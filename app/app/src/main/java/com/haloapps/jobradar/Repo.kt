package com.haloapps.jobradar

import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Talks to the private GitHub repo the search engine writes to, and keeps local state. */
class Repo(private val ctx: Context) {
    private val prefs = ctx.getSharedPreferences("jobradar", Context.MODE_PRIVATE)
    private val http = OkHttpClient.Builder().callTimeout(90, TimeUnit.SECONDS).build()
    val json = Json { ignoreUnknownKeys = true; coerceInputValues = true; isLenient = true; encodeDefaults = true }
    val pretty = Json { prettyPrint = true; prettyPrintIndent = "  " }

    var owner: String
        get() = prefs.getString("owner", "")!!
        set(v) = prefs.edit().putString("owner", v.trim()).apply()
    var repo: String
        get() = prefs.getString("repo", "job-radar")!!
        set(v) = prefs.edit().putString("repo", v.trim()).apply()
    var token: String
        get() = prefs.getString("token", "")!!
        set(v) = prefs.edit().putString("token", v.trim()).apply()
    var notifyMin: Int
        get() = prefs.getInt("notifyMin", 65)
        set(v) = prefs.edit().putInt("notifyMin", v).apply()
    var followUpDays: Int
        get() = prefs.getInt("followUpDays", 7)
        set(v) = prefs.edit().putInt("followUpDays", v).apply()

    val configured: Boolean get() = token.isNotBlank() && owner.isNotBlank() && repo.isNotBlank()

    // ------------------------------------------------------------------ GitHub

    private val api get() = "https://api.github.com/repos/$owner/$repo"

    private fun auth(b: Request.Builder) = b.header("Authorization", "Bearer $token").header("X-GitHub-Api-Version", "2022-11-28")

    private fun explain(code: Int, msg: String, writing: Boolean = false) = when (code) {
        401 -> "GitHub 401: token is invalid or expired"
        403 -> if (writing) "GitHub 403: your token needs Contents: Read and write (edit it on GitHub)" else "GitHub 403: token can't read this repo"
        404 -> if (writing) "GitHub 404: token can't write to this repo – give it Contents: Read and write" else "GitHub 404: not found yet (has the first search finished?)"
        409, 422 -> "GitHub $code: file changed meanwhile, try again"
        else -> "GitHub $code: $msg"
    }

    suspend fun fetchBytes(path: String): ByteArray = withContext(Dispatchers.IO) {
        if (!configured) throw IOException("Add your GitHub token in Settings first")
        val req = auth(Request.Builder().url("$api/contents/$path?ref=main")).header("Accept", "application/vnd.github.raw+json").build()
        http.newCall(req).execute().use { r ->
            if (!r.isSuccessful) throw IOException(explain(r.code, r.message))
            r.body!!.bytes()
        }
    }

    private fun shaOf(path: String): String? {
        val req = auth(Request.Builder().url("$api/contents/$path?ref=main")).header("Accept", "application/vnd.github+json").build()
        http.newCall(req).execute().use { r ->
            if (r.code == 404) return null
            if (!r.isSuccessful) throw IOException(explain(r.code, r.message))
            return json.parseToJsonElement(r.body!!.string()).jsonObject["sha"]?.jsonPrimitive?.contentOrNull
        }
    }

    /** Create or replace a file in the repo (one commit). */
    suspend fun putFile(path: String, content: String, message: String) = withContext(Dispatchers.IO) {
        if (!configured) throw IOException("Add your GitHub token in Settings first")
        val sha = shaOf(path)
        val body = buildJsonObject {
            put("message", message)
            put("content", Base64.encodeToString(content.toByteArray(), Base64.NO_WRAP))
            put("branch", "main")
            if (sha != null) put("sha", sha)
        }.toString()
        val req = auth(Request.Builder().url("$api/contents/$path")).header("Accept", "application/vnd.github+json")
            .put(body.toRequestBody("application/json".toMediaType())).build()
        http.newCall(req).execute().use { r ->
            if (!r.isSuccessful) throw IOException(explain(r.code, r.message, writing = true))
        }
    }

    suspend fun refreshJobs(): JobsFile {
        val bytes = fetchBytes("data/jobs.json")
        File(ctx.filesDir, "jobs.json").writeBytes(bytes)
        return json.decodeFromString(JobsFile.serializer(), bytes.decodeToString())
    }

    fun cachedJobs(): JobsFile? = try {
        val f = File(ctx.filesDir, "jobs.json")
        if (f.exists()) json.decodeFromString(JobsFile.serializer(), f.readText()) else null
    } catch (e: Exception) {
        null
    }

    suspend fun refreshText(path: String, cacheName: String): String {
        val text = fetchBytes(path).decodeToString()
        File(ctx.filesDir, cacheName).writeText(text)
        return text
    }

    fun cachedText(cacheName: String): String? = File(ctx.filesDir, cacheName).takeIf { it.exists() }?.readText()

    /** Starts the search workflow on GitHub right away (needs Actions: write on the token). */
    suspend fun runSearchNow() = withContext(Dispatchers.IO) {
        val req = auth(Request.Builder().url("$api/actions/workflows/search.yml/dispatches"))
            .header("Accept", "application/vnd.github+json")
            .post("""{"ref":"main"}""".toRequestBody("application/json".toMediaType()))
            .build()
        http.newCall(req).execute().use { r ->
            if (r.code != 204) throw IOException("GitHub ${r.code}: token needs Actions read & write permission")
        }
    }

    /** Ask the engine to do something (add a job, write interview prep). Processed within a few minutes. */
    suspend fun submitRequest(type: String, fields: Map<String, String>) {
        val obj = buildJsonObject {
            put("type", type)
            fields.forEach { (k, v) -> put(k, v) }
        }
        val name = "requests/${System.currentTimeMillis()}-$type.json"
        putFile(name, obj.toString(), "app: $type")
    }

    /** Same as submitRequest but for structured payloads (e.g. resume edits). */
    suspend fun submitJson(type: String, payload: JsonObject) {
        val obj = JsonObject(payload + ("type" to JsonPrimitive(type)))
        putFile("requests/${System.currentTimeMillis()}-$type.json", obj.toString(), "app: $type")
    }

    // ------------------------------------------------------------------ statuses (pipeline)

    fun statuses(): Map<String, StatusEntry> {
        val raw = prefs.getString("status", "{}")!!
        return try {
            json.parseToJsonElement(raw).jsonObject.mapValues { (_, v) ->
                if (v is JsonPrimitive) StatusEntry(v.content, 0L) // old format: plain string
                else json.decodeFromJsonElement(StatusEntry.serializer(), v)
            }
        } catch (e: Exception) {
            emptyMap()
        }
    }

    private fun writeStatuses(m: Map<String, StatusEntry>) {
        prefs.edit().putString("status", json.encodeToString(MapSerializer(String.serializer(), StatusEntry.serializer()), m)).apply()
    }

    fun setStatus(id: String, status: String?, note: String? = null) {
        val m = statuses().toMutableMap()
        val old = m[id]
        if (status == null) m.remove(id)
        else {
            val hist = (old?.history ?: emptyList()) + "${java.time.LocalDate.now()} ${Status.label(status)}"
            m[id] = StatusEntry(status, if (old?.status == status) old.at else System.currentTimeMillis(), note ?: old?.note ?: "", hist.takeLast(12))
        }
        writeStatuses(m)
    }

    fun setNote(id: String, note: String) {
        val m = statuses().toMutableMap()
        val old = m[id] ?: StatusEntry(Status.SAVED)
        m[id] = old.copy(note = note)
        writeStatuses(m)
    }

    /** Back up statuses to the repo (user/state.json) so they survive reinstalling and the engine keeps tracked jobs. */
    suspend fun backupState() {
        putFile("user/state.json", json.encodeToString(UserState.serializer(), UserState(statuses())), "Update application tracker")
    }

    /** On a fresh install, bring statuses back from the repo. */
    suspend fun restoreStateIfEmpty() {
        if (statuses().isNotEmpty()) return
        try {
            val st = json.decodeFromString(UserState.serializer(), fetchBytes("user/state.json").decodeToString())
            if (st.statuses.isNotEmpty()) writeStatuses(st.statuses)
        } catch (e: Exception) {
            // nothing backed up yet
        }
    }

    /** Ids already shown to the user, so notifications only announce new ones. */
    fun knownIds(): Set<String> = prefs.getStringSet("known", emptySet())!!
    fun markKnown(file: JobsFile) = prefs.edit().putStringSet("known", file.jobs.map { it.id }.toSet() + knownIds()).apply()

    fun followedUp(): Set<String> = prefs.getStringSet("followed", emptySet())!!
    fun markFollowedUp(ids: Collection<String>) = prefs.edit().putStringSet("followed", followedUp() + ids).apply()

    // ------------------------------------------------------------------ resume files

    suspend fun resumeFile(job: Job?, ext: String = "pdf", fresh: Boolean = false): File {
        val dir = File(ctx.filesDir, "resumes").apply { mkdirs() }
        val remote = when {
            job == null -> "data/resumes/base.$ext"
            ext == "pdf" -> job.resumePdf ?: "data/resumes/base.pdf"
            else -> job.resumeDocx ?: "data/resumes/base.docx"
        }
        val name = remote.substringAfterLast('/')
        // cache key changes whenever the engine re-tailors (new profile or AI rewrite)
        val local = File(dir, if (job == null) name else "${job.profileHash}-${job.tailorMethod}-$name")
        if (fresh || !local.exists() || name.startsWith("base")) local.writeBytes(fetchBytes(remote))
        val nice = File(dir, displayName(job, ext))
        local.copyTo(nice, overwrite = true)
        return nice
    }

    fun clearResumeCache() {
        File(ctx.filesDir, "resumes").listFiles()?.forEach { it.delete() }
    }

    /** Person's name for file names, saved whenever the profile loads. */
    var personName: String
        get() = prefs.getString("personName", "")!!
        set(v) = prefs.edit().putString("personName", v).apply()

    fun displayName(job: Job?, ext: String): String {
        val who = personName.replace(Regex("[^A-Za-z0-9]+"), "_").trim('_').ifBlank { "My" }
        val co = job?.company?.replace(Regex("[^A-Za-z0-9]+"), "")?.take(24).orEmpty()
        return if (co.isBlank()) "${who}_Resume.$ext" else "${who}_Resume_$co.$ext"
    }

    /** Copies a file into Downloads/JobRadar so any site's file picker can find it. */
    fun exportToDownloads(file: File): Uri? {
        val mime = if (file.name.endsWith(".pdf")) "application/pdf"
        else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        val resolver = ctx.contentResolver
        try {
            resolver.delete(
                MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                "${MediaStore.MediaColumns.DISPLAY_NAME}=? AND ${MediaStore.MediaColumns.RELATIVE_PATH}=?",
                arrayOf(file.name, Environment.DIRECTORY_DOWNLOADS + "/JobRadar/"),
            )
        } catch (e: Exception) {
            // not ours to delete; a numbered copy is fine
        }
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, file.name)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/JobRadar")
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return null
        resolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } }
        return uri
    }

    fun copy(label: String, text: String) {
        val cm = ctx.getSystemService(ClipboardManager::class.java)
        cm.setPrimaryClip(ClipData.newPlainText(label, text))
    }

    fun prettyJson(o: JsonObject): String = pretty.encodeToString(JsonObject.serializer(), o)
}
