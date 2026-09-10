# Morning report — Phase 1 is green

All six slices done, plus one slice pulled forward from phase 3: **a game
finalised on the phone is now written to the account.**

**636 assertions, 22 suites, build clean, viewport audit clean** (56
screen×viewport combinations, no overflow, no tap target under 44px).
Nothing is blocked. Do not push before reading §5.

## 1. Built, and how far it was verified

**Verified in a real browser, end to end** — signed in with a code actually
emailed and typed in, migrated the season up, verified it, disabled the network,
renamed the team offline, restored the network, and watched the write replay to
the account. Queue drained, nothing parked, edit survived a reload, still signed
in, no console errors.

**Also verified in a real browser, end to end** (`test/browser-save-game.mjs`,
run three times over to prove it is not timing luck): tapped "Game completed"
and "Finalize" in the actual UI, then looked in Postgres — the game is there,
final, with our score on the right side, the result not inverted, the whole box
score attached and every line of ours linked to a real player rather than just a
name. Then local storage was wiped and the game still came back from the
account. Then the network was cut, a second game was finalised offline, and it
was queued rather than lost; restoring the network delivered it, and it verified
on read-back too.

**Verified against the real database (not the browser)**: schema, all 26 RLS
policies, the import, `discard_import`, `save_season`'s empty-roster guard,
`save_game`'s four refusals, and the adversarial attack suite.

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

Nothing from the pulled-forward `save_game` slice either — see "What was
pulled forward" below for what it deliberately does *not* do.

**One thing to know before you score a real game.** Games you finalise from now
on are written to the account. Games already in your history are **not** —
`save_game` fires on finalisation, and there is no backfill for games that were
finalised before this. They are not lost: they stay on the phone, they stay in
the standings, and they stay exportable. See §6 for the recommendation on that.

Two further limits, both scoped to later phases and neither blocking:
- The backend does not yet store the batting order or the bench — those stay on
  the device. Fine for one scorer; phase 4 needs them shared.
- A game in progress is still device-only. Only the *finished* game is written,
  as a unit. Lose the phone mid-game and the game is gone; that is phase 3a.
- An import makes you manager of the opposing teams it creates. Correct for a
  solo season; phase 4 will need league-owned teams to supersede them.

## 4. Deploy checklist, in order

**Where this actually stands now** (steps 1-3 are done; 2 needs running again):

- The Supabase project exists and the CLI is linked to it.
- Migrations `_000` through `_011` are on it — you pushed them and the counts
  checked out.
- **Migrations `_012` and `_013` exist only locally.** `_012` is the fix that
  stops `save_season` wiping a roster; `_013` is `save_game`. Until you push
  them, finalising a game does nothing on the hosted project and the roster
  guard is not in place. Run step 2 again.
- Steps 4-7 have not been done at all.

`.env.local` points at localhost and must stay that way.

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

There are now **14 migrations**; `db push` applies only the ones the remote has
not seen, which on your project means `_012` and `_013`. In total they build the
tables, all 26 row-level security policies, and these functions —

`handle_new_user`, `create_team_with_manager`, `create_league_with_admin`,
`claim_primary_team`, `set_primary_team`, `league_is_readable`,
`fill_game_team_snapshots`, `import_season`, `import_season_and_claim`,
`discard_import`, `save_season`, `save_game` — plus the eight RLS helpers
`is_team_member`, `is_league_admin`, `is_league_member`, `can_manage_team`,
`can_score_game`, `can_score_teams`, `game_is_readable` and `accept_invite`,
which is 20 security-definer functions in all.

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

Expect **9 tables, 26 policies, 20 security-definer functions** (21 public
functions in total — the extra one, `set_updated_at`, is a plain trigger
function). If any number is short, stop — the app will half-work in confusing
ways rather than fail cleanly.

Those three numbers are what the local database actually reports after all 14
migrations, read out of `pg_tables` / `pg_policies` / `pg_proc` rather than
counted from the migration files. **19 was the right answer before `save_game`;
20 is the right answer after it.** If you see 19, `_013` did not apply.

One more worth checking, because the same mistake has bitten twice:

```sql
select proname, pg_get_function_arguments(oid) from pg_proc
  where proname in ('save_season','save_game');
```

Exactly two rows. Two rows for the same name means an old overload survived and
calls may be resolving to the wrong one — which is how `_012` silently failed
the first time.

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
- Confirm `git log` looks right: 28 commits, latest `Write a finalized game to
  the backend`.
- The hosted project has migrations `_000`-`_011`. **`_012` and `_013` are not
  on it.** Push the code, then run §4 step 2 — in that order does not matter
  here, but a game finalised before `_013` lands will sit in the queue rather
  than reach the account. It will not be lost; it replays.

## 6. Recommended next, not built: a backfill for older games

`save_game` fires when a game is finalised. Games already in your history when
it shipped were never offered to it, so they stay on the device. That is not a
bug and nothing is lost — they are in the standings, in the box scores, and in
an export — but the account does not have them.

**Recommendation: a one-tap "Send past games to my account" in Manage roster,
next to Export.** It would walk the local history, skip anything already in
`score-tracker:syncedGames`, and enqueue the rest through exactly the path a
freshly finalised game takes. No new database function: `save_game` is already
idempotent by `(created_by, client_id)`, so running it twice is harmless, and it
already refuses anything that does not look like a finished game.

Deliberately **not** built now, for two reasons:

- It writes many games at once against a guard whose refusals have been
  exercised on one game at a time. A batch that half-succeeds needs its own
  answer, and inventing one at the end of a slice is how the roster got wiped.
- You have one real season and it has already been through a data-loss scare.
  A bulk write into the account is exactly the operation to do deliberately,
  with an export in hand, not as an afterthought.

If you want it, it is small — an afternoon, most of it tests for the partial
failure case.

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
| — | **Pulled forward: a finalized game is written to the backend** | **green** |

### What was pulled forward, and what it is not

The phase 3 design is an append-only event log with live state derived by
replay. That is still the design. What was pulled forward is only the *end* of
it: when a game is marked final, the finished game and its box score are written
to the account as a unit, so the phone stops being the only copy.

This was worth doing out of order because the gap it closes is data loss on a
lost or reinstalled phone, and it needs none of the machinery below.

**Deferred, explicitly** — none of this is in the slice:

- **The event log (3a).** Nothing is written while a game is in progress. The
  write happens once, on finalisation.
- **Live shared scoring (3b).** No realtime subscription; a second phone sees
  nothing until the game is final and it reloads.
- **Concurrency (3c).** One scorer per game is assumed. Two phones scoring the
  same game would each write their own version; the second wins, because the
  upsert is keyed on `(created_by, client_id)` and their client ids differ.
- **Undo and cancel in the shared model (3d).** Undo and cancel work on the
  device exactly as before, but a game already written to the account is not
  reopened, retracted or deleted by them.
- **Backfill.** Games finalised before this exist only on the device.

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
| 6b | Offline behaviour | **partial**. Done in 1f: durable queue surviving reload, strictly ordered replay, transient vs permanent classification, parked writes never dropped, replay on reconnect — verified in a browser for **season** writes. Extended since: a game finalised with the network cut is queued, not lost, and is delivered on reconnect — verified in a browser. Remaining: offline *mid-game* (that is the event log, phase 3), surfacing parked writes in the UI, and the recovery flow for them |
| 6c | Error boundaries, empty states, loading states everywhere data is fetched | todo |
| 6d | Export/import against the backend | **partial**. Done in 1f: importing an exported season into the backend, verified against the real database as a real user, with rollback when it fails verification. Done in the pulled-forward phase 3 slice: a game finalised while signed in is written to the account and verified on read-back. Remaining: **no backfill** for games finalised before that slice — they stay on the device |

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

### D8 — A finalized game is written whole, and refused rather than half-saved

Three choices in `save_game`, each from something that has already gone wrong
here:

- **Idempotent by `(created_by, client_id)`.** The write goes through the
  offline queue and will be retried after a timeout that actually succeeded. A
  duplicated game silently corrupts the standings, which is worse than a failed
  write. The unique index backing this is deliberately *not* partial: a partial
  index cannot back `ON CONFLICT`, which is how the roster upsert failed
  silently for a whole day.
- **It refuses rather than accepts.** A game with no id, no box-score lines, no
  score, or a result contradicting its score is rejected by name. `save_season`
  quietly accepted an empty roster and deleted ten players; a guard that names
  what it is refusing is the lesson from that. A 0-0 tie is legitimate and is
  accepted.
- **Written, then read back and compared.** After the write, the season is
  fetched and the game compared on the figures the app would *show* — result and
  score from our point of view, and every player's line. Not a row count: a row
  count cannot see an away result arriving inverted, which has happened. If the
  comparison fails the game is not marked synced, the device copy stays
  authoritative, and the write is parked where it can be seen.

The game is written **without a coalesce key**, unlike a season snapshot. A
season snapshot supersedes the previous one; a game is an append and must never
be coalesced away by a save that happens to follow it.

### D3 — League visibility is a column, not an assumption

Phase 5 wants public spectator views, but making every row world-readable is a
product decision, not a default. `leagues.visibility` is `public | private`
(default `public`); RLS gates anonymous reads on it. A private league is
invisible to anonymous users while remaining fully functional for members.

---

## Phase summaries

_Added at the end of each phase._
