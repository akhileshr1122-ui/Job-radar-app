# Job Radar on Azure (invite-only, for a group)

One Job Radar website for you and your friends:

- People sign in with **Microsoft** or **GitHub**. Only people on your **invite list** get in.
- Every 4 hours, one **bulk search** pulls jobs from every source once for everybody. Then each person gets their own matches, scores and tailored resumes.
- Uploading a resume, adding a job, editing, interview prep and **Search now** run on demand, usually within a few minutes.
- Nobody needs a GitHub account or token. Each friend can add their own Claude token in Settings for AI resumes.

What it uses: a Storage account, two Container Apps jobs (consumption plan) and a Static Web App (Free plan). For a small group this normally stays within Azure's free monthly grants. The Storage account costs a few cents a month.

---

## One-time setup (about 10 minutes)

### 1. Open Azure Cloud Shell
Go to [portal.azure.com](https://portal.azure.com), click the **Cloud Shell** icon (`>_`) in the top bar and choose **Bash**. There's nothing to install.

### 2. Create the resource group and a deploy key
Paste this and press Enter. It uses your current subscription; run `az account show` first if you have several.

```bash
for p in Microsoft.App Microsoft.OperationalInsights Microsoft.Web Microsoft.Storage; do az provider register -n $p -o none; done
az group create -n job-radar -l canadacentral -o none
az ad sp create-for-rbac --name job-radar-deploy --role contributor \
  --scopes $(az group show -n job-radar --query id -o tsv) --json-auth
```

It prints a block of JSON that starts with `{` and contains `clientId`, `clientSecret` and so on. Copy **all of it**.

### 3. Add it to GitHub
In **github.com/akhileshr1122-ui/Job-radar-app → Settings → Secrets and variables → Actions**:

1. On the **Secrets** tab, click **New repository secret**. Set the name to `AZURE_CREDENTIALS` and the value to the JSON from step 2.
2. On the **Variables** tab, click **New repository variable**. Set the name to `JR_ADMIN_USERS` and the value to the account(s) you'll sign in with, comma separated. For example: `you@example.com,your-github-username`. Use the email for Microsoft sign-in and the username for GitHub sign-in.
3. Optional job-source keys, as **Secrets**: `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `JOOBLE_KEY`, `RAPIDAPI_KEY`. These are the same keys as in your own Job Radar repo, and everybody shares them.

### 4. Deploy
Go to **Actions → Deploy to Azure → Run workflow**. It takes about 5 minutes. When it finishes, the run summary shows your site's link (`https://jobradar-web-….azurestaticapps.net`). This first run also starts the first bulk search.

From now on, every change to the web app, API or infra deploys by itself. The search engine needs no deploy: each run downloads the latest code from this repo.

### 5. Sign in and invite friends
1. Open the link and sign in. If your email is Gmail, choose **Sign in with Microsoft → Create one!** to make a free Microsoft account with that same Gmail address, or use **Sign in with GitHub**.
2. In **Settings**, use **Bring my data over** to copy your existing Job Radar (profile, tracker, jobs, resumes), or just upload your resume.
3. Under **Invite list**, add each friend's email (Microsoft) or GitHub username, then send them the link.

### 6. Use your own domain (optional)
1. Look at the finished deploy's summary. It shows your site's Azure address, like `jobradar-web-abc123.azurestaticapps.net`.
2. At the company where you bought your domain, open its **DNS settings** and add a record:
   - **Type:** CNAME
   - **Name / Host:** `jobs` (for `jobs.ladioro.com`)
   - **Value / Points to:** the Azure address from step 1, without `https://`
   - **TTL:** the default, or 1 hour
3. In GitHub → **Settings → Secrets and variables → Actions → Variables**, add `JR_DOMAIN` = `jobs.ladioro.com`.
4. Wait 10–30 minutes, then **Actions → Deploy to Azure → Run workflow**. Azure checks the record and issues a free HTTPS certificate, usually within 15 minutes. Sign-in works the same on the new address.

---

## Plans and invites
- People can ask for access themselves with the **Request an invite** form on the homepage. Requests show up on the **Admin** tab, where you approve them and pick their plan.
- The plans and prices shown on the site are in `web/plans.js`. Edit the names, prices or feature lists there. To take payments online, paste a Stripe Payment Link into `paymentLink`. Until then, "Upgrade" sends you a request and you move the person to the new plan on the Admin tab.
- The limits each plan enforces are in `api/jr/index.js` (`PLANS`) and `engine/azure_run.py` (`PLAN_LIMITS`).
- **AI included in Plus and Pro:** add an Anthropic API key as the repository secret `SHARED_ANTHROPIC_API_KEY` and redeploy. Plus and Pro members without their own Claude token then get AI resumes on your key, billed per use to your Anthropic account. Don't use your personal Claude Pro or Max token for other people.

## Day to day

| You want to… | Do this |
|---|---|
| Add or remove a friend | Settings → Invite list |
| See who's using it and whether their runs work | Settings → People using it |
| Change how often the bulk search runs | Change `bulkCron` in `infra/main.bicep` (cron, UTC), push, and it redeploys |
| See the runner's logs | Azure portal → resource group **job-radar** → **jobradar-bulk** (or **jobradar-queue**) → Execution history → Console logs. Each person's last run log is also saved as `data/last_run.log` |
| Stop everything | Azure portal → delete the resource group **job-radar**. This also deletes everybody's data |

## Privacy notes for your friends
- Their resume, tracker and tailored resumes are stored in your Azure Storage account. As the owner of that account, you could technically open them, so tell friends that.
- Their Claude token is stored on the server, only used for their own resumes, and never sent back to any browser.
- The Android app and Chrome extension still work with GitHub-based Job Radar only. On the hosted site, friends can use **Add to Home Screen** on their phones.
