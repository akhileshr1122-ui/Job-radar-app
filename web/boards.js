// Every job site worth checking, with a link that opens it already searched.
const enc = encodeURIComponent;
const dash = (q) => q.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");

export const BOARD_GROUPS = (country) => [
  {
    title: "Searched for you automatically",
    note: "New jobs from these arrive in your list every 4 hours.",
    boards: [
      ["Company career pages", "Greenhouse, Lever, Ashby, Workable and SmartRecruiters boards of the companies you watch", (q, l) => `https://www.google.com/search?q=${enc(q + " careers")}`],
      ["Adzuna", "Pulls from hundreds of job boards (needs the free Adzuna key)", (q, l) => country === "US" ? `https://www.adzuna.com/search?q=${enc(q)}&w=${enc(l)}` : `https://www.adzuna.ca/search?q=${enc(q)}&w=${enc(l)}`],
      ["LinkedIn · Indeed · Glassdoor · ZipRecruiter", "Through Google for Jobs once you add the free JSearch key", (q, l) => `https://www.google.com/search?q=${enc(q + " jobs " + l)}&ibp=htl;jobs`],
      ...(country === "CA" ? [
        ["Job Bank", "Government of Canada", (q, l) => `https://www.jobbank.gc.ca/jobsearch/jobsearch?searchstring=${enc(q)}&locationstring=${enc(l)}`],
        ["Eluta", "Jobs straight from Canadian employer sites", (q, l) => `https://www.eluta.ca/search?q=${enc(q)}&l=${enc(l)}`],
      ] : []),
      ["Amazon Jobs", "Amazon's own career site", (q, l) => `https://www.amazon.jobs/en/search?base_query=${enc(q)}&loc_query=${enc(l)}`],
      ["Jooble", "Aggregator (needs the free Jooble key)", (q, l) => `https://jooble.org/SearchResult?ukw=${enc(q)}&rgns=${enc(l)}`],
      ["Remotive · Remote OK · Himalayas · Jobicy · We Work Remotely · Working Nomads", "Remote jobs", (q) => `https://remotive.com/remote-jobs?query=${enc(q)}`],
      ["The Muse", "Curated company jobs", (q) => `https://www.themuse.com/search/keyword/${enc(q)}`],
    ],
  },
  {
    title: country === "US" ? "United States – open and search" : "Canada – open and search",
    note: "Found a good one? Add it with “Add a job” (or Share → Job Radar on Android) and get a tailored resume.",
    boards: country === "US" ? [
      ["LinkedIn Jobs", "", (q, l) => `https://www.linkedin.com/jobs/search/?keywords=${enc(q)}&location=${enc(l)}`],
      ["Indeed", "", (q, l) => `https://www.indeed.com/jobs?q=${enc(q)}&l=${enc(l)}`],
      ["Glassdoor", "", (q) => `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${enc(q)}`],
      ["ZipRecruiter", "", (q, l) => `https://www.ziprecruiter.com/jobs-search?search=${enc(q)}&location=${enc(l)}`],
      ["Monster", "", (q, l) => `https://www.monster.com/jobs/search?q=${enc(q)}&where=${enc(l)}`],
      ["CareerBuilder", "", (q, l) => `https://www.careerbuilder.com/jobs?keywords=${enc(q)}&location=${enc(l)}`],
      ["SimplyHired", "", (q, l) => `https://www.simplyhired.com/search?q=${enc(q)}&l=${enc(l)}`],
      ["Built In", "Tech & e-commerce companies", (q) => `https://builtin.com/jobs?search=${enc(q)}`],
      ["Dice", "Tech-leaning roles", (q, l) => `https://www.dice.com/jobs?q=${enc(q)}&location=${enc(l)}`],
      ["Wellfound", "Startups", () => "https://wellfound.com/jobs"],
    ] : [
      ["LinkedIn Jobs", "Turn on job alerts there too", (q, l) => `https://www.linkedin.com/jobs/search/?keywords=${enc(q)}&location=${enc(l)}`],
      ["Indeed Canada", "", (q, l) => `https://ca.indeed.com/jobs?q=${enc(q)}&l=${enc(l)}`],
      ["Google Jobs", "Searches nearly every board at once", (q, l) => `https://www.google.com/search?q=${enc(q + " jobs " + l)}&ibp=htl;jobs`],
      ["Glassdoor Canada", "", (q, l) => `https://www.glassdoor.ca/Job/jobs.htm?sc.keyword=${enc(q)}&locKeyword=${enc(l)}`],
      ["Talent.com", "", (q, l) => `https://ca.talent.com/jobs?k=${enc(q)}&l=${enc(l)}`],
      ["Workopolis", "", (q, l) => `https://www.workopolis.com/jobsearch/find-jobs?ak=${enc(q)}&l=${enc(l)}`],
      ["Monster Canada", "", (q, l) => `https://www.monster.ca/jobs/search?q=${enc(q)}&where=${enc(l)}`],
      ["SimplyHired Canada", "", (q, l) => `https://www.simplyhired.ca/search?q=${enc(q)}&l=${enc(l)}`],
      ["CareerJet Canada", "", (q, l) => `https://www.careerjet.ca/search/jobs?s=${enc(q)}&l=${enc(l)}`],
      ["CareerBeacon", "Atlantic and national", (q, l) => `https://www.careerbeacon.com/en/search?keyword=${enc(q)}&location=${enc(l)}`],
      ["Jobboom", "Quebec", (q) => `https://www.jobboom.com/en/job-offers?keywords=${enc(q)}`],
      ["Welcome to the Jungle", "Startups and scale-ups", (q) => `https://app.welcometothejungle.com/jobs?query=${enc(q)}`],
      ["Wellfound", "Startups", () => "https://wellfound.com/jobs"],
    ],
  },
  {
    title: "Remote and freelance",
    note: "",
    boards: [
      ["Remote OK", "", (q) => `https://remoteok.com/remote-${dash(q)}-jobs`],
      ["Remote.co", "", (q) => `https://remote.co/remote-jobs/search/?search_keywords=${enc(q)}`],
      ["Dynamite Jobs", "Strong e-commerce focus", (q) => `https://dynamitejobs.com/remote-jobs?q=${enc(q)}`],
      ["FlexJobs", "Paid, vetted remote jobs", (q) => `https://www.flexjobs.com/search?search=${enc(q)}`],
      ["Upwork", "Freelance contracts", (q) => `https://www.upwork.com/nx/search/jobs/?q=${enc(q)}`],
    ],
  },
];
