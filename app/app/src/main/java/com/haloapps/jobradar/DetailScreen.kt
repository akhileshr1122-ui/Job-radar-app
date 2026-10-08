package com.haloapps.jobradar

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DetailScreen(vm: MainVM, job: Job, modifier: Modifier, onBack: () -> Unit, onPrep: () -> Unit, onReview: () -> Unit) {
    val ctx = LocalContext.current
    val entry = vm.statuses[job.id]
    val status = entry?.status
    var showDesc by remember { mutableStateOf(false) }
    var note by remember(job.id) { mutableStateOf(entry?.note.orEmpty()) }
    var pasting by remember { mutableStateOf(false) }
    var pasted by remember { mutableStateOf("") }
    val busy = vm.busyJob == job.id

    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(4.dp)) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Text(job.company, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
        }
        Column(Modifier.padding(horizontal = 16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                ScoreBadge(job.score, 56)
                Spacer(Modifier.width(14.dp))
                Column {
                    Text(job.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text(job.location, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    val extra = listOfNotNull(job.salary.ifBlank { null }, job.age().ifBlank { null }?.let { "posted $it ago" },
                        "via ${job.source}" + if (job.alsoOn.isNotEmpty()) " (+${job.alsoOn.joinToString()})" else "")
                    Text(extra.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }

            Spacer(Modifier.height(16.dp))
            Button(onClick = onReview, modifier = Modifier.fillMaxWidth().height(56.dp)) {
                Icon(Icons.Filled.Send, null)
                Spacer(Modifier.width(8.dp))
                Text("Review changes and apply")
            }
            TextButton(onClick = { vm.quickApply(ctx, job) }, enabled = !busy) {
                Text(if (busy) "Preparing…" else "Skip review: apply right away")
            }
            Text(
                "See what changed in your resume and cover letter for this job, edit anything, then apply. Apply saves the resume to Downloads/JobRadar, copies the cover letter, opens the application and marks it applied.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp),
            )
            Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { openUrl(ctx, job.url.ifBlank { job.link }) }) { Text("Open posting") }
                OutlinedButton(onClick = { vm.shareResume(ctx, job, "pdf") }) {
                    Icon(Icons.Filled.Share, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("PDF")
                }
                OutlinedButton(onClick = { vm.shareResume(ctx, job, "docx") }) { Text("Word") }
            }

            Section("Status") {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(Status.SAVED, Status.APPLIED, Status.INTERVIEW, Status.OFFER, Status.REJECTED, Status.HIDDEN).forEach { s ->
                        FilterChip(status == s, { vm.toggle(job.id, s) }, { Text(Status.label(s)) })
                    }
                }
                entry?.history?.takeIf { it.isNotEmpty() }?.let {
                    Text(it.joinToString("  →  "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                OutlinedTextField(note, { note = it }, label = { Text("Notes (recruiter, salary, next step…)") },
                    modifier = Modifier.fillMaxWidth().padding(top = 6.dp), minLines = 2)
                if (note != entry?.note.orEmpty()) TextButton(onClick = { vm.setNote(job.id, note) }) { Text("Save note") }
            }

            Section("Interview prep") {
                Text(
                    if (job.prep != null) "Your prep sheet is ready: likely questions, your best stories for this role, gaps to prepare for."
                    else "Got an interview? Get likely questions with answers built from your real experience, plus questions to ask them.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (job.prep != null) Button(onClick = onPrep) { Text("Open prep sheet") }
                    OutlinedButton(onClick = { vm.requestPrep(job) }) { Text(if (job.prep != null) "Write again" else "Prepare me") }
                }
            }

            Section("Why it matched") {
                job.reasons.forEach { Text("• $it", style = MaterialTheme.typography.bodyMedium) }
                job.fitNotes?.let { Text(it, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 6.dp)) }
            }

            if (job.keywordsMatched.isNotEmpty() || job.keywordsMissing.isNotEmpty()) Section("Keywords in the posting") {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    job.keywordsMatched.forEach { AssistChip(onClick = {}, label = { Text("✓ $it") }) }
                    job.keywordsMissing.forEach { AssistChip(onClick = {}, label = { Text("✗ $it", color = Color(0xFFB54708)) }) }
                }
                if (job.keywordsMissing.isNotEmpty()) Text(
                    "✗ = asked for but not on your resume. If you do have it, add it on the Me tab → Edit profile.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Section(if (job.tailorMethod == "claude") "Tailored resume (AI)" else "Tailored resume (keyword match)") {
                job.headline?.let { Text(it, fontWeight = FontWeight.SemiBold) }
                job.summary?.let { Text(it, modifier = Modifier.padding(top = 4.dp)) }
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(onClick = { vm.saveResume(job, "pdf") }) { Text("Save PDF") }
                    TextButton(onClick = { vm.saveResume(job, "docx") }) { Text("Save Word") }
                    TextButton(onClick = { vm.requestRetailor(job) }) { Text(if (job.tailored) "Re-write" else "Tailor now") }
                }
            }

            job.coverLetter?.let { cl ->
                Section("Cover letter") {
                    SelectionContainer { Text(cl, style = MaterialTheme.typography.bodyMedium) }
                    TextButton(onClick = { vm.copy("Cover letter", cl) }) { Text("Copy") }
                }
            }

            Section("Job description") {
                val d = job.description.ifBlank { "This source didn't include a description. Open the posting to read it." }
                Text(if (showDesc || d.length < 700) d else d.take(700) + "…", style = MaterialTheme.typography.bodyMedium)
                if (d.length >= 700) TextButton(onClick = { showDesc = !showDesc }) { Text(if (showDesc) "Show less" else "Show all") }
                if (job.manual || job.description.length < 400) {
                    if (!pasting) TextButton(onClick = { pasting = true }) { Text("Paste the full description for a better resume") }
                    else {
                        OutlinedTextField(pasted, { pasted = it }, label = { Text("Job description") }, modifier = Modifier.fillMaxWidth(), minLines = 5)
                        Button(onClick = { vm.addJob(job.url, job.title, job.company, pasted) { pasting = false } }, enabled = pasted.length > 100 && !vm.saving) {
                            Text("Re-tailor with this description")
                        }
                    }
                }
            }
            Spacer(Modifier.height(32.dp))
        }
    }
}

@Composable
fun PrepScreen(vm: MainVM, job: Job, modifier: Modifier, onBack: () -> Unit) {
    var text by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(job.prep) {
        try {
            text = vm.loadPrep(job)
        } catch (e: Exception) {
            error = e.message
        }
    }
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(4.dp)) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Text("Interview prep", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            text?.let { t -> TextButton(onClick = { vm.copy("Prep sheet", t) }) { Text("Copy") } }
        }
        Column(Modifier.padding(horizontal = 16.dp)) {
            when {
                error != null -> Text(error!!)
                text == null -> CircularProgressIndicator()
                else -> SelectionContainer { Column { Markdown(text!!) } }
            }
            Spacer(Modifier.height(32.dp))
        }
    }
}

/** Just enough Markdown for the prep sheet: headings, bullets, bold. */
@Composable
fun Markdown(md: String) {
    md.lines().forEach { raw ->
        val line = raw.trimEnd()
        when {
            line.startsWith("# ") -> Text(line.drop(2), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(top = 8.dp, bottom = 4.dp))
            line.startsWith("## ") -> Text(line.drop(3), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 14.dp, bottom = 4.dp))
            line.startsWith("### ") -> Text(line.drop(4), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(top = 8.dp))
            line.trimStart().startsWith("- ") || line.trimStart().startsWith("* ") ->
                Text("•  " + line.trimStart().drop(2).replace("**", ""), style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(start = if (line.startsWith("  ")) 16.dp else 0.dp, top = 2.dp))
            line.isBlank() -> Spacer(Modifier.height(6.dp))
            else -> Text(line.replace("**", ""), style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
fun Section(title: String, content: @Composable () -> Unit) {
    Spacer(Modifier.height(16.dp))
    HorizontalDivider()
    Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(top = 12.dp, bottom = 6.dp))
    Card(colors = CardDefaults.cardColors(containerColor = Color.Transparent)) { Column { content() } }
}
