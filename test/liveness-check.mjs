// When a live game has stopped, and what the app shows once it has.
//
// Pure. Time is passed in, never read, which is the whole reason the cutoff can
// be tested at all without waiting three hours for it. The real clock, the real
// account and a real phone are browser-abandon.mjs.

import { STALE_AFTER_MS, contiguousSeq, countPlays, idleLabel, isStale, lastActivityAt, lastSeq, toMs, wasAbandoned } from '../src/game/liveness.js';
import { logStatus, replay } from '../src/game/events.js';
import { advanceClock, now, onClockChange, resetClock } from '../src/game/clock.js';
import { deriveView } from '../src/game/derive.js';
import { abandonFailure } from '../src/game/useGame.js';
import { INITIAL_STATE, TEMPLATES } from '../src/data/league.js';
import { SEEDED } from './fixtures-history.js';

let fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    fail++;
    console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  } else console.log('ok   ' + label);
};

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse('2026-09-20T18:00:00Z');

// ---------------------------------------------------------------------------
// The cutoff
// ---------------------------------------------------------------------------
{
  eq('the cutoff is three hours, as D20 argues', STALE_AFTER_MS, 3 * HOUR);
  eq('a game quiet for an hour is not stopped — that is a rain delay', isStale(T0, T0 + HOUR), false);
  eq('nor at two and a half hours', isStale(T0, T0 + 2.5 * HOUR), false);
  eq('nor at exactly three', isStale(T0, T0 + 3 * HOUR), false);
  eq('a minute past three, it is', isStale(T0, T0 + 3 * HOUR + 60 * 1000), true);
  eq('overnight, certainly', isStale(T0, T0 + 14 * HOUR), true);
  eq('not knowing when it last moved is never "stopped"', [isStale(null, T0), isStale(undefined, T0), isStale('nonsense', T0)], [false, false, false]);
  eq('nor is not knowing what time it is', isStale(T0, null), false);
  eq('a play timestamped in the future (a fast clock somewhere) is not stopped', isStale(T0 + HOUR, T0), false);
}

// ---------------------------------------------------------------------------
// Reading a log
// ---------------------------------------------------------------------------
{
  eq('timestamps arrive as ISO strings, numbers and Dates', [toMs('2026-09-20T18:00:00Z'), toMs(T0), toMs(new Date(T0))], [T0, T0, T0]);

  const log = [
    { kind: 'start', seq: 1, at: '2026-09-20T18:00:00Z' },
    { kind: 'outcome', seq: 2, at: '2026-09-20T18:05:00Z' },
    { kind: 'lineup_move', seq: 3, at: '2026-09-20T18:06:00Z' },
    { kind: 'undo', seq: 4, at: '2026-09-20T18:07:00Z' },
    // This phone's own play, not accepted yet: no seq, and a number for a time.
    { kind: 'outcome', seq: null, at: T0 + 20 * 60 * 1000 },
  ];
  eq('the last activity is the newest event, including this phone\'s unsent ones', lastActivityAt(log), T0 + 20 * 60 * 1000);
  eq('rows straight from the database are read by created_at', lastActivityAt([{ created_at: '2026-09-20T19:00:00Z' }]), T0 + HOUR);
  eq('an empty log falls back to when the game row last changed', lastActivityAt([], '2026-09-20T18:30:00Z'), T0 + 30 * 60 * 1000);
  eq('and with nothing at all, nothing', lastActivityAt([], null), null);
  eq('the last seq is the account\'s, ignoring unsent events', lastSeq(log), 4);
  eq('no log, seq 0', lastSeq([]), 0);

  // Catching up asks from the end of the unbroken run. Realtime dropping 3 and 4
  // while delivering 5 must not leave the phone asking only for what is after 5.
  const holed = [1, 2, 5].map((seq) => ({ kind: 'outcome', seq }));
  eq('with a hole, the highest seq held is past it', lastSeq(holed), 5);
  eq('but catching up asks from before the hole', contiguousSeq(holed), 2);
  eq('an unbroken log asks from its end', contiguousSeq([3, 1, 2].map((seq) => ({ seq }))), 3);
  eq('unsent events (no seq) do not count as held', contiguousSeq([{ seq: 1 }, { seq: null }, { seq: 2 }]), 2);
  eq('a log missing its first event asks for everything', contiguousSeq([{ seq: 2 }, { seq: 3 }]), 0);
  eq('nothing held, from the start', contiguousSeq([]), 0);
  eq('plays are plays — not the start, not a batting-order change, not the undo itself', countPlays(log), 2);

  eq('minutes', idleLabel(45 * 60 * 1000), '45 min');
  eq('hours and minutes', idleLabel(3 * HOUR + 10 * 60 * 1000), '3 hr 10 min');
  eq('whole hours', idleLabel(5 * HOUR), '5 hr');
  eq('a day', idleLabel(30 * HOUR), '1 day');
  eq('days', idleLabel(80 * HOUR), '3 days');
}

// ---------------------------------------------------------------------------
// An abandoned game ends like a cancelled one, and says why
// ---------------------------------------------------------------------------
const seeded = SEEDED(INITIAL_STATE);
const single = TEMPLATES.kickball.groups.flatMap((g) => g.outcomes).find((o) => o.k === '1B');
{
  const base = [
    { clientEventId: 'e1', seq: 1, kind: 'start', payload: { gameClientId: 'g1', lineup: seeded.lineup, bench: [] } },
    { clientEventId: 'e2', seq: 2, kind: 'outcome', payload: { o: single } },
  ];
  const abandoned = [...base, { clientEventId: 'abandon:x', seq: 3, kind: 'cancel', payload: { reason: 'abandoned', seenSeq: 2 } }];
  const cancelled = [...base, { clientEventId: 'e3', seq: 3, kind: 'cancel', payload: {} }];

  const a = replay(seeded, abandoned);
  const c = replay(seeded, cancelled);
  eq('an abandoned game is over', [a.gameActive, a.cancelled], [false, true]);
  eq('and knows it was abandoned', a.abandoned, true);
  eq('a scorer\'s cancel is not called abandoned', [c.cancelled, c.abandoned], [true, false]);
  eq('the log says cancelled for both — the status the account holds', [logStatus(abandoned), logStatus(cancelled)], ['cancelled', 'cancelled']);
  eq('and which one it was can be read back', [wasAbandoned(abandoned), wasAbandoned(cancelled), wasAbandoned(base)], [true, false, false]);
  eq('the play before it still counts in the replay, which is what "kept" means', a.score, c.score);
}

// ---------------------------------------------------------------------------
// What the phone shows
// ---------------------------------------------------------------------------
const noop = new Proxy({}, { get: () => () => {} });
{
  const offer = {
    gameId: 'g-1', clientId: 'c-1', lastActivityAt: T0, lastSeq: 12, plays: 11, home: true,
  };
  const s = { ...seeded, gameActive: false, joinable: offer };

  const fresh = deriveView(s, noop, { now: T0 + 20 * 60 * 1000 }).schedule[0];
  eq('a game being scored is offered to join', [fresh.key, fresh.sub], ['join', 'Tap to join and score it too']);

  const late = deriveView(s, noop, { now: T0 + 3 * HOUR + 15 * 60 * 1000 }).schedule[0];
  eq('the same game past the cutoff is not offered as being scored', late.key, 'stopped');
  eq('it says it stopped, and for how long', [late.tag, late.line.endsWith('no plays for 3 hr 15 min')], ['■ STOPPED', true]);
  eq('and where tapping leads', late.sub, 'Tap to abandon or resume it');

  const closed = deriveView(s, noop, { now: T0 + 4 * HOUR });
  eq('its sheet is shut until the card is tapped', closed.stoppedGame, null);
  const open = deriveView({ ...s, stoppedSheet: true }, noop, { now: T0 + 4 * HOUR });
  eq('open, it says how long and how much was entered', [open.stoppedGame.idle, open.stoppedGame.plays, open.stoppedGame.busy], ['4 hr', 11, false]);
  eq('a sheet with no game behind it does not open', deriveView({ ...s, joinable: null, stoppedSheet: true }, noop, { now: T0 }).stoppedGame, null);
}

{
  // The game screen of a phone in a game.
  const serverLog = [
    { clientEventId: 'e1', seq: 1, kind: 'start', at: '2026-09-20T18:00:00Z', payload: {} },
    { clientEventId: 'e2', seq: 2, kind: 'outcome', at: '2026-09-20T18:10:00Z', payload: { o: single } },
  ];
  const live = { ...seeded, gameActive: true, screen: 'live', liveGameId: 'g-1', serverLog, gameLog: [] };
  const lastPlay = Date.parse('2026-09-20T18:10:00Z');

  eq('an hour after the last play, no banner', deriveView(live, noop, { now: lastPlay + HOUR }).liveStopped, null);
  eq('past the cutoff, the banner, and what abandoning will say it saw',
    deriveView(live, noop, { now: lastPlay + 3 * HOUR + 60 * 1000 }).liveStopped, { idle: '3 hr 1 min', seenSeq: 2, busy: false });

  const typingOffline = { ...live, gameLog: [{ clientEventId: 'e3', seq: null, kind: 'outcome', at: lastPlay + 3 * HOUR, payload: {} }] };
  eq('a scorer entering plays with no signal is never told the game stopped',
    deriveView(typingOffline, noop, { now: lastPlay + 3 * HOUR + 60 * 1000 }).liveStopped, null);

  eq('a game only on this phone has nobody to abandon it for', deriveView({ ...live, liveGameId: null }, noop, { now: lastPlay + 9 * HOUR }).liveStopped, null);
  eq('nor does a phone not in a game', deriveView({ ...live, gameActive: false }, noop, { now: lastPlay + 9 * HOUR }).liveStopped, null);
}

// ---------------------------------------------------------------------------
// Saying why an abandon did not happen
// ---------------------------------------------------------------------------
{
  eq('a play landed first', abandonFailure({ message: 'refusing to abandon game x : 1 play(s) have been entered since you looked, so it is still being scored' }),
    'Someone has just entered a play in that game, so it was not abandoned.');
  eq('no signal', abandonFailure(new TypeError('Failed to fetch')), 'Could not reach the account, so the game was not abandoned.');
  eq('not theirs to abandon', abandonFailure({ message: 'not allowed to score this game' }), 'Only a manager, scorer or commissioner can abandon a game.');
  eq('anything else is said in the account\'s own words', abandonFailure({ message: 'boom' }), 'The game was not abandoned: boom');
}

// ---------------------------------------------------------------------------
// The clock a harness moves
// ---------------------------------------------------------------------------
{
  const before = now();
  let heard = 0;
  const off = onClockChange(() => heard++);
  advanceClock(3 * HOUR);
  eq('moving the clock moves now', now() - before >= 3 * HOUR, true);
  eq('and says so', heard, 1);
  resetClock();
  eq('reset puts it back', Math.abs(now() - Date.now()) < 1000, true);
  off();
  advanceClock(1);
  eq('a listener that left hears nothing more', heard, 2);
  resetClock();
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
