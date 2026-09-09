import { applyOutcome, applyQuick, applyRunnerAction, applyUndo, obpString, ordinal, currentKicker, homePid, awayPid, playerName, playerById, statLine } from '../src/game/logic.js';
import { INITIAL_STATE as BLANK, TEMPLATES } from '../src/data/league.js';
import { SEEDED } from './fixtures-history.js';
const INITIAL_STATE = SEEDED(BLANK);

const out = (o) => TEMPLATES.kickball.groups.flatMap(g => g.outcomes).find(x => x.k === o);
let fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}`);
};

// Start a game in the bottom half so our roster is kicking.
let s = { ...INITIAL_STATE, gameActive: true, half: 'bot' };

// Bases loaded via three singles.
s = applyOutcome(s, out('1B'));
s = applyOutcome(s, out('1B'));
s = applyOutcome(s, out('1B'));
// Lineup order is Ortiz, Wallace, Shah, Bennett, Fuentes, Lee...
eq('3 singles load the bases', s.bases.map(b => playerName(s, b)), ['Priya Shah', 'Deon Wallace', 'Maya Ortiz']);
eq('bases hold ids, not names', s.bases, [homePid(2), homePid(1), homePid(0)]);
eq('no runs yet', s.score, { home: 0, away: 0 });

// Grand slam.
s = applyOutcome(s, out('HR'));
eq('HR clears the bases', s.bases, [null, null, null]);
eq('grand slam = 4 runs', s.score.home, 4);
eq('HR hitter credited 4 RBI', s.gameStats[homePid(3)].rbi, 4);
eq('runner credited a run', s.gameStats[homePid(0)].r, 1);

// Walk with bases empty.
s = applyOutcome(s, out('BB'));
eq('walk puts runner on 1st', playerName(s, s.bases[0]), 'Ana Fuentes');
eq('walk is not an at-bat', s.gameStats[homePid(4)], { ab: 0, h: 0, r: 0, rbi: 0, bb: 1, k: 0, d: 0, t: 0, hr: 0 });

// Reached on error: a hit for bases, but no H and no RBI.
let e = applyOutcome({ ...s, bases: [null, null, null] }, out('E'));
eq('error charges an AB but no hit', [e.gameStats[homePid(5)].ab, e.gameStats[homePid(5)].h], [1, 0]);

// Force out with a runner on first.
let f = applyOutcome({ ...s }, out('FO'));
eq('force out swaps the runner at 1st', playerName(f, f.bases[0]), 'Jordan Lee');
eq('force out records an out', f.outs, 1);

// Three outs retires the side and flips the half.
let t = { ...INITIAL_STATE, gameActive: true, half: 'bot', inning: 3 };
t = applyOutcome(t, out('K'));
t = applyOutcome(t, out('K'));
t = applyOutcome(t, out('K'));
eq('3 outs resets outs', t.outs, 0);
eq('3 outs clears bases', t.bases, [null, null, null]);
eq('bottom -> top flips and advances inning', [t.half, t.inning], ['top', 4]);
eq('tape marks the half with a slash', t.tape.at(-1), '/');
eq('detail says side retired', t.lastPlay.detail.endsWith('· 3 outs, side retired'), true);

// End of the 7th asks to finalize.
let g = { ...INITIAL_STATE, gameActive: true, half: 'bot', inning: 7, outs: 2 };
g = applyOutcome(g, out('K'));
eq('7th inning triggers finalize prompt', g.confirmFinal, true);
eq('stays in the 7th', [g.inning, g.half], [7, 'bot']);
eq('final message', g.lastPlay.detail, 'End of the 7th — game over');

// Runner advance / out on the bases.
const A = homePid(0), B = homePid(1);
let r = { ...INITIAL_STATE, gameActive: true, half: 'bot', bases: [A, null, null], selRunner: 0 };
let adv = applyRunnerAction(r, true);
eq('advance moves 1st -> 2nd', adv.bases, [null, A, null]);
let r3 = applyRunnerAction({ ...r, bases: [null, null, A], selRunner: 2 }, true);
eq('advance from 3rd scores', r3.score.home, 1);
let ro = applyRunnerAction(r, false);
eq('runner out increments outs', ro.outs, 1);
let rb = applyRunnerAction({ ...r, bases: [null, A, null], selRunner: 1 }, 'back');
eq('back moves 2nd -> 1st', rb.bases, [A, null, null]);
let blocked = applyRunnerAction({ ...r, bases: [B, A, null], selRunner: 1 }, 'back');
eq('back is blocked when 1st is occupied', blocked.bases, [B, A, null]);

// Runner out for the third out should NOT push a slash (differs from a PA).
let ro3 = applyRunnerAction({ ...r, outs: 2 }, false);
eq('runner 3rd out does not mark tape', ro3.tape, []);
eq('runner 3rd out suffix', ro3.lastPlay.detail, 'Maya Ortiz out on the bases · side retired');

// Undo restores the previous play state.
let u = { ...INITIAL_STATE, gameActive: true, half: 'bot' };
u = applyOutcome(u, out('2B'));
const beforeHR = JSON.parse(JSON.stringify({ bases: u.bases, score: u.score }));
u = applyOutcome(u, out('HR'));
u = applyUndo(u);
eq('undo restores bases', u.bases, beforeHR.bases);
eq('undo restores score', u.score, beforeHR.score);
eq('undo pops the stack', u.undoStack.length, 1);

// Quick opponent scoring.
let q = { ...INITIAL_STATE, gameActive: true, trackMode: 'ours', half: 'top' };
q = applyQuick(q, true);
eq('quick run bumps away score', q.score.away, 1);
q = applyQuick(q, false);
q = applyQuick(q, false);
q = applyQuick(q, false);
eq('3 quick outs flip to our half', [q.half, q.outs], ['bot', 0]);

// Opponent PAs are not written to the book when tracking our team only.
let o = applyOutcome({ ...INITIAL_STATE, gameActive: true, trackMode: 'ours', half: 'top' }, out('1B'));
eq('opponent PA not booked in ours-only mode', o.events.length, 0);
let ob = applyOutcome({ ...INITIAL_STATE, gameActive: true, trackMode: 'both', half: 'top' }, out('1B'));
eq('opponent PA booked when tracking both', ob.events.length, 1);

// Sac fly scores from third only with fewer than 3 outs.
const sf = TEMPLATES.softball.groups.flatMap(g => g.outcomes).find(x => x.k === 'SF');
let sac = applyOutcome({ ...INITIAL_STATE, sport: 'softball', gameActive: true, half: 'bot', bases: [null, null, homePid(0)], outs: 1 }, sf);
eq('sac fly scores the runner', sac.score.home, 1);
let sac3 = applyOutcome({ ...INITIAL_STATE, sport: 'softball', gameActive: true, half: 'bot', bases: [null, null, homePid(0)], outs: 2 }, sf);
eq('sac fly on the 3rd out scores nothing', sac3.score.home, 0);

// Identity: home and away namespaces must not collide, and duplicate names
// must not share a stat line.
eq('home/away ids are distinct', homePid(0) === awayPid(0), false);
eq('away PA keyed by slot', applyOutcome({ ...INITIAL_STATE, gameActive: true, trackMode: 'both', half: 'top' }, out('1B')).gameStats[awayPid(0)].h, 1);
eq('events carry pid not name', ob.events[0].pid, awayPid(0));
eq('playerById is id-based, not index-based', playerById(INITIAL_STATE, 7).name, 'Tess Nakamura');
eq('unknown pid reads as empty line', statLine({}, homePid(99)), { ab: 0, h: 0, r: 0, rbi: 0, bb: 0, k: 0, d: 0, t: 0, hr: 0 });

// Helpers.
eq('obp with no PAs', obpString({ ab: 0, h: 0, bb: 0 }), '—');
eq('obp rounds to 3 places', obpString({ ab: 3, h: 1, bb: 1 }), '.500');
eq('perfect obp reads 1.000', obpString({ ab: 1, h: 1, bb: 0 }), '1.000');
eq('walk-only obp reads 1.000', obpString({ ab: 0, h: 0, bb: 1 }), '1.000');
eq('obp pads to 3 places', obpString({ ab: 20, h: 1, bb: 0 }), '.050');
eq('ordinal 1', ordinal(1), '1st inning');
eq('ordinal 7', ordinal(7), '7th inning');
eq('inactive game ignores outcomes', applyOutcome(INITIAL_STATE, out('1B')), INITIAL_STATE);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
