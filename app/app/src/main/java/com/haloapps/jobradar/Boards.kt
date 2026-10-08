package com.haloapps.jobradar

import android.net.Uri

/** Every job site worth checking for Canada + US, with a search link built from the current query. */
data class Board(val name: String, val note: String, val template: String, val auto: Boolean = false) {
    fun url(query: String, location: String): String {
        val q = Uri.encode(query)
        val l = Uri.encode(location)
        val dash = query.trim().lowercase().replace(Regex("[^a-z0-9]+"), "-")
        return template.replace("{q}", q).replace("{l}", l).replace("{dash}", dash)
    }
}

data class BoardGroup(val title: String, val boards: List<Board>)

val BOARD_GROUPS = listOf(
    BoardGroup(
        "Searched for you every 4 hours ✓", listOf(
            Board("Amazon Jobs", "Amazon's own career site, Canada", "https://www.amazon.jobs/en/search?base_query={q}&loc_query={l}", auto = true),
            Board("Company career boards", "Greenhouse, Lever, Ashby, Workable and SmartRecruiters boards of ~150 e-commerce brands, agencies and tools", "https://boards.greenhouse.io/", auto = true),
            Board("Adzuna", "Aggregator: pulls from hundreds of Canadian and US boards (needs free API key)", "https://www.adzuna.ca/search?q={q}&w={l}", auto = true),
            Board("Jooble", "Aggregator (needs free API key)", "https://ca.jooble.org/SearchResult?ukw={q}&rgns={l}", auto = true),
            Board("Job Bank (Government of Canada)", "Canada's national job board", "https://www.jobbank.gc.ca/jobsearch/jobsearch?searchstring={q}&locationstring={l}", auto = true),
            Board("Remotive", "Remote jobs", "https://remotive.com/remote-jobs?query={q}", auto = true),
            Board("Remote OK", "Remote jobs", "https://remoteok.com/remote-{dash}-jobs", auto = true),
            Board("Himalayas", "Remote jobs with location limits", "https://himalayas.app/jobs?q={q}", auto = true),
            Board("Jobicy", "Remote jobs", "https://jobicy.com/?search_keywords={q}", auto = true),
            Board("We Work Remotely", "Remote jobs", "https://weworkremotely.com/remote-jobs/search?term={q}", auto = true),
            Board("The Muse", "Curated company jobs", "https://www.themuse.com/search/keyword/{q}", auto = true),
            Board("Eluta", "Jobs straight from Canadian employer sites", "https://www.eluta.ca/search?q={q}&l={l}", auto = true),
            Board("Working Nomads", "Remote", "https://www.workingnomads.com/jobs?tag={dash}", auto = true),
            Board("Big-brand career sites", "P&G, Unilever, Clorox, Kimberly-Clark, Logitech (Workday) – add more in Search preferences", "https://www.pg.com/careers", auto = true),
            Board("LinkedIn · Indeed · Glassdoor · ZipRecruiter", "Through Google for Jobs (JSearch) once you add the free RAPIDAPI_KEY secret", "https://www.google.com/search?q={q}+jobs+{l}&ibp=htl;jobs", auto = true),
        )
    ),
    BoardGroup(
        "Canada – open & search (share good ones to Job Radar)", listOf(
            Board("LinkedIn Jobs", "Biggest for manager roles; turn on job alerts", "https://www.linkedin.com/jobs/search/?keywords={q}&location={l}"),
            Board("Indeed Canada", "Largest Canadian job board", "https://ca.indeed.com/jobs?q={q}&l={l}"),
            Board("Google Jobs", "Searches nearly every board at once", "https://www.google.com/search?q={q}+jobs+{l}&ibp=htl;jobs"),
            Board("Glassdoor Canada", "Jobs + salaries + reviews", "https://www.glassdoor.ca/Job/jobs.htm?sc.keyword={q}&locKeyword={l}"),
            Board("Talent.com", "Canadian aggregator", "https://ca.talent.com/jobs?k={q}&l={l}"),
            Board("Workopolis", "Canadian board (part of Indeed)", "https://www.workopolis.com/jobsearch/find-jobs?ak={q}&l={l}"),
            Board("Monster Canada", "General board", "https://www.monster.ca/jobs/search?q={q}&where={l}"),
            Board("SimplyHired Canada", "Aggregator", "https://www.simplyhired.ca/search?q={q}&l={l}"),
            Board("CareerJet Canada", "Aggregator", "https://www.careerjet.ca/search/jobs?s={q}&l={l}"),
            Board("CareerBeacon", "Atlantic + national", "https://www.careerbeacon.com/en/search?keyword={q}&location={l}"),
            Board("Jobboom", "Quebec", "https://www.jobboom.com/en/job-offers?keywords={q}"),
            Board("Wellfound", "Startups (formerly AngelList)", "https://wellfound.com/jobs"),
            Board("Welcome to the Jungle", "Startups & scale-ups (formerly Otta)", "https://app.welcometothejungle.com/jobs?query={q}"),
            Board("Shopify Careers", "Shopify itself", "https://www.shopify.com/careers"),
        )
    ),
    BoardGroup(
        "United States – open & search", listOf(
            Board("LinkedIn Jobs (US remote)", "Filter: Remote", "https://www.linkedin.com/jobs/search/?keywords={q}&location=United%20States&f_WT=2"),
            Board("Indeed US", "Largest US board", "https://www.indeed.com/jobs?q={q}&l=Remote"),
            Board("Glassdoor US", "Jobs + salaries", "https://www.glassdoor.com/Job/remote-jobs-SRCH_IL.0,6_IS11047.htm?sc.keyword={q}"),
            Board("ZipRecruiter", "Large US board", "https://www.ziprecruiter.com/jobs-search?search={q}&location=Remote"),
            Board("Monster US", "General board", "https://www.monster.com/jobs/search?q={q}&where=Remote"),
            Board("CareerBuilder", "General board", "https://www.careerbuilder.com/jobs?keywords={q}&location=Remote"),
            Board("SimplyHired US", "Aggregator", "https://www.simplyhired.com/search?q={q}&l=Remote"),
            Board("Built In", "Tech & e-commerce companies", "https://builtin.com/jobs/remote?search={q}"),
            Board("Dice", "Tech-leaning roles", "https://www.dice.com/jobs?q={q}&location=Remote"),
        )
    ),
    BoardGroup(
        "Remote & freelance", listOf(
            Board("Remote.co", "Remote", "https://remote.co/remote-jobs/search/?search_keywords={q}"),
            Board("Dynamite Jobs", "Remote, strong e-commerce focus", "https://dynamitejobs.com/remote-jobs?q={q}"),
            Board("JustRemote", "Remote", "https://justremote.co/remote-jobs"),
            Board("FlexJobs", "Paid, vetted remote jobs", "https://www.flexjobs.com/search?search={q}"),
            Board("Upwork", "Freelance Amazon / e-commerce contracts", "https://www.upwork.com/nx/search/jobs/?q={q}"),
        )
    ),
)
