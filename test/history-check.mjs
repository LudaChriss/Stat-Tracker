const B = new URL('../src', import.meta.url).pathname;
const { applyOutcome, buildGameRecord, homePid, awayPid } = await import(`${B}/game/logic.js`);
const { tallyStandings, winPct } = await import(`${B}/game/standings.js`);
const { INITIAL_STATE: BLANK, TEMPLATES } = await import(`${B}/data/league.js`);
const { SEEDED, HOME_TEAM } = await import('./fixtures-history.js');
const INITIAL_STATE = SEEDED(BLANK);
const { SEED_HISTORY } = await import(`./fixtures-history.js`);

let fail = 0;
const eq = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`FAIL ${l}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log('ok   ' + l);
};
const out = k => TEMPLATES.kickball.groups.flatMap(g => g.outcomes).find(x => x.k === k);
const st = (h) => ({ ...INITIAL_STATE, history: h });
const row = (h, name) => tallyStandings(st(h)).find(r => r.name === name);

// Seeded season reproduces the design's opening table.
eq('seeded GS record', [row(SEED_HISTORY, HOME_TEAM).w, row(SEED_HISTORY, HOME_TEAM).l], [7, 2]);
eq('seeded games played', row(SEED_HISTORY, HOME_TEAM).gp, 9);
eq('opponent we beat took a loss', [row(SEED_HISTORY,'Dirt Merchants').w, row(SEED_HISTORY,'Dirt Merchants').l], [5, 4]);
eq('opponent that beat us took a win', [row(SEED_HISTORY,'The Ringers').w, row(SEED_HISTORY,'The Ringers').l], [2, 7]);

// Standings ACCUMULATE — the original bug was that they did not.
const slug = n => n.toLowerCase().replace(/[^a-z0-9]+/g,'-');
const win = (opp) => ({ id: 'x'+opp, opponentId: slug(opp), opponent: opp, result: 'W', score: { us: 5, them: 1 }, home: true, label: 'Sep 1', date: '2026-09-01', lines: [] });
let h = [...SEED_HISTORY, win('Rubber Chickens')];
eq('one more win', [row(h, HOME_TEAM).w, row(h, HOME_TEAM).l], [8, 2]);
h = [...h, win('Dirt Merchants')];
eq('two more wins accumulate', [row(h, HOME_TEAM).w, row(h, HOME_TEAM).l], [9, 2]);
// RC and DM each already lost to us once in the seeded season, so these are
// their second losses.
eq('both opponents took a loss', [row(h,'Rubber Chickens').l, row(h,'Dirt Merchants').l], [4, 5]);
eq('games played grew by two', row(h, HOME_TEAM).gp, 11);

// Ties.
const tie = { id: 't', opponentId: 'the-ringers', opponent: 'The Ringers', result: 'T', score: { us: 4, them: 4 }, home: true, label: 'Sep 2', date: '2026-09-02', lines: [] };
const ht = [...SEED_HISTORY, tie];
eq('tie is neither W nor L', [row(ht, HOME_TEAM).w, row(ht, HOME_TEAM).l, row(ht, HOME_TEAM).t], [7, 2, 1]);
eq('tie counts as half a win', winPct(row(ht, HOME_TEAM)).toFixed(3), '0.750');

// Unknown opponent must not corrupt the table.
const bogus = [...SEED_HISTORY, { ...win('Not A Real Team') }];
eq('unknown opponent ignored for them', tallyStandings(st(bogus)).length, 5);
eq('but still counts for us', row(bogus, HOME_TEAM).w, 8);

// Record building from a played game.
let s = { ...INITIAL_STATE, gameActive: true, half: 'bot', opponentId: 'sunday-scaries', score: { home: 0, away: 0 } };
s = applyOutcome(s, out('1B'));
s = applyOutcome(s, out('HR'));
const rec = buildGameRecord(s, { date: new Date('2026-09-05T18:30:00Z') });
eq('record label', rec.label, 'Sep 5');
eq('record opponent', rec.opponent, 'Sunday Scaries');
eq('record score', rec.score, { us: 2, them: 0 });
eq('record result', rec.result, 'W');
eq('box score covers the lineup', rec.lines.filter(l => l.team === 'home').length, 8);
eq('box score keeps the HR line', rec.lines.find(l => l.pid === homePid(1)), { pid: 'h1', name: 'Deon Wallace', team: 'home', ab: 1, h: 1, r: 1, rbi: 2, bb: 0, k: 0, d: 0, t: 0, hr: 1 });
eq('names captured in the record', rec.lines[0].name, 'Maya Ortiz');
eq('untracked opponent lines omitted', rec.lines.filter(l => l.team === 'away').length, 0);

// Level game is a tie, not a win (the design treated >= as a win).
const level = buildGameRecord({ ...s, score: { home: 3, away: 3 } }, { date: new Date('2026-09-05') });
eq('level game is a tie', level.result, 'T');

// Opponent stats are recorded when tracking both teams.
let both = { ...INITIAL_STATE, gameActive: true, trackMode: 'both', half: 'top', opponentId: 'the-ringers' };
both = applyOutcome(both, out('1B'));
const recBoth = buildGameRecord(both, { date: new Date('2026-09-05') });
eq('opponent box score present', recBoth.lines.filter(l => l.team === 'away').length, 1);
eq('anonymous opponent line keyed by slot', recBoth.lines.find(l => l.team === 'away').pid, awayPid(0));

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
