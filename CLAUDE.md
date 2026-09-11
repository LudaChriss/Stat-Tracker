# CLAUDE.md

Working notes for this repo.

## Non-negotiables

### A subagent's own tests passing is not evidence its work is correct

A test written by the implementer proves the test agrees with the implementation.
It does not prove the implementation is right. Both are wrong together often
enough that "all tests pass" from a subagent means nothing on its own.

For any **security**, **data-mapping**, or **persistence** work, write an
**independent** test that exercises the real system the way a real user would,
and write it without reading the implementer's test first.

What "as a real user would" means in practice:

- **Security** — attack the running database as an actual signed-in user
  holding a real session, not as a service-role client and not by asserting
  that a policy expression looks correct.
- **Data mapping** — round-trip through the real schema, not through an
  in-memory object. Anything the database would drop, drop it.
- **Persistence** — go through the real storage API, including its failure
  modes: unavailable, corrupt, quota exceeded, and an older stored shape.

This rule exists because it has already caught, in this repo:

- a mapping that round-tripped perfectly in memory but returned `null` for
  every roster id and every box-score pid once run through the real column set,
  which would have detached every historical stat line from its player;
- a security layer whose 26 assertions passed while a brand-new user could not
  create a team at all, and while creating a league left you unable to
  administer it.

### Tests that skip on setup failure must fail loudly

A suite that silently skips when its fixtures fail to build reports success
while proving nothing, and silence is indistinguishable from passing. If setup
fails, fail the run and say why.

The one legitimate skip is a genuinely absent optional dependency — no local
Supabase, say — and it must print an explicit "skipped, and why" line rather
than exiting quietly.

This has also already bitten here: an adversarial probe printed
`no holes found` while the event-log and league-visibility sections had never
run, because a failed setup left those blocks unreached.

## Shell

Do not pipe multi-line scripts into an interpreter over stdin
(`python3 - <<'PY' ... PY`) from this harness. The heredoc body can arrive with
its newlines flattened, the terminator never lands on its own line, and the
interpreter blocks on stdin forever — holding a half-applied edit in memory.
One such shell sat for five hours here.

Write the script to a file and run the file.

## Testing

- `npm test` runs every suite in `test/` (auto-discovered by `test/run.mjs`).
- `test/viewports.mjs` is the responsive audit. It needs a dev server on :5173
  and Chrome on `--remote-debugging-port=9222`; it is run manually, not by
  `npm test`.
- Suites that need the database skip cleanly without a local Supabase, so
  `npm test` still passes on a machine with no Docker.
- Browser harnesses are run by hand, not by `npm test`: `browser-save-game.mjs`,
  `browser-backfill.mjs`, `browser-session.mjs`, `browser-parked.mjs`,
  `browser-invites.mjs`, `browser-two-phones.mjs`, `browser-leagues.mjs`,
  `browser-team-switch.mjs`. Each needs a dev server on :5173 and Chrome on
  `--remote-debugging-port=9222`.
- A harness that seeds localStorage must do it with
  `Page.addScriptToEvaluateOnNewDocument` and then remove the script, NOT by
  writing into an already-running app. The app writes its own blank starting
  season on boot, so a `Runtime.evaluate` write races it and whichever lands
  last wins — which shows up as the app sitting on first-run setup, at random,
  for reasons that have nothing to do with the change under test.
- `browser-two-phones.mjs` opens **two private browser contexts** so the two
  phones have genuinely separate localStorage and separate network conditions —
  two tabs on one origin share storage and would prove nothing. It disposes both
  contexts when it finishes; a run that dies partway leaves them behind, and
  enough of those will start killing CDP sessions mid-test for reasons that have
  nothing to do with the app. Restart Chrome if it starts behaving oddly.
- `session-expiry.mjs` and `browser-session.mjs` need genuinely short-lived
  tokens: set `jwt_expiry = 8` under `[auth]` in `supabase/config.toml` and
  restart the stack. **Put it back to 3600 afterwards** — an 8-second token
  expires mid-migration and makes the other browser harnesses fail for reasons
  that have nothing to do with the code. Both refuse to run (exit 2) rather
  than passing quietly when tokens are normal length.

## Local backend

```bash
npx supabase start --ignore-health-check
npx supabase db reset      # applies supabase/migrations/
```

See `SUPABASE_SETUP.md`. Build state and decisions live in `BUILD_TRACKER.md`.
