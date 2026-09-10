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
| 1f | Wire the app to the repository; localStorage demoted to offline cache/queue | todo |

## Phase 2 — Accounts and roles

| Slice | Description | Status |
|---|---|---|
| 2a | Email magic-link sign in, session handling, signed-out state | todo |
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
| 6b | Offline: scorer loses signal mid-game, queue and recover | todo |
| 6c | Error boundaries, empty states, loading states everywhere data is fetched | todo |
| 6d | Export/import against the backend | todo |

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
