# IntellectFlow

Bandwidth-aware study scheduler for planning review sessions without overloading a day.

Live app: `https://nits41089.github.io/StudyApp/`

## What this app does

- Adds study topics with estimated duration (`20m`, `45m`, `90m`)
- Builds a daily agenda based on your daily capacity (minutes)
- Defers overflow topics to avoid burnout
- Uses adaptive spaced repetition with:
  - learning-phase progression (`1d -> 2d -> 4d`) for new/forgotten topics
  - per-topic ease factor updates from review feedback
  - timing-aware interval changes (overdue/early effects)
  - stability damping from recent struggle history
- Prioritizes due topics by risk (overdue days, lapses, ease, recent hard rate)
- Tracks streaks and next-review dates
- Shows SRS quality metrics (retention proxy, hard within 7d, overdue rate, learning vs graduated hard rate)
- Includes AI understanding checks on due topics (material -> questions -> score -> auto difficulty mapping)
- Lets you edit/delete topics
- Backup/restore data as JSON
- Cloud sync across devices using Supabase Auth + Postgres
- Microsoft Clarity analytics (behavior + custom events)
- Includes an in-app `Tutorial` tab for first-time users

## Tech stack

- `HTML` (single-page app shell)
- `Tailwind CSS` (CDN)
- `Vanilla JavaScript`
- `Supabase` (Auth + Postgres for cloud sync)
- `Microsoft Clarity` (analytics)
- `GitHub Pages` (hosting)

## Project files

- `index.html` - app layout/markup + script/style includes
- `assets/css/main.css` - app-specific styles
- `assets/js/core.js` - app state, normalization, local persistence, shared helpers
- `assets/js/sync.js` - Supabase auth + cloud sync logic
- `assets/js/features.js` - topic actions, analytics rendering, backup/restore, bootstrap
- `SUPABASE_SETUP.md` - detailed Supabase backend setup
- `favicon.svg`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` - icons
- `site.webmanifest` - mobile install metadata

## Use the app (end user)

### App routes

The app uses client-side hash routes (works with GitHub Pages static hosting):

- `#/dashboard` - today agenda
- `#/analytics` - activity charts + category insights + SRS quality metrics
- `#/topics` - add/edit topics + library
- `#/tutorial` - beginner-friendly walkthrough of how to use the app
- `#/sync` - cloud auth and sync controls

### Local-only mode (no sign-in)

1. Open the app
2. (Optional) Open the `Tutorial` tab for a quick guided walkthrough
3. Add topics and choose session length
4. Set your `Daily Capacity (Min)`
5. Complete due topics as `Struggled`, `Okay`, or `Mastered`
6. Data is stored in your browser (`localStorage`)

### Cloud sync mode (use across devices)

1. Sign up with email/password in the `Cloud Sync` section
2. Confirm your email (if your Supabase project requires confirmation)
3. Sign in
4. Your topics will sync to the cloud automatically (and can also be synced manually with `Sync Now`)
5. Sign in with the same account on another device/browser to load the same data

### Backup and restore

- `Backup (.json)` downloads your topic list
- `Restore` imports a previous backup file

### Spaced repetition model (current)

- Review outcomes:
  - `Struggled` resets interval to `1` day and returns topic to learning phase
  - `Okay` and `Mastered` increase intervals using adaptive factors
- Learning phase:
  - short steps `1d -> 2d -> 4d` before full long-interval scheduling
- Adaptive factors:
  - ease factor changes per review (`easy` up, `medium` slightly down, `hard` down)
  - overdue/early timing adjustment
  - stability damping when recent history has many `hard` outcomes
- Due priority:
  - higher priority for topics that are overdue, repeatedly lapsed, low-ease, or recently difficult

### AI understanding check (current)

- On due cards, click `Assess with AI`.
- Paste the study material and generate questions.
- If a quiz already exists for that topic, the app reuses it by default.
- Users can explicitly click `Regenerate Quiz` to create a fresh one.
- Question count depends only on material length:
  - `question_count = clamp(ceil(word_count / 220), 3, 25)`
- Answer all generated questions, then grade with AI.
- The suggested result maps to scheduler difficulty:
  - `< 50` -> `Struggled`
  - `50-79` -> `Okay`
  - `>= 80` -> `Mastered`

### AI backend setup (required for AI checks)

Deploy these Supabase Edge Functions in your project:

- `ai-generate-quiz`
- `ai-grade-quiz`

Set secrets before deployment:

```bash
supabase secrets set OPENAI_API_KEY=your_openai_api_key
supabase secrets set OPENAI_MODEL=gpt-4.1-mini
```

Then deploy:

```bash
supabase functions deploy ai-generate-quiz
supabase functions deploy ai-grade-quiz
```

The frontend calls these functions using your existing Supabase project config in `assets/js/core.js`.

## Run locally

This is a static app. You can run it either way:

### Option 1: Open directly

- Double-click `index.html`

### Option 2: Local server (recommended)

```bash
cd /Users/nitinthakur/softwares/StudyApp
python3 -m http.server 8000
```

Then open:

- `http://localhost:8000/`

## Configure cloud sync (Supabase)

Detailed guide: `SUPABASE_SETUP.md`

### Summary

1. Create a Supabase project
2. Create the `user_study_data` table and RLS policies (SQL in `SUPABASE_SETUP.md`)
3. Enable Email/Auth provider
4. Configure `Authentication` -> `URL Configuration` for your GitHub Pages URL
5. Copy `Project URL` + `Publishable key` (or legacy `anon` key)
6. Paste them into `assets/js/core.js`

Look for these constants in `assets/js/core.js`:

```js
const SUPABASE_URL = '...';
const SUPABASE_ANON_KEY = '...';
```

### Security note

- The Supabase publishable/anon key in frontend code is expected and can be public.
- Security depends on correct RLS policies.
- Never put a `service_role` key in frontend code.

## Configure analytics (Microsoft Clarity)

The app includes Microsoft Clarity tracking and custom events.

1. Create a Clarity project for your site
2. Copy the Clarity project ID
3. Set/update the project ID in `index.html`:

```js
const CLARITY_PROJECT_ID = 'YOUR_CLARITY_PROJECT_ID';
```

### Tracked custom events (examples)

- App load
- Cloud sync success/failure (auto/manual)
- Sign up/sign in/sign out
- Topic add/update/delete
- Topic completion by difficulty
- Backup export/import

## Deploy (GitHub Pages)

### First-time deploy

```bash
cd /Users/nitinthakur/softwares/StudyApp
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<YOUR_USERNAME>/<YOUR_REPO>.git
git push -u origin main
```

Then on GitHub:

1. `Settings` -> `Pages`
2. Under `Build and deployment`
3. `Source`: `Deploy from a branch`
4. Branch: `main`
5. Folder: `/(root)`
6. Save

### Update deploys

```bash
cd /Users/nitinthakur/softwares/StudyApp
git add .
git commit -m "Update app"
git push
```

## iPhone/iPad install (Add to Home Screen)

1. Open the live site in **Safari**
2. Tap **Share**
3. Tap **Add to Home Screen**
4. Tap **Add**

If the icon looks outdated, remove it and add again (iOS caches icons aggressively).

## Troubleshooting

### Supabase email confirm error: `{"error":"requested path is invalid"}`

Usually a redirect URL issue.

- Set the correct GitHub Pages URL in Supabase `Authentication` -> `URL Configuration`
- Add both:
  - `https://<YOUR_USERNAME>.github.io/<YOUR_REPO>/`
  - `https://<YOUR_USERNAME>.github.io/<YOUR_REPO>/index.html` (optional but useful)
- Send a new confirmation email after changing settings

See `SUPABASE_SETUP.md` for the full checklist.

### Clarity not showing data

- Confirm the correct `CLARITY_PROJECT_ID` is set
- Open the live site and interact with it for a minute
- Check Clarity `Live` and recordings (there can be a short delay)

## Privacy / data notes

- Study topic data is stored locally in browser storage by default
- If signed in, topic data is also stored in your Supabase project
- Microsoft Clarity collects usage analytics/session behavior
- If you have users in regions requiring consent, add a consent banner before enabling analytics

## Future improvements (optional)

- Conflict resolution/merge UI for multi-device edits
- SRS settings UI to tune algorithm constants without code changes
- Leech handling for repeatedly failed topics
- PWA offline caching (service worker)
