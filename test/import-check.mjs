const B = new URL('../src', import.meta.url).pathname;
const { parseSeasonFile, applySeason } = await import(`${B}/game/importSeason.js`);
const { migrateState, migrateGame } = await import(`${B}/game/storage.js`);
const { buildExport } = await import(`${B}/game/export.js`);
const { INITIAL_STATE: BLANK } = await import(`${B}/data/league.js`);
const { tallyStandings } = await import(`${B}/game/standings.js`);
const { seasonTotals } = await import(`${B}/game/stats.js`);
const { SEEDED } = await import('./fixtures-history.js');

const seeded = SEEDED(BLANK);
let fail = 0;
const eq = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`FAIL ${l}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log('ok   ' + l);
};

// --- round trip: export then import restores everything ---
const dump = JSON.stringify(buildExport(seeded));
const r = parseSeasonFile(dump);
eq('export file parses', r.ok, true);
eq('team name restored', r.summary.teamName, 'Grass Stains');
eq('counts restored', [r.summary.players, r.summary.teams, r.summary.games], [10, 4, 4]);

const restored = applySeason(BLANK, r.season);
eq('roster restored', restored.roster.length, 10);
eq('teams restored', restored.teams.length, 4);
eq('history restored', restored.history.length, 4);
eq('standings rebuild from imported history', tallyStandings(restored).find(t => t.you).w, 7);
eq('season stats rebuild', seasonTotals(restored.history, 'h0').avg, seasonTotals(seeded.history, 'h0').avg);
eq('batting order rebuilt', restored.lineup.length, 9);
eq('live game discarded on import', [restored.gameActive, restored.history === seeded.history], [false, false]);

// --- also accepts a raw storage payload (what the crash screen downloads) ---
const rawPayload = JSON.stringify({ version: 3, state: seeded });
const raw = parseSeasonFile(rawPayload);
eq('raw storage payload accepted', raw.ok, true);
eq('raw payload counts', [raw.summary.players, raw.summary.games], [10, 4]);
// ...and a bare state object
eq('bare state object accepted', parseSeasonFile(JSON.stringify(seeded)).ok, true);

// --- bad input is a message, never a crash ---
eq('not JSON', parseSeasonFile('hello').ok, false);
eq('not JSON message', parseSeasonFile('hello').error.includes('valid JSON'), true);
eq('unrelated JSON rejected', parseSeasonFile('{"foo":1}').ok, false);
eq('array rejected', parseSeasonFile('[1,2,3]').ok, false);
eq('null rejected', parseSeasonFile('null').ok, false);
eq('empty backup rejected', parseSeasonFile(JSON.stringify({ roster: [], teams: [], history: [] })).ok, false);
eq('partial file still loads', parseSeasonFile(JSON.stringify({ roster: [{ name: 'Solo' }] })).ok, true);
eq('partial file fills defaults', parseSeasonFile(JSON.stringify({ roster: [{ name: 'Solo' }] })).season.roster[0], { id: 0, name: 'Solo', num: null, pos: 'P', c: '#0E7490' });

// --- THE DEPLOY QUESTION: a version bump must not destroy a season ---
for (const v of [1, 2, 3, 99]) {
  const stored = { version: v, state: seeded };
  const out = migrateState(stored, BLANK);
  eq(`stored v${v} survives (roster)`, out.roster.length, 10);
  eq(`stored v${v} survives (games)`, out.history.length, 4);
}
eq('missing version survives', migrateState({ state: seeded }, BLANK).history.length, 4);
eq('bare state survives', migrateState(seeded, BLANK).history.length, 4);
eq('garbage migrates to null (preserved, not merged)', migrateState('nonsense', BLANK), null);
eq('array migrates to null', migrateState([1, 2], BLANK), null);

// --- older record shapes forward-migrate ---
const old = { id: 'g1', opponent: 'The Ringers', result: 'L', score: { us: 3, them: 5 }, label: 'Aug 23',
              lines: [{ pid: 'h0', name: 'Maya Ortiz', team: 'home', ab: 3, h: 1, r: 0, rbi: 1 }] };
const mg = migrateGame(old, seeded.teams);
eq('opponent name maps to team id', mg.opponentId, 'the-ringers');
eq('old line gains new stat fields', [mg.lines[0].hr, mg.lines[0].k, mg.lines[0].d], [0, 0, 0]);
eq('old line keeps its values', [mg.lines[0].ab, mg.lines[0].h], [3, 1]);
const legacy = migrateState({ version: 1, state: { ...seeded, history: [old] } }, BLANK);
eq('legacy history counts in standings', tallyStandings(legacy).find(t => t.name === 'The Ringers').w, 2);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
