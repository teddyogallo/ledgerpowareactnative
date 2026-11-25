# Calvin & Lydia Expense Tracker — deployment guide

Feature-complete as of this version: 13 categories (including House Help Salary,
Groceries, House Shopping, Electricity, Internet, Books and Stationery), edit-in-place
on every entry with date+time, a monthly report, and an Obligations view covering
both the fixed Rent/School fees carry-forward budgets and custom one-off obligations
you create with a target amount and log payments against.

This is a real installable web app (PWA). Once deployed, opening the URL on a
phone and choosing "Add to Home Screen" (iOS Safari) or the install prompt
(Android Chrome) gives it an app icon that opens full-screen, same as any
native app.

**No login system.** Anyone with the deployed URL can read, add, edit, and
delete entries. Fine for sharing privately between two co-parents; not fine if
the link could leak.

## What "offline" actually means here

The service worker (via vite-plugin-pwa) caches the app's code and interface,
so the app *opens* even with no signal — you won't get a blank white screen.
But all your data lives in Supabase, not on the phone. With no connection:
- You can open the app and see whatever was already loaded into memory during
  this session.
- You **cannot** log, edit, or delete anything — those all require reaching
  Supabase, and will fail with the error banner you've seen before.
- If you force-quit the app while offline and reopen it, it won't have last
  session's data cached — expect an empty or stale screen until you're back online.

This is not full offline-first sync (queue changes locally, push when back
online). That's a meaningfully bigger build — a local database, conflict
resolution when two people edit offline at once, sync logic. Say so explicitly
if you actually need that; what you have now is "the app loads without
signal," not "the app works without signal."

## Step 1 — Supabase

1. supabase.com → sign up → new project.
2. SQL Editor → paste **supabase-schema.sql** (brand new project) — or
   **supabase-schema-v2.sql** if you already had a Supabase project running an
   earlier version of this app — → Run.
3. Project Settings → API → copy the Project URL and the `anon public` key.

## Step 2 — Configure

```
cp .env.example .env
```
Paste your Project URL and anon key into `.env`.

## Step 3 — Test locally (optional)

```
npm install
npm run dev
```
Add an entry, confirm it shows up in Supabase's Table Editor.

## Step 4 — Deploy to Vercel

1. vercel.com → sign up.
2. Push this folder to a GitHub repo, or run `npm i -g vercel` then `vercel`
   directly from this folder.
3. In Vercel's project settings → Environment Variables, add
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` — same values as your `.env`.
4. Deploy. You get a URL like `calvin-ledger.vercel.app`.

## Step 5 — Install on your phones

- **iPhone**: Safari → Share → Add to Home Screen
- **Android**: Chrome's install prompt, or ⋮ menu → Add to Home screen

## What this still doesn't do

- No accounts, no permissions, no audit trail of who changed what.
- No real offline write support (see above).
- No export to PDF/spreadsheet — the monthly report is a view inside the app,
  not a document you can hand to someone else.

If any of these become something you actually need, say so specifically —
each is a real scoped feature, not a checkbox to flip.
