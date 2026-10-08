package com.haloapps.jobradar

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.concurrent.TimeUnit

fun scoreColor(s: Int): Color = when {
    s >= 80 -> Color(0xFF1B8A5A)
    s >= 65 -> Color(0xFF2F7DBF)
    s >= 50 -> Color(0xFFB7791F)
    else -> Color(0xFF7A7A7A)
}

fun statusColor(s: String?): Color = when (s) {
    Status.INTERVIEW -> Color(0xFF2F7DBF)
    Status.OFFER -> Color(0xFF1B8A5A)
    Status.REJECTED -> Color(0xFF9A3B3B)
    else -> Color(0xFF6B6B6B)
}

@Composable
fun JobsScreen(vm: MainVM, modifier: Modifier, onOpen: (String) -> Unit, onAdd: () -> Unit) {
    var tab by rememberSaveable { mutableStateOf(0) }
    var canada by rememberSaveable { mutableStateOf(false) }
    var remote by rememberSaveable { mutableStateOf(false) }
    var ready by rememberSaveable { mutableStateOf(false) }
    var newest by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    var where by rememberSaveable { mutableStateOf("") }
    var searching by rememberSaveable { mutableStateOf(false) }

    val all = vm.file?.jobs.orEmpty()
    val st = vm.statuses
    fun s(j: Job) = st[j.id]?.status
    val tabs = listOf(
        "Inbox" to all.count { s(it) == null },
        "Saved" to all.count { s(it) == Status.SAVED },
        "Applied" to all.count { s(it) in Status.PIPELINE },
    )
    var list = when (tab) {
        0 -> all.filter { s(it) == null }
        1 -> all.filter { s(it) == Status.SAVED }
        else -> all.filter { s(it) in Status.PIPELINE }
    }
    if (canada) list = list.filter { it.inCanada }
    if (remote) list = list.filter { it.remote }
    if (ready) list = list.filter { it.tailored }
    if (query.isNotBlank()) {
        val q = query.trim().lowercase()
        list = list.filter { q in it.title.lowercase() || q in it.company.lowercase() }
    }
    if (where.isNotBlank()) {
        val w = where.trim().lowercase()
        list = list.filter { w in it.location.lowercase() || (w == "remote" && it.remote) }
    }
    list = when {
        tab == 2 -> list.sortedByDescending { st[it.id]?.at ?: 0L }
        newest -> list.sortedBy { it.ageHours() }
        else -> list.sortedWith(compareByDescending<Job> { it.manual }.thenByDescending { it.score })
    }

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(vm.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 2)
                    val upd = vm.file?.updated?.take(16)?.replace('T', ' ')
                    Text(
                        if (upd != null) "Last search $upd UTC · ${all.size} jobs" else "Pull your first results with ↻",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (vm.loading) CircularProgressIndicator(Modifier.size(24.dp).padding(2.dp), strokeWidth = 2.dp)
                IconButton(onClick = { searching = !searching; if (!searching) { query = ""; where = "" } }) { Icon(Icons.Filled.Search, "Search and location filter") }
                IconButton(onClick = { vm.refresh() }) { Icon(Icons.Filled.Refresh, "Refresh") }
            }
            if (searching) Row(Modifier.padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(query, { query = it }, placeholder = { Text("Title or company") }, singleLine = true, modifier = Modifier.weight(1f))
                OutlinedTextField(where, { where = it }, placeholder = { Text("City or Remote") }, singleLine = true, modifier = Modifier.weight(1f))
            }
            TabRow(selectedTabIndex = tab) {
                tabs.forEachIndexed { i, (label, n) ->
                    Tab(selected = tab == i, onClick = { tab = i }, text = { Text("$label ($n)") })
                }
            }
            if (tab == 2) PipelineStats(vm, all)
            else Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = canada, onClick = { canada = !canada }, label = { Text("Canada") })
                FilterChip(selected = remote, onClick = { remote = !remote }, label = { Text("Remote") })
                FilterChip(selected = ready, onClick = { ready = !ready }, label = { Text("Resume ready") })
                FilterChip(selected = newest, onClick = { newest = !newest }, label = { Text(if (newest) "Newest first" else "Best match first") })
            }
            if (list.isEmpty()) {
                Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                    Text(
                        when {
                            !vm.repo.configured -> "Add your GitHub token in Settings to load jobs."
                            all.isEmpty() -> "No jobs yet. The search runs every 4 hours; tap ↻ after it finishes."
                            tab == 2 -> "Jobs you apply to show up here so you can track interviews and offers."
                            else -> "Nothing here with these filters."
                        },
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 96.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(list, key = { it.id }) { job ->
                        JobCard(job, st[job.id], onOpen = { onOpen(job.id) },
                            onSave = { vm.toggle(job.id, Status.SAVED) },
                            onHide = { vm.setStatus(job.id, if (s(job) == null) Status.HIDDEN else null) })
                    }
                }
            }
        }
        ExtendedFloatingActionButton(
            onClick = onAdd, icon = { Icon(Icons.Filled.Add, null) }, text = { Text("Add a job") },
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
        )
    }
}

@Composable
fun PipelineStats(vm: MainVM, all: List<Job>) {
    val entries = vm.statuses.values
    val weekAgo = System.currentTimeMillis() - TimeUnit.DAYS.toMillis(7)
    val applied = entries.count { it.status in Status.PIPELINE }
    val thisWeek = entries.count { it.status in Status.PIPELINE && it.at > weekAgo }
    val interviews = entries.count { it.status == Status.INTERVIEW || it.status == Status.OFFER }
    val offers = entries.count { it.status == Status.OFFER }
    val rate = if (applied > 0) (100 * interviews / applied) else 0
    Text(
        "$applied applied · $thisWeek this week · $interviews interviews ($rate%) · $offers offers",
        style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
    )
}

@Composable
fun ScoreBadge(score: Int, size: Int = 44) {
    Box(Modifier.size(size.dp).background(scoreColor(score), CircleShape), contentAlignment = Alignment.Center) {
        Text("$score", color = Color.White, fontWeight = FontWeight.Bold, fontSize = (size / 2.6).sp)
    }
}

@Composable
fun JobCard(job: Job, entry: StatusEntry?, onOpen: () -> Unit, onSave: () -> Unit, onHide: () -> Unit) {
    val status = entry?.status
    Card(Modifier.fillMaxWidth().clickable { onOpen() }, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.Top) {
            ScoreBadge(job.score)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(job.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text("${job.company} · ${job.location}", style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(Modifier.horizontalScroll(rememberScrollState()).padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (status in Status.PIPELINE) SuggestionChip(onClick = onOpen, label = {
                        Text(Status.label(status) + " · " + java.text.SimpleDateFormat("MMM d", java.util.Locale.CANADA).format(java.util.Date(entry!!.at)),
                            fontSize = 12.sp, color = statusColor(status), fontWeight = FontWeight.SemiBold)
                    })
                    if (job.manual) SuggestionChip(onClick = onOpen, label = { Text("Added by you", fontSize = 12.sp) })
                    if (job.tailored) SuggestionChip(onClick = onOpen, label = { Text(if (job.tailorMethod == "claude") "AI resume ready" else "Resume ready", fontSize = 12.sp) })
                    if (job.remote) SuggestionChip(onClick = onOpen, label = { Text("Remote", fontSize = 12.sp) })
                    if (job.salary.isNotBlank()) SuggestionChip(onClick = onOpen, label = { Text(job.salary, fontSize = 12.sp) })
                    val age = job.age()
                    if (age.isNotBlank()) SuggestionChip(onClick = onOpen, label = { Text(age, fontSize = 12.sp) })
                    SuggestionChip(onClick = onOpen, label = { Text(job.source, fontSize = 12.sp) })
                }
            }
            Column {
                IconButton(onClick = onSave) {
                    Icon(if (status == Status.SAVED) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder, "Save",
                        tint = if (status == Status.SAVED) Color(0xFFD64545) else MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (status == null || status == Status.HIDDEN) IconButton(onClick = onHide) { Icon(Icons.Filled.Close, "Hide") }
            }
        }
    }
}
