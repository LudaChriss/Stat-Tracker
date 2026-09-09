const B = new URL('../src', import.meta.url).pathname;
const { applyOutcome, currentKicker } = await import(`${B}/game/logic.js`);
const { tallyStandings, winPct } = await import(`${B}/game/standings.js`);
const { deriveView } = await import(`${B}/game/derive.js`);
const { buildExport } = await import(`${B}/game/export.js`);
const { parseSeasonFile, applySeason } = await import(`${B}/game/importSeason.js`);
const { migrateState } = await import(`${B}/game/storage.js`);
const { INITIAL_STATE: BLANK, TEMPLATES } = await import(`${B}/data/league.js`);
const { SEEDED } = await import('./fixtures-history.js');

const seeded = SEEDED(BLANK);
let fail = 0;
const eq = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`FAIL ${l}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log('ok   ' + l);
};
const A = new Proxy({}, { get: () => (...a) => () => {} });
const view = (s) => deriveView(s, A);

// Mirror the reducer in useGame.benchPlayer.
function bench(s, id) {
  if (s.lineup.length <= 1 || !s.lineup.includes(id)) return { ...s, posMenu: null };
  return {
    ...s,
    lineup: s.lineup.filter((x) => x !== id),
    bench: s.bench.includes(id) ? s.bench : [...s.bench, id],
    posMenu: null,
  };
}

// ---------- 1. Removing a player from the batting order ----------
let s = { ...seeded, lineup: [0, 1, 2, 3], bench: [8, 9] };
eq('starting order', [s.lineup, s.bench], [[0, 1, 2, 3], [8, 9]]);

s = bench(s, 2);
eq('benched player leaves the order', s.lineup, [0, 1, 3]);
eq('benched player joins the bench', s.bench, [8, 9, 2]);
eq('sheet closes on bench', s.posMenu, null);

// Re-adding is the existing bench "+" path.
const readd = { ...s, lineup: [...s.lineup, 2], bench: s.bench.filter((b) => b !== 2) };
eq('can be added back', [readd.lineup, readd.bench], [[0, 1, 3, 2], [8, 9]]);

// Guard: never empty the order.
let one = { ...seeded, lineup: [5], bench: [] };
eq('last player cannot be benched', bench(one, 5).lineup, [5]);
eq('view disables the control', view(one).posMenuCanBench, false);
eq('view enables it with two', view({ ...seeded, lineup: [5, 6], posMenu: 5 }).posMenuCanBench, true);

// Benching someone off the bench is a no-op, not a corruption.
eq('benching a non-member is inert', bench(s, 99).lineup, [0, 1, 3]);

// Mid-game benching keeps the engine consistent.
let live = { ...seeded, gameActive: true, half: 'bot', lineup: [0, 1, 2, 3] };
live = applyOutcome(live, TEMPLATES.kickball.groups[0].outcomes[0]); // Ortiz singles
eq('second batter is up', currentKicker(live).name, 'Deon Wallace');
const after = bench(live, 1);
eq('order shrinks mid-game', after.lineup, [0, 2, 3]);
eq('a valid batter is still up', ['Priya Shah', 'Cole Bennett', 'Maya Ortiz'].includes(currentKicker(after).name), true);
eq('their recorded stats survive benching', after.gameStats['h0'].h, 1);

// Sheet labelling.
const sheet = view({ ...seeded, lineup: [0, 1, 2], posMenu: 1 });
eq('sheet shows the slot', sheet.posMenuSlot, 'Batting 2 of 3');
eq('sheet knows they are in the order', sheet.posMenuInLineup, true);
const benched = view({ ...seeded, lineup: [0, 1], bench: [8], posMenu: 8 });
eq('bench member shows as benched', benched.posMenuSlot, 'On the bench');
eq('no bench control for someone already benched', benched.posMenuInLineup, false);

// ---------- 2. Manual record offset ----------
const noManual = { ...seeded, myTeam: { name: 'Grass Stains', priorW: 0, priorL: 0, priorT: 0 } };
eq('record with no offset is purely tracked', tallyStandings(noManual).find((t) => t.you).w, 3);
eq('view reports tracked only', view(noManual).recordBreakdown, '4 tracked games');
eq('no manual flag', view(noManual).hasManualRecord, false);

const withManual = { ...seeded, myTeam: { name: 'Grass Stains', priorW: 4, priorL: 1, priorT: 0 } };
const row = tallyStandings(withManual).find((t) => t.you);
eq('offset adds to the standings', [row.w, row.l, row.gp], [7, 2, 9]);
eq('view separates the two halves', view(withManual).recordBreakdown,
   '3–1 from 4 tracked games · 4–1 entered manually');
eq('tracked half', view(withManual).trackedRecord, '3–1');
eq('manual half', view(withManual).manualRecord, '4–1');
eq('total', view(withManual).totalRecord, '7–2');
eq('manual flag set', view(withManual).hasManualRecord, true);
eq('manual game count', view(withManual).manualGames, 5);

// Ties.
const tied = { ...seeded, myTeam: { name: 'GS', priorW: 1, priorL: 1, priorT: 2 } };
const tr = tallyStandings(tied).find((t) => t.you);
eq('manual ties count toward games played', tr.gp, 8);
eq('manual ties are half a win', winPct(tr).toFixed(3), '0.625');
eq('tie shows in the record string', view(tied).manualRecord, '1–1–2');

// The offset must not invent history or box scores.
eq('manual games add no history', withManual.history.length, 4);
eq('manual games add no game rows', view(withManual).teamGames.filter((g) => g.key !== 'next').length, 4);
eq('season stats ignore the offset',
   view(withManual).rosterView[0].s1, view(noManual).rosterView[0].s1);

// It survives export/import and a storage migration.
const round = parseSeasonFile(JSON.stringify(buildExport(withManual)));
eq('offset exports', round.season.myTeam.priorW, 4);
eq('offset imports', applySeason(BLANK, round.season).myTeam.priorL, 1);
eq('offset survives migration', migrateState({ version: 1, state: withManual }, BLANK).myTeam.priorW, 4);
eq('missing priorT defaults to 0',
   migrateState({ version: 1, state: { ...seeded, myTeam: { name: 'X', priorW: 2, priorL: 0 } } }, BLANK).myTeam.priorT, 0);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
