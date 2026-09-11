// The check that stops a box score being written when it disagrees with the
// plays it is supposed to come from.
//
// The failure it exists for: two phones, and a play entered on the other one
// between this phone working out the box score and writing it. The run is in
// the log and missing from the box score, and without this nobody would ever
// be told — the season would simply be one run light.
//
// It has to name what differs, not just that something does. "The upload did
// not match" is a dead end for whoever reads it; "Casey Rivera: R 1 here, 2 in
// the plays" is something a person can act on.

import { reconcileBoxScore } from '../src/game/reconcile.js';
import { buildGameRecord } from '../src/game/logic.js';
import { replay } from '../src/game/events.js';
import { INITIAL_STATE as BLANK, TEMPLATES } from '../src/data/league.js';
import { SEEDED } from './fixtures-history.js';

const SEASON = SEEDED(BLANK);
const out = (k) => TEMPLATES.kickball.groups.flatMap((g) => g.outcomes).find((x) => x.k === k);

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

let n = 0;
const ev = (kind, payload = {}) => ({ clientEventId: `e${(n += 1)}`, kind, payload, seq: n });
const START = {
  gameClientId: 'g-rec',
  sport: 'kickball',
  opponentId: 'rubber-chickens',
  trackMode: 'both',
  lineup: [0, 1, 2, 3, 4, 5, 6, 7],
  bench: [8, 9],
};

const recordFor = (events) => {
  const state = replay(SEASON, events);
  return buildGameRecord({ ...state, gameStartedAt: 1789000000000 });
};

// Three strikeouts to reach our half, then some plays of our own.
const toOurHalf = [ev('start', START), ev('outcome', { o: out('K') }), ev('outcome', { o: out('K') }), ev('outcome', { o: out('K') })];
const ourPlays = [ev('outcome', { o: out('1B') }), ev('outcome', { o: out('HR') })];
const wholeGame = [...toOurHalf, ...ourPlays];

// ---------------------------------------------------------------------------
// The ordinary case: this phone has the whole log, so there is nothing to say.
// ---------------------------------------------------------------------------
{
  const mine = recordFor(wholeGame);
  const verdict = reconcileBoxScore(mine, recordFor(wholeGame));
  eq('a box score built from the whole log agrees with it', verdict, { ok: true, differences: [] });
}

// ---------------------------------------------------------------------------
// The case it exists for: the log has a play this phone had not seen.
// ---------------------------------------------------------------------------
{
  const behind = recordFor(wholeGame);
  const ahead = recordFor([...wholeGame, ev('outcome', { o: out('HR') })]);
  const verdict = reconcileBoxScore(behind, ahead);

  eq('a play this phone had not seen stops the write', verdict.ok, false);
  is('and the score it names is the one that differs',
    verdict.differences.some((d) => d.includes('2–0') && d.includes('3–0')),
    JSON.stringify(verdict.differences));
  is('and it names the player whose line moved',
    verdict.differences.some((d) => d.includes('HR')),
    JSON.stringify(verdict.differences));
}

// ---------------------------------------------------------------------------
// A run moving from one player to another: same score, same number of lines,
// different game. A count would not see this.
// ---------------------------------------------------------------------------
{
  const mine = recordFor(wholeGame);
  const moved = {
    ...mine,
    lines: mine.lines.map((l, i) =>
      i === 0 ? { ...l, r: (l.r || 0) + 1 } : i === 1 ? { ...l, r: Math.max(0, (l.r || 0) - 1) } : l,
    ),
  };
  const verdict = reconcileBoxScore(moved, mine);
  eq('a run credited to the wrong player is caught', verdict.ok, false);
  eq('and both players are named', verdict.differences.length, 2);
  is('with the figure that differs on each', verdict.differences.every((d) => d.includes('R ')));
}

// ---------------------------------------------------------------------------
// A result that flipped, and a line that exists on only one side.
// ---------------------------------------------------------------------------
{
  const mine = recordFor(wholeGame);
  const flipped = reconcileBoxScore({ ...mine, result: 'L' }, mine);
  eq('a flipped result is caught', flipped.ok, false);
  is('and says which is which', flipped.differences[0].includes('this phone says L'), flipped.differences[0]);

  const extra = reconcileBoxScore(
    { ...mine, lines: [...mine.lines, { pid: 'h99', name: 'Nobody', team: 'home', ab: 1, h: 1, r: 0, rbi: 0, bb: 0, k: 0, d: 0, t: 0, hr: 0 }] },
    mine,
  );
  is('a line with no plays behind it is caught',
    !extra.ok && extra.differences.some((d) => d.includes('Nobody')), JSON.stringify(extra.differences));

  const missing = reconcileBoxScore(mine, {
    ...mine,
    lines: [...mine.lines, { pid: 'h98', name: 'Unseen', team: 'home', ab: 1, h: 1, r: 0, rbi: 0, bb: 0, k: 0, d: 0, t: 0, hr: 0 }],
  });
  is('a player in the plays with no line here is caught',
    !missing.ok && missing.differences.some((d) => d.includes('Unseen')), JSON.stringify(missing.differences));
}

// ---------------------------------------------------------------------------
// Nothing to check against is not "it matched".
// ---------------------------------------------------------------------------
{
  const mine = recordFor(wholeGame);
  eq('an unplayable log refuses rather than passing', reconcileBoxScore(mine, null).ok, false);
  eq('and so does a missing box score', reconcileBoxScore(null, mine).ok, false);
}

// ---------------------------------------------------------------------------
// A long list is trimmed: a sheet nobody can read helps nobody.
// ---------------------------------------------------------------------------
{
  const mine = recordFor(wholeGame);
  const allWrong = { ...mine, lines: mine.lines.map((l) => ({ ...l, ab: (l.ab || 0) + 1 })) };
  const verdict = reconcileBoxScore(allWrong, mine);
  eq('a long list of differences is trimmed to something readable', verdict.differences.length <= 7, true);
  is('and says how many were left out',
    verdict.differences[verdict.differences.length - 1].includes('more'),
    JSON.stringify(verdict.differences));
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
