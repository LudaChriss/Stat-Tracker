# Supabase setup

You only need this to run against a **hosted** Supabase project (i.e. to deploy,
or to use the app across more than one device). Local development does not need
it — `npx supabase start` runs the whole stack in Docker and the build is
verified against that.

## Running the local stack (no account needed)

Requires Docker Desktop running.

```bash
npx supabase start --ignore-health-check   # first run pulls ~2GB of images
npx supabase db reset                      # applies supabase/migrations/
npx supabase status                        # prints the local URL and keys
npx supabase stop                          # when you're done
```

`--ignore-health-check` is needed because the Realtime container reports
unhealthy on macOS even though it works (verified by round-tripping a
broadcast). `analytics`, `vector`, `studio`, `storage` and `edge_runtime` are
disabled in `supabase/config.toml` — unused here, and they broke startup.

`.env.local` is already pointed at the local stack.

---

> **ORDER MATTERS.** Create the project and push the schema *before* pointing
> the app at it. Redeploying with env vars set but no schema means the first
> person to open the app hits errors against an empty database. The full,
> ordered checklist lives in `BUILD_TRACKER.md` §4 — this file is the detail
> behind each step.

## 1. Create the project

1. Go to <https://supabase.com/dashboard> and sign in (GitHub sign-in is fine).
2. **New project**.
   - **Name:** `score-tracker`
   - **Database password:** generate one and save it in your password manager.
     You will not need it day to day, but it cannot be recovered — only reset.
   - **Region:** pick the one closest to where you play. This is the single
     biggest factor in how snappy live scoring feels.
   - **Plan:** Free is enough. A rec league is far below the limits.
3. Wait for provisioning (~2 minutes).

## 2. Copy the two keys

In the dashboard: **Project Settings → API**.

| Field | Where it goes |
|---|---|
| **Project URL** (`https://xxxxx.supabase.co`) | `VITE_SUPABASE_URL` |
| **anon / public** key | `VITE_SUPABASE_ANON_KEY` |

Take the **anon** key, not `service_role`. The `service_role` key bypasses every
security rule and must never appear in a browser bundle. If you ever paste it
somewhere client-side, rotate it immediately.

The anon key is *designed* to be public — row-level security is what protects
the data, not the key.

## 3. Put them in your local env

From the repo root:

```bash
cp .env.example .env.local
```

Then edit `.env.local`:

```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

`.env.local` is gitignored. Restart `npm run dev` after changing it — Vite only
reads env at startup.

## 4. Push the schema to the hosted project

The schema lives in `supabase/migrations/` and is already applied locally. To
apply it to the hosted project:

```bash
npx supabase login                        # opens a browser
npx supabase link --project-ref xxxxx     # the ref is in your project URL
npx supabase db push
```

`--project-ref` is the `xxxxx` part of `https://xxxxx.supabase.co`.

Verify in the dashboard under **Table Editor** that the tables exist, and under
**Authentication → Policies** that every table shows RLS enabled.

## 5. Vercel

In the Vercel project: **Settings → Environment Variables**, add both:

| Name | Value | Environments |
|---|---|---|
| `VITE_SUPABASE_URL` | your project URL | Production, Preview, Development |
| `VITE_SUPABASE_ANON_KEY` | your anon key | Production, Preview, Development |

Then **redeploy** — Vercel bakes env vars in at build time, so an existing
deployment will not pick them up on its own.

## 6. Auth redirect URLs

For magic-link sign-in to return to the right place: **Authentication → URL
Configuration**.

- **Site URL:** your production URL (e.g. `https://score-tracker.vercel.app`)
- **Redirect URLs:** add every origin you will sign in from:
  - `http://localhost:5173/**`
  - `https://score-tracker.vercel.app/**`
  - your Vercel preview pattern, if you use previews

A magic link that lands on an unlisted origin fails with a redirect error, and
the message is not obvious — this is the most common setup mistake.

---

## What to send back

Nothing secret. Just confirm:

- the project is created and `db push` succeeded, and
- the env vars are set locally and in Vercel.

I don't need the keys themselves — the app reads them from the environment.
