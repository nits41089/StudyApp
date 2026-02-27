# Supabase Cloud Sync Setup (IntellectFlow)

This app now supports cloud sync using Supabase Auth + a `user_study_data` table.

## 1. Create a Supabase project

1. Go to https://supabase.com/
2. Create a new project
3. Wait for the database to finish provisioning

## 2. Create/update table + RLS policies

Open `SQL Editor` in Supabase and run this SQL:

```sql
create table if not exists public.user_study_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  topics jsonb not null default '[]'::jsonb check (jsonb_typeof(topics) = 'array'),
  activity_log jsonb not null default '[]'::jsonb check (jsonb_typeof(activity_log) = 'array'),
  updated_at timestamptz not null default now()
);

alter table public.user_study_data
  add column if not exists activity_log jsonb not null default '[]'::jsonb;

alter table public.user_study_data
  drop constraint if exists user_study_data_activity_log_is_array;

alter table public.user_study_data
  add constraint user_study_data_activity_log_is_array
  check (jsonb_typeof(activity_log) = 'array');

alter table public.user_study_data enable row level security;

drop policy if exists "Users can read own study data" on public.user_study_data;
create policy "Users can read own study data"
on public.user_study_data
for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "Users can insert own study data" on public.user_study_data;
create policy "Users can insert own study data"
on public.user_study_data
for insert
to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "Users can update own study data" on public.user_study_data;
create policy "Users can update own study data"
on public.user_study_data
for update
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);
```

Why this version:
- `to authenticated` follows Supabase's current recommendation to scope policies to logged-in users.
- Explicit `is not null` avoids the common `auth.uid() = null` confusion for unauthenticated requests.
- `(select auth.uid())` is the recommended pattern in Supabase docs for policy performance in many cases.
- `activity_log` is included so daily activity stats sync across devices.
- If the table already exists, rerunning this block adds `activity_log` and refreshes policies.

## 3. Configure Auth (email/password) for GitHub Pages

1. Supabase dashboard -> `Authentication` -> `Providers` (or `Sign In / Providers`, depending on UI)
2. Ensure `Email` / `Email + Password` sign-in is enabled
3. Save

Then configure allowed URLs (important for email confirmation links):

1. `Authentication` -> `URL Configuration`
2. Set `Site URL` to your GitHub Pages site URL, for example:
   - `https://<YOUR_USERNAME>.github.io/<YOUR_REPO>/`
3. Add the same URL under `Redirect URLs`
4. Save

Optional:
- If email confirmation is enabled, new users may need to confirm email before sign-in works.
- Supabase hosted default email sending may be restricted for production/public use. For a public app, configure your own SMTP provider under `Authentication` -> `SMTP Settings`.

## 4. Copy your project API values (current Supabase UI)

Supabase changed the dashboard flow. In current projects, the easiest place is:

1. Open your project in Supabase Dashboard
2. Click the `Connect` button (top area of the project dashboard)
3. Copy:
   - `Project URL`
   - `Publishable key` (preferred for frontend apps)

If you need the legacy key instead:

- Open `Settings` -> `API Keys`
- Use the `Legacy API Keys` tab and copy the `anon` key

Notes:
- Your frontend app can use the new `Publishable key` or the legacy `anon` key.
- This project’s variable name is `SUPABASE_ANON_KEY`, but it can hold a publishable key value too.

## 5. Paste config into the app

Edit `index.html` and set these values near the top of the `<script>`:

```js
const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_PUBLISHABLE_OR_ANON_KEY';
```

File reference: `index.html`

## 6. Deploy / update GitHub Pages

Commit and push your changes:

```bash
git add index.html SUPABASE_SETUP.md
git commit -m "Add Supabase cloud sync"
git push
```

## 7. How sync works in the app

- Local data is still cached in `localStorage` for offline use.
- When signed in, the app syncs topics plus the daily activity log to Supabase.
- The same email account can be used on any device/browser to load topics and activity stats.
