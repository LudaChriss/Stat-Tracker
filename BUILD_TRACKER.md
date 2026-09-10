# Morning report — Phase 1 is green

All six slices done. **589 assertions, 20 suites, build clean, viewport audit clean.**
Nothing is blocked. Do not push before reading §5.

## 1. Built, and how far it was verified

**Verified in a real browser, end to end** — signed in with a code actually
emailed and typed in, migrated the season up, verified it, disabled the network,
renamed the team offline, restored the network, and watched the write replay to
the account. Queue drained, nothing parked, edit survived a reload, still signed
in, no console errors.

**Verified against the real database (not the browser)**: schema, all 27 RLS
policies, the import, `discard_import`, and the adversarial attack suite.

**Verified in tests only**: the offline queue's parked/permanent-failure paths,
the sync-decision branches, and the config-error screen. The happy paths of each
were exercised in the browser; the failure paths were not.

**Not verified anywhere**: nothing on a real iPhone yet. That needs a deploy.

## 2. Judgement calls

- **Backend load merges, never replaces.** It returned only the season and
  `useGame` set that as the whole state — sport and batting order vanished and
  the live screen crashed. The backend owns the season; the device owns its own
  state.
- **Saving is one transactional function.** It was two round trips, so a failure
  left the team renamed and the roster stale. Half-applied is worse than failed.
- **A season write is coalesced per team**, since a later snapshot wholly
  contains an earlier one. Event-log appends (phase 3) are never coalesced.
- **Anything unexpected during reconciliation leaves the device in charge** of
  its own data rather than showing an account season we could not verify.
- **Which team is "mine" is recorded on the profile**, not guessed. A user
  manages several teams after an import, and guessing picks wrong eventually.
- **Production with no env vars refuses to start**; development still runs
  local-only, because that is a real mode rather than a mistake.

## 3. Not finished

Nothing from 1f. Phase 2 not started, as instructed.

**Read this one before you score a real game.** A game finalised *after* you
sign in is not written to the backend yet — `save_season` covers the team and
roster only, and game history reaches the backend solely through the one-time
import. It is not lost: it stays on the phone, stays exportable, and the next
launch notices the device and the account disagree and asks you rather than
silently choosing. But until phase 3 the phone is the only copy of a new game.
Export after a game, as you would have anyway.

Two further limits, both scoped to later phases and neither blocking:
- The backend does not yet store the batting order or the bench — those stay on
  the device. Fine for one scorer; phase 4 needs them shared.
- An import makes you manager of the opposing teams it creates. Correct for a
  solo season; phase 4 will need league-owned teams to supersede them.

## 4. Deploy checklist, in order

Nothing below has been done. There is no hosted Supabase project yet, the CLI
has never been linked to one, and none of the 12 migrations have been applied
anywhere except the local Docker stack. `.env.local` points at localhost.

**The order matters.** The database must exist and have the schema *before* the
app is pointed at it, or the first person to open the deployed app hits errors
against an empty database.

### 1. Create the Supabase project

Dashboard → **New project**. Save the database password somewhere; it cannot be
recovered, only reset. Pick the region closest to where you play — that is the
single biggest factor in how snappy live scoring feels. Free tier is ample.

Wait for provisioning (~2 min).

### 2. Push the schema — BEFORE the app points at it

From the repo root:

```bash
npx supabase login                      # opens a browser
npx supabase link --project-ref xxxxx   # the xxxxx from https://xxxxx.supabase.co
npx supabase db push
```

That applies all 12 migrations: the tables, all 27 row-level security policies,
and these 11 functions —

`handle_new_user`, `create_team_with_manager`, `create_league_with_admin`,
`claim_primary_team`, `set_primary_team`, `league_is_readable`,
`fill_game_team_snapshots`, `import_season`, `import_season_and_claim`,
`discard_import`, `save_season` — plus the eight RLS helpers
`is_team_member`, `is_league_admin`, `is_league_member`, `can_manage_team`,
`can_score_game`, `can_score_teams`, `game_is_readable` and `accept_invite`,
which is 19 security-definer functions in all.

`db push` will list what it is about to apply and ask to confirm. It only ever
applies migrations the remote has not seen.

### 3. Check the push actually landed

Dashboard → **SQL Editor**, run:

```sql
select count(*) as tables from pg_tables where schemaname = 'public';
select count(*) as policies from pg_policies where schemaname = 'public';
select count(*) as functions from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef;
```

Expect **9 tables, 26 policies, 19 security-definer functions** (20 public
functions in total — the 20th, `set_updated_at`, is a plain trigger function).
If any number is short, stop — the app will half-work in confusing ways rather
than fail cleanly.

Two of those numbers were wrong in an earlier version of this checklist, and
both errors are worth remembering:

- **26, not 27.** The 27th was `leagues_insert_authenticated`, which migration
  `20260101000005` deliberately drops: a league must be created through
  `create_league_with_admin` so its creator becomes its admin atomically. The
  figure 27 came from a subagent's report, was correct when written, and went
  stale the moment a later migration removed a policy.
- **19, not 11.** The 11 was produced by grepping the migrations for
  `create or replace function public.`, which silently missed the eight
  row-level-security helpers (`is_team_member`, `is_league_admin`,
  `is_league_member`, `can_manage_team`, `can_score_game`, `can_score_teams`,
  `game_is_readable`, `accept_invite`). Counting source text is not counting
  what the database has.

### 4. ⚠️ Change the sign-in email template — THE STEP THAT SILENTLY BREAKS SIGN-IN

Skip this and sign-in fails with nothing explaining why: the email arrives with
a link and no code, the link opens in Safari rather than the installed app, so
the app itself stays signed out and there is nothing to type in.

Dashboard → **Authentication → Email Templates → Magic Link**. Replace the body:

```html
<h2>Your sign-in code</h2>
<p>Enter this code in the app:</p>
<p style="font-size:28px;font-weight:800;letter-spacing:.18em">{{ .Token }}</p>
<p>It expires in an hour. If you didn't ask for it, ignore this email.</p>
```

The part that matters is `{{ .Token }}` where `{{ .ConfirmationURL }}` was. Save.

Then **Authentication → URL Configuration**:
- **Site URL:** your Vercel URL
- **Redirect URLs:** add `https://<your-app>.vercel.app/**`

### 5. Vercel environment variables

**Settings → Environment Variables**, add both to Production, Preview and
Development:

- `VITE_SUPABASE_URL` — `https://xxxxx.supabase.co`
- `VITE_SUPABASE_ANON_KEY` — the **anon** key, never `service_role`

### 6. Redeploy

Vite bakes these in at build time, so an existing deployment will not pick them
up. Skip this and the app shows a screen naming the missing variables — that is
deliberate, and it is the failure you want rather than an empty season.

### 7. First sign-in on your phone

Open the deployed URL in Safari → Share → **Add to Home Screen** → open it from
the home screen. Enter your email, then the 6-digit code.

Your local season migrates up and is verified before the device stops being the
source of truth. If verification fails, the upload is removed and the phone
stays in charge — you will see a message saying so.

## 5. Before you push

- **Export your season first** (Manage roster → Export season as JSON). Nothing
  in this build deletes local data — there is a test that fails if any code path
  tries — but you have one copy of a real season and this is a large change.
- `.env.local` currently points at the **local** stack. It is gitignored, so it
  will not be pushed, but do not copy it to Vercel.
- Confirm `git log` looks right: 20 commits, latest `Phase 1f: sign in,
  migrate, and keep writing offline`.
- Nothing has been applied to any hosted Supabase project — there is not one
  yet. Every step in §4 needs your hands, in that order.

---

# Build Tracker

Live checklist for the multi-team / multi-league / live-shared-scoring build.
Status values: `todo` · `in progress` · `blocked` · `green`.

A slice is **green** only when all of these hold:

1. `npm test` passes (every suite, not just the new one)
2. `npm run build` is clean
3. The feature works end-to-end driven in a real browser
4. No console errors
5. No regression: prior suites **and** the viewport audit re-run clean

---

## Starting point (already built, must not be rebuilt)

These are load-bearing and get **re-pointed** at the backend, never rewritten:

| Area | Files |
|---|---|
| Scoring engine | `src/game/logic.js` |
| Stats derivation | `src/game/stats.js`, `src/game/standings.js` |
| View model | `src/game/derive.js` |
| Box scores | `src/screens/GameDetail.jsx` |
| Mobile UI / responsive shell | `src/App.jsx`, `src/styles.css`, all `src/screens/**` |
| Export / import | `src/game/export.js`, `src/game/importSeason.js` |

279 assertions across 9 suites at the start of this build. That number must
only ever go up.

---

## Phase 1 — Backend and data model

| Slice | Description | Status |
|---|---|---|
| 1a | Schema migrations: leagues, teams, players, games, game_events, game_lines, memberships, invites, profiles | **green** |
| 1b | RLS policies + a policy test harness proving each role's reach | **green** |
| 1c | Repository abstraction; local adapter preserves today's behaviour exactly | **green** |
| 1d | Supabase adapter: state ⇄ rows mapping, both directions | **green** (verified against the real database) |
| 1e | "Import my existing data": export JSON → backend as my team | **green** |
| 1f | Wire the app to the repository; localStorage demoted to offline cache/queue | **green** |

Phase 1 complete: 1a–1f all green, verified against a real database and, for
the whole sign-in → migrate → offline → replay flow, in a real browser.

## Phase 2 — Accounts and roles

| Slice | Description | Status |
|---|---|---|
| 2a | Sign-in itself is **done** — email + 6-digit code, built in 1f (a link opens in Safari, not the installed app). Remaining: signed-out empty state, session expiry and refresh failure, and a sign-out control | todo |
| 2b | Roles: league admin, team manager, team scorer, viewer | todo |
| 2c | Invite flow: manager generates a link/code, invitee lands in the right team+role | todo |

## Phase 3 — Live shared scoring

| Slice | Description | Status |
|---|---|---|
| 3a | Append-only command log; live state derived by replay | todo |
| 3b | Realtime subscription; two phones on one game stay in sync | todo |
| 3c | Concurrency: chosen strategy documented and tested | todo |
| 3d | Cancel / undo / finalize correct in the shared model | todo |

## Phase 4 — Multi-team and multi-league

| Slice | Description | Status |
|---|---|---|
| 4a | League admin: create league, add teams, set schedule | todo |
| 4b | Team manager: own roster and lineup only | todo |
| 4c | League-wide standings and leaders across all tracked games | todo |
| 4d | Manual record adjustments still per team | todo |

## Phase 5 — Public / spectator views

| Slice | Description | Status |
|---|---|---|
| 5a | Routing + clean URLs per league / team / game | todo |
| 5b | Read-only standings, schedule, box scores without sign-in | todo |
| 5c | Live spectator game view | todo |

## Phase 6 — Hardening

| Slice | Description | Status |
|---|---|---|
| 6a | Full regression across all phases on iPhone viewports | todo |
| 6b | Offline behaviour | **partial**. Done in 1f: durable queue surviving reload, strictly ordered replay, transient vs permanent classification, parked writes never dropped, replay on reconnect — verified in a browser for **season** writes. Remaining: offline *mid-game* (that is the event log, phase 3), surfacing parked writes in the UI, and the recovery flow for them |
| 6c | Error boundaries, empty states, loading states everywhere data is fetched | todo |
| 6d | Export/import against the backend | **partial**. Done in 1f: importing an exported season into the backend, verified against the real database as a real user, with rollback when it fails verification. Remaining: **game history is not written back yet** — `save_season` covers team and roster only — so a game finalised after signing in stays on the device until phase 3 |

---

## Decisions

Recorded as they are made, so nothing is silently assumed.

### D1 — Local Supabase stack for verification (Phase 1)

Docker is available, so the build runs a **full local Supabase stack**
(`npx supabase start`: Postgres + Auth + Realtime + Storage). Schema, RLS and
realtime are therefore genuinely executed and tested before any hosted project
exists. Hosted credentials are needed only to deploy, not to build or verify.

This means Phase 1 can reach green without blocking on you.

### D2 — Game events are a command log, not a state snapshot

Live game state is **derived by replaying an append-only `game_events` log**
rather than stored as a mutable row. This matches the existing engine, whose
reducers are already pure `state -> state`, and gives Phase 3 concurrent
scoring and undo almost for free. A finalized game additionally materialises
`game_lines` (the box score) so history reads never replay.

### D4 — Local stack runs a trimmed service set

`analytics` (logflare), `vector`, `studio`, `storage` and `edge_runtime` are
disabled in `supabase/config.toml`. The full set failed health checks locally
and took the whole stack down with it; none of them are used by this app.
Realtime's health check is still flaky even though the service starts and
serves — local startup therefore uses `--ignore-health-check`. This is a local
development concern only and does not affect the hosted project.

Realtime was probed directly rather than trusted: a broadcast sent from one
client and received by a second round-tripped correctly, so Phase 3's transport
is viable and the failing health check is cosmetic.

Start the local stack with:

    npx supabase start --ignore-health-check

### D5 — Scorebook pids are persisted, not re-derived

The engine keys every stat line by a pid (`h0`, `a3`, `o:slug:2`). Those are
stored as real columns rather than reconstructed on read: an anonymous opponent
slot has no player row to derive from, and a rostered player may since have
been renamed or removed. Verified by round-tripping through only the real
column set — before this, roster ids and every pid came back null.

### D6 — An unreachable backend never presents an empty season

If the network fails, the adapter falls back to the local mirror rather than
returning nothing. "No data" and "cannot reach the server" look identical to
someone at a field with no signal, and the reasonable response to the former is
to start re-entering a roster that already exists. Every successful load is
mirrored locally so a cold start with no signal still works.

Season writes are debounced upserts. Play-by-play is deliberately NOT routed
this way — that goes through the append-only event log in phase 3, because a
live game produces events every few seconds from several phones at once.

### D7 — Creating a league or team makes you its administrator, atomically

Neither can be created by a plain INSERT. Both go through a `SECURITY DEFINER`
function that creates the row and the creator's membership together, so a team
without a manager or a league without an admin is unreachable. This also closes
the privilege-escalation route: there is no INSERT policy on `memberships` at
all, and the only other way to gain one is `accept_invite`.

### D3 — League visibility is a column, not an assumption

Phase 5 wants public spectator views, but making every row world-readable is a
product decision, not a default. `leagues.visibility` is `public | private`
(default `public`); RLS gates anonymous reads on it. A private league is
invisible to anonymous users while remaining fully functional for members.

---

## Phase summaries

_Added at the end of each phase._
