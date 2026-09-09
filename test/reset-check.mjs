const B = new URL('../src', import.meta.url).pathname;
const { buildExport, exportFilename, EXPORT_VERSION } = await import(`${B}/game/export.js`);
const { applyOutcome, currentKicker, awayLineup } = await import(`${B}/game/logic.js`);
const { tallyStandings } = await import(`${B}/game/standings.js`);
const { seasonTotals, teamSeason } = await import(`${B}/game/stats.js`);
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

// --- export ---
const dump = buildExport(INITIAL_STATE);
eq('export is tagged', [dump.app, dump.exportVersion], ['rec-league-stat-tracker', EXPORT_VERSION]);
eq('export carries the season', [dump.roster.length, dump.teams.length, dump.history.length], [10, 4, 4]);
eq('export omits live game state', ['gameStats','events','undoStack','bases'].filter(k => k in dump), []);
eq('export is JSON round-trippable', JSON.parse(JSON.stringify(dump)).history[3].lines.length, dump.history[3].lines.length);
eq('filename is slugged and dated', exportFilename(INITIAL_STATE, new Date('2026-09-09')), 'grass-stains-2026-09-09.json');
eq('filename copes with an odd team name', exportFilename({ myTeam: { name: "Mike's Bar & Grill" } }, new Date('2026-01-02')), 'mike-s-bar-grill-2026-01-02.json');
eq('filename copes with an empty name', exportFilename({ myTeam: { name: '' } }, new Date('2026-01-02')), 'season-2026-01-02.json');

// --- the blank season a reset produces ---
const blank = {
  ...INITIAL_STATE,
  myTeam: { name: 'Sunday Sluggers', priorW: 0, priorL: 0 },
  roster: [], teams: [], lineup: [], bench: [], history: [],
  opponentId: null, gameStats: {}, events: [], undoStack: [], tape: [],
  gameActive: false, gameFinal: false,
};
eq('no players', blank.roster.length, 0);
eq('no teams', blank.teams.length, 0);
eq('no games', blank.history.length, 0);
eq('standings show only my team', tallyStandings(blank).map(r => [r.name, r.w, r.l, r.gp]), [['Sunday Sluggers', 0, 0, 0]]);
eq('team season is empty', [teamSeason([]).gp, teamSeason([]).avg], [0, '—']);
eq('player season is empty', seasonTotals([], 'h0').avg, '—');

// --- the crash paths an empty roster used to open ---
eq('no batter with an empty order', currentKicker({ ...blank, half: 'bot' }).pid, null);
eq('empty order reports a placeholder name', currentKicker({ ...blank, half: 'bot' }).name, '—');
eq('away lineup still resolves with no opponent', awayLineup(blank).length, 9);
const live = { ...blank, gameActive: true, half: 'bot' };
eq('recording with nobody up is a no-op', applyOutcome(live, kb('1B')), live);
eq('no-op leaves the score alone', applyOutcome(live, kb('HR')).score, { home: 0, away: 0 });
eq('exporting a blank season works', buildExport(blank).history.length, 0);

// --- rebuilding from a fresh start ---
let s = { ...blank,
  roster: [{ id: 0, name: 'Real Player', num: 1, pos: 'P', c: '#000' }],
  teams: [{ id: 'rivals', name: 'Rivals', priorW: 0, priorL: 0, players: [] }],
  lineup: [0], opponentId: 'rivals', gameActive: true, half: 'bot' };
eq('batter resolves once a player exists', currentKicker(s).name, 'Real Player');
s = applyOutcome(s, kb('HR'));
eq('scoring works from a blank start', s.score.home, 1);
eq('stats key to the new player', s.gameStats['h0'].hr, 1);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
