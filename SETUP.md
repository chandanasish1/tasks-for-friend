# Setting up your own copy of Tasks

This folder is a complete, self-contained copy of the Tasks app, ready to be
pointed at **your own private database**. Nothing here is connected to anyone
else's account or data: you create a free Supabase project, and everything you
do in the app lives there, visible only to you.

**You need:**
- A free account at [supabase.com](https://supabase.com)
- To build the Android APK: a computer with [Node.js](https://nodejs.org) and
  Android Studio (or an Android SDK). The build script is written for Windows.

---

## 1. Create a Supabase project

Sign up at supabase.com (free tier is plenty) → **New project**. Pick any name
and a strong database password (you won't need the password day-to-day).

## 2. Create the database schema

In your project's dashboard, open **SQL Editor**, paste the entire contents of
[`supabase/setup.sql`](supabase/setup.sql), and click **Run**. It creates the
tables, the sync/versioning triggers, row-level security, and realtime — the
whole backend in one shot.

For an existing database, run [supabase/upgrade-day-planner.sql](supabase/upgrade-day-planner.sql)
to add duration, start/deadline mode, rigidity and daily ordering. This is additive;
existing tasks and owner-only access rules are retained. An authenticated SQL Editor
session or database connection is required; a service-role data API key cannot run SQL migrations.

## 3. Create your login account

For the Pomodoro timer's cloud history and daily goals, also run
[`supabase/upgrade-pomodoro.sql`](supabase/upgrade-pomodoro.sql) in the SQL Editor.
The timer works locally before this migration; cloud sync requires these tables.

The app deliberately has **no sign-up screen** — accounts are created in the
dashboard:

**Authentication → Users → Add user → Create new user**

Enter your email and a password, and tick **Auto Confirm User**. These are the
credentials you'll sign in to the app with.

## 4. Point the app at your project

Open [`src/config.mjs`](src/config.mjs) in any text editor and replace the two
placeholders:

- `SUPABASE_URL` — dashboard → Project Settings → Data API → **Project URL**
- `SUPABASE_KEY` — dashboard → Project Settings → API Keys → the
  **publishable** key (starts with `sb_publishable_`)

## 5. Build the Android APK

From this folder, in a terminal:

```
npm install
npm run sync
cd android
.\gradlew assembleDebug
```

The APK lands at `android\app\build\outputs\apk\debug\app-debug.apk`. Copy it
to the phone and install it (allow "install from unknown sources" when asked).

> First build notes:
> - Gradle needs to know where your Android SDK is. Easiest: open the
>   `android/` folder once in Android Studio, which sets this up
>   automatically. Alternatively set the `ANDROID_HOME` environment variable.
> - **Warning:** the app ID is `com.tasks.app`. Installing this APK on a phone
>   that already has another copy of Tasks will REPLACE that copy.

## 6. First sign-in

Open the app and sign in with the account from step 3. On first sign-in the
app automatically creates the starter lists on your server: **Today,
Upcoming, Routine, Commitments, Academics**. Rename or delete the last two
freely; the first three are the app's smart lists (see the guide).

Now read [`APP-GUIDE.md`](APP-GUIDE.md) — it explains how the lists work.

---

## Optional: run it in a browser instead

The app is also a plain static web app (PWA). Host everything except the
`android/` folder on any static host (Cloudflare Pages, Netlify, Vercel, …)
and open it in a browser — same sign-in, same data, live-synced with the
phone. For a quick local test: `npx http-server .` from this folder.

## For the person handing this package out

To prepare a copy for another friend: this folder IS the template. Zip it and
send it as-is (the config placeholders are the point — each friend fills in
their own project). If you build the APK for them, put their keys into
`src/config.mjs`, build, send the APK, then restore the placeholders.
