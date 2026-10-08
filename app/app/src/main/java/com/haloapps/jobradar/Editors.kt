package com.haloapps.jobradar

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull

// ------------------------------------------------------------------ JSON helpers

private fun JsonObject?.str(k: String) = (this?.get(k) as? JsonPrimitive)?.contentOrNull.orEmpty()
private fun JsonObject?.obj(k: String) = this?.get(k) as? JsonObject
private fun JsonObject?.strList(k: String) = (this?.get(k) as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty()
private fun JsonObject?.int(k: String, d: Int) = (this?.get(k) as? JsonPrimitive)?.intOrNull ?: d
private fun JsonObject?.bool(k: String) = (this?.get(k) as? JsonPrimitive)?.booleanOrNull ?: false

private fun lines(s: String) = s.lines().map { it.trim().removePrefix("•").removePrefix("-").trim() }.filter { it.isNotBlank() }
/** Split on commas and new lines, but not inside brackets: "Amazon Ads (SP, SB, SD)" stays one skill. */
private fun commas(s: String) = s.split(Regex(",(?![^(]*\\))|\n")).map { it.trim() }.filter { it.isNotBlank() }
private fun arr(items: List<String>) = JsonArray(items.map { JsonPrimitive(it) })
private fun JsonObject.with(vararg pairs: Pair<String, JsonElement>) = JsonObject(this.toMutableMap().apply { pairs.forEach { (k, v) -> put(k, v) } })
private fun slug(s: String) = s.lowercase().replace(Regex("[^a-z0-9]+"), "")

// ------------------------------------------------------------------ editable models

class KV(k: String, v: String) {
    var key by mutableStateOf(k)
    var value by mutableStateOf(v)
}

class RoleEdit(val original: JsonObject?) {
    var title by mutableStateOf(original.str("title"))
    var company by mutableStateOf(original.str("company"))
    var location by mutableStateOf(original.str("location"))
    var start by mutableStateOf(original.str("start"))
    var end by mutableStateOf(original.str("end"))
    var core by mutableStateOf(original.strList("core").joinToString("\n"))
    var flex by mutableStateOf(((original?.get("flex") as? JsonArray) ?: JsonArray(emptyList()))
        .mapNotNull { (it as? JsonObject).str("text").ifBlank { null } }.joinToString("\n"))

    fun toJson(): JsonObject {
        val oldFlex = ((original?.get("flex") as? JsonArray) ?: JsonArray(emptyList())).mapNotNull { it as? JsonObject }
        val tagsByText = oldFlex.associate { it.str("text") to (it["tags"] ?: JsonArray(emptyList())) }
        val flexArr = JsonArray(lines(flex).map { t ->
            JsonObject(mapOf("text" to JsonPrimitive(t), "tags" to (tagsByText[t] ?: JsonArray(emptyList()))))
        })
        val base = original ?: JsonObject(mapOf("id" to JsonPrimitive(slug(company).take(20).ifBlank { "role" + System.currentTimeMillis() % 10000 })))
        return base.with(
            "title" to JsonPrimitive(title.trim()), "company" to JsonPrimitive(company.trim()), "location" to JsonPrimitive(location.trim()),
            "start" to JsonPrimitive(start.trim()), "end" to JsonPrimitive(end.trim()), "core" to arr(lines(core)), "flex" to flexArr,
        ).let { o -> JsonObject(o.filterKeys { !it.endsWith("_CONFIRM") }) }
    }
}

class ProjEdit(val original: JsonObject?) {
    var name by mutableStateOf(original.str("name"))
    var text by mutableStateOf(original.str("text"))
    fun toJson() = (original ?: JsonObject(mapOf("tags" to JsonArray(emptyList())))).with("name" to JsonPrimitive(name.trim()), "text" to JsonPrimitive(text.trim()))
}

class EduEdit(val original: JsonObject?) {
    var credential by mutableStateOf(original.str("credential"))
    var school by mutableStateOf(original.str("school"))
    var dates by mutableStateOf(original.str("dates"))
    fun toJson() = (original ?: JsonObject(emptyMap())).with(
        "credential" to JsonPrimitive(credential.trim()), "school" to JsonPrimitive(school.trim()), "dates" to JsonPrimitive(dates.trim()))
}

// ------------------------------------------------------------------ profile editor

@Composable
fun ProfileEditor(vm: MainVM, modifier: Modifier, onClose: () -> Unit) {
    val src = vm.resumeJson
    if (src == null) {
        Column(modifier.padding(24.dp)) {
            Text("Your profile hasn't loaded yet. Go to Jobs and tap ↻, then come back.")
            TextButton(onClick = onClose) { Text("Back") }
        }
        return
    }
    val contact = remember { mutableStateListOf<KV>().apply { src.obj("contact")?.forEach { (k, v) -> add(KV(k, (v as? JsonPrimitive)?.content.orEmpty())) } } }
    val answers = remember { mutableStateListOf<KV>().apply { src.obj("application_answers")?.forEach { (k, v) -> add(KV(k, (v as? JsonPrimitive)?.content.orEmpty())) } } }
    val headlines = remember { mutableStateListOf<KV>().apply { src.obj("headlines")?.forEach { (k, v) -> add(KV(k, (v as? JsonPrimitive)?.content.orEmpty())) } } }
    var summary by remember { mutableStateOf(src.str("summary_base")) }
    var facts by remember { mutableStateOf(src.strList("summary_facts").joinToString("\n")) }
    val roles = remember { mutableStateListOf<RoleEdit>().apply { (src["experience"] as? JsonArray)?.forEach { add(RoleEdit(it as? JsonObject)) } } }
    val skills = remember { mutableStateListOf<KV>().apply { src.obj("skills")?.forEach { (k, v) -> add(KV(k, (v as? JsonArray)?.joinToString(", ") { (it as JsonPrimitive).content }.orEmpty())) } } }
    val projects = remember { mutableStateListOf<ProjEdit>().apply { (src["projects"] as? JsonArray)?.forEach { add(ProjEdit(it as? JsonObject)) } } }
    var certs by remember { mutableStateOf(src.strList("certifications").joinToString("\n")) }
    val edu = remember { mutableStateListOf<EduEdit>().apply { (src["education"] as? JsonArray)?.forEach { add(EduEdit(it as? JsonObject)) } } }

    fun build(): JsonObject = src.with(
        "contact" to JsonObject(contact.filter { it.key.isNotBlank() }.associate { it.key.trim() to JsonPrimitive(it.value.trim()) }),
        "application_answers" to JsonObject(answers.filter { it.key.isNotBlank() }.associate { it.key.trim() to JsonPrimitive(it.value.trim()) }),
        "headlines" to JsonObject(headlines.filter { it.key.isNotBlank() }.associate { it.key.trim() to JsonPrimitive(it.value.trim()) }),
        "summary_base" to JsonPrimitive(summary.trim()),
        "summary_facts" to arr(lines(facts)),
        "experience" to JsonArray(roles.filter { it.title.isNotBlank() || it.company.isNotBlank() }.map { it.toJson() }),
        "skills" to JsonObject(skills.filter { it.key.isNotBlank() }.associate { it.key.trim() to arr(commas(it.value)) }),
        "projects" to JsonArray(projects.filter { it.name.isNotBlank() }.map { it.toJson() }),
        "certifications" to arr(lines(certs)),
        "education" to JsonArray(edu.filter { it.credential.isNotBlank() }.map { it.toJson() }),
    )

    EditorScaffold("Edit profile", modifier, vm.saving, onClose, onSave = { vm.saveProfile(build(), onClose) }) {
        Hint("Your companies, titles, dates, main bullets, education and certifications are never changed by the AI. " +
            "\"Main bullets\" always appear; \"Optional bullets\" are picked per job. Never put numbers you can't back up.")

        Group("Contact") { KVList(contact, keyEditable = false) }
        Group("Application answers") { KVList(answers, keyEditable = true, addLabel = "Add answer") }
        Group("Summary") {
            Field("Summary", summary, { summary = it }, lines = 5)
            Field("Facts the AI may use (one per line)", facts, { facts = it }, lines = 6)
        }
        Group("Headlines (one is picked per job)") { KVList(headlines, keyEditable = false) }

        Group("Experience (newest first)") {
            roles.forEachIndexed { i, r ->
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow), modifier = Modifier.padding(vertical = 6.dp)) {
                    Column(Modifier.padding(10.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(r.company.ifBlank { "New role" }, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                            if (i > 0) TextButton(onClick = { roles.add(i - 1, roles.removeAt(i)) }) { Text("Move up") }
                            IconButton(onClick = { roles.removeAt(i) }) { Icon(Icons.Filled.Delete, "Delete role") }
                        }
                        Field("Title", r.title, { r.title = it })
                        Field("Company", r.company, { r.company = it })
                        Field("Location", r.location, { r.location = it })
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Field("Start (MM/YYYY)", r.start, { r.start = it }, modifier = Modifier.weight(1f))
                            Field("End", r.end, { r.end = it }, modifier = Modifier.weight(1f))
                        }
                        Field("Main bullets – always shown (one per line)", r.core, { r.core = it }, lines = 4)
                        Field("Optional bullets – picked per job (one per line)", r.flex, { r.flex = it }, lines = 6)
                    }
                }
            }
            OutlinedButton(onClick = { roles.add(0, RoleEdit(null)) }) { Text("Add a role") }
        }

        Group("Skills (comma separated)") { KVList(skills, keyEditable = true, addLabel = "Add skill group", multiline = true) }

        Group("Projects") {
            projects.forEachIndexed { i, p ->
                Row(verticalAlignment = Alignment.Top) {
                    Column(Modifier.weight(1f)) {
                        Field("Name", p.name, { p.name = it })
                        Field("Description", p.text, { p.text = it }, lines = 2)
                    }
                    IconButton(onClick = { projects.removeAt(i) }) { Icon(Icons.Filled.Delete, "Delete") }
                }
                Spacer(Modifier.height(6.dp))
            }
            OutlinedButton(onClick = { projects.add(ProjEdit(null)) }) { Text("Add project") }
        }

        Group("Certifications (one per line)") { Field("Certifications", certs, { certs = it }, lines = 6) }

        Group("Education") {
            edu.forEachIndexed { i, e ->
                Row(verticalAlignment = Alignment.Top) {
                    Column(Modifier.weight(1f)) {
                        Field("Credential", e.credential, { e.credential = it })
                        Field("School", e.school, { e.school = it })
                        Field("Dates", e.dates, { e.dates = it })
                    }
                    IconButton(onClick = { edu.removeAt(i) }) { Icon(Icons.Filled.Delete, "Delete") }
                }
                Spacer(Modifier.height(6.dp))
            }
            OutlinedButton(onClick = { edu.add(EduEdit(null)) }) { Text("Add education") }
        }
    }
}

// ------------------------------------------------------------------ search settings editor

@Composable
fun SearchEditor(vm: MainVM, modifier: Modifier, onClose: () -> Unit) {
    val src = vm.searchJson
    if (src == null) {
        Column(modifier.padding(24.dp)) {
            Text("Search settings haven't loaded yet. Go to Jobs and tap ↻, then come back.")
            TextButton(onClick = onClose) { Text("Back") }
        }
        return
    }
    val titleTerms = src.obj("title_terms")
    val locs = src.obj("locations")
    var queries by remember { mutableStateOf(src.strList("queries").joinToString("\n")) }
    var required by remember { mutableStateOf(titleTerms.strList("required").joinToString(", ")) }
    var exclude by remember { mutableStateOf(src.strList("exclude_title").joinToString(", ")) }
    var excludeCo by remember { mutableStateOf(src.strList("exclude_company").joinToString(", ")) }
    var home by remember { mutableStateOf(locs.strList("home_city_terms").joinToString(", ")) }
    var country by remember { mutableStateOf(locs.str("country").ifBlank { "CA" }) }
    var nearbyOnly by remember { mutableStateOf(locs.str("mode") == "nearby") }
    val places = remember {
        mutableStateListOf<KV>().apply {
            ((locs?.get("search_locations") as? JsonArray) ?: JsonArray(emptyList())).mapNotNull { it as? JsonObject }
                .forEach { add(KV(it.str("place"), (it["radius_km"] as? JsonPrimitive)?.contentOrNull ?: "50")) }
            if (isEmpty()) {
                val loc = (vm.resumeJson.obj("contact")).str("location")
                if (loc.isNotBlank()) add(KV(loc, "50"))
            }
        }
    }
    var usRemote by remember { mutableStateOf(locs.bool("include_us_remote")) }
    var usOnsite by remember { mutableStateOf(locs.bool("include_us_onsite")) }
    var minSave by remember { mutableStateOf(src.int("min_score_to_save", 40).toString()) }
    var minTailor by remember { mutableStateOf(src.int("min_score_to_tailor", 58).toString()) }
    var minAi by remember { mutableStateOf(src.int("min_score_for_ai", 65).toString()) }
    var aiPerDay by remember { mutableStateOf(src.int("max_ai_per_day", 40).toString()) }
    var salary by remember { mutableStateOf(src.int("min_salary_cad", 0).toString()) }
    var maxAge by remember { mutableStateOf(src.int("max_age_days", 30).toString()) }
    var companies by remember { mutableStateOf(src.obj("ats_companies").strList("candidates").joinToString("\n")) }
    var workday by remember { mutableStateOf(src.obj("workday_sites").strList("urls").joinToString("\n")) }

    fun n(s: String, d: Int) = s.trim().toIntOrNull() ?: d
    fun build(): JsonObject = src.with(
        "queries" to arr(lines(queries)),
        "title_terms" to (titleTerms ?: JsonObject(emptyMap())).with("required" to arr(commas(required).map { it.lowercase() })),
        "exclude_title" to arr(commas(exclude).map { it.lowercase() }),
        "exclude_company" to arr(commas(excludeCo)),
        "locations" to (locs ?: JsonObject(emptyMap())).with(
            "home_city_terms" to arr(commas(home).map { it.lowercase() }),
            "country" to JsonPrimitive(country), "mode" to JsonPrimitive(if (nearbyOnly) "nearby" else "country"),
            "search_locations" to JsonArray(places.filter { it.key.isNotBlank() }.map {
                JsonObject(mapOf("place" to JsonPrimitive(it.key.trim()), "radius_km" to JsonPrimitive(it.value.trim().toIntOrNull() ?: 50)))
            }),
            "include_us_remote" to JsonPrimitive(usRemote), "include_us_onsite" to JsonPrimitive(usOnsite)),
        "min_score_to_save" to JsonPrimitive(n(minSave, 40)), "min_score_to_tailor" to JsonPrimitive(n(minTailor, 58)),
        "min_score_for_ai" to JsonPrimitive(n(minAi, 65)), "max_ai_per_day" to JsonPrimitive(n(aiPerDay, 40)),
        "min_salary_cad" to JsonPrimitive(n(salary, 0)), "max_age_days" to JsonPrimitive(n(maxAge, 30)),
        "ats_companies" to (src.obj("ats_companies") ?: JsonObject(emptyMap())).with("candidates" to arr(lines(companies).map { it.lowercase() })),
        "workday_sites" to (src.obj("workday_sites") ?: JsonObject(emptyMap())).with("urls" to arr(lines(workday))),
    )

    EditorScaffold("Search preferences", modifier, vm.saving, onClose, onSave = { vm.saveSearch(build(), onClose) }) {
        Hint("Saving starts a new search right away.")
        Group("What to search for") {
            Field("Search phrases (one per line)", queries, { queries = it }, lines = 8)
            Field("A job title must contain one of these words", required, { required = it }, lines = 3)
            Field("Skip titles containing", exclude, { exclude = it }, lines = 3)
            Field("Skip these companies", excludeCo, { excludeCo = it }, lines = 2)
        }
        Group("Where") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("CA" to "Canada", "US" to "United States").forEach { (code, label) ->
                    androidx.compose.material3.FilterChip(country == code, { country = code }, { Text("I work in $label") })
                }
            }
            Hint("Search around these places (radius in km):")
            places.forEachIndexed { i, p ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Field("City", p.key, { p.key = it }, modifier = Modifier.weight(2f))
                    Spacer(Modifier.width(6.dp))
                    Field("km", p.value, { p.value = it }, modifier = Modifier.weight(1f))
                    IconButton(onClick = { places.removeAt(i) }) { Icon(Icons.Filled.Delete, "Remove place") }
                }
            }
            OutlinedButton(onClick = { places.add(KV("", "50")) }) { Text("Add a location") }
            Toggle("Only jobs near these places (plus remote)", nearbyOnly) { nearbyOnly = it }
            Hint(if (nearbyOnly) "Jobs farther away are skipped." else "Jobs anywhere in the country are kept; nearby ones rank higher.")
            Field("Extra area words for bonus points (optional)", home, { home = it }, lines = 2)
            Toggle(if (country == "CA") "Include US remote jobs" else "Include Canadian remote jobs", usRemote) { usRemote = it }
            Toggle(if (country == "CA") "Include US on-site jobs (needs a US work permit)" else "Include Canadian on-site jobs (needs a permit)", usOnsite) { usOnsite = it }
        }
        Group("Filters") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Field("Min salary (CAD, 0 = any)", salary, { salary = it }, modifier = Modifier.weight(1f))
                Field("Max age (days)", maxAge, { maxAge = it }, modifier = Modifier.weight(1f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Field("Keep jobs scoring ≥", minSave, { minSave = it }, modifier = Modifier.weight(1f))
                Field("Tailor resume when ≥", minTailor, { minTailor = it }, modifier = Modifier.weight(1f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Field("Use AI when score ≥", minAi, { minAi = it }, modifier = Modifier.weight(1f))
                Field("AI resumes per day (cost cap)", aiPerDay, { aiPerDay = it }, modifier = Modifier.weight(1f))
            }
        }
        Group("Company career pages to watch") {
            Hint("One per line: the name in the company's careers link, e.g. jobs.lever.co/NAME or boards.greenhouse.io/NAME. Unknown names are skipped automatically.")
            Field("Companies", companies, { companies = it }, lines = 8)
            Field("Workday career sites (full links, one per line)", workday, { workday = it }, lines = 4)
        }
    }
}

// ------------------------------------------------------------------ add a job

@Composable
fun AddJobDialog(vm: MainVM, shared: SharedJob?, onClose: () -> Unit) {
    var url by remember { mutableStateOf(shared?.url.orEmpty()) }
    var title by remember { mutableStateOf(shared?.title.orEmpty()) }
    var company by remember { mutableStateOf("") }
    var desc by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("Add a job") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text("Found a job on LinkedIn, Indeed or anywhere else? Tip: use Share → Job Radar from that app.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Field("Job link", url, { url = it })
                Field("Title (optional)", title, { title = it })
                Field("Company (optional)", company, { company = it })
                Field("Description (paste for best results)", desc, { desc = it }, lines = 4)
                Text("I'll read the posting, score it and write a tailored resume and cover letter (3–5 minutes).",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        confirmButton = {
            Button(onClick = { vm.addJob(url.trim(), title.trim(), company.trim(), desc.trim(), onClose) },
                enabled = !vm.saving && (url.startsWith("http") || desc.length > 100)) {
                if (vm.saving) CircularProgressIndicator(Modifier.height(18.dp)) else Text("Add & tailor")
            }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("Cancel") } },
    )
}

// ------------------------------------------------------------------ small building blocks

@Composable
fun EditorScaffold(title: String, modifier: Modifier, saving: Boolean, onClose: () -> Unit, onSave: () -> Unit, content: @Composable () -> Unit) {
    Column(modifier.fillMaxSize()) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(4.dp)) {
            IconButton(onClick = onClose) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            Button(onClick = onSave, enabled = !saving, modifier = Modifier.padding(end = 8.dp)) {
                if (saving) CircularProgressIndicator(Modifier.height(18.dp)) else Text("Save")
            }
        }
        HorizontalDivider()
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp)) {
            content()
            Spacer(Modifier.height(48.dp))
        }
    }
}

@Composable
fun Group(title: String, content: @Composable () -> Unit) {
    Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(top = 18.dp, bottom = 4.dp))
    content()
}

@Composable
fun Hint(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 4.dp))
}

@Composable
fun Field(label: String, value: String, onChange: (String) -> Unit, lines: Int = 1, modifier: Modifier = Modifier.fillMaxWidth()) {
    OutlinedTextField(value, onChange, label = { Text(label) }, singleLine = lines == 1, minLines = lines,
        modifier = modifier.padding(vertical = 3.dp))
}

@Composable
fun Toggle(label: String, value: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(label, modifier = Modifier.weight(1f))
        Switch(value, onChange)
    }
}

@Composable
fun KVList(items: MutableList<KV>, keyEditable: Boolean, addLabel: String? = null, multiline: Boolean = false) {
    items.forEachIndexed { i, kv ->
        if (keyEditable) {
            Row(verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) {
                    Field("Name", kv.key, { kv.key = it })
                    Field("Value", kv.value, { kv.value = it }, lines = if (multiline) 3 else 1)
                }
                IconButton(onClick = { items.removeAt(i) }) { Icon(Icons.Filled.Delete, "Delete") }
            }
            Spacer(Modifier.height(6.dp))
        } else {
            Field(kv.key.replace('_', ' ').replaceFirstChar { it.uppercase() }, kv.value, { kv.value = it }, lines = if (kv.value.length > 60) 2 else 1)
        }
    }
    if (addLabel != null) OutlinedButton(onClick = { items.add(KV("", "")) }) { Text(addLabel) }
}
