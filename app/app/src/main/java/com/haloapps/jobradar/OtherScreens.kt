package com.haloapps.jobradar

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

private val QUICK_QUERIES = listOf("Amazon marketplace manager", "E-commerce manager", "Amazon advertising manager", "Head of e-commerce", "E-commerce operations automation", "Amazon account manager")
private val QUICK_LOCS = listOf("Toronto, ON", "Canada", "Remote")

@Composable
fun BoardsScreen(modifier: Modifier) {
    val ctx = LocalContext.current
    var query by rememberSaveable { mutableStateOf(QUICK_QUERIES[0]) }
    var loc by rememberSaveable { mutableStateOf(QUICK_LOCS[0]) }
    LazyColumn(modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp)) {
        item {
            Text("All job boards", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text("Tap a board to open it already searched. Found a good job there? Tap Share → Job Radar and you'll get a tailored resume for it.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedTextField(query, { query = it }, label = { Text("Search for") }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(top = 12.dp))
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                QUICK_QUERIES.forEach { q -> FilterChip(query == q, { query = q }, { Text(q) }) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                QUICK_LOCS.forEach { l -> FilterChip(loc == l, { loc = l }, { Text(l) }) }
            }
        }
        BOARD_GROUPS.forEach { g ->
            item {
                Text(g.title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 18.dp, bottom = 4.dp))
            }
            items(g.boards, key = { g.title + it.name }) { b ->
                Column(Modifier.fillMaxWidth().clickable { openUrl(ctx, b.url(query, loc)) }.padding(vertical = 10.dp)) {
                    Text(b.name + if (b.auto) "  ✓" else "", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                    Text(b.note, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                HorizontalDivider()
            }
        }
    }
}

@Composable
fun ProfileScreen(vm: MainVM, modifier: Modifier, onEdit: () -> Unit) {
    val ctx = LocalContext.current
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            Text("Application kit", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            Button(onClick = onEdit) { Text("Edit profile") }
        }
        Text("Tap any line to copy it into an application form. Edit profile changes your resume data; every resume is re-written after you save.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { vm.shareResume(ctx, null, "pdf") }) { Text("Standard resume PDF") }
            OutlinedButton(onClick = { vm.saveResume(null, "docx") }) { Text("Save Word") }
        }
        Spacer(Modifier.height(12.dp))
        val answers = vm.answers()
        if (answers.isEmpty()) Text("Refresh on the Jobs tab to load your details.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        answers.forEach { (k, v) ->
            Column(Modifier.fillMaxWidth().clickable { vm.copy(k, v) }.padding(vertical = 10.dp)) {
                Text(k, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                Text(v, style = MaterialTheme.typography.bodyLarge)
            }
            HorizontalDivider()
        }
        val summary = (vm.resumeJson?.get("summary_base") as? JsonPrimitive)?.content
        if (summary != null) {
            Spacer(Modifier.height(16.dp))
            Text("Summary", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            Text(summary, modifier = Modifier.clickable { vm.copy("Summary", summary) })
        }
        Spacer(Modifier.height(16.dp))
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
fun SettingsScreen(vm: MainVM, modifier: Modifier, onDone: () -> Unit, onEditSearch: () -> Unit) {
    val ctx = LocalContext.current
    var owner by remember { mutableStateOf(vm.repo.owner) }
    var repo by remember { mutableStateOf(vm.repo.repo) }
    var token by remember { mutableStateOf(vm.repo.token) }
    var minScore by remember { mutableFloatStateOf(vm.repo.notifyMin.toFloat()) }

    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Settings", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text("Job Radar reads results from your private GitHub repo. Create a fine-grained token at github.com → Settings → Developer settings, " +
            "limited to the job-radar repo, with Contents: Read and write and Actions: Read and write. Direct link: github.com/settings/personal-access-tokens",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedTextField(owner, { owner = it }, label = { Text("GitHub account") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(repo, { repo = it }, label = { Text("Repository") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(token, { token = it }, label = { Text("Access token") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
        Text("Notify me about new jobs scoring ${minScore.toInt()}+")
        Slider(minScore, { minScore = it }, valueRange = 40f..90f, steps = 9)
        Button(onClick = {
            vm.repo.owner = owner; vm.repo.repo = repo; vm.repo.token = token; vm.repo.notifyMin = minScore.toInt()
            vm.refresh(); onDone()
        }, modifier = Modifier.fillMaxWidth()) { Text("Save & load jobs") }
        OutlinedButton(onClick = { vm.runSearchNow() }, modifier = Modifier.fillMaxWidth(), enabled = vm.repo.configured) { Text("Run a search now") }
        OutlinedButton(onClick = onEditSearch, modifier = Modifier.fillMaxWidth(), enabled = vm.repo.configured) { Text("Search preferences (what, where, filters)") }
        HorizontalDivider()
        Text("AI resumes and more job sources", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
        Text("AI-written resumes and cover letters can use your own Claude Pro or Max plan, with no API bill. It's a one-time setup on a computer:",
            style = MaterialTheme.typography.bodySmall)
        listOf(
            "1. On a computer, open the Job Radar web app → Settings (button below).",
            "2. Pick Windows, Mac or Linux and follow the steps: install Claude Code, run claude setup-token, copy the token.",
            "3. Add it to your repo as the secret CLAUDE_CODE_OAUTH_TOKEN.",
            "4. Tap Run a search now. Resumes are AI-written from the next search.",
            "Free keys for Adzuna, LinkedIn/Indeed (JSearch) and Jooble are explained on the same page."
        ).forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        OutlinedButton(onClick = { openUrl(ctx, "https://akhileshr1122-ui.github.io/Job-radar-app/#settings") },
            modifier = Modifier.fillMaxWidth()) { Text("Open the step-by-step setup guide") }
        OutlinedButton(onClick = { openUrl(ctx, "https://github.com/${vm.repo.owner}/${vm.repo.repo}/settings/secrets/actions/new") },
            modifier = Modifier.fillMaxWidth(), enabled = vm.repo.configured) { Text("Add a secret to my repo") }
        HorizontalDivider()
        var followDays by remember { mutableFloatStateOf(vm.repo.followUpDays.toFloat()) }
        Text("Remind me to follow up ${followDays.toInt()} days after applying")
        Slider(followDays, { followDays = it; vm.repo.followUpDays = it.toInt() }, valueRange = 3f..21f, steps = 17)

        val rep = vm.report
        if (rep != null) {
            HorizontalDivider()
            Text("Last search", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            listOf("updated", "raw", "passed", "unique", "new", "tailored_this_run", "ai_enabled", "ai_used_today").forEach { k ->
                (rep[k] as? JsonPrimitive)?.let { Text("$k: ${it.content}", style = MaterialTheme.typography.bodySmall) }
            }
            Text("Sources", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            (rep["sources"] as? JsonObject)?.forEach { (k, v) ->
                if (v is JsonPrimitive) Text("$k: ${v.content}", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}
