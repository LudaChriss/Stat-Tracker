const B = new URL('../src', import.meta.url).pathname;
const { applyOutcome, buildGameRecord, homePid } = await import(`${B}/game/logic.js`);
const { seasonTotals, teamSeason, fmtRate, totalBases, addLines, normalizeLine, onBaseByGame } = await import(`${B}/game/stats.js`);
const { INITIAL_STATE: BLANK, TEMPLATES } = await import(`${B}/data/league.js`);
const { SEEDED } = await import('./fixtures-history.js');
const INITIAL_STATE = SEEDED(BLANK);

let fail = 0;
const eq = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`FAIL ${l}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log('ok   ' + l);
};
const kb = k => TEMPLATES.kickball.groups.flatMap(g => g.outcomes).find(x => x.k === k);

// Play a game and finalize it; the season line must move.
function playAndFinalize(history, outcomes, opponentId, date) {
  let s = { ...INITIAL_STATE, history, gameActive: true, half: 'bot', opponentId };
  outcomes.forEach(k => { s = applyOutcome(s, kb(k)); });
  return [...history, buildGameRecord(s, { date: new Date(date) })];
}

const P = homePid(0); // Maya Ortiz bats first

eq('no games -> no stats', seasonTotals([], P).avg, '—');
eq('no games -> zero GP', seasonTotals([], P).gp, 0);

// Game 1: Maya singles (1-for-1).
let h = playAndFinalize([], ['1B'], 'dirt-merchants', '2026-09-01');
eq('after 1 game', [seasonTotals(h, P).ab, seasonTotals(h, P).h, seasonTotals(h, P).avg], [1, 1, '1.000']);
eq('games played is 1', seasonTotals(h, P).gp, 1);

// Game 2: Maya strikes out (now 1-for-2).
h = playAndFinalize(h, ['K'], 'the-ringers', '2026-09-08');
eq('season ACCRUES across games', [seasonTotals(h, P).ab, seasonTotals(h, P).h, seasonTotals(h, P).avg], [2, 1, '.500']);
eq('games played is 2', seasonTotals(h, P).gp, 2);
eq('strikeout accrued', seasonTotals(h, P).k, 1);

// Game 3: Maya homers (2-for-3, 5 TB).
h = playAndFinalize(h, ['HR'], 'sunday-scaries', '2026-09-15');
const t = seasonTotals(h, P);
eq('three games', [t.gp, t.ab, t.h, t.hr], [3, 3, 2, 1]);
eq('total bases = 1 + 4', t.tb, 5);
eq('AVG 2/3', t.avg, '.667');
eq('SLG 5/3 exceeds 1.000', t.slg, '1.667');
eq('OPS = OBP + SLG', t.ops, '2.333');
eq('runs accrued', t.r, 1);

// A walk raises OBP but not AVG.
h = playAndFinalize(h, ['BB'], 'rubber-chickens', '2026-09-22');
const w = seasonTotals(h, P);
eq('walk leaves AB alone', w.ab, 3);
eq('walk raises OBP', w.obp, '.750');
eq('walk leaves AVG alone', w.avg, '.667');

// Team totals track the same history.
const team = teamSeason(h);
eq('team games played', team.gp, 4);
eq('team runs per game', team.runsPerGame, 0.25);  // 1 run scored across 4 one-batter games
eq('per-game on-base series length', onBaseByGame(h, P).length, 4);

// Pure helpers.
eq('total bases of a clean single', totalBases({ h: 1, d: 0, t: 0, hr: 0 }), 1);
eq('total bases of a triple', totalBases({ h: 1, d: 0, t: 1, hr: 0 }), 3);
eq('total bases mixed', totalBases({ h: 4, d: 1, t: 1, hr: 1 }), 1 + 2 + 3 + 4);
eq('normalize fills missing fields', normalizeLine({ ab: 1 }).hr, 0);
eq('addLines sums counting stats', addLines({ ab: 1, h: 1 }, { ab: 2, h: 0 }).ab, 3);
eq('fmtRate handles above 1', fmtRate(1.6667), '1.667');
eq('fmtRate handles null', fmtRate(null), '—');

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
