// The concurrency strategy, stated as properties and checked.
//
// THE DECISION (see D13 in BUILD_TRACKER.md)
//
// Any member holding scorer or manager on the team may enter plays on a live
// game. There is no lease, no claim to take and release, and no single active
// scorer. Appends from several phones interleave in the order the SERVER
// assigns; nothing merges and nothing is dropped.
//
// What that buys, and what it costs, are both tested here:
//
//   * Nothing is lost. Every event entered anywhere is folded exactly once,
//     whether it was accepted immediately or held on a phone with no signal.
//   * Everyone converges. Once the account has everything, every phone folds
//     the same list in the same order and shows the same game.
//   * The order is the server's, not any phone's. A phone's own view while it
//     is holding unsent plays is provisional, and it changes when those plays
//     land after someone else's. This is not a bug being tolerated — it is the
//     only ordering every phone can agree on.
//   * TWO PEOPLE ENTERING THE SAME PLAY MAKES TWO PLAYS. Deliberately. There
//     is no automatic de-duplication, because "the same play" is not something
//     a program can recognise: two runners really can score on consecutive
//     pitches, and a guess that silently deletes one of them is worse than a
//     double entry somebody can see and undo.
//
// Pure: no database, no browser. The database half is live-events-check.mjs
// and the two-phone half is browser-two-phones.mjs.

import { liveSlice, mergeLog, replay, resolveUndos } from '../src/game/events.js';
import { INITIAL_STATE as BLANK, TEMPLATES } from '../src/data/league.js';
import { homePid } from '../src/game/logic.js';
import { SEEDED } from './fixtures-history.js';

const SEASON = SEEDED(BLANK);
const OUTCOMES = TEMPLATES.kickball.groups.flatMap((g) => g.outcomes);
const out = (k) => OUTCOMES.find((x) => x.k === k);

let fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    fail++;
    console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  } else console.log('ok   ' + label);
};
const is = (label, cond, detail) => {
  if (cond) console.log('ok   ' + label);
  else {
    fail++;
    console.log(`FAIL ${label}${detail ? '\n  ' + detail : ''}`);
  }
};

// A seeded PRNG, so a failure here is reproducible rather than a story about
// one unlucky run.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const START = {
  gameClientId: 'g-conc',
  sport: 'kickball',
  opponentId: 'rubber-chickens',
  trackMode: 'both',
  lineup: [0, 1, 2, 3, 4, 5, 6, 7],
  bench: [8, 9],
};

// =============================================================================
console.log('--- nothing is lost, and everyone converges --------------------');
// =============================================================================
//
// 300 random games. Two phones enter plays; the account accepts them in some
// interleaving that respects each phone's own order (which is what the write
// queue guarantees); at a random moment one phone is still holding some of its
// own. Three things must hold at every such moment.
{
  let dropped = 0;
  let duplicated = 0;
  let outOfOrder = 0;
  let diverged = 0;
  let orderMattered = 0;

  for (let scenario = 0; scenario < 300; scenario++) {
    const rand = rng(1000 + scenario);
    const pick = (list) => list[Math.floor(rand() * list.length)];

    const startEvent = { clientEventId: 'e-start', kind: 'start', payload: START, seq: null };
    const byDevice = { A: [], B: [] };
    for (let i = 0; i < 24; i++) {
      const device = rand() < 0.5 ? 'A' : 'B';
      byDevice[device].push({
        clientEventId: `${device}-${i}`,
        kind: 'outcome',
        payload: { o: pick(OUTCOMES) },
        seq: null,
      });
    }

    // The server's order: a random interleaving that keeps each phone's own
    // order, because a phone's queue sends strictly in order.
    const queues = { A: byDevice.A.slice(), B: byDevice.B.slice() };
    const serverOrder = [startEvent];
    while (queues.A.length || queues.B.length) {
      const from = !queues.A.length ? 'B' : !queues.B.length ? 'A' : rand() < 0.5 ? 'A' : 'B';
      serverOrder.push(queues[from].shift());
    }
    const accepted = serverOrder.map((e, i) => ({ ...e, seq: i + 1 }));

    // A moment mid-game: the account has a prefix, and phone B is still
    // holding everything of its own that is not in it.
    const cut = 1 + Math.floor(rand() * (accepted.length - 1));
    const knownToServer = accepted.slice(0, cut);
    const knownIds = new Set(knownToServer.map((e) => e.clientEventId));
    const heldByB = byDevice.B.filter((e) => !knownIds.has(e.clientEventId));

    // B's own log is B's own entries, in the order B entered them. It joined a
    // game A had already started, so the start event is only ever the
    // account's.
    const viewOfB = mergeLog(knownToServer, byDevice.B);

    // 1. Nothing is lost: every play B entered is in B's view.
    for (const e of byDevice.B) {
      if (!viewOfB.some((x) => x.clientEventId === e.clientEventId)) dropped++;
    }
    // 2. Nothing is counted twice.
    if (new Set(viewOfB.map((e) => e.clientEventId)).size !== viewOfB.length) duplicated++;
    // 3. What the account has already accepted keeps the account's order.
    const prefix = viewOfB.slice(0, knownToServer.length).map((e) => e.clientEventId);
    if (JSON.stringify(prefix) !== JSON.stringify(knownToServer.map((e) => e.clientEventId))) outOfOrder++;

    // 4. Once everything is accepted, both phones fold to the same game.
    const finalA = liveSlice(replay(SEASON, mergeLog(accepted, [startEvent, ...byDevice.A])));
    const finalB = liveSlice(replay(SEASON, mergeLog(accepted, byDevice.B)));
    if (JSON.stringify(finalA) !== JSON.stringify(finalB)) diverged++;

    // 5. And the order is load-bearing: B's provisional view, with its own
    //    plays on the end, is often NOT the game the server's order produces.
    //    If this never happened the properties above would be vacuous.
    if (heldByB.length) {
      const provisional = liveSlice(replay(SEASON, viewOfB));
      if (JSON.stringify(provisional) !== JSON.stringify(finalB)) orderMattered++;
    }
  }

  eq('no play entered on either phone is ever dropped', dropped, 0);
  eq('and none is folded twice', duplicated, 0);
  eq('what the account accepted keeps the account\'s order', outOfOrder, 0);
  eq('both phones land on the same game once everything is accepted', diverged, 0);
  is('and the order genuinely decides the game, so the checks above mean something',
    orderMattered > 30, `only ${orderMattered} of 300 scenarios changed when the order settled`);
}

// =============================================================================
console.log('\n--- the server\'s order wins, not the phone\'s -------------------');
// =============================================================================
//
// The concrete case. Phone B, with no signal, scores two singles. Phone A
// scores a home run. B's own screen says three runs — two runners on, then...
// no: B has not seen the home run at all. When B reconnects, its singles land
// AFTER the home run, and the same four plays produce a different score.
{
  const start = { clientEventId: 'e0', kind: 'start', payload: START, seq: 1 };
  const single = (id) => ({ clientEventId: id, kind: 'outcome', payload: { o: out('1B') }, seq: null });
  const homer = (id) => ({ clientEventId: id, kind: 'outcome', payload: { o: out('HR') }, seq: null });

  const bOffline = [start, single('b1'), single('b2')];
  const whatBSaw = replay(SEASON, bOffline);
  eq('B, with no signal, has two runners on and nobody home', whatBSaw.score, { home: 0, away: 0 });

  // A's home run went up while B was away.
  const accepted = [start, { ...homer('a1'), seq: 2 }];
  const whatASaw = replay(SEASON, accepted);
  eq('A has a run on the board', whatASaw.score, { home: 0, away: 1 });

  // B reconnects. Its two singles are appended after A's home run.
  const converged = [...accepted, { ...single('b1'), seq: 3 }, { ...single('b2'), seq: 4 }];
  const after = replay(SEASON, converged);
  eq('after the order settles, one run and two runners on', after.score, { home: 0, away: 1 });
  eq('and both phones fold the identical list', liveSlice(replay(SEASON, mergeLog(converged, bOffline))), liveSlice(after));

  // Had B's singles landed first it would be a different game. That is why
  // there is exactly one order and it belongs to the server.
  const otherWay = replay(SEASON, [start, single('b1'), single('b2'), homer('a1')]);
  eq('the other order would have been three runs, not one', otherWay.score, { home: 0, away: 3 });
}

// =============================================================================
console.log('\n--- two people entering the same play: accepted, not detected --');
// =============================================================================
//
// This is the cost of having no lease, and it is deliberate. Both scorers see
// the same home run and both tap it. The result is two home runs, because
// nothing here can tell that apart from two home runs.
{
  const start = { clientEventId: 'e0', kind: 'start', payload: START, seq: 1 };
  const byA = { clientEventId: 'a1', kind: 'outcome', payload: { o: out('HR') }, seq: 2, actor: 'A' };
  const byB = { clientEventId: 'b1', kind: 'outcome', payload: { o: out('HR') }, seq: 3, actor: 'B' };

  const both = replay(SEASON, [start, byA, byB]);
  eq('the same play entered twice counts twice', both.score, { home: 0, away: 2 });
  is('which is exactly what two real home runs would look like',
    JSON.stringify(both.score) === JSON.stringify(replay(SEASON, [start, byA, { ...byB, actor: 'A' }]).score),
    'the log cannot distinguish a double entry from two real plays');

  // The mitigation is not detection, it is that both scorers can SEE it and
  // either of them can take it back.
  const fixed = replay(SEASON, [start, byA, byB, { clientEventId: 'u1', kind: 'undo', payload: { target: 'b1' }, seq: 4, actor: 'A' }]);
  eq('and one of them can be taken back, by whoever notices', fixed.score, { home: 0, away: 1 });
  eq('the log still holds all four facts', resolveUndos([start, byA, byB, { clientEventId: 'u1', kind: 'undo', payload: {}, seq: 4 }]).length, 4);
}

// =============================================================================
console.log('\n--- undo reaches the other phone\'s play ------------------------');
// =============================================================================
{
  const start = { clientEventId: 'e0', kind: 'start', payload: START, seq: 1 };
  const byB = { clientEventId: 'b1', kind: 'outcome', payload: { o: out('HR') }, seq: 2, actor: 'B' };
  const undoByA = { clientEventId: 'u1', kind: 'undo', payload: { target: 'b1' }, seq: 3, actor: 'A' };

  eq('A can take back a play B entered', replay(SEASON, [start, byB, undoByA]).score, { home: 0, away: 0 });

  // And doing it twice does not walk backwards through the innings.
  const withStrikeouts = [
    start,
    { clientEventId: 'k1', kind: 'outcome', payload: { o: out('K') }, seq: 2, actor: 'A' },
    { ...byB, seq: 3 },
    { ...undoByA, seq: 4 },
    { clientEventId: 'u2', kind: 'undo', payload: { target: 'b1' }, seq: 5, actor: 'B' },
  ];
  const s = replay(SEASON, withStrikeouts);
  eq('a second undo of the SAME play changes nothing further', s.score, { home: 0, away: 0 });
  eq('and does not reach back past it', s.outs, 1);
}

// =============================================================================
console.log('\n--- a lineup change from one phone reaches the other -----------');
// =============================================================================
//
// Not cosmetic: the batting order decides who is up, and therefore whose stat
// line a play is written to. Two phones disagreeing about it would file plays
// against the wrong players.
{
  const start = { clientEventId: 'e0', kind: 'start', payload: START, seq: 1 };
  const toOurHalf = ['k1', 'k2', 'k3'].map((id, i) => ({
    clientEventId: id, kind: 'outcome', payload: { o: out('K') }, seq: i + 2,
  }));
  const swap = { clientEventId: 'l1', kind: 'lineup_move', payload: { idx: 0, dir: 1 }, seq: 5, actor: 'B' };
  const hit = { clientEventId: 'h1', kind: 'outcome', payload: { o: out('HR') }, seq: 6, actor: 'A' };

  const withSwap = replay(SEASON, [start, ...toOurHalf, swap, hit]);
  const without = replay(SEASON, [start, ...toOurHalf, hit]);

  eq('B\'s batting-order change decides who A\'s home run belongs to',
    [withSwap.gameStats[homePid(1)].hr, without.gameStats[homePid(0)].hr], [1, 1]);
  is('and the two are genuinely different players',
    without.gameStats[homePid(1)] === undefined && withSwap.gameStats[homePid(0)] === undefined);
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
