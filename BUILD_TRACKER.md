# Morning report — Phase 1 is green

All six slices done, plus one slice pulled forward from phase 3: **a game
finalised on the phone is now written to the account.**

Plus the backfill for games finalised before that slice, now built.

**776 assertions, 26 suites, build clean, viewport audit clean** (56
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

**Every step in this checklist is done.** Read from the hosted project's own
migration history with `npx supabase migration list --linked`, not inferred:
**14 local migrations, 14 applied remotely, 0 pending.**

| Step | State |
|---|---|
| 1. Create the project | done, CLI linked |
| 2. Push the schema | done — all 14 migrations, `_000` through `_013` |
| 3. Check the push landed | done, counts verified in the SQL Editor |
| 4. `{{ .Token }}` email template | done |
| 5. Vercel environment variables | done |
| 6. Redeploy | done |
| 7. First sign-in on the phone | done — signed in, added players, exported |

Nothing in the work since has added a migration: the backfill deliberately
reuses `save_game` rather than introducing an RPC, and the history-merge fix is
client-side. **The only remaining step is `git push`,** after which Vercel
redeploys the new client code.

Keep the rest of this section for the next time a database change ships.

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
- The hosted project is fully migrated: 14 of 14, nothing pending. No database
  step is outstanding and none of §4 steps 4-6 need redoing.
- Pushing is the last step. Vercel will redeploy the client code that calls
  `save_game` and the backfill.

## 6. Sending past games to your account

`save_game` fires on finalisation, so games already in the history when it
shipped were never offered to it. **Manage roster → Send past games to my
account** sends them. It is a button, never automatic.

- **One at a time, in order, stopping at the first failure**, naming the game
  and the reason. Nothing after it is attempted. What went before is marked
  sent, so fixing the problem and running it again resumes rather than restarts.
- **A pre-flight before anything is written.** Every candidate is checked
  locally against the same four refusals `save_game` enforces, so games that
  cannot be sent are named up front — not discovered at game seven of twelve.
  They are listed before the run and still listed after it.
- **It cannot duplicate anything.** `save_game` is idempotent on
  `(created_by, client_id)` and `import_season` writes the same key, so a game
  the one-time import already put in the account resolves to the same row.
  Verified against the real database: re-sending returned the same row id, the
  game count did not move and the box score was replaced, not duplicated.
- **It refuses to start** when writes are still queued (jumping the queue would
  break its ordering promise), when there is no connection, or when the device
  is not signed in — and says which.
- **It tells you to export first**, because this is exactly what an export
  protects against.

Deliberately not done: it does not repair the legacy records it refuses. See
§7.

## 7. Legacy records: a local data bug, not a backfill problem

Two shapes in stored history are refused by `save_game`, and both are wrong on
the phone today whether or not they are ever sent:

- **A level game recorded as a win or a loss.** The original engine used `>=`,
  so a tie scored as a win. This is wrong in the standings right now.
- **A game with no score at all.** `migrateGame` fills a missing score with
  0-0 but does not recompute `result`, leaving a stale W or L against 0-0.

**Are they distinguishable?** From a genuine 0-0 tie, yes — that carries
`result: 'T'`. From each other, **no**, and this is worth knowing: once a
season has been loaded and saved even once, `migrateGame` has already replaced
the missing score with 0-0, so "a 0-0 game stored as a win" and "a game whose
score was never recorded" are the same bytes. The distinction is not
recoverable after the fact.

`legacyResultReport()` in `src/data/backfill.js` counts all three figures
(`tieStoredAsDecision`, `zeroZeroWithDecision`, `missingScore`). The backfill
sheet already names each offending game on screen.

**Recommended, not built: an explicit repair step** that recomputes `result`
from `score` for exactly these records. It is a few lines, but it rewrites
history, so it wants to be a deliberate action with an export in hand and its
own confirmation naming every game it would change — not something a bulk send
does on the way past.

## 8. Fixed: a game that exists only on this device is never dropped

**Was:** `load()` merged the account's season over the local one and mirrored
the result back to localStorage. History came from the account, so a game the
account had not been told about yet was dropped from the running state *and
overwritten in localStorage*. The queue would still have replayed it, but the
phone stopped showing it in the meantime — indistinguishable from data loss.

**Now:** history is merged, not replaced. `mergeHistory(local, remote)` takes
every game the account has, then appends any local game whose id the account
does not know. Matching is on the game's client id — the same key `save_game` is
idempotent on — so a game the account already has is taken from the account and
never duplicated. Device-only games go last, because history reads newest-last
and a game the account has not seen is one that was just finalised. A local game
with no id at all is kept rather than dropped: it cannot collide with anything.

### What "the account is authoritative" means now

It was: *the account replaces the device.* It is now: **the account is
authoritative for every game it knows about, and silent about the ones it does
not.**

- A game **both** sides have is taken from the account, every time. The
  account's copy is the one that was verified on write; the device's may be a
  stale mirror. Editing a game on the device and never sending it does not
  survive a reload.
- A game **only the account** has appears on the device. Unchanged.
- A game **only the device** has stays, visibly, until it is sent. It is no
  longer evidence that the device is wrong — it is evidence the account has not
  been told yet.
- Team name, roster and opposing teams are unchanged: still wholly the
  account's. Only history merges.

**The trade-off, stated plainly:** deleting a game becomes harder to propagate.
Nothing deletes games in the account today (`deleteGame` is local-only), so
there is no live conflict. But if a delete-in-the-account feature is ever built,
this merge will resurrect the deleted game from any device still mirroring it,
and that feature will need a tombstone rather than an absence. Worth knowing
before phase 4 makes teams shared.

### How it is pinned

- `test/mirror-check.mjs` — through the real storage API against real Postgres:
  a queued, unsent game survives `load()` in both the running state and
  localStorage, is not duplicated by a second load, and once it finally lands
  the account's copy is the one that counts.
- `test/supabase-repo-check.mjs` — `mergeHistory` on its own, including the
  overlap case, a local game with no id, and nulls.
- `test/browser-save-game.mjs` — the whole thing in a real browser: with the
  write endpoint blocked, finalise a game, **reload**, and it is still on screen
  and still queued; unblock and it lands, exactly once, surviving one more
  reload.

Each of these was run against the old behaviour to confirm it actually fails
there: the browser check fails on exactly one assertion, the database check on
seven.

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

### 2a — what "signed in" now means

Three states, not two. The middle one is the whole point:

| State | When | What the app does |
|---|---|---|
| `ready` | signed in, account reachable | normal |
| `stale` | a session is on the device but the server did not answer | **keeps the remote repository**, shows the season, finalising still saves and still queues, banner says it cannot reach the account |
| `signed-out` | nobody signed in, or the server rejected the refresh token | season fully usable, banner offers sign-in |

`stale` deliberately keeps the *remote* repository. The local adapter's
`saveGame` is a no-op, so swapping to it would mean a game finalised at a field
never reaches the account at all.

Sign-in is a screen you can reach and leave, never a wall. Being signed out is
a fact about syncing, not a reason to withhold a season sitting on the phone.

Three things were found and fixed while building this, each in the browser:

- **Opening the app with an unreachable auth server took 26 seconds** before
  anything rendered — supabase-js retries a failed refresh with backoff. The
  launch now waits 2.5s and then shows the season anyway; a late answer still
  upgrades it. Measured again after: 2.9s.
- **Every token refresh tore the app down to a splash** and re-ran the whole
  sync reconciliation, unmounting whatever was open. Hourly, in production, and
  mid-game if the timing landed there. A refreshed token for the same person is
  no longer news.
- **Writes queued while stale were not stamped with an account**, because the
  stale path has no session object to read an id from. The last signed-in user
  id is now remembered separately for exactly this.

### Queued writes belong to an account

Every queued entry records the user it was queued for. `flush` applies only the
current user's; anything else stays exactly where it is, in order, and is
reported rather than skipped. Signing out and into a different account no longer
replays the first account's writes — which would either write to the wrong
account or park with a permissions error that looks like data loss.

Entries queued before this existed carry no owner and are treated as the current
user's, which is what they were.

| Slice | Description | Status |
|---|---|---|
| 2a | Sign-in, session persistence, expiry and refresh failure, a signed-out state that hides nothing, and a sign-out control | **green** |
| 2b | Roles: league admin, team manager, team scorer, viewer | todo |
| — | Surfacing parked writes was pulled forward into 6b and is done | **green** |
| 2c | Invite flow: manager generates a link/code, invitee lands in the right team+role | todo |

## Phase 3 — Live shared scoring

| Slice | Description | Status |
|---|---|---|
| 3a | Append-only command log; live state derived by replay | todo |
| 3b | Realtime subscription; two phones on one game stay in sync | todo |
| 3c | Concurrency: chosen strategy documented and tested | todo |
| 3d | Cancel / undo / finalize correct in the shared model | todo |
| — | **Pulled forward: a finalized game is written to the backend** | **green** |
| — | **Pulled forward: past games can be sent to the backend on demand** | **green** |

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
- **Backfill.** Built since, as a manual button — see §6.

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

### 6b, UI half — a write that cannot be sent says so

A parked write is one the server refused in a way retrying cannot fix. It is
now impossible to miss and impossible to lose:

- **A bar at the top of every screen** whenever anything is parked, in the alarm
  colour, with no dismiss. Dismissing it is precisely how someone ends up
  believing a game reached their account when it did not.
- **A screen listing each one**: whether it was a game or the team and roster,
  which game, when it happened, how many tries, and **the database's own words**
  rather than a paraphrase — the wording is what makes the problem fixable.
- **Retry per entry and for all of them.** A revived entry keeps its original
  sequence number and goes back to where it was in the queue, never to the end.
  A write made earlier still reaches the server first.
- **No discard, deliberately.** There is no dismiss, delete or clear anywhere,
  and a test walks the source to keep it that way. The only way out of this list
  is succeeding.

**Found while building it, and much bigger than the UI:** every deliberate
refusal these functions raise — no box-score lines, a result contradicting the
score, refusing to empty a roster, "not allowed to record games for this team" —
came back as Postgres `P0001` with **no HTTP status at all**, and the queue
classified all of them as a network blip. They were retried forever and never
surfaced. The entire "refuse rather than accept" design was invisible to the
queue. `P0001` is now permanent, along with Postgres classes 22, 23 and 42.

| Slice | Description | Status |
|---|---|---|
| 6a | Full regression across all phases on iPhone viewports | todo |
| 6b | Offline behaviour | **partial**. The UI half is done: a parked write is surfaced, listed with its reason, and retryable — see below. Done in 1f: durable queue surviving reload, strictly ordered replay, transient vs permanent classification, parked writes never dropped, replay on reconnect — verified in a browser for **season** writes. Extended since: a game finalised with the network cut is queued, not lost, and is delivered on reconnect — verified in a browser. Remaining: offline *mid-game* (that is the event log, phase 3) |
| 6c | Error boundaries, empty states, loading states everywhere data is fetched | todo |
| 6d | Export/import against the backend | **partial**. Done in 1f: importing an exported season into the backend, verified against the real database as a real user, with rollback when it fails verification. Done in the pulled-forward phase 3 slice: a game finalised while signed in is written to the account and verified on read-back, and a manual backfill sends games finalised before it. Remaining: repairing legacy records that cannot be sent (§7) |

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

### D9 — A bulk send is a foreground action, not a queued one

Finalising a game enqueues it and forgets about it; that is right for a phone
at a field. The backfill deliberately does the opposite — it writes directly,
one game at a time, awaiting each — because its entire purpose is to be able to
say how far it got and what stopped it. A fire-and-forget bulk send that quietly
parks four of twelve writes answers none of that.

Two consequences, both accepted on purpose:

- It **refuses to start with no connection** rather than queueing a dozen games
  for later. Someone who taps a button expecting a summary should not get a
  silent background job instead.
- It **refuses to start while the queue has anything in it**, because writing
  directly would jump ahead of writes already waiting, breaking the strict
  ordering the queue promises.

It also never repairs anything on the way past. A game it cannot send is named
and left exactly as it is; rewriting history is a separate, deliberate step.

### D10 — The account is authoritative for what it knows, not for what it lacks

Loading the account used to replace the device's history outright. That is the
right rule for the team name and the roster, and the wrong one for games: the
account not having a game usually means it has not been told yet, not that the
game did not happen.

History is therefore merged on the game's client id. A game both sides have
comes from the account; a game only the device has stays until it is sent. The
practical effect is that a game finalised while the write is still queued
remains on screen across a reload instead of vanishing and reappearing when the
queue drains.

The cost is that an absence in the account can no longer express a deletion. No
feature deletes games in the account today, so nothing conflicts; when one
exists it will need an explicit tombstone.

### D11 — "Cannot refresh right now" is not "signed out"

A failed token refresh has two completely different causes and they had one
outcome. Offline, the stored session survives untouched; revoked, the server
wipes it. Both were confirmed against a real auth server, and the difference is
now what the app keys off — with an unrecognised error leaning towards keeping
the person in, because the cost of guessing wrong that way is a stale banner and
the cost of guessing wrong the other way is a season you cannot reach.

Sign-out never deletes local data. It keeps the season and the write queue, and
clears only the synced-games marker, which is a claim about an account we no
longer know the identity of.

Unsent writes warn rather than block. Refusing to sign out would trap someone
with no signal into staying signed in, which is worse than a warning they can
read and act on.

### D12 — A parked write can only leave by succeeding

There is no discard. Not hidden, not behind a confirmation — absent, with a test
that walks the source to keep it absent.

The reasoning: a parked write means the device believes something happened that
the account does not know about. Removing it from the list does not resolve that
disagreement, it just stops anyone being told about it, which is the failure the
queue exists to prevent wearing a tidier face. Retrying is the only action, and
the list empties on its own when a write goes through.

Retrying preserves order. A revived entry keeps its original sequence number, so
it returns to its place in the queue rather than jumping to the end — the strict
ordering promise holds across a failure and a retry, not just in the happy path.

### D3 — League visibility is a column, not an assumption

Phase 5 wants public spectator views, but making every row world-readable is a
product decision, not a default. `leagues.visibility` is `public | private`
(default `public`); RLS gates anonymous reads on it. A private league is
invisible to anonymous users while remaining fully functional for members.

---

## Phase summaries

_Added at the end of each phase._
