package com.haloapps.jobradar

import android.content.Context
import android.graphics.Color as AColor
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.io.File

// ------------------------------------------------------------------ data

@Serializable
data class TExp(val id: String, val bullets: List<String> = emptyList())

@Serializable
data class Tailored(
    val headline: String = "",
    val summary: String = "",
    val skills: List<String> = emptyList(),
    val experience: List<TExp> = emptyList(),
    val projects: List<String> = emptyList(),
    @SerialName("cover_letter") val coverLetter: String = "",
    val method: String? = null,
)

data class Role(val id: String, val title: String, val company: String, val location: String, val start: String, val end: String,
                val core: List<String>, val flex: List<String>)

/** The parts of profile/resume.json the review screen and PDF need. */
class Master(val o: JsonObject) {
    private fun JsonObject?.s(k: String) = (this?.get(k) as? JsonPrimitive)?.contentOrNull.orEmpty()
    private fun JsonObject?.list(k: String) = (this?.get(k) as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty()
    val contact = o["contact"] as? JsonObject
    val name get() = contact.s("name")
    val roles: List<Role> = ((o["experience"] as? JsonArray) ?: JsonArray(emptyList())).mapNotNull { it as? JsonObject }.map { e ->
        Role(e.s("id"), e.s("title"), e.s("company"), e.s("location"), e.s("start"), e.s("end"), e.list("core"),
            ((e["flex"] as? JsonArray) ?: JsonArray(emptyList())).mapNotNull { f -> (f as? JsonObject).s("text").ifBlank { null } })
    }
    val certifications = o.list("certifications")
    val education: List<String> = ((o["education"] as? JsonArray) ?: JsonArray(emptyList())).mapNotNull { it as? JsonObject }.map { e ->
        listOf(e.s("credential"), listOf(e.s("school"), e.s("dates")).filter { it.isNotBlank() }.joinToString(", ")).filter { it.isNotBlank() }.joinToString(" – ")
    }
    val projects: Map<String, String> = ((o["projects"] as? JsonArray) ?: JsonArray(emptyList())).mapNotNull { it as? JsonObject }
        .associate { it.s("name") to it.s("text") }
    fun contactLine() = listOf(contact.s("location"), contact.s("phone"), contact.s("email"), contact.s("linkedin").replace("https://www.", ""))
        .filter { it.isNotBlank() }.joinToString("  ·  ")
    val displayName get() = contact.s("display_name").ifBlank { name }
    val workAuth get() = contact.s("work_authorization")
}

// ------------------------------------------------------------------ on-device PDF (so edits can be used instantly)

object PdfMaker {
    private const val W = 612
    private const val H = 792
    private const val M = 43f
    private val TEAL = AColor.rgb(15, 76, 92)

    fun make(ctx: Context, t: Tailored, m: Master, fileName: String): File {
        val doc = PdfDocument()
        var pageNo = 1
        var page = doc.startPage(PdfDocument.PageInfo.Builder(W, H, pageNo).create())
        var canvas = page.canvas
        var y = 44f
        val cw = (W - 2 * M).toInt()

        fun paint(size: Float, bold: Boolean = false, italic: Boolean = false, color: Int = AColor.rgb(25, 25, 25)) = TextPaint().apply {
            isAntiAlias = true; textSize = size; this.color = color
            typeface = Typeface.create(Typeface.SANS_SERIF, when { bold && italic -> Typeface.BOLD_ITALIC; bold -> Typeface.BOLD; italic -> Typeface.ITALIC; else -> Typeface.NORMAL })
        }
        fun newPageIfNeeded(h: Float) {
            if (y + h > H - 40) {
                doc.finishPage(page); pageNo++
                page = doc.startPage(PdfDocument.PageInfo.Builder(W, H, pageNo).create()); canvas = page.canvas; y = 44f
            }
        }
        fun text(s: String, p: TextPaint, indent: Float = 0f) {
            if (s.isBlank()) return
            val layout = StaticLayout.Builder.obtain(s, 0, s.length, p, cw - indent.toInt()).setAlignment(Layout.Alignment.ALIGN_NORMAL)
                .setLineSpacing(0f, 1.12f).build()
            // split across pages line by line
            for (i in 0 until layout.lineCount) {
                val lh = (layout.getLineBottom(i) - layout.getLineTop(i)).toFloat()
                newPageIfNeeded(lh)
                canvas.drawText(s, layout.getLineStart(i), layout.getLineEnd(i), M + indent, y + lh * 0.8f, p)
                y += lh
            }
        }
        fun section(title: String) {
            y += 8f; newPageIfNeeded(26f)
            canvas.drawText(title.uppercase(), M, y + 10f, paint(10f, bold = true, color = TEAL))
            y += 14f
            canvas.drawLine(M, y, W - M, y, Paint().apply { color = TEAL; strokeWidth = 0.6f })
            y += 6f
        }

        text(m.displayName, paint(20f, bold = true, color = AColor.rgb(17, 17, 17)))
        text(t.headline, paint(10.5f, bold = true, color = TEAL))
        text(m.contactLine(), paint(8.8f, color = AColor.rgb(68, 68, 68)))
        text(m.workAuth, paint(8.8f, color = AColor.rgb(68, 68, 68)))
        if (t.summary.isNotBlank()) { section("Summary"); text(t.summary, paint(9.3f)) }
        if (t.skills.isNotEmpty()) { section("Core skills"); text(t.skills.joinToString("  •  "), paint(9.3f)) }
        val roles = m.roles.associateBy { it.id }
        if (t.experience.isNotEmpty()) section("Professional experience")
        for (e in t.experience) {
            val r = roles[e.id] ?: continue
            newPageIfNeeded(30f)
            val tp = paint(9.8f, bold = true, color = AColor.rgb(17, 17, 17))
            val dp = paint(9f, color = AColor.rgb(68, 68, 68))
            val dates = listOf(r.start, r.end).filter { it.isNotBlank() }.joinToString(" – ")
            canvas.drawText(r.title, M, y + 10f, tp)
            canvas.drawText(dates, W - M - dp.measureText(dates), y + 10f, dp)
            y += 13f
            text(listOf(r.company, r.location).filter { it.isNotBlank() }.joinToString(", "), paint(9.1f, italic = true, color = AColor.rgb(51, 51, 51)))
            y += 2f
            for (b in e.bullets) {
                newPageIfNeeded(12f)
                canvas.drawText("•", M + 2f, y + 9.5f, paint(9.2f))
                text(b, paint(9.2f), indent = 12f)
            }
            y += 3f
        }
        val projects = t.projects.mapNotNull { n -> m.projects[n]?.let { "$n – $it" } }
        if (projects.isNotEmpty()) { section("Selected projects"); projects.forEach { text(it, paint(9.3f)) } }
        if (m.certifications.isNotEmpty()) { section("Certifications"); text(m.certifications.joinToString("  •  "), paint(9.3f)) }
        if (m.education.isNotEmpty()) { section("Education"); m.education.forEach { text(it, paint(9.3f)) } }
        doc.finishPage(page)
        val dir = File(ctx.cacheDir, "pdf").apply { mkdirs() }
        val f = File(dir, fileName)
        f.outputStream().use { doc.writeTo(it) }
        doc.close()
        return f
    }
}

// ------------------------------------------------------------------ review & edit screen

private val ADDED = Color(0x3327A86B)
private val CHANGED = Color(0x40E9A23B)

@Composable
fun ReviewScreen(vm: MainVM, job: Job, modifier: Modifier, onBack: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var original by remember { mutableStateOf<Tailored?>(null) }
    var base by remember { mutableStateOf<Tailored?>(null) }
    var draft by remember { mutableStateOf<Tailored?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var tab by remember { mutableStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    val master = vm.resumeJson?.let { Master(it) }

    LaunchedEffect(job.id, job.resumePdf) {
        try {
            base = runCatching { vm.repo.json.decodeFromString(Tailored.serializer(), vm.repo.fetchBytes("data/resumes/base.json").decodeToString()) }.getOrNull()
            val t = if (job.resumePdf != null) vm.repo.json.decodeFromString(Tailored.serializer(), vm.repo.fetchBytes("data/resumes/${job.id}.json").decodeToString())
                    else (base ?: Tailored()).copy(coverLetter = job.coverLetter.orEmpty())
            original = t; draft = t
        } catch (e: Exception) {
            error = e.message
        }
    }
    val dirty = draft != null && draft != original

    fun buildPdf(): File? {
        val d = draft ?: return null
        val m = master ?: return null
        return PdfMaker.make(ctx, d, m, vm.repo.displayName(job, "pdf"))
    }

    Column(modifier.fillMaxSize()) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(4.dp)) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Column(Modifier.weight(1f)) {
                Text("Review and apply", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text("${job.title} · ${job.company}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            }
        }
        Column(Modifier.padding(horizontal = 16.dp)) {
            Button(onClick = {
                scope.launch {
                    busy = true
                    try {
                        val pdf = buildPdf() ?: vm.repo.resumeFile(job, "pdf")
                        vm.repo.exportToDownloads(pdf)
                        draft?.coverLetter?.takeIf { it.isNotBlank() }?.let { vm.repo.copy("Cover letter", it) }
                        openUrl(ctx, job.link)
                        vm.setStatus(job.id, Status.APPLIED)
                        if (dirty) vm.saveEdits(job, draft!!)
                        original = draft
                        vm.message = "Resume saved to Downloads/JobRadar" + (if (draft?.coverLetter.isNullOrBlank()) "" else ", cover letter copied") +
                            ". Attach it on the page that just opened."
                    } catch (e: Exception) {
                        vm.message = e.message
                    } finally {
                        busy = false
                    }
                }
            }, enabled = !busy && draft != null, modifier = Modifier.fillMaxWidth().height(54.dp)) {
                if (busy) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                else Text(if (dirty) "Apply now with my edits" else "Apply now")
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 6.dp)) {
                OutlinedButton(onClick = { buildPdf()?.let { share(ctx, it) } }, enabled = draft != null) { Text("Share PDF") }
                if (dirty) {
                    OutlinedButton(onClick = { scope.launch { vm.saveEdits(job, draft!!); original = draft } }) { Text("Save edits") }
                    TextButton(onClick = { draft = original }) { Text("Undo") }
                }
            }
        }
        TabRow(selectedTabIndex = tab, modifier = Modifier.padding(top = 8.dp)) {
            Tab(tab == 0, { tab = 0 }, text = { Text("What changed") })
            Tab(tab == 1, { tab = 1 }, text = { Text("Edit") })
        }
        val d = draft
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            when {
                error != null -> Text(error!!)
                d == null || master == null -> CircularProgressIndicator()
                tab == 0 -> DiffView(d, base, master)
                else -> EditView(d, master) { draft = it }
            }
            Spacer(Modifier.height(40.dp))
        }
    }
}

@Composable
private fun Mark(text: String, bg: Color? = null, struck: Boolean = false) {
    Text(text, style = MaterialTheme.typography.bodyMedium,
        textDecoration = if (struck) TextDecoration.LineThrough else null,
        color = if (struck) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
        modifier = if (bg != null) Modifier.background(bg, RoundedCornerShape(4.dp)).padding(horizontal = 3.dp) else Modifier)
}

@Composable
private fun Head(s: String) {
    Text(s, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(top = 14.dp, bottom = 4.dp))
}

@Composable
private fun DiffView(t: Tailored, base: Tailored?, m: Master) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Mark("added for this job", ADDED); Mark("reworded", CHANGED); Mark("left out", struck = true)
    }
    Head("Headline")
    Mark(t.headline, if (base != null && t.headline != base.headline) CHANGED else null)
    Head("Summary")
    Mark(t.summary, if (base != null && t.summary != base.summary) CHANGED else null)
    Head("Skills")
    val baseSkills = base?.skills?.toSet() ?: emptySet()
    t.skills.forEach { Mark("• $it", if (base != null && it !in baseSkills) ADDED else null) }
    base?.skills?.filter { it !in t.skills }?.forEach { Mark("• $it", struck = true) }
    val roles = m.roles.associateBy { it.id }
    val baseExp = base?.experience?.associate { it.id to it.bullets } ?: emptyMap()
    t.experience.forEach { e ->
        val r = roles[e.id] ?: return@forEach
        Head("${r.title}, ${r.company}")
        e.bullets.forEach { b ->
            val original = b in r.core || b in r.flex
            val bg = when { !original -> CHANGED; base != null && b !in (baseExp[e.id] ?: emptyList()) -> ADDED; else -> null }
            Mark("• $b", bg)
            Spacer(Modifier.height(3.dp))
        }
        baseExp[e.id]?.filter { it !in e.bullets }?.forEach { Mark("• $it", struck = true) }
    }
    Head("Cover letter")
    Text(t.coverLetter, style = MaterialTheme.typography.bodyMedium)
    if (base == null) Text("The side-by-side comparison appears after the next search.", style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 10.dp))
}

@Composable
private fun EditView(t: Tailored, m: Master, onChange: (Tailored) -> Unit) {
    OutlinedTextField(t.headline, { onChange(t.copy(headline = it)) }, label = { Text("Headline") }, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(t.summary, { onChange(t.copy(summary = it)) }, label = { Text("Summary") }, minLines = 4, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
    var skillsText by remember(t.skills) { mutableStateOf(t.skills.joinToString(", ")) }
    OutlinedTextField(skillsText, {
        skillsText = it
        onChange(t.copy(skills = it.split(Regex(",(?![^(]*\\))|\n")).map { s -> s.trim() }.filter { s -> s.isNotBlank() }))
    }, label = { Text("Skills (comma separated)") }, minLines = 3, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
    val roles = m.roles.associateBy { it.id }
    t.experience.forEachIndexed { ei, e ->
        val r = roles[e.id] ?: return@forEachIndexed
        Head("${r.title}, ${r.company}")
        fun setBullets(b: List<String>) = onChange(t.copy(experience = t.experience.toMutableList().also { it[ei] = e.copy(bullets = b) }))
        e.bullets.forEachIndexed { bi, b ->
            Row(verticalAlignment = Alignment.Top) {
                OutlinedTextField(b, { v -> setBullets(e.bullets.toMutableList().also { it[bi] = v }) }, modifier = Modifier.weight(1f).padding(vertical = 3.dp))
                IconButton(onClick = { setBullets(e.bullets.filterIndexed { i, _ -> i != bi }) }) { Icon(Icons.Filled.Delete, "Remove bullet") }
            }
        }
        val unused = r.flex.filter { it !in e.bullets }
        if (unused.isNotEmpty()) {
            var open by remember { mutableStateOf(false) }
            Column {
                TextButton(onClick = { open = true }) { Text("Add another bullet from your profile") }
                DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                    unused.forEach { u -> DropdownMenuItem(text = { Text(u, maxLines = 3) }, onClick = { open = false; setBullets(e.bullets + u) }) }
                }
            }
        }
    }
    HorizontalDivider(Modifier.padding(vertical = 12.dp))
    OutlinedTextField(t.coverLetter, { onChange(t.copy(coverLetter = it)) }, label = { Text("Cover letter") }, minLines = 10, modifier = Modifier.fillMaxWidth())
}
