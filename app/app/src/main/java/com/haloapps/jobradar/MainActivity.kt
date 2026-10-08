package com.haloapps.jobradar

import android.Manifest
import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.FileProvider
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job as CoJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import java.io.File

class MainActivity : ComponentActivity() {
    private val askNotify = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }
    private val vm: MainVM by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        askNotify.launch(Manifest.permission.POST_NOTIFICATIONS)
        SyncWorker.schedule(this)
        handleShare(intent)
        setContent { RadarTheme { App(vm) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleShare(intent)
    }

    /** "Share" a job from LinkedIn, Indeed, Chrome... into Job Radar. */
    private fun handleShare(i: Intent?) {
        if (i?.action != Intent.ACTION_SEND) return
        val text = i.getStringExtra(Intent.EXTRA_TEXT) ?: return
        val subject = i.getStringExtra(Intent.EXTRA_SUBJECT).orEmpty()
        vm.pendingShare = SharedJob.from(text, subject)
    }
}

data class SharedJob(val url: String, val title: String) {
    companion object {
        fun from(text: String, subject: String): SharedJob {
            val url = Regex("https?://\\S+").find(text)?.value?.trimEnd('.', ',', ')') ?: ""
            val title = subject.ifBlank { text.replace(url, "").lines().firstOrNull { it.isNotBlank() }.orEmpty() }.trim().take(120)
            return SharedJob(url, title)
        }
    }
}

// ---------------------------------------------------------------------------- state

class MainVM(app: Application) : AndroidViewModel(app) {
    val repo = Repo(app)
    var file by mutableStateOf(repo.cachedJobs())
    var statuses by mutableStateOf(repo.statuses())
    var loading by mutableStateOf(false)
    var busyJob by mutableStateOf<String?>(null)
    var message by mutableStateOf<String?>(null)
    var resumeJson by mutableStateOf(parse(repo.cachedText("resume.json")))
    var searchJson by mutableStateOf(parse(repo.cachedText("search.json")))
    var report by mutableStateOf(parse(repo.cachedText("report.json")))
    var pendingShare by mutableStateOf<SharedJob?>(null)
    var saving by mutableStateOf(false)
    private var backupJob: CoJob? = null

    private fun parse(s: String?): JsonObject? = try {
        s?.let { repo.json.parseToJsonElement(it).jsonObject }
    } catch (e: Exception) {
        null
    }

    fun status(id: String): String? = statuses[id]?.status

    fun refresh() {
        if (loading) return
        viewModelScope.launch {
            loading = true
            try {
                repo.restoreStateIfEmpty()
                statuses = repo.statuses()
                val f = repo.refreshJobs()
                file = f
                repo.markKnown(f)
                runCatching {
                    resumeJson = parse(repo.refreshText("profile/resume.json", "resume.json"))
                    ((resumeJson?.get("contact") as? JsonObject)?.get("name") as? JsonPrimitive)?.content?.let { repo.personName = it }
                }
                runCatching { searchJson = parse(repo.refreshText("profile/search.json", "search.json")) }
                runCatching { report = parse(repo.refreshText("data/report.json", "report.json")) }
            } catch (e: Exception) {
                message = e.message
            } finally {
                loading = false
            }
        }
    }

    fun setStatus(id: String, s: String?) {
        repo.setStatus(id, s)
        statuses = repo.statuses()
        scheduleBackup()
    }

    fun toggle(id: String, s: String) = setStatus(id, if (status(id) == s) null else s)

    fun setNote(id: String, note: String) {
        repo.setNote(id, note)
        statuses = repo.statuses()
        scheduleBackup()
    }

    /** Statuses are copied to the repo a few seconds after the last change (survives reinstall). */
    private fun scheduleBackup() {
        backupJob?.cancel()
        backupJob = viewModelScope.launch {
            delay(4000)
            runCatching { repo.backupState() }
        }
    }

    /** The one tap: resume to Downloads + share-ready, cover letter on clipboard, application page open. */
    fun quickApply(ctx: Context, job: Job) {
        viewModelScope.launch {
            busyJob = job.id
            try {
                val pdf = repo.resumeFile(job, "pdf")
                repo.exportToDownloads(pdf)
                job.coverLetter?.let { repo.copy("Cover letter", it) }
                openUrl(ctx, job.link)
                setStatus(job.id, Status.APPLIED)
                message = "Resume saved to Downloads/JobRadar" + (if (job.coverLetter != null) " · cover letter copied" else "") +
                    ". Attach it on the page that just opened."
            } catch (e: Exception) {
                message = "Couldn't prepare the resume: ${e.message}"
                openUrl(ctx, job.link)
            } finally {
                busyJob = null
            }
        }
    }

    fun shareResume(ctx: Context, job: Job?, ext: String) {
        viewModelScope.launch {
            busyJob = job?.id ?: "base"
            try {
                share(ctx, repo.resumeFile(job, ext))
            } catch (e: Exception) {
                message = e.message
            } finally {
                busyJob = null
            }
        }
    }

    fun saveResume(job: Job?, ext: String) {
        viewModelScope.launch {
            try {
                repo.exportToDownloads(repo.resumeFile(job, ext))
                message = "Saved to Downloads/JobRadar"
            } catch (e: Exception) {
                message = e.message
            }
        }
    }

    fun runSearchNow() {
        viewModelScope.launch {
            try {
                repo.runSearchNow()
                message = "Search started on GitHub. New jobs arrive in about 10–15 minutes."
            } catch (e: Exception) {
                message = e.message
            }
        }
    }

    fun addJob(url: String, title: String, company: String, description: String, onDone: () -> Unit) {
        viewModelScope.launch {
            saving = true
            try {
                repo.submitRequest("add_job", mapOf("url" to url, "title" to title, "company" to company, "description" to description))
                message = "Added. Your tailored resume and cover letter will appear in about 3–5 minutes (tap ↻)."
                onDone()
            } catch (e: Exception) {
                message = e.message
            } finally {
                saving = false
            }
        }
    }

    fun requestPrep(job: Job) {
        viewModelScope.launch {
            try {
                repo.submitRequest("prep", mapOf("job_id" to job.id))
                if (status(job.id) !in Status.PIPELINE) setStatus(job.id, Status.INTERVIEW)
                message = "Writing your interview prep. It'll be ready in about 3–5 minutes (tap ↻)."
            } catch (e: Exception) {
                message = e.message
            }
        }
    }

    fun requestRetailor(job: Job) {
        viewModelScope.launch {
            try {
                repo.submitRequest("retailor", mapOf("job_id" to job.id))
                message = "Re-writing this resume. Ready in about 3–5 minutes (tap ↻)."
            } catch (e: Exception) {
                message = e.message
            }
        }
    }

    suspend fun loadPrep(job: Job): String = repo.fetchBytes(job.prep ?: "").decodeToString()

    fun saveProfile(o: JsonObject, onDone: () -> Unit) {
        viewModelScope.launch {
            saving = true
            try {
                repo.putFile("profile/resume.json", repo.prettyJson(o) + "\n", "app: update profile")
                resumeJson = o
                message = "Profile saved. Every resume is being re-written with it (about 5 minutes)."
                onDone()
            } catch (e: Exception) {
                message = e.message
            } finally {
                saving = false
            }
        }
    }

    fun saveSearch(o: JsonObject, onDone: () -> Unit) {
        viewModelScope.launch {
            saving = true
            try {
                repo.putFile("profile/search.json", repo.prettyJson(o) + "\n", "Search settings updated from app")
                searchJson = o
                message = "Search settings saved. A new search is running (about 10–15 minutes)."
                onDone()
            } catch (e: Exception) {
                message = e.message
            } finally {
                saving = false
            }
        }
    }

    suspend fun saveEdits(job: Job, t: Tailored) {
        try {
            repo.submitJson("edit", JsonObject(mapOf("job_id" to JsonPrimitive(job.id),
                "tailored" to repo.json.encodeToJsonElement(Tailored.serializer(), t))))
            message = "Edits saved. The web app and Chrome extension get the same version in about a minute."
        } catch (e: Exception) {
            message = e.message
        }
    }

    /** "<Name>'s Job Radar", from the profile. */
    val title: String get() = (resumeJson?.get("contact") as? JsonObject)?.get("name")?.let { (it as? JsonPrimitive)?.content }
        ?.takeIf { it.isNotBlank() }?.let { "$it's Job Radar" } ?: "Job Radar"

    fun copy(label: String, text: String) {
        repo.copy(label, text)
        message = "$label copied"
    }

    fun answers(): List<Pair<String, String>> {
        val r = resumeJson ?: return emptyList()
        val out = mutableListOf<Pair<String, String>>()
        listOf("contact", "application_answers").forEach { key ->
            (r[key] as? JsonObject)?.forEach { (k, v) ->
                val text = (v as? JsonPrimitive)?.content ?: return@forEach
                if (out.none { it.second == text }) out += k.replace('_', ' ').replaceFirstChar { it.uppercase() } to text
            }
        }
        return out
    }
}

fun openUrl(ctx: Context, url: String) {
    if (url.isBlank()) return
    try {
        CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(ctx, Uri.parse(url))
    } catch (e: Exception) {
        ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}

fun share(ctx: Context, f: File) {
    val uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".files", f)
    val mime = if (f.name.endsWith(".pdf")) "application/pdf" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    val send = Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    ctx.startActivity(Intent.createChooser(send, "Send resume").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

// ---------------------------------------------------------------------------- shell

enum class NavTab(val label: String) { Jobs("Jobs"), Boards("Boards"), Profile("Me"), Settings("Settings") }

sealed class Overlay {
    data class JobDetail(val id: String) : Overlay()
    data class Prep(val id: String) : Overlay()
    data class Review(val id: String) : Overlay()
    data object EditProfile : Overlay()
    data object EditSearch : Overlay()
}

@Composable
fun App(vm: MainVM) {
    var tab by remember { mutableStateOf(if (vm.repo.configured) NavTab.Jobs else NavTab.Settings) }
    var overlay by remember { mutableStateOf<Overlay?>(null) }
    var addOpen by remember { mutableStateOf(false) }
    val snack = remember { SnackbarHostState() }

    LaunchedEffect(Unit) { if (vm.repo.configured) vm.refresh() }
    LaunchedEffect(vm.message) {
        vm.message?.let { snack.showSnackbar(it); vm.message = null }
    }
    LaunchedEffect(vm.pendingShare) { if (vm.pendingShare != null) addOpen = true }
    BackHandler(enabled = overlay != null) {
        overlay = when (val o = overlay) {
            is Overlay.Prep -> Overlay.JobDetail(o.id)
            is Overlay.Review -> Overlay.JobDetail(o.id)
            else -> null
        }
    }

    if (addOpen) {
        AddJobDialog(vm, vm.pendingShare) { addOpen = false; vm.pendingShare = null }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snack) },
        bottomBar = {
            if (overlay == null) NavigationBar {
                NavTab.entries.forEach { t ->
                    NavigationBarItem(
                        selected = tab == t, onClick = { tab = t }, label = { Text(t.label) },
                        icon = {
                            Icon(
                                when (t) {
                                    NavTab.Jobs -> Icons.Filled.Home
                                    NavTab.Boards -> Icons.Filled.Search
                                    NavTab.Profile -> Icons.Filled.Person
                                    NavTab.Settings -> Icons.Filled.Settings
                                }, contentDescription = t.label
                            )
                        },
                    )
                }
            }
        },
    ) { pad ->
        val m = Modifier.padding(pad)
        fun jobFor(id: String) = vm.file?.jobs?.firstOrNull { it.id == id }
        when (val o = overlay) {
            is Overlay.JobDetail -> jobFor(o.id)?.let {
                DetailScreen(vm, it, m, onBack = { overlay = null }, onPrep = { overlay = Overlay.Prep(o.id) }, onReview = { overlay = Overlay.Review(o.id) })
            } ?: run { overlay = null }
            is Overlay.Review -> jobFor(o.id)?.let { ReviewScreen(vm, it, m) { overlay = Overlay.JobDetail(o.id) } } ?: run { overlay = null }
            is Overlay.Prep -> jobFor(o.id)?.let { PrepScreen(vm, it, m) { overlay = Overlay.JobDetail(o.id) } } ?: run { overlay = null }
            Overlay.EditProfile -> ProfileEditor(vm, m) { overlay = null }
            Overlay.EditSearch -> SearchEditor(vm, m) { overlay = null }
            null -> when (tab) {
                NavTab.Jobs -> JobsScreen(vm, m, onOpen = { overlay = Overlay.JobDetail(it) }, onAdd = { addOpen = true })
                NavTab.Boards -> BoardsScreen(m)
                NavTab.Profile -> ProfileScreen(vm, m) { overlay = Overlay.EditProfile }
                NavTab.Settings -> SettingsScreen(vm, m, onDone = { tab = NavTab.Jobs }, onEditSearch = { overlay = Overlay.EditSearch })
            }
        }
    }
}

@Composable
fun RadarTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val ctx = LocalContext.current
    val scheme = when {
        android.os.Build.VERSION.SDK_INT >= 31 -> if (dark) dynamicDarkColorScheme(ctx) else dynamicLightColorScheme(ctx)
        dark -> darkColorScheme(primary = Color(0xFF7FD3C3))
        else -> lightColorScheme(primary = Color(0xFF0F4C5C))
    }
    MaterialTheme(colorScheme = scheme, content = content)
}
