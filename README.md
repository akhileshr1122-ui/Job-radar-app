# Job Radar

Your own job search assistant. It finds jobs that fit your resume across Canada and the US, scores each one, writes a tailored resume and cover letter for the best matches, and lets you review, edit and apply in one tap.

- **Web app:** https://akhileshr1122-ui.github.io/Job-radar-app/
- **Android app and Chrome extension:** [latest release](https://github.com/akhileshr1122-ui/Job-radar-app/releases/latest)

## Get started (5 minutes, free)
1. Open the web app and choose **I'm new**.
2. Make a GitHub token with the `repo` and `workflow` boxes ticked and paste it. Job Radar creates a **private** copy of itself in your GitHub account; your resume and results stay there.
3. Upload your resume (PDF or Word). Your profile and search settings are built from it; adjust both any time.

The search runs every 4 hours on GitHub's free Actions minutes.

## Optional upgrades (secrets in your copy: Settings → Secrets and variables → Actions)
| Secret | What it adds |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | AI-written resumes, cover letters and interview prep using **your own Claude Pro or Max plan**. Run `claude setup-token` once (needs [Claude Code](https://code.claude.com/docs/en/setup)) and paste the token. |
| `ANTHROPIC_API_KEY` | Same, billed per use to a Claude API account instead. |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | Adzuna aggregator (free at developer.adzuna.com). |
| `RAPIDAPI_KEY` | LinkedIn, Indeed, Glassdoor and ZipRecruiter listings via Google for Jobs (JSearch free plan on rapidapi.com). |
| `JOOBLE_KEY` | Jooble aggregator (free). |

Without any of these it still works: free job sources and keyword-based tailoring.

## How applying works
Job Radar never signs in to job sites or submits applications for you. **Apply now** downloads your tailored resume, copies the cover letter and opens the application; the Chrome extension then fills the form (Greenhouse, Lever, Ashby, Workday, Workable, SmartRecruiters and more) and you check it and press Submit.

## What's inside
`engine/` search, scoring, tailoring (Python, GitHub Actions) · `web/` web app · `app/` Android app · `extension/` Chrome extension · `profile/` your resume data and search settings.
