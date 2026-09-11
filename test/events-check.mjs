// The event log, replayed.
//
// This suite is about one question: does folding a list of events produce the
// game that actually happened? Everything phase 3 rests on is downstream of
// that. If replay is wrong, then a second phone shows the wrong score, an undo
// takes back the wrong play, and the box score written at the final whistle
// does not match the log it came from.
//
// Written against the pure module, with no database and no browser, because
// these are the properties that have to hold before either of those is worth
// testing.

import {
  createReplayer,
  liveSlice,
  logStatus,
  mergeLog,
  replay,
  resolveUndos,
  startingState,
  undoTarget,
} from '../src/game/events.js';
import { INITIAL_STATE as BLANK, TEMPLATES } from '../src/data/league.js';
import { homePid, awayPid, playerName } from '../src/game/logic.js';
import { SEEDED } from './fixtures-history.js';

const SEASON = SEEDED(BLANK);
const out = (o) => TEMPLATES.kickball.groups.flatMap((g) => g.outcomes).find((x) => x.k === o);

let fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    fail++;
    console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  } else console.log('ok   ' + label);
};
const is = (label, cond) => {
  if (cond) console.log('ok   ' + label);
  else {
    fail++;
    console.log(`FAIL ${label}`);
  }
};

// ---------------------------------------------------------------------------
// A tiny log builder. `device` and `seq` are what the real thing carries, so
// the ordering rules below are exercised with the same shapes.
// ---------------------------------------------------------------------------
let n = 0;
const ev = (kind, payload = {}, { device = 'A', seq = null } = {}) => ({
  clientEventId: `${device}-${(n += 1)}`,
  kind,
  payload,
  seq,
  actor: device,
});

const START = {
  gameClientId: 'g-1000',
  sport: 'kickball',
  opponentId: 'rubber-chickens',
  trackMode: 'both',
  lineup: [0, 1, 2, 3, 4, 5, 6, 7],
  bench: [8, 9],
};

const start = (o = {}) => ev('start', { ...START, ...o });
const single = (opts) => ev('outcome', { o: out('1B') }, opts);
const homer = (opts) => ev('outcome', { o: out('HR') }, opts);
const strikeout = (opts) => ev('outcome', { o: out('K') }, opts);

// ---------------------------------------------------------------------------
// The start event is the whole setup
// ---------------------------------------------------------------------------
{
  const s = replay(SEASON, [start()]);
  eq('a started game is active', s.gameActive, true);
  eq('starts in the top of the 1st', [s.half, s.inning, s.outs], ['top', 1, 0]);
  eq('starts level', s.score, { home: 0, away: 0 });
  eq('carries the batting order from the event', s.lineup, [0, 1, 2, 3, 4, 5, 6, 7]);
  eq('carries the game id from the event', s.gameClientId, 'g-1000');

  // A phone that never saw the setup screen replays to the same order.
  const stranger = replay({ ...SEASON, lineup: [], bench: [], trackMode: 'ours' }, [start()]);
  eq('a phone with no local lineup gets it from the log', stranger.lineup, [0, 1, 2, 3, 4, 5, 6, 7]);
  eq('and the track mode with it', stranger.trackMode, 'both');
}

// A log with no start is not a game. A fragment read mid-write must show
// nothing rather than something wrong.
eq('a log with no start replays to nothing', replay(SEASON, [single()]), null);
eq('an empty log replays to nothing', replay(SEASON, []), null);

// ---------------------------------------------------------------------------
// A game that was already being played when the log arrived
//
// Scored on a phone with no account, or by a build from before any of this
// existed. Without a way to pick it up, the phone would sit on a live game
// that no longer answers a tap — which is worse than not having a log at all.
// ---------------------------------------------------------------------------
{
  // Two innings already played, in the old shape: state, no log.
  const played = replay(SEASON, [start(), strikeout(), strikeout(), strikeout(), single(), homer()]);
  const resume = ev('resume', { gameClientId: 'g-1000', state: { ...liveSlice(played), undoStack: [] } });

  const picked = replay(SEASON, [resume]);
  eq('resuming keeps the score already on the board', picked.score, played.score);
  eq('and the batting order position', [picked.kiHome, picked.kiAway], [played.kiHome, played.kiAway]);
  eq('and every stat line so far', picked.gameStats, played.gameStats);
  eq('and the scorebook', picked.events, played.events);
  eq('the game is live again', picked.gameActive, true);

  // Play carries on from there, and a second phone replaying the same log
  // reaches the same place.
  const carried = replay(SEASON, [resume, single()]);
  const straight = replay(SEASON, [start(), strikeout(), strikeout(), strikeout(), single(), homer(), single()]);
  eq('play carries on from a resumed game', carried.score, straight.score);
  eq('and the next hitter is the right one', carried.kiHome, straight.kiHome);
}

// ---------------------------------------------------------------------------
// Plays fold through the real engine
// ---------------------------------------------------------------------------
{
  // Top of the 1st: the opposition bats. Three singles then a grand slam.
  const log = [start(), single(), single(), single(), homer()];
  const s = replay(SEASON, log);
  eq('grand slam scores four for the away side', s.score, { home: 0, away: 4 });
  eq('bases are cleared', s.bases, [null, null, null]);
  eq('the away hitter is credited four RBI', s.gameStats[awayPid(3)].rbi, 4);
  eq('the scorebook has four opposition entries', s.events.length, 4);
}

{
  // Bottom of the 1st, by way of three strikeouts in the top.
  const log = [start(), strikeout(), strikeout(), strikeout(), single(), homer()];
  const s = replay(SEASON, log);
  eq('three outs flip the half', s.half, 'bot');
  eq('two-run homer for our side', s.score, { home: 2, away: 0 });
  eq('our leadoff hitter scored', s.gameStats[homePid(0)].r, 1);
}

// ---------------------------------------------------------------------------
// Runner moves name the base, not a selection
// ---------------------------------------------------------------------------
{
  const log = [
    start(),
    strikeout(), strikeout(), strikeout(),   // to our half
    single(),                                 // Ortiz on first
    ev('runner', { base: 0, action: 'adv' }),
  ];
  const s = replay(SEASON, log);
  eq('the named runner advanced', playerName(s, s.bases[1]), 'Maya Ortiz');
  eq('first base is empty again', s.bases[0], null);

  const outOnBases = replay(SEASON, [...log.slice(0, 5), ev('runner', { base: 0, action: 'out' })]);
  eq('a runner out on the bases is an out', outOnBases.outs, 1);
}

// ---------------------------------------------------------------------------
// Undo: an append that takes back a play, never a deletion
// ---------------------------------------------------------------------------
{
  const a = single();
  const b = homer();
  const withBoth = [start(), a, b];
  const undone = [...withBoth, ev('undo', { target: b.clientEventId })];

  eq(
    'undoing the last play lands exactly where the log without it does',
    liveSlice(replay(SEASON, undone)),
    liveSlice(replay(SEASON, [start(), a])),
  );

  // The log itself still holds both. Nothing was removed.
  eq('the undone play is still in the log', undone.length, 4);
  eq('resolveUndos marks the play, not the log', resolveUndos(undone).map((e) => e.undone), [
    false, false, true, true,
  ]);

  // Two undos walk back two plays.
  const twice = [...undone, ev('undo', { target: a.clientEventId })];
  eq('a second undo takes back the one before', liveSlice(replay(SEASON, twice)), liveSlice(replay(SEASON, [start()])));

  // An undo with no target still means "the last play", which is what a lone
  // scorer tapping the button means by it.
  eq(
    'an untargeted undo takes back the last play',
    liveSlice(replay(SEASON, [...withBoth, ev('undo', {})])),
    liveSlice(replay(SEASON, [start(), a])),
  );

  // THE TWO-SCORER CASE. Both phones see the same home run and both tap undo.
  // Naming the target is what stops the second undo eating the single as well.
  const bothUndo = [
    ...withBoth,
    ev('undo', { target: b.clientEventId }, { device: 'A' }),
    ev('undo', { target: b.clientEventId }, { device: 'B' }),
  ];
  eq(
    'two people undoing the same play take back that play once',
    liveSlice(replay(SEASON, bothUndo)),
    liveSlice(replay(SEASON, [start(), a])),
  );

  // Undo does not reach a batting-order change: taking back a strikeout must
  // never quietly reshuffle who is up.
  const withLineup = [start(), a, ev('lineup_move', { idx: 0, dir: 1 }), ev('undo', {})];
  const s = replay(SEASON, withLineup);
  eq('undo skips past a lineup change', s.lineup, [1, 0, 2, 3, 4, 5, 6, 7]);
  eq('and takes back the play instead', s.score, { home: 0, away: 0 });

  eq('undoTarget names the play an undo would reach', undoTarget(withBoth).clientEventId, b.clientEventId);
  eq('undoTarget is null with nothing to undo', undoTarget([start()]), null);
}

// ---------------------------------------------------------------------------
// Lineup and track-mode changes are facts about the game
// ---------------------------------------------------------------------------
{
  const s = replay(SEASON, [start(), ev('lineup_bench', { id: 0 })]);
  eq('benching removes from the order', s.lineup, [1, 2, 3, 4, 5, 6, 7]);
  eq('and puts them on the bench', s.bench.includes(0), true);

  const back = replay(SEASON, [start(), ev('lineup_bench', { id: 0 }), ev('lineup_add', { id: 0 })]);
  eq('adding from the bench puts them at the end of the order', back.lineup, [1, 2, 3, 4, 5, 6, 7, 0]);

  // Tracking our team only means the opposition gets no scorebook entries.
  const ours = replay(SEASON, [start({ trackMode: 'ours' }), single()]);
  eq('opposition PAs are not booked when tracking our team only', ours.events.length, 0);
  const flipped = replay(SEASON, [start({ trackMode: 'ours' }), ev('track_mode', { mode: 'both' }), single()]);
  eq('switching to both starts booking them', flipped.events.length, 1);
}

// ---------------------------------------------------------------------------
// The end of the game
// ---------------------------------------------------------------------------
{
  eq('a log that only started is live', logStatus([start()]), 'live');
  eq('a cancelled log says so', logStatus([start(), ev('cancel')]), 'cancelled');
  eq('a finalised log says so', logStatus([start(), ev('final')]), 'final');
  const s = replay(SEASON, [start(), single(), ev('cancel')]);
  eq('a cancelled game is no longer active', s.gameActive, false);
}

// ---------------------------------------------------------------------------
// Ordering: the server's order first, this phone's unsent events after
// ---------------------------------------------------------------------------
{
  const a1 = { ...single({ device: 'A' }), seq: 1 };
  const b1 = { ...homer({ device: 'B' }), seq: 2 };
  const a2 = { ...strikeout({ device: 'A' }), seq: null };

  const merged = mergeLog([b1, a1], [a1, a2]);
  eq('accepted events come first, in the server\'s order', merged.map((e) => e.seq), [1, 2, null]);
  eq('an accepted event is not also counted in the local tail', merged.length, 3);
  eq('the unsent event is last', merged[2].clientEventId, a2.clientEventId);

  eq('with no backend the merge is simply the local order', mergeLog([], [a1, a2]).length, 2);
  eq('with nothing local the merge is the server order', mergeLog([b1, a1], []).map((e) => e.seq), [1, 2]);
}

// ---------------------------------------------------------------------------
// CONVERGENCE — the thing the whole design is for.
//
// Two phones both score. The server puts the appends in an order. Both phones
// fold that same order and land on the same game.
// ---------------------------------------------------------------------------
{
  const s0 = start({}, { device: 'A' });
  const server = [
    { ...s0, seq: 1 },
    { ...strikeout({ device: 'A' }), seq: 2 },
    { ...strikeout({ device: 'B' }), seq: 3 },
    { ...strikeout({ device: 'A' }), seq: 4 },   // side retired, our half
    { ...homer({ device: 'B' }), seq: 5 },
    { ...single({ device: 'A' }), seq: 6 },
  ];

  // Phone A has one play still unsent; phone B has none.
  const stillOnA = single({ device: 'A' });
  const onA = replay(SEASON, mergeLog(server, [stillOnA]));
  const onB = replay(SEASON, mergeLog(server, []));

  eq('while a play is unsent the two phones differ', onA.gameStats[homePid(2)].h, 1);
  eq('and the other phone has not seen it', onB.gameStats[homePid(2)], undefined);

  // The play is accepted, at the end of the order. Now they agree.
  const after = [...server, { ...stillOnA, seq: 7 }];
  eq(
    'once accepted, both phones fold the same log to the same game',
    liveSlice(replay(SEASON, mergeLog(after, [stillOnA]))),
    liveSlice(replay(SEASON, mergeLog(after, []))),
  );

  // THE OFFLINE CASE. Phone B was out of signal for two plays and replays them
  // in its own order, on the end. Everyone still converges.
  const offlineB1 = single({ device: 'B' });
  const offlineB2 = homer({ device: 'B' });
  const whileOffline = replay(SEASON, mergeLog(server, [offlineB1, offlineB2]));
  const converged = [...server, { ...offlineB1, seq: 8 }, { ...offlineB2, seq: 9 }];

  eq(
    'a phone that was offline lands where everyone else does once it catches up',
    liveSlice(replay(SEASON, mergeLog(converged, [offlineB1, offlineB2]))),
    liveSlice(replay(SEASON, mergeLog(converged, []))),
  );
  eq(
    'and its own view while offline already had its own plays in',
    whileOffline.score,
    replay(SEASON, mergeLog(converged, [])).score,
  );

  // Order is preserved, not merged: a play that lands between two of yours
  // stays between them.
  eq(
    'events interleave in server order, not by device',
    replay(SEASON, mergeLog(server, [])).events.length,
    replay(SEASON, server).events.length,
  );
}

// ---------------------------------------------------------------------------
// The incremental replayer must never disagree with a full fold
// ---------------------------------------------------------------------------
{
  const fold = createReplayer();
  const log = [start()];
  let mismatches = 0;

  const plays = ['1B', 'K', '2B', 'BB', 'K', 'HR', 'K', 'E', '1B', 'K', 'K', '3B', 'FO', 'BB', 'HR'];
  plays.forEach((k) => {
    log.push(ev('outcome', { o: out(k) }));
    const incremental = liveSlice(fold(SEASON, log.slice()));
    const whole = liveSlice(replay(SEASON, log));
    if (JSON.stringify(incremental) !== JSON.stringify(whole)) mismatches++;
  });
  eq('folding only what is new matches folding the whole log, every time', mismatches, 0);

  // An undo invalidates the cache, because it changes whether an earlier event
  // counted. The replayer must notice rather than reuse.
  log.push(ev('undo', {}));
  eq(
    'an appended undo is not served from the cache',
    liveSlice(fold(SEASON, log.slice())),
    liveSlice(replay(SEASON, log)),
  );

  // A roster edit changes the names the engine writes into a play's
  // description, so the cache must not be reused across one.
  const renamed = { ...SEASON, roster: SEASON.roster.map((p) => ({ ...p, name: `${p.name}!` })) };
  eq(
    'a roster change is not served from the cache',
    liveSlice(fold(renamed, log.slice())),
    liveSlice(replay(renamed, log)),
  );
}

// ---------------------------------------------------------------------------
// Unknown kinds are ignored, not fatal. A newer phone may know a play this
// build does not, and showing the rest of the game beats showing none of it.
// ---------------------------------------------------------------------------
{
  const s = replay(SEASON, [start(), ev('something_new_in_2027', { x: 1 }), single()]);
  is('an unrecognised event does not break the replay', s !== null && s.gameActive === true);
  eq('and the plays around it still count', s.events.length, 1);
}

// startingState leaves the season alone.
{
  const s = startingState(SEASON, START);
  eq('starting a game does not touch the roster', s.roster, SEASON.roster);
  eq('or the history', s.history, SEASON.history);
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
