// Exercise storage.js against a stub localStorage, including the failure modes.
let store = {};
let mode = 'ok';
globalThis.localStorage = {
  getItem(k) { if (mode === 'throw-read') throw new Error('SecurityError'); return k in store ? store[k] : null; },
  setItem(k, v) { if (mode === 'quota') throw new Error('QuotaExceededError'); store[k] = v; },
  removeItem(k) { delete store[k]; },
};

const { loadState, saveState } = await import('../src/game/storage.js');
const { INITIAL_STATE } = await import('../src/data/league.js');

let fail = 0;
const eq = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`FAIL ${l}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log('ok   ' + l);
};

eq('empty storage falls back', loadState(INITIAL_STATE), INITIAL_STATE);

// Round trip a finalized game.
const finished = { ...INITIAL_STATE, gameFinal: true, score: { home: 7, away: 4 }, screen: 'league', synced: false };
saveState(finished);
let back = loadState(INITIAL_STATE);
eq('final result survives', [back.gameFinal, back.score], [true, { home: 7, away: 4 }]);
eq('synced resets on load', back.synced, true);

// Transient UI must not come back.
saveState({ ...INITIAL_STATE, toast: 'hi', posMenu: 3, confirmFinal: true, selRunner: 1, screen: 'league' });
back = loadState(INITIAL_STATE);
eq('toast dropped', back.toast, null);
eq('sheet state dropped', [back.posMenu, back.confirmFinal], [null, false]);
eq('runner selection dropped', back.selRunner, null);
eq('transient keys are not written', Object.keys(JSON.parse(store['score-tracker:state']).state).filter(k => ['toast','posMenu','confirmFinal','selRunner'].includes(k)), []);

// Screens that make no sense cold.
const resume = (screen, extra = {}) => { saveState({ ...INITIAL_STATE, screen, ...extra }); return loadState(INITIAL_STATE).screen; };
eq('scan camera does not resume', resume('scanCam'), 'team');
eq('scan review does not resume', resume('scanReview'), 'team');
eq('live without a game falls back', resume('live', { gameActive: false }), 'league');
eq('live with a game resumes', resume('live', { gameActive: true }), 'live');
eq('normal screen resumes', resume('player'), 'player');

// Corruption / version handling.
store['score-tracker:state'] = '{not json';
eq('corrupt payload falls back', loadState(INITIAL_STATE), INITIAL_STATE);
// A version mismatch must MIGRATE, never discard. Discarding meant a routine
// deploy could wipe a real season, because the blank fallback was written
// straight back over it on the next save.
store['score-tracker:state'] = JSON.stringify({
  version: 999,
  state: { score: { home: 1, away: 0 }, roster: [{ id: 0, name: 'Kept' }], history: [] },
});
eq('version mismatch keeps the roster', loadState(INITIAL_STATE).roster, [{ id: 0, name: 'Kept' }]);
eq('version mismatch keeps game state', loadState(INITIAL_STATE).score, { home: 1, away: 0 });
store['score-tracker:state'] = JSON.stringify({ version: 1 });
const bare = loadState(INITIAL_STATE);
eq('payload with no state yields defaults', [bare.roster.length, bare.teams.length, bare.history.length], [0, 0, 0]);

// Storage unavailable must not throw.
mode = 'throw-read';
eq('read failure falls back', loadState(INITIAL_STATE), INITIAL_STATE);
mode = 'quota';
let threw = false;
try { saveState({ ...INITIAL_STATE, score: { home: 9, away: 9 } }); } catch { threw = true; }
eq('quota failure is swallowed', threw, false);
mode = 'ok';

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
