# Free GitHub Pages deployment

This is the optional browser-only alternative. The current full-stack Vercel + Render + Neon deployment is documented in [CLOUD_DEPLOYMENT.md](CLOUD_DEPLOYMENT.md). The Pages workflow is now manual; `main` pushes run the full-stack CI workflow.

The default deployment is an interactive portfolio demo on GitHub Pages. A public repository can use Pages with GitHub Free. No hosting account, API secrets, SMS account, payment credentials, or database is needed for this mode.

The demo opens automatically with fictional addresses and pickup history. Recruiters can browse providers, reserve a future slot, simulate successful or failed payment, cancel an unpaid reservation, and edit addresses. All demo state is in browser memory. Reloading resets it; visitors and tabs do not share data. Seeded provider and order links survive refresh; newly created pickups disappear on reload. A visible banner identifies the simulation. It does not authenticate users or verify real payments. The normal API-backed application still runs locally using the existing setup.

## Publish from Windows PowerShell

Git has already been initialized on `main`. GitHub CLI was not installed when this setup was prepared. Install it once:

```powershell
winget install --id GitHub.cli --exact
```

Open a new terminal so `gh` is available, then run:

```powershell
cd D:\aksha\Projects\HKS
gh auth login
gh auth setup-git
git status --short
git add .
git diff --cached --stat
git commit -m "Prepare Loop demo and GitHub Pages deployment"
gh repo create loop-pickup --public --source=. --remote=origin --push
```

Choose another repository name if `loop-pickup` already exists in your account. If Git asks for your identity, set your actual name and GitHub email with `git config user.name "Your Name"` and `git config user.email "your-github-email"`, then repeat the commit.

Enable Pages for the new repository:

```powershell
gh api --method POST "repos/{owner}/{repo}/pages" -f build_type=workflow
gh workflow run deploy.yml --ref main
gh run list --workflow deploy.yml
gh browse --settings
```

`{owner}` and `{repo}` above are GitHub CLI placeholders resolved from the current repository's remote. If Pages is already enabled, the POST can report that the site already exists: use **Settings → Pages → Build and deployment → Source → GitHub Actions** to confirm the source. The first push can fail at Configure Pages if Pages was not yet enabled; the manual run above retries after enabling it.

The Actions tab shows the deployment URL after success. With the default repository name it is:

```text
https://YOUR_GITHUB_USERNAME.github.io/loop-pickup/
```

Subsequent pushes to `main` automatically check, build, and deploy. Hash routes such as `#/orders` work on refresh without a server rewrite. The workflow derives the asset path from GitHub Pages metadata, so repository names and account sites are supported.

If you prefer creating an empty public repository in the GitHub website, run the add/commit commands above, then use these commands instead of `gh repo create`:

```powershell
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/loop-pickup.git
git push -u origin main
```

Then enable **GitHub Actions** as the Pages source in repository settings and rerun the deployment workflow. Do not initialize the remote with a README or license when following this existing-project push flow.

## What Actions runs

`.github/workflows/deploy.yml` runs on pushes to `main` and manual dispatch. It installs the lockfile dependencies, generates Prisma Client, checks lint and TypeScript, runs backend and frontend tests, builds the backend as a compilation check, and builds/uploads only `frontend/dist` to Pages. In demo mode it also opens the built site in Chromium and checks refresh, navigation, sign-out/reentry, and successful simulated checkout without API requests. Backend tests use their dedicated test database. Backend source and databases are never included in the Pages artifact.

The build and deploy jobs use GitHub's built-in token with scoped permissions. No personal access token or hosting deploy secret is required.

## Build variables and API mode

The workflow defaults work without configuring any variables. Optional settings are under **Settings → Secrets and variables → Actions → Variables**:

| Variable         | Default | Meaning                                                                                           |
| ---------------- | ------- | ------------------------------------------------------------------------------------------------- |
| `VITE_DEMO_MODE` | `true`  | Use the isolated browser demo. Set to `false` only after deploying a compatible, hardened API.    |
| `VITE_API_URL`   | `/api`  | In API mode, use an absolute HTTPS endpoint including `/api`, e.g. `https://api.example.com/api`. |

`VITE_API_URL` can alternatively be an Actions secret of the same name; the repository variable takes precedence. URLs are public configuration: **every `VITE_*` value is compiled into downloadable browser code**, even when supplied as a GitHub secret. JWT signing secrets, database credentials, and `RAZORPAY_KEY_SECRET` belong only in a backend host's environment.

After configuring a suitable backend, the switch is:

```powershell
gh variable set VITE_API_URL --body "https://api.example.com/api"
gh variable set VITE_DEMO_MODE --body "false"
gh workflow run deploy.yml --ref main
```

To restore the fully self-contained demo:

```powershell
gh variable set VITE_DEMO_MODE --body "true"
gh workflow run deploy.yml --ref main
```

The workflow sets `VITE_ROUTER_MODE=hash` and `VITE_BASE_PATH` automatically. Changing a variable requires a new build. Local development uses BrowserRouter and the normal API proxy by default.

## Preview the exact Pages mode locally

In PowerShell, from the repository root:

```powershell
$env:VITE_DEMO_MODE = "true"
$env:VITE_ROUTER_MODE = "hash"
$env:VITE_BASE_PATH = "/loop-pickup/"
npm run build -w frontend
npm run preview -w frontend -- --port 4173
```

Visit **http://127.0.0.1:4173/loop-pickup/**. Try booking a pickup, both simulated payment outcomes, browser Back, reloading an order URL, editing an address, signing out/opening the demo, and Reset demo. No backend should be running or requested.

After stopping the preview, clear those terminal overrides before returning to ordinary local development:

```powershell
Remove-Item Env:VITE_DEMO_MODE
Remove-Item Env:VITE_ROUTER_MODE
Remove-Item Env:VITE_BASE_PATH
```

## Free backend options and current limitations

Render has a Free web-service option, and Neon has a Free Postgres plan. These are possible services for a future backend deployment, but **Render + Neon is not compatible with this SQLite implementation by changing only `DATABASE_URL`**:

- SQLite files on Render Free are ephemeral; Free services cannot attach persistent disks. Changes can disappear on restart or redeployment. An automatically reseeded disposable server would still need an appropriate public demo authentication policy.
- Neon/Supabase use Postgres. This repository's Prisma datasource, migrations, SQLite triggers, and concurrency guarantees need a reviewed Postgres implementation before switching databases.
- The current backend intentionally refuses `NODE_ENV=production`. Console OTP delivery also does not give recruiters a self-service sign-in flow.
- Refresh cookies are `SameSite=Strict`. A GitHub Pages origin and an unrelated backend host are cross-site, so refresh-cookie authentication requires a deliberate cookie/origin deployment policy or a suitable same-site hosting arrangement. Merely setting CORS or `VITE_API_URL` does not solve this.

The Pages demo avoids those deployment dependencies while keeping the existing backend invariants. It is the configured zero-cost portfolio deployment. A future API deployment should retain server-side JWT verification, user isolation, hashed credentials, atomic reservations, signature verification, and backend-only payment secrets.

References: [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [Render Free limitations](https://render.com/docs/free), [Neon plans](https://neon.com/pricing).

## Files excluded from the first push

`.gitignore` excludes environment files, dependencies, build output, Python virtual environments/caches, SQLite databases/journals, logs and test artifacts. The example environment files remain included. Existing local scratch files `am.txt`, `result.json`, `result.jsn`, and root `test.py` are also excluded; review them before publishing them explicitly.

You can confirm the important exclusions with:

```powershell
git check-ignore backend/.env frontend/.env node_modules backend/prisma/dev.db venv .venv
```
