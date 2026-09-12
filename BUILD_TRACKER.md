# Report — phase 4, multi-team and multi-league (4a, 4b, 4c, 4d)

All four slices built and green, plus **4e** — the wire between a fixture and a
scored game — added before merging. On branch **`phase-4`**, nothing pushed and
the hosted project untouched. **1237 assertions across 37 suites** (up from 1044
across 33), build clean, viewport audit clean, and all seven browser harnesses
re-run and passing.

**Follow-up before merging: a game in progress has a place on the league
screen.** 4e made a fixture go `live` when somebody starts scoring it, and the
league screen only had lists for `scheduled` and `final` — so the game vanished
from the league for as long as it was being played. It now sits under **In
progress**, between Schedule and Played, saying which team is scoring it. §3 has
the detail; §4 has what is still open about it. That pass re-ran
`browser-leagues`, `browser-team-switch` and `browser-two-phones` and the full
viewport audit; the other four harnesses were not re-run for it, and nothing
they drive was changed.

**Read §5 and §6 before you deploy.** Four new migrations. Three of them replace
functions the live app calls, and the order is **migrations first this time** —
§6 says why, and why that direction is safe in a way the other one is not.

**The headline: a league is now a real thing in the app.** Start one, hand out a
code, bring teams in, put fixtures on a calendar, and read one table across all
of it. A phone can be on several teams and choose which it is looking at.

**And the gap that was under it is closed.** A fixture is scored from the league
screen — "Score this game" — which starts the game under the fixture's own id
and names the opposition by its real team id. The finished game IS the fixture:
in the table, in both teams' seasons, and on one row rather than two. The season
screen's slug-based picker is untouched, because that is the right model for a
friendly against a team with no account.

---

## 1. What was built, and how far it was verified

### Verified in real browsers, end to end

**`test/browser-leagues.mjs`** — two browser contexts, two accounts, one league.
A commissioner opens the leagues screen, starts a league, brings their own team
in, picks a role and mints a code. A manager on the other phone types that code,
ticks "bring my team", and lands in the same league as a follower — seeing both
teams and none of the commissioner's controls. The commissioner schedules a
fixture between the two teams and the follower sees it. A played game is then
recorded and **the table is read column by column off the screen**: the winner
top with the win added to its prior record, the loser below it, ranked 1 and 2,
percentages right — and the leaders filled in from the box score, switchable
between runs, RBI, hits and home runs. Finally the follower leaves, which takes
their team out and keeps their membership.

The same harness then **scores that fixture through the app**: tap "Score this
game", three strikeouts to get through the opposition's half, two home runs of
our own, Game completed, Finalize. Checked afterwards: the fixture is `live`
while it is being scored and `final` when it is called; it is one row, not a
fixture and a game beside it; **no team was invented from a slug**; the score is
2-0 the right way round; the box score is filed to the two real teams on the
right sides; the game is in phone A's season as a win and — after a reload — in
phone B's as a loss, which is the same game from the other dugout. Then the
table, read column by column off the screen: the winner top with the win added
to its own prior record, the loser below, and the leaders filled in from the box
score that was just written.

**Mid-game, from the other team's phone:** while A is scoring, B reopens the
league and finds the fixture under **In progress · 1** and not on the schedule
or among the results, on the same fixture card, reading "Scored by" A's team,
with no "Score this game" button on it. The start event in the account is
checked to name A's team and A's user. Once it is finalised, the game has left
In progress for Played.

**And the league screen goes through the viewport audit** — the same
measurement `viewports.mjs` uses, imported from one shared module, at all four
iPhone sizes — twice: mid-game with In progress showing, and after the result
with the table and leaders. It cannot be reached by `viewports.mjs` itself,
which restores state from storage and has no account. Before trusting a clean
result, the harness plants an element too wide for the screen inside it and
requires the audit to catch it.

**`test/browser-team-switch.mjs`** — one account managing two teams, and a
second account that only scores for one of them. The switcher lists both, marks
the one being shown, and switching repoints the app: the other team's roster and
the other team's batting order, the device and the account both recording which
team it is on. Then the part that matters — the first team's roster must not
have been written into the second team's row on the way past — checked in the
database after waiting out the season-write debounce. Then back again, with the
first team's roster and opposing teams intact. Then the scorer's phone: the
roster screen opens, says whose roster it is, and offers no Add player, no
Rename and no record adjustment, while the manager still has all three.

Both harnesses require **both consoles to be silent**, warnings included.

Also re-run and passing unchanged, in one sequential pass:
`browser-save-game`, `browser-backfill`, `browser-parked`, `browser-invites`,
`browser-two-phones`.

### Verified against the real database, not the browser

**`leagues-check.mjs`** (72 assertions) — creating a league makes you its admin
atomically; a manager **cannot** attach their team to a league they were never
invited to, nor create one already inside it; only a league admin mints a league
code and it cannot grant a team role; the holder of a code can see what it is
for without being able to read the invites table at all; redeeming it brings the
team in and grants the membership together; a spent code, a made-up code and a
*team* code handed to `join_league` are each refused by name, and a refusal
burns nothing and grants nothing; a manager already in the league can bring a
second team in; leaving and rejoining works. Then fixtures: only a commissioner
schedules, rescheduling the same fixture moves it rather than adding one, a team
cannot play itself, a team outside the league cannot be scheduled, and a game
that has been played cannot be rescheduled. Then visibility: a public league is
readable by anyone including anonymously, a private one only by its members.
Then the manual record: a manager sets their own team's, another manager's
update changes nothing, leaving a league does not touch it, and the table starts
that team from its own record while nobody else's moves.

**`lineup-share-check.mjs`** — the batting order saved by a manager is read back
by a scorer on another account, exactly; reordering moves it; **a payload that
says nothing about the order leaves the recorded order alone**, while an
explicitly empty one is obeyed; a scorer cannot rewrite it; a player dropped
from the roster leaves the order with them.

### Verified in tests only

- **`league-tables-check.mjs`** — the table and the leaders, from row shapes,
  with no database. Includes the one that matters: the same three games told
  once as the league sees them and once as a team's own season does, required to
  give the same W-L-T, games played and percentage. If those two ever drift, one
  of the two tables on a person's phone is lying about the same team.
- **`league-buckets-check.mjs`** (24 assertions) — every league game is in
  exactly one of Schedule, In progress and Played, a cancelled game is in none,
  one fixture walks scheduled → in progress → played, and the scorer line: "you"
  only to the person whose start it was, otherwise the team, and never a guess
  when the start does not say.
- The **"leagues need an account"** state of the league screen is measured by
  `viewports.mjs`. Its signed-in states — a league with a game in progress, and
  one with a table and leaders — are measured by `browser-leagues.mjs` with the
  same yardstick (see above). A league with fixtures still on the schedule is
  not measured at a phone size.
- The **team switcher's "changes have not reached your account yet" warning**
  renders from code inspection only. The switch itself is driven in a browser;
  that particular banner needs an account with a stuck queue, which no harness
  currently sets up.

### Not verified anywhere

- **A league with more than two teams.** Nothing in the table or the leaders
  cares, and nothing has run it.
- **A fixture scored from the AWAY side, in a browser.** The away case is
  checked against the database on its own (the score and the result have to
  invert), but the browser harness scores from the home dugout.
- **A private league in the app.** The database half is checked; there is no UI
  for the toggle, so nobody has seen it on a screen.
- Anything on a real iPhone. That still needs a deploy.
- A league whose teams are on **different sports**. The column exists on both;
  nothing reconciles them.

---

## 2. Judgement calls

**A team enters a league by code, and leaves freely.** D14 states it in full.
The alternative — a commissioner adding any team they can see — would let
someone capture a team they do not manage. Leaving is deliberately
unrestricted: a league that can hold a team hostage is worse than one that loses
one, and the membership survives so they can come back without a new code.

**League invites are a NEW function, not a parameter on `create_invite`.**
Adding even a defaulted argument creates a second overload rather than replacing
the function, which is how `_012` left an unguarded `save_season` live for a
day. `create_invite` is not touched at all.

**`peek_invite` is dropped and recreated at the same signature.** Its return
type changes, which `create or replace` cannot do. Dropping and recreating at
the identical signature is a replacement, not an overload —
`select proname from pg_proc where proname = 'peek_invite'` still returns one
row — and §5 says how to check that after deploying.

**`join_league` tolerates someone who is already a member, and does not burn the
code.** Managing two teams in one league would otherwise dead-end on
`accept_invite` refusing a duplicate membership. The code stays unspent because
it granted nothing, and this confers no reach: a league member can already move
a team they manage into that league with a plain update.

**The league guard exempts `service_role`.** The seed and migration paths have
no `auth.uid()` and already bypass row-level security. A trigger stricter than
RLS would break fixtures that were never the threat.

**League state lives outside `useGame`.** `useGame` owns the season — one team,
its roster, its history, the game in progress. One account can be in several
leagues, and folding the two together would let the season and the league
disagree about which team you are, which is the confusion this phase exists to
remove. Nothing is fetched until the leagues screen is opened: a league is not
needed to score a game, and a phone at a field should not wait on one.

**Commissioner controls are behind the role the database reports**, never one
the client assumes — the same rule the team invite button already followed.

**Roster controls are hidden only when we KNOW the team is somebody else's.** A
null role is every state that has always been able to edit (local-only, signed
out, a session we cannot reach), and those keep working exactly as they do. The
conservative direction costs one case: a **league admin** may manage a team in
their league (`can_manage_team` says so) but holds no team membership, so the
role read is null... and a null role *allows*, so they keep their controls. The
case that loses is a league admin who holds an explicit non-manager membership
on the team; they are shown nothing, and the database would have let them.
Hiding a control that would have worked is the harmless way round.

**A game belongs to a league only when both teams do — and that makes it
public.** D15. Filing a friendly under a league would put a result in a table
against a team the table does not contain. And a league is public by default, so
filing a game under one makes it and its box score readable by anyone. That is
what a league is; a league whose games should not be public is set to private,
which RLS already enforces and which has no UI yet.

**The batting order is shared, and silence about it is not an instruction.**
D16. The guard matters more than the feature: an older phone sends no `lineup`
key, and reading that as "the order is empty" would wipe a real order every time
it saved.

**The league table and the season table share their rules deliberately.** A tie
is half a win; a manual prior record is added to what was tracked. They are
different modules on different inputs, and a test tells the same games both ways
and requires the same answer.

**League leaders key on the player row where there is one, and on team plus name
where there is not.** An opponent scored without a roster has no player rows at
all. Keying on name alone would merge two people who share one — the exact
mistake the scorebook's pids exist to prevent.

---

## 3. Found on the way, and fixed

**A team could walk into any league it could see.** `teams_update_manager_or_admin`
admits a team's own manager for every column, `league_id` included, and nothing
checked which league. Anyone managing a team could attach it to any public
league and appear in that league's standings uninvited. Not a crash — a table
that is quietly wrong. Closed by a pair of triggers (D14) and checked from both
the update and the insert side.

**One team's roster was written into another team's row on switching.** Two
separate causes, both found by `browser-team-switch.mjs` against a real
database, and the harness was written to look for exactly this:

- Every repository read the team id from one shared mutable ref. A season write
  is debounced, so the previous team's repository still had a save in flight
  when the ref moved, and it then resolved against the NEW team. Each repository
  is now bound to the team it was built for.
- The local mirror is stamped with the team it holds so it is never handed to
  another team as a seed — but `save()` wrote the app state to the mirror
  unstamped, stripping that stamp on every save. It is stamped on the way in
  now too.

**Nothing the app wrote ever set `games.league_id`.** The league table would
have been permanently empty however many games were played in it. `save_game`
and `start_live_game` now file a game under the league both teams share.

**A blank season was being sent to the account.** That is what the app holds for
the moment between switching to a team it has never cached and that team
arriving. `save_season` refuses it, so nothing was ever lost — but the refusal
parks a write that says something alarming and means nothing. The adapter no
longer sends one.

**The scorebook pager arrows were 36×42 on an iPhone SE** — the only controls in
the app the viewport audit has ever flagged, and they page the scorebook
mid-game on a phone held in one hand. **Pre-existing and present on `main`:** the
same audit run from `main` reports the same two. Worth saying plainly, because
it means the phase 3 report's "viewport audit clean" line rested on a single run
rather than a repeated one. Fixed, and the leagues screen was added to the
audit's list so it is measured on every run from here.

**A league was listed once per person in it.** `memberships_select_own` admits
every membership on a league you administer — which is right, an admin needs to
see who is in their league — but the leagues list read it unfiltered, so it
returned one row per MEMBER rather than one per league. A commissioner saw their
league twice, with somebody else's role beside it. The same shape of bug was in
the team switcher's read. Both are scoped to the signed-in user now, and a read
that cannot establish who it is for returns nothing rather than somebody else's
rows. **Found by a duplicate-key React warning**, which is only a failure because
the browser harnesses require a completely silent console — the check earns its
keep here for the second time.

**The user id was captured on the first render**, before there was a session, so
the fix above answered null forever. The leagues api is built once and now reads
its identity through a ref rather than a closure.

**A browser harness started too soon after `supabase db reset` HUNG**, silently,
with no output at all — supabase-js retries a failed request with a long backoff
while the auth container is still restarting. Silence is the worst of the three
outcomes. All three context-creating harnesses now wait for `/auth/v1/health`
and refuse loudly if it never comes up.

**Seeding a browser harness raced the app's own first save.** Writing
localStorage into an already-running app competes with the blank starting season
it writes on boot, and whichever lands last wins — which is why the league
harness failed intermittently showing first-run setup. Both new harnesses now
inject on the new document, before any of the app's scripts run, and remove the
injection afterwards so later reloads are the app's own.

**A league game disappeared from the league for as long as it was being
played.** A regression from 4e, caught before merging. `_022`'s
`start_live_game` flips a fixture from `scheduled` to `live` when somebody
starts scoring it — correctly — but the league screen's two lists filtered on
`scheduled` and `final`, so a live fixture was on neither. Nobody following the
league could see a game was on, and it came back only when it was finalised.
The screen now sorts games through one function with a home for each status
(`bucketLeagueGames`), cancelled in none, and live games get their own **In
progress** section on the same fixture card.

Two decisions inside that, both deliberate:

- **"Who is scoring it" names a team, not a person.** `profiles` is readable
  only by its owner, and showing a scorer's name to every follower of a public
  league is a policy change that wants a migration and an attack test, not a
  label. The fixture's start event now carries the scoring team's id, read back
  from the log (which is readable wherever the game is). The person scoring is
  told it is them; everyone else sees "Scored by" the team; a game started before
  this change says only "Being scored". No migration; `save_game` untouched.
- **An in-progress card has no "Score this game" button.** That button starts
  the fixture, which appends a `start` event, and a second start on a log that
  already has plays in it folds back to the starting state — it would reset the
  game on every phone watching. A phone on one of the teams is already offered
  to join it, which is the safe way in.

**The viewport audit could not see inside a scrolling screen.** Its check for
elements running off the edge skips anything inside a sideways scroller, so that
a strip meant to scroll is not flagged. But CSS computes `overflow-x` to `auto`
on anything that sets `overflow-y`, so every screen that scrolls vertically
counted as a sideways scroller and **nothing inside it was checked**; a card too
wide for the phone would be clipped by the screen rather than widening the page,
and the page-width check would not see that either. A second measurement now asks
each clipping container whether it holds more than it shows, ignoring strips that
declare their own sideways scroll and text that ends in an ellipsis on purpose.
Run over all 60 screen×viewport combinations it finds nothing, so no earlier
"clean" was hiding a real overflow — but until now that was not known.

**The league leaders' stat chips were 30px wide.** "R" and "H" are one letter,
and the chips had a minimum height and no minimum width. From 4c; no audit had
ever reached a league with leaders on it. Found the first time one did, and
given a 44px minimum width.

**`roles-check.mjs`'s fixture created a team directly inside a league its
manager had never joined** — precisely what the new guard stops. The fixture now
creates the team outside and places it with the service key, as it already did
on the next line.

---

## 4. Unfinished, and what to watch

**What is left of it.** 4e connects a league FIXTURE to the scoring flow, which
is the path that matters: a commissioner schedules, somebody taps "Score this
game", and the result is a league result. What is still not connected is the
other direction — starting a game from the season screen and having it *become*
a league game. That picker is slug-based and stays that way, because a friendly
against a team with no account is a real and common case. The consequence to
know: **a league game scored from the season screen instead of from the fixture
is a friendly.** It goes into your own season and not into the table.

The narrower thing I would add next is a fixture on the SEASON screen's "next
game" card, so the league fixture is the obvious thing to tap rather than
something to go and find.

Also outstanding:

- **A fixture that goes live and is then abandoned is stuck.** A fixture flipped
  to `live` by `_022` fell out of both Schedule and Played on the league screen,
  cannot be rescheduled (`schedule_game` refuses a game that is already live),
  and resurfaced only as a join offer on a phone on one of its two teams. **The
  first half is fixed** (§3): it is listed under In progress now. **The rest is
  not.** A live fixture nobody finishes still cannot be moved, and stays In
  progress — and offered to join — indefinitely, which is phase 3's stale live
  row (phase 3 §4) with a league attached. It needs a way to abandon a stale
  live game and a decision about whether an abandoned fixture returns to the
  schedule; both are next session's, and `schedule_game` was deliberately not
  touched here.
- **No way to see or revoke a league's outstanding codes.** Same gap the team
  invites have had since 2c. A code is shown once and never again.
- **No UI for making a league private.** The column, the policies and the
  behaviour are all there and tested; nothing on a screen sets it. Given §2's
  note about public games, this is the second thing I would add.
- **A commissioner cannot remove somebody else's team from their league.** Only
  the team's own manager can leave. Deliberate for now — the alternative needs a
  conversation about who owns a place in a table — but a league will eventually
  need it.
- **A league admin's controls on a member team** are hidden when they hold an
  explicit non-manager membership on it. See §2.
- **Leaders show five players and four stats**, with no way to see more.
- **The league screen re-reads on open; there is no realtime on it.** A fixture
  added by the commissioner appears on the other phone when it next opens the
  league, not immediately. Correct for a calendar; wrong later for 5c.
- **Nothing reconciles sports across a league.** A league has a sport and so does
  a team; nothing checks they agree.
- **Opposing teams in the SEASON view still carry no `priorT`** — pre-existing,
  noted in `seasonMapping`, and untouched here. The LEAGUE table reads each
  team's own `prior_t` from its row and is unaffected.
- **Harness hygiene:** the three harnesses that open private browser contexts
  dispose them on a normal finish but not when they exit early through
  `need()`. Enough orphaned contexts will start killing CDP sessions mid-test
  for reasons that have nothing to do with the app. The browser was cleaned up
  at the end of this session and CLAUDE.md says how to spot it; making `need()`
  itself tidy up is a small job nobody has done.

---

## 5. New migrations — LOCAL ONLY, all three pending

None has been applied to any hosted project by this session; the hosted project
was not contacted at all. `npx supabase migration list --linked` is the only
authority on what is actually pending there — as far as this repo knows, `_014`
through `_021` have never been pushed.

| Migration | What it does | Risk |
|---|---|---|
| `20260101000019_leagues` | Adds `create_league_invite`, `join_league`, `schedule_game`, two guard triggers on `teams`; **replaces `peek_invite`** | **Touches a live function.** `peek_invite` is dropped and recreated at the same signature with extra columns; existing callers read `team_name`, which is still there. The triggers are new refusals — see below |
| `20260101000020_shared_lineup` | Adds `players.lineup_order` and `players.on_bench`; **replaces `save_season`** | **Touches a live function.** Same signature, same guards, two more columns on the way through. A payload with no `lineup` key leaves the order alone, so an old client is unaffected |
| `20260101000021_games_know_their_league` | Adds `shared_league`; **replaces `save_game` and `start_live_game`** | **Touches two live functions.** Both keep their exact signatures. The only change is `league_id` being set when both teams share a league |
| `20260101000022_score_a_fixture` | Adds `can_name_opponent`; **replaces `save_game` and `start_live_game` again** | **Touches two live functions.** Both keep their exact signatures. A payload with no `opponentTeamId` — which is every payload an older client sends — takes the identical path it took before |

**The one behaviour change to know about before pushing `_019`:** the triggers
refuse to put a team into a league nobody invited you to. If anything in the
hosted project currently sets `teams.league_id` by a plain update from a
signed-in user who is not a league member, it will start failing by name. In
this repo nothing did — that path did not exist — but it is the one thing that
could surprise.

After pushing, the check that matters is the overload one, since two of these
replace functions:

```sql
select proname, pg_get_function_arguments(oid) from pg_proc
  where proname in ('save_season','save_game','peek_invite','start_live_game');
```

**Exactly one row each.** Two rows for one name means an old overload survived
and calls may be resolving to the wrong one, which is how `_012` silently failed
the first time.

---

## 6. Deploy order

**Migrations first.** The opposite of phase 3's reasoning but the same
principle: deploy whichever side fails safely if the other is missing.

- **Migrations without the new code: nothing breaks.** `peek_invite` returns
  extra columns the old client ignores. `save_season` leaves the order alone
  when the payload does not mention it, which an old client never does.
  `save_game` and `start_live_game` set a column nothing yet reads, and their
  new opponent branch is only reached by a payload carrying `opponentTeamId`,
  which no older client sends.
- **Code without the migrations: the league screen fails on every action.**
  Start a league, mint a code, join, schedule — each is a direct RPC call, not a
  queued write, so it errors on screen with "function not found" and nothing is
  retried or recovered.

So:

1. **Export the season from the phone first.** As always.
2. **`npx supabase db push`** — applies everything the remote has not seen, in
   order. Do not cherry-pick: `_021` and `_022` each replace `save_game` and
   `start_live_game`, so the last one applied is the one that survives, and
   they must go in order.
3. **Run the overload check in §5.** Four names, one row each.
4. **Then push the code** (`git push` — this session pushed nothing, and the
   work is on `phase-4`, not `main`).
5. **First thing to try after deploying:** open Leagues, start one, and bring
   your own team in. If "Bring my team into this league" fails, `_019` did not
   apply.

**If you would rather not deploy this yet: don't.** Nothing in phase 4 is needed
to score a game, and every existing path is unchanged — the roster, the season,
the live game and the finalise all behave exactly as they did, which is what the
five pre-existing browser harnesses re-running unchanged is evidence for.

---
# Report — phase 3, live shared scoring (3a, 3b, 3c, 3d)

All four slices built and green. **1044 assertions across 33 suites, build
clean, viewport audit clean, every browser harness re-run and passing.** Nothing
was pushed. The hosted project was not touched.

**Read §5 before you deploy anything.** Three new migrations, and one of them
changes `save_game` — a function the live app calls on every finalised game.

**The headline: a game in progress is no longer only on one phone.** Every play
is written as it happens. Two phones can score the same game and both see the
combined result. A phone that loses signal keeps scoring and catches up.

---

## 1. What mid-game exposure is now, versus before

This is the thing phase 3 was for, so it goes first.

**Before.** Nothing about a game in progress left the phone. The whole game —
every play, the score, every stat line — existed in one browser's localStorage
until somebody tapped *Game completed*. Lose the phone in the 5th, drop it in a
puddle, have the browser evict site data, and the game had never happened. There
was no partial recovery, because there was nothing partial: the first and only
write was at the final whistle.

**Now.** A play is written as it is entered. The exposure is **whatever has not
yet left the write queue** — which is:

| Situation | What is at risk if the phone is lost right now |
|---|---|
| Signed in, signal fine | The play being sent this second. In practice one play, usually less than a second old. |
| Signed in, no signal | Every play since the signal went. Still **durable on the device** — the queue is in localStorage and survives a reload, a crash and a battery death. Lost only if the phone itself is lost or its site data is cleared. |
| Signed in, second phone also scoring | Nothing, effectively. Anything the other phone has seen is already in the account. |
| Not signed in at all | The whole game, exactly as before. Nothing is sent because there is nowhere to send it. The moment you sign in mid-game, the game so far goes up as one `resume` event and the exposure drops to the first row. |

What has **not** changed: the finished game is still written whole at
finalisation, still verified on read-back, still queued and retried if it cannot
go. None of that was touched.

One more thing worth knowing: a game abandoned by walking away — phone flat, app
closed, never finalised — now leaves a `live` row and its log in the account.
That is a recovery, not a leak: the plays are there. But see §4, those rows stay
live indefinitely.

---

## 2. What was built, and how far it was verified

### Verified in two real browsers, end to end

`test/browser-two-phones.mjs` — 81 assertions. Two separate browser contexts,
two separate accounts, two separate stores of localStorage, one game. Run by
hand like the other browser harnesses. In order, it drives:

- A manager starts a game and scores a play — and the game reaches the account
  **while it is still being played**, as a `live` row with its log.
- A scorer on the same team, on the other phone, is **offered** that game
  ("being scored now"), joins it, and lands on the same score, because it
  replays the same log.
- Both phones score; each one sees the other's play.
- **One phone takes back the other's play.** The undo is an append in the log,
  not a deletion; the play it took back is still recorded; it is attributed to
  the phone that tapped it.
- Phone B loses signal, scores two plays anyway, while phone A scores one. The
  two visibly disagree — checked, so the next step is not vacuous.
- B comes back. Its plays replay **in its own order, after the server's**, and
  both phones converge on the game the account's log produces — same score, same
  stat lines, same scorebook, play for play.
- A calls the game. The box score written is the one the plays add up to; there
  is still exactly one row; B is taken out of the game, told, and the finished
  game reaches B's season. A play entered after the whistle is refused by name.
- A second game is started, joined, and then **cancelled** on A. The row is
  marked cancelled rather than deleted, the whole log is kept, B is taken out of
  it, and it is in nobody's history — a cancelled game is not a result.

Both phones are also required to log **nothing to the console at all**, warnings
included. That is how the sign-in bug in §3 announced itself, and nobody was
listening.

Also re-run in a browser and passing unchanged: `browser-save-game`,
`browser-backfill`, `browser-parked`, `browser-invites`, and `browser-session`
(with the short-token config, put back to 3600 afterwards).

### Verified against the real database, not the browser

- `live-events-check.mjs` — the server assigns the sequence; ten simultaneous
  appends from two accounts all succeed and come back numbered 3–12 with no gaps
  and no duplicates; an append is idempotent on the entering device's own event
  id; a manager and a scorer take turns with no claim in between; a viewer and a
  stranger are refused; the log cannot be edited or deleted by anyone; a
  finished or cancelled game refuses further plays by name — but a **retry** of
  an already-accepted play still succeeds, because the queue cannot tell a
  timeout from a success.
- `finish-shared-check.mjs` — the scorer who did not start the game finishes it,
  and there is exactly one row; a box score the log has moved on from is refused
  and the game stays live; cancelling keeps the row and the whole log; a
  finalised game cannot then be cancelled; and **a game with no event log at all
  still saves exactly as it always did**, with every old guard in force.

### Verified in tests only

- `events-check.mjs`, `concurrency-check.mjs`, `reconcile-check.mjs` — the fold
  itself: replay, undo resolution, the merge rule, 300 randomised two-phone
  games, and the box-score comparison. Pure, no database.
- The **"this box score does not match the plays" sheet** renders from tests
  only. It appears only when a finalise is refused, which the browser harness
  does not currently provoke; the refusal path itself is verified against the
  database.
- The `offline-queue-check.mjs` additions (overlapping flushes) are unit-level.
  The bug they pin was found *through* the browser, but the pin is a unit test.

### Not verified anywhere

- Two phones holding **different rosters** for the same team. Both phones in the
  harness read the same season from the account.
- **Three or more phones.** Nothing in the design cares, but nothing has run it.
- Realtime against a **hosted** Supabase project. Only the local stack.
- A game long enough to make the log big. The longest thing exercised is a
  couple of dozen plays.

---

## 3. Judgement calls

Each of these went the safer way, and each one is a real choice.

**Live state is now derived by replay on every device, including with no
backend at all.** One code path rather than two. The alternative — mutate
locally and replay only when shared — means two implementations of what a double
does, and they drift. The scoring engine itself is untouched; it is the fold.

**A game already in progress opens its log with a `resume` event** carrying the
game exactly as it stands. Without it, a game being scored when this version
arrives — or one started while signed out — would sit on a phone that no longer
responds to a tap. Nothing already scored is lost, and a second phone joining
replays the whole game rather than the rest of it.

**Undo names the play it takes back.** With one scorer that changes nothing.
With two it is the difference between both people undoing the same double entry
once, and undoing it *and then an innocent play behind it*. An undo whose target
is already gone does nothing rather than falling back.

**Undo reaches plays only** — not batting-order changes, not the track-both
switch. An undo that silently reshuffled the order while the scorer thought they
were taking back a strikeout would be worse than no undo.

**Batting-order changes and the track-both switch ARE events.** They are not
cosmetic: the order decides who is up, and therefore whose stat line a play is
written to. Two phones disagreeing about it would file plays against the wrong
players. Fielding-position overrides and the scorebook page offset are *not*
synced — they are one person's screen.

**Finalising reconciles on the client; the server closes the remaining window.**
The comparison is done in the app, because doing it in Postgres would mean a
second implementation of the scoring engine in plpgsql. The gap that leaves — a
play landing between the check and the write — is closed by `save_game` itself,
which refuses a box score if anything was appended after the event that called
the game.

**Realtime AND a poll every six seconds.** Not belt and braces. A live socket
over a mobile network drops messages and whole connections without reporting
either, and a play that was genuinely written staying invisible for the rest of
the game is not a trade worth making to save a request. Realtime makes it
immediate; the poll makes it certain.

**Joining is offered, never automatic.** A card that says a game is being scored
now. Landing someone in a game they did not open is how plays get entered
against the wrong game. The offer is refreshed every fifteen seconds, and
tapping a stale one is refused rather than joining a finished game.

**A play refused after the whistle parks as a visible write** rather than being
dropped. It will sit in the parked-writes list with the database's own words.
That is loud, and it is meant to be: the device believes something happened that
the account does not know about.

**History now excludes games that are not final.** A games row exists from the
first pitch, so mapping every row would file a game still being played — and one
that was cancelled — as a completed 0-0 result and move the standings with it. A
row with no status at all is treated as final: that is every row written before
this mattered.

**`game_events` keeps its direct INSERT policy.** Row-level security still lets
a scorer insert a row directly and choose its own `seq`, which the app never
does — it only uses `append_game_event`. The policy is kept so the existing RLS
suites and their semantics are unchanged. A scorer abusing it could only disrupt
their own team's game, which they could already do by entering false plays.

**A league admin can score too.** `can_score_game` has always said so; the
decision in D13 names scorer and manager, and league admin is a superset of that,
not a new grant.

**Two people entering the same play makes two plays.** Deliberately, and D13
argues it at length. There is no automatic de-duplication because "the same
play" is not something a program can recognise. The mitigation is live sync and
undo.

### Found on the way, and fixed, because live scoring made them reachable

**The write queue lost writes when two flushes overlapped.** A play is appended
every few seconds and each append asks the queue to drain, so overlapping
flushes stopped being theoretical. Two of them read the same pending list and
the second one's write-back resurrected or erased what the first decided — and a
write enqueued *during* a flush was simply gone, with no error and nothing
parked. Flushes are now serialised, and each one writes back a set of changes
against a fresh read rather than the snapshot it started from. Pinned by three
new cases in `offline-queue-check.mjs`.

**`writeGame` and `writeSeason` returned quietly when the team id was not
resolved yet**, which marked the queue entry applied and dropped it. They now
wait instead.

**Signing in reconciled twice.** Outside phase 3, and it blocked the two-phone
harness, so it is fixed. The explicit `getSession` and the `INITIAL_SESSION`
event each started a full reconciliation, so a first sign-in with a season to
upload ran `import_season_and_claim` **twice**, milliseconds apart. Confirmed
against a real database: two complete sets of opposing teams, after which the
read-back check correctly reported that the upload did not match the device,
discarded it, and told the person their season could not be uploaded — for a
season that was perfectly fine. Reconciliations for the same account now collapse
into one, and the two-phone harness checks the team count after sign-in.

---

## 4. Unfinished, and what to watch

- **A `live` row is never cleaned up.** A game abandoned without being finalised
  or cancelled — phone flat, app closed, walked away — stays `live` in the
  account forever, and another phone on that team will keep being offered to
  join it. Nothing is wrong with the data; it is clutter, and it will be
  confusing the first time it happens. There is no "abandon this stale game"
  path and no age cutoff. This is the first thing I would add.
- **The join offer only looks at the primary team.** Phase 4 territory.
- **A long log is fetched whole** when joining and on the first catch-up after a
  reconnect. Fine at rec-game scale; there is no pagination.
- **The mismatch sheet has not been through the viewport audit**, because it
  only appears on a refused finalise and `viewports.mjs` drives screens rather
  than error states.
- **A live spectator view** is phase 5. A viewer can already *read* the log —
  RLS allows it — but there is no screen that shows it.
- **The event log is never pruned.** Every play of every game stays in
  `game_events` forever. At rec-league volume that is nothing, and it is what
  makes a game reconstructible. Worth knowing before it is a surprise.

---

## 5. New migrations — LOCAL ONLY, all three pending

None has been applied to the hosted project. `npx supabase migration list
--linked` will show these three, on top of `_014` and `_015` from the last
session, which are also still pending.

| Migration | What it does | Risk |
|---|---|---|
| `20260101000016_live_event_log` | Adds `client_event_id` to `game_events` + a unique index; adds `start_live_game` and `append_game_event` | New column and new functions. Nothing existing is altered. The column is nullable so the direct-insert path RLS already allows keeps working |
| `20260101000017_realtime_game_events` | Adds `game_events` to the `supabase_realtime` publication; adds an index on `games(status)` | Publication + index only. Grants nobody anything — Realtime applies the table's own SELECT policy before relaying |
| `20260101000018_finish_a_shared_game` | Adds `cancel_live_game`; **replaces `save_game`** | **Touches a live function.** See below |

`_018` is the one to think about. `save_game` keeps its exact signature — no new
parameter, deliberately, because even a defaulted one would create a second
overload and leave the old version live, which is the trap `_012` had to be
rescued from. What changes inside it:

- it finds an existing game row for this client id **whoever created it**, and
  updates that row rather than inserting under the author's own key;
- it refuses a game that was cancelled;
- it refuses a box score when the log has moved on past the event that called
  the game.

For a game with **no event log** — which is every game the hosted app has ever
written, and every game a phone scores while signed out — none of those three
paths is reached. The insert, the conflict target, the guards, the box-score
replacement and the perspective flip are unchanged. `finish-shared-check.mjs`
checks that directly, as its own section.

Applying all three takes the hosted project to 19 migrations.

---

## 6. Deploy order

**Order matters, and it is not the same as last time: the migrations must go
first.** The client code calls `start_live_game` and `append_game_event` on the
first play of the first game after it loads. Deploy the code without `_016` and
every play becomes a queued write failing with "function not found" — retried
forever, invisible, until the migration lands. Nothing would be lost, but the
first game after the deploy would be scored with no idea whether it was reaching
the account.

1. **Export the season from the phone first.** As always.
2. **`npx supabase db push`** — applies `_014`, `_015`, `_016`, `_017`, `_018`
   in that order. `_018` must not be applied without `_016`: it refers to event
   kinds that only exist once the log does. The CLI applies them in order, so
   pushing them together is correct; do not cherry-pick.
3. **Check Realtime is enabled** on the hosted project before relying on `_017`.
   If it is not, the app still works — the six-second poll carries it — but a
   second phone will be a few seconds behind rather than immediate.
4. **Then push the code** (`git push`).
5. **First game after the deploy: watch the LIVE header.** It says `· SHARED`
   once the game has reached the account. If it does not, the game is being
   scored locally and queued, which is safe, but it means step 2 did not take.

**If you would rather not deploy this yet: don't.** Everything that exists today
keeps working without any of it. Phase 3 is entirely additive at the product
level — the single-phone flow is the same flow, and its path through `save_game`
is the same path.

---
# Report — phases 2b and 2c

Built while you were away. **854 assertions across 28 suites, build clean,
viewport audit clean.** Nothing was pushed. The hosted project was not touched.

**Read §5 before you deploy anything tomorrow.** One migration changes a
function the live app calls.

## 1. What was built, and how far it was verified

### Verified in a real browser, end to end

- **The whole invite round trip** (`test/browser-invites.mjs`), with three
  separate accounts in one browser: a manager picks a role and mints a code, a
  second account signs in, enters it, sees what it grants *before* accepting,
  joins, and lands in that team. Then the database is asked whether the
  membership is real, whether the code is spent, and by whom.
- **A spent code refused**, in words, to a third account, granting nothing.
- **The safety case**: joining with a season already on the phone leaves the
  roster, the history, the team on screen and the primary team exactly as they
  were, while still granting the membership.
- Both new sheets measured at iPhone SE and Pro Max.
- The save-game, backfill and parked-writes browser harnesses were all re-run
  and pass unchanged.

### Verified against the real database, not the browser

- **Every role's reach** (`test/roles-check.mjs`), as real signed-in users with
  RLS on — the way 1b did it. A viewer reads and changes nothing; a scorer
  scores and cannot touch the roster; a manager owns their team; a league admin
  reaches every team in their league and nothing outside it; a stranger reaches
  nothing and cannot even list invites.
- **Invites** (`test/invites-check.mjs`): who may mint one, what it may grant,
  the expiry clamp at both ends, single use, expiry, made-up codes, and that a
  failed accept does not burn the invite.

### Verified in tests only

- The role shown in the account card for `stale` and `signed-out` accounts.
  Both states render, but only the `ready` wording was seen in a browser.

### Not verified anywhere

- Nothing on a real iPhone. That still needs a deploy.
- **League-scoped invites.** `create_invite` is team-scoped only. A league admin
  adding teams to a league is 4a.

## 2. Judgement calls

- **A scorer can finalize. This changes `save_game`.** RLS already let a scorer
  write games and box scores, but `save_game` is SECURITY DEFINER and did its
  own check with `can_manage_team`, so a scorer could score every play and be
  refused at the final whistle. `_014` widens that one line to a new
  `can_score_team`. Everything else in the function is byte-identical, and the
  change is strictly a widening — **a manager cannot tell it happened.** This is
  the only place the finalize path was touched, and §5 says what to do about it.
- **Accepting an invite never switches the season you are looking at**, unless
  the device has nothing of its own. The membership is granted either way. The
  alternative — repointing the primary team — would let a code replace what is
  on someone's screen, and local data is never touched without being asked.
  Choosing between two seasons is phase 4.
- **A team invite cannot grant `league_admin`.** Refused by name rather than
  quietly downgraded. Today such a row would be inert, but it would be a row
  asserting something untrue, waiting for a query that trusts it.
- **Invite codes are generated in the database**, not the client, and expire
  within 1-30 days. Nobody can list invites they do not manage, so the code is
  the only secret protecting a membership.
- **The invite button appears only for a manager**, read from the database
  rather than assumed. A scorer and a manager see the same season; guessing
  generously would show a button the database refuses.

## 3. Unfinished, and why

- **No way to switch between teams.** Someone who joins a second team holds the
  role but keeps looking at their own season. Deliberate — see §2 — and it is
  the natural shape of 4a/4b.
- **No league-scoped invites, and no UI for leagues at all.** `create_invite`
  covers teams. Leagues are phase 4.
- **No way to see or revoke a team's outstanding invites.** The database allows
  it (managers can select and delete their own); nothing surfaces it. Worth
  doing when there is a reason to look at a list of them.
- **Nothing shows a viewer that they are a viewer** beyond the account card.
  The roster screen still shows edit controls to a viewer; the database refuses
  them, so the failure is safe but ugly. Flagged rather than fixed, because
  changing what the roster screen renders touches the screen used tonight.

## 4. New migrations — LOCAL ONLY, both pending

Neither has been applied to the hosted project. `npx supabase migration list
--linked` will show both as pending.

| Migration | What it does | Risk |
|---|---|---|
| `20260101000014_scorer_can_finalize` | Adds `can_score_team`; `save_game` uses it instead of `can_manage_team` | **Touches a live function.** Strictly widening; a manager's path is unchanged and re-verified |
| `20260101000015_create_invite` | Adds `create_invite`, `peek_invite`, `new_invite_code` | New functions only. Nothing existing is altered |

Applying both takes the hosted project from 14 to 16 migrations and from 20 to
23 security-definer functions.

## 5. Deploy order for tomorrow

**The safest order is to deploy nothing from this session until tonight's game
is over and exported.** None of it is needed for scoring a game.

When you are ready:

1. **Export the season from the phone first.** As always.
2. **Push the code** (`git push`). The client changes are additive: an account
   card, an invite sheet, a join sheet. The scoring, saving, finalizing and
   queueing paths are untouched — no file under `src/game/` changed in this
   session.
3. **Then `npx supabase db push`** to apply `_014` and `_015`.

**Order matters here, and it is the opposite of last time.** The new client code
does not call anything from `_014` or `_015` unless you tap Invite or Join, so
deploying it before the migrations is safe. Pushing the migrations first is also
safe. The only thing to avoid is tapping **Invite someone** on the deployed app
before `_015` is applied — it would fail with "function not found", the write is
not queued (it is a direct call, not a queued write), and nothing would be
damaged.

If you would rather not touch the database at all yet: **push the code and skip
step 3.** Everything that exists today keeps working. Invite and Join will error
if tapped, and nothing else changes.

---

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
| 2b | Roles: league admin, team manager, team scorer, viewer — enforced in RLS, every role's reach proven | **green** |
| — | Surfacing parked writes was pulled forward into 6b and is done | **green** |
| 2c | Invite flow: manager generates a code with a role, invitee lands in the right team | **green** (team-scoped; league invites are phase 4) |

## Phase 3 — Live shared scoring

| Slice | Description | Status |
|---|---|---|
| 3a | Append-only command log; live state derived by replay | **green** |
| 3b | Realtime subscription; two phones on one game stay in sync | **green** |
| 3c | Concurrency: chosen strategy documented and tested | **green** (D13) |
| 3d | Cancel / undo / finalize correct in the shared model | **green** |
| — | **Pulled forward: a finalized game is written to the backend** | **green** |
| — | **Pulled forward: past games can be sent to the backend on demand** | **green** |

### What was pulled forward, and what it is not

_Written before 3a–3d were built. Everything listed as deferred below has since
been done; kept as the record of what the slice was and was not._

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
| 4a | League admin: create league, add teams, set schedule | **green** (D14) |
| 4b | Team manager: own roster and lineup only | **green** (D16) |
| 4c | League-wide standings and leaders across all tracked games | **green** (D15) |
| 4d | Manual record adjustments still per team | **green** |
| 4e | Score a fixture: a normally-scored league game reaches the table | **green** (D17) |

A team joins a league by redeeming its code, which is also what lets it be put
there at all — see D14. A fixture on a league calendar is scored from the league
screen, which is what makes it a league result rather than a friendly against a
name typed into one phone — see D17. The season screen's own opponent picker is
still slug-based, which is correct for a friendly and is what 4e routes around
rather than replaces.

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

### D13 — Concurrency: an append-only log in the server's order, and no lease

**The decision.** Any member holding **scorer** or **manager** on the team may
enter plays on a live game. There is no lease, no claim to take and release, and
no single active scorer. (A league admin of the game's league can too, which is
what `can_score_game` has always said; it is a superset, not a new rule.)

The concurrency strategy *is* the append-only log with a **server-assigned
sequence**. Appends from several phones interleave in the order the server gives
them. Nothing merges, nothing is dropped, and no phone's version of the game
overwrites another's — there is no version to overwrite, only a list to fold.

**Why not a lease.** A lease has to be released, and the phone holding it is the
one that walks out of signal range, or goes flat, or gets put in a bag at the
end of the third. Every lease design ends up needing a way to break the lease,
and at that point the thing it was protecting against — two people scoring at
once — is back, only now it is a surprise. Scorekeeping at a rec game is two
people with phones and no protocol between them; the software should match that
rather than impose an order of turns nobody at the field agreed to.

**Why the server assigns the sequence.** The schema originally described
`UNIQUE(game_id, seq)` as a compare-and-swap: a client proposes the next number
and loses the race if someone else claimed it. That works, and it pushes a retry
loop onto a phone with one bar of signal, where the loser of the race is a
person who has to tap again. `append_game_event` takes a per-game advisory lock
instead and reads `max(seq)+1` under it. Two phones appending at the same
instant both succeed, one after the other. Ten at once, from two accounts, come
back numbered 3 to 12 with no gaps and no duplicates — proved in
`live-events-check.mjs`, not argued.

**What a phone shows before its plays are accepted.** Its own view, with its own
unsent plays folded on the end, in the order it entered them. That view is
provisional: when those plays land after somebody else's, the same plays produce
a different state, and the phone's screen changes to match. This is not a defect
being tolerated — it is the only ordering every phone can agree on, and the
alternative is two phones that never agree at all.

**The accepted cost: two people entering the same play makes two plays.**
Deliberately. There is no automatic de-duplication and there should not be,
because "the same play" is not something a program can recognise: two runners
really do score on consecutive pitches, two batters really do walk in a row.
Any rule that silently dropped the second one would eventually drop a real play,
and a missing run nobody saw happen is far worse than a duplicate run both
scorers can see.

The mitigation is visibility and reversal, not detection:

- **Live sync**, so the other scorer's play is on your screen in about a second
  rather than at the end of the inning. Most double entries never happen,
  because the first entry is already visible.
- **Undo**, which appends a reversing event and takes back the last play
  *whoever entered it* — so either scorer can fix it, and neither has to be the
  one who made the mistake.

An undo names the play it is taking back. Two people both undoing the same
double entry take it back once, rather than taking back the duplicate and then
an innocent play behind it.

**Where this is proved.** `concurrency-check.mjs` (300 random two-phone games:
nothing dropped, nothing folded twice, the accepted order preserved, and both
phones converging), `live-events-check.mjs` (the database half, including the
concurrent burst and the no-lease turn-taking), and `browser-two-phones.mjs`
(two real browsers, two accounts, one game, including a phone scoring through a
loss of signal and converging when it returns).

### D14 — A team enters a league by invitation, and leaves whenever it likes

**The hole this closes.** `teams_update_manager_or_admin` admits a team's own
manager for every column, and `league_id` was one of them. Anyone managing a
team could set it to any league id they could see — and a league is public by
default — so a stranger's team could appear in your standings uninvited. Not a
crash: a table that is quietly wrong, which is worse.

**The rule.** A team can only be put into a league the caller already holds a
membership on, enforced by a trigger on `teams` rather than by any one function,
so there is one answer however the row is written. Redeeming the league's code
is what grants that membership, which makes the code the way in.

Leaving is deliberately unrestricted. A manager can take their team out of a
league at any time without anyone's permission — leaving is not a favour to be
granted, and a league that can hold a team hostage is worse than one that loses
one. The membership survives, so they can come back with no new code.

`service_role` is exempt, matching row-level security: the seed and migration
paths have no `auth.uid()` and already bypass RLS, so this must not be stricter
than RLS is.

**Joining is one transaction.** `join_league` redeems the code and places the
team together. Either half alone is a mess: a membership without the team leaves
someone in a league their team is not in, with no obvious way to finish; the
team without the membership is refused by the trigger.

**And one case that had to be handled rather than dead-ended on.**
`accept_invite` refuses a second membership for the same scope — correctly,
there is nothing left to grant — which blocked a manager bringing a SECOND team
into a league they were already in. `join_league` now skips the grant in that
case and places the team anyway, and deliberately does not burn the code: it
granted nothing, so it is still somebody else's way in. This confers no reach,
because a league member can already move a team they manage into that league
with a plain update.

### D15 — A game belongs to a league only when both teams do, and that makes it public

Nothing the app wrote ever set `games.league_id`. A fixture created by
`schedule_game` carried one; a game actually SCORED did not. A league table
built from league games would therefore have been permanently empty however many
were played in it — the rows existed and were simply filed nowhere the league
could see.

`save_game` and `start_live_game` now file a game under the league both teams
are in. The rule is narrow on purpose: one team in a league and one outside it
is a friendly, not a fixture, and filing it under the league would put a result
in a table against a team the table does not contain.

**The consequence, stated plainly rather than discovered later.**
`games_select_visible` admits anyone for whom `league_is_readable(league_id)` is
true, and a league is public by default (D3). So scoring a game between two
teams in a public league makes that game — and its box score — readable by
anyone, signed in or not. That is what a league is: a table other people look
at. A league whose games should not be public is set to private, which the
column already supports and RLS already enforces. There is no UI for that toggle
yet, which is in the report's unfinished list.

### D16 — The batting order is shared, and saying nothing about it is not saying "empty"

The account held the roster but not the ORDER — who is in the lineup, in what
sequence, and who is on the bench. That was fine while one person scored. It is
not fine with two, and the reason is sharper than tidiness: the order decides
who is at the plate, and who is at the plate decides whose stat line a play is
written to. Two phones disagreeing about the order do not disagree cosmetically;
they file the same double against two different players and tell nobody.

Phase 3 covered the live case — the `start` event carries the lineup, so
everyone replaying one game agrees within it. What it did not cover is the gap
BETWEEN games, which is where the order is actually set.

`players.lineup_order` and `players.on_bench` now carry it, and `save_season`
writes them.

**The guard that matters more than the feature.** A payload that says nothing
about the order leaves the recorded order alone. A client too old to know about
lineups sends a roster with no `lineup` key at all, and reading that as "nobody
is in the order" would wipe a real batting order from the account every single
time such a phone saved — silently, and repeatedly. An absence is not an
instruction. This is the same lesson as the empty roster in `_012`, and it has
its own test. An EXPLICITLY empty order is different, and is obeyed.

### D17 — A league game is named by team id; a friendly is named by a slug

The season screen's opponent picker has always worked in device-side slugs
(`rubber-chickens`) — a name typed into one phone, which `save_game` turns into
a team that phone owns. That is right for a friendly: nobody else's record is
touched, and the opposition needs no account.

It is wrong for a league. A league is made of real teams with real ids, and a
game resolved from a slug lands against a team OUTSIDE the league — so the
fixture stayed on the calendar, the game went into one season, and the table
never heard about either. 4a scheduled fixtures and 4c built a table; this is
the wire between them.

**The rule.** A payload may name the opposition by `opponentTeamId`. When it
does, that team is the opponent — no lookup, no team invented. When it does not,
the slug path runs exactly as it always has. Scoring a fixture also carries the
FIXTURE's own client id, so `start_live_game` and `save_game` find the row
already on the schedule and finish it rather than making a second game beside
it: a fixture becomes live when somebody starts scoring it, and final when they
call it.

**Who may name a team, and why it is narrower than the policy.** Row-level
security has always let a scorer of EITHER team record a game between them
(`can_score_teams`) — that is how one person keeps the book for both sides. But
these functions are SECURITY DEFINER, so accepting any uuid would be a wider
door than the policy: anyone who can score for any team could write a result
into any other team's record, and once both are in a league, into the table
everyone reads. So the named team must be one we share a league with, or one we
hold a membership on. Anything else is refused by name.

**Which dugout.** A game's score and result are recorded from the HOME team's
point of view, because a game belongs to two teams. Everything scored from the
season screen is at home, which is what the record was hard-coded to. A fixture
says which side we are on, and the record carries it — getting that the wrong
way round hands the win to the wrong team, and it is the kind of wrong nobody
notices until the table is read. There is a test for the away case alone.

### D3 — League visibility is a column, not an assumption

Phase 5 wants public spectator views, but making every row world-readable is a
product decision, not a default. `leagues.visibility` is `public | private`
(default `public`); RLS gates anonymous reads on it. A private league is
invisible to anonymous users while remaining fully functional for members.

---

## Phase summaries

_Added at the end of each phase._
