package com.haloapps.jobradar

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** Every few hours: pull the latest jobs.json and notify about new strong matches. */
class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result {
        val repo = Repo(applicationContext)
        if (!repo.configured) return Result.success()
        return try {
            val firstEver = repo.knownIds().isEmpty()
            val file = repo.refreshJobs()
            val known = repo.knownIds()
            val fresh = file.jobs.filter { it.id !in known && it.score >= repo.notifyMin }
            repo.markKnown(file)
            if (!firstEver && fresh.isNotEmpty()) notify(applicationContext, fresh)
            followUps(applicationContext, repo, file)
            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }

    companion object {
        private const val CHANNEL = "matches"

        fun schedule(ctx: Context) {
            val req = PeriodicWorkRequestBuilder<SyncWorker>(2, TimeUnit.HOURS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("sync", ExistingPeriodicWorkPolicy.KEEP, req)
        }

        /** Nudge to follow up on applications that have had no update for a while. */
        fun followUps(ctx: Context, repo: Repo, file: JobsFile) {
            val cutoff = System.currentTimeMillis() - TimeUnit.DAYS.toMillis(repo.followUpDays.toLong())
            val done = repo.followedUp()
            val due = repo.statuses().filter { (id, e) -> e.status == Status.APPLIED && e.at in 1 until cutoff && id !in done }
            if (due.isEmpty()) return
            val jobs = file.jobs.associateBy { it.id }
            val names = due.keys.mapNotNull { jobs[it] }.map { "${it.title} — ${it.company}" }
            repo.markFollowedUp(due.keys)
            if (names.isEmpty()) return
            post(ctx, 2, "Time to follow up on ${names.size} application${if (names.size == 1) "" else "s"}",
                names.first(), names.take(5))
        }

        private fun post(ctx: Context, id: Int, title: String, text: String, lines: List<String>) {
            val nm = ctx.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "New job matches", NotificationManager.IMPORTANCE_DEFAULT))
            if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
            val open = PendingIntent.getActivity(
                ctx, id, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val style = NotificationCompat.InboxStyle()
            lines.forEach { style.addLine(it) }
            val n = NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_notify).setContentTitle(title).setContentText(text)
                .setStyle(style).setContentIntent(open).setAutoCancel(true).build()
            NotificationManagerCompat.from(ctx).notify(id, n)
        }

        fun notify(ctx: Context, jobs: List<Job>) {
            val nm = ctx.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "New job matches", NotificationManager.IMPORTANCE_DEFAULT))
            if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
            val top = jobs.sortedByDescending { it.score }
            val open = PendingIntent.getActivity(
                ctx, 0, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val style = NotificationCompat.InboxStyle()
            top.take(5).forEach { style.addLine("${it.score} · ${it.title} — ${it.company}") }
            val n = NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle("${jobs.size} new job match${if (jobs.size == 1) "" else "es"}")
                .setContentText("${top[0].title} — ${top[0].company}")
                .setStyle(style)
                .setContentIntent(open)
                .setAutoCancel(true)
                .build()
            NotificationManagerCompat.from(ctx).notify(1, n)
        }
    }
}
