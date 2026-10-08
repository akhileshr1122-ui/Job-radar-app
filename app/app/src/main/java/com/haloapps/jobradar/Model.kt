package com.haloapps.jobradar

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.Duration
import java.time.OffsetDateTime

@Serializable
data class Job(
    val id: String,
    val title: String = "",
    val company: String = "",
    val location: String = "",
    val country: String = "",
    val remote: Boolean = false,
    val url: String = "",
    @SerialName("apply_url") val applyUrl: String = "",
    val source: String = "",
    @SerialName("also_on") val alsoOn: List<String> = emptyList(),
    val posted: String = "",
    @SerialName("first_seen") val firstSeen: String = "",
    val score: Int = 0,
    val reasons: List<String> = emptyList(),
    val matched: List<String> = emptyList(),
    val salary: String = "",
    val description: String = "",
    @SerialName("resume_pdf") val resumePdf: String? = null,
    @SerialName("resume_docx") val resumeDocx: String? = null,
    val headline: String? = null,
    val summary: String? = null,
    @SerialName("cover_letter") val coverLetter: String? = null,
    @SerialName("keywords_missing") val keywordsMissing: List<String> = emptyList(),
    @SerialName("keywords_matched") val keywordsMatched: List<String> = emptyList(),
    @SerialName("tailor_method") val tailorMethod: String? = null,
    @SerialName("fit_notes") val fitNotes: String? = null,
    val manual: Boolean = false,
    @SerialName("profile_hash") val profileHash: String? = null,
    val prep: String? = null,
) {
    val link: String get() = applyUrl.ifBlank { url }
    val tailored: Boolean get() = resumePdf != null
    val inCanada: Boolean get() = country == "CA"

    /** "3h", "2d" since posted (or first seen). */
    fun age(): String {
        val t = parse(posted) ?: parse(firstSeen) ?: return ""
        val d = Duration.between(t, OffsetDateTime.now())
        return when {
            d.toHours() < 1 -> "now"
            d.toHours() < 24 -> "${d.toHours()}h"
            else -> "${d.toDays()}d"
        }
    }

    fun ageHours(): Long = parse(posted)?.let { Duration.between(it, OffsetDateTime.now()).toHours() } ?: Long.MAX_VALUE

    private fun parse(s: String): OffsetDateTime? = try {
        if (s.isBlank()) null else OffsetDateTime.parse(s)
    } catch (e: Exception) {
        null
    }
}

@Serializable
data class JobsFile(
    val updated: String = "",
    val count: Int = 0,
    @SerialName("new_this_run") val newThisRun: Int = 0,
    val jobs: List<Job> = emptyList(),
)

object Status {
    const val SAVED = "saved"
    const val APPLIED = "applied"
    const val INTERVIEW = "interview"
    const val OFFER = "offer"
    const val REJECTED = "rejected"
    const val HIDDEN = "hidden"

    /** Statuses that count as "in the pipeline" (shown on the Applied tab). */
    val PIPELINE = listOf(APPLIED, INTERVIEW, OFFER, REJECTED)

    fun label(s: String?) = when (s) {
        SAVED -> "Saved"; APPLIED -> "Applied"; INTERVIEW -> "Interview"; OFFER -> "Offer"
        REJECTED -> "Rejected"; HIDDEN -> "Not interested"; else -> "New"
    }
}

@Serializable
data class StatusEntry(
    val status: String,
    val at: Long = System.currentTimeMillis(),
    val note: String = "",
    val history: List<String> = emptyList(),
)

@Serializable
data class UserState(val statuses: Map<String, StatusEntry> = emptyMap())
