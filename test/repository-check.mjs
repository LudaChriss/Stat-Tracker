// Exercise the local repository adapter — the thin Promise-shaped wrapper
// around storage.js — proving the abstraction round-trips a season, strips
// transient state, migrates an older payload, survives corrupt input, and
// never throws when storage is unavailable.
let store = {};
let mode = 'ok';
globalThis.localStorage = {
  getItem(k) { if (mode === 'throw-read') throw new Error('SecurityError'); return k in store ? store[k] : null; },
  setItem(k, v) { if (mode === 'quota') throw new Error('QuotaExceededError'); store[k] = v; },
  removeItem(k) { delete store[k]; },
};

const { createLocalRepository } = await import('../src/data/localRepository.js');
const { INITIAL_STATE } = await import('../src/data/league.js');

let fail = 0;
const eq = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`FAIL ${l}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log('ok   ' + l);
};

const repo = createLocalRepository();

// Nothing stored yet — the interface reports null, not a blank fallback
// state, so a caller can tell "never saved" apart from "saved, but blank".
eq('empty storage resolves null', await repo.load(), null);

// Round trip a finalized game.
const finished = { ...INITIAL_STATE, gameFinal: true, score: { home: 7, away: 4 }, screen: 'league', synced: false };
repo.save(finished);
let back = await repo.load();
eq('final result survives', [back.gameFinal, back.score], [true, { home: 7, away: 4 }]);
eq('synced resets on load', back.synced, true);

// Transient UI must not come back.
repo.save({ ...INITIAL_STATE, toast: 'hi', posMenu: 3, confirmFinal: true, selRunner: 1, screen: 'league' });
back = await repo.load();
eq('toast dropped', back.toast, null);
eq('sheet state dropped', [back.posMenu, back.confirmFinal], [null, false]);
eq('runner selection dropped', back.selRunner, null);
eq(
  'transient keys are not written',
  Object.keys(JSON.parse(store['score-tracker:state']).state).filter((k) =>
    ['toast', 'posMenu', 'confirmFinal', 'selRunner'].includes(k),
  ),
  [],
);

// A version mismatch must MIGRATE, never discard.
store['score-tracker:state'] = JSON.stringify({
  version: 999,
  state: { score: { home: 1, away: 0 }, roster: [{ id: 0, name: 'Kept' }], history: [] },
});
back = await repo.load();
eq('version mismatch keeps the roster', back.roster, [{ id: 0, name: 'Kept' }]);
eq('version mismatch keeps game state', back.score, { home: 1, away: 0 });

// Corrupt payload falls back to null and is preserved for manual recovery.
store['score-tracker:state'] = '{not json';
eq('corrupt payload resolves null', await repo.load(), null);
eq('corrupt payload preserved for recovery', await repo.getPreserved(), '{not json');
repo.clearPreserved();
eq('clearPreserved removes it', await repo.getPreserved(), null);

// Storage unavailable must never throw, on either read or write.
mode = 'throw-read';
let threw = false;
let loaded;
try { loaded = await repo.load(); } catch { threw = true; }
eq('read failure does not throw', threw, false);
eq('read failure resolves null', loaded, null);

mode = 'quota';
threw = false;
try { repo.save({ ...INITIAL_STATE, score: { home: 9, away: 9 } }); } catch { threw = true; }
eq('quota failure is swallowed', threw, false);
mode = 'ok';


// --- the "nothing stored" signal must not depend on object identity ---
// A previous implementation inferred emptiness by comparing loadState's result
// against the defaults by reference. That worked, but would have started
// silently reporting a stored season if storage.js ever returned a copy.
{
  const { readState, loadState } = await import('../src/game/storage.js');
  store = {};
  eq('readState reports empty as null', readState({ marker: 1 }), null);
  eq('loadState still falls back for its own callers', loadState({ marker: 1 }), { marker: 1 });

  // A structurally identical but distinct defaults object must behave the same.
  const a = { ...INITIAL_STATE };
  eq('emptiness is not identity-based', readState(a), null);

  store['score-tracker:state'] = JSON.stringify({ version: 3, state: { ...INITIAL_STATE, roster: [{ id: 0, name: 'Real' }] } });
  const got = readState(INITIAL_STATE);
  eq('a real season is returned, not null', got && got.roster, [{ id: 0, name: 'Real' }]);

  store['score-tracker:state'] = '{broken';
  eq('unreadable payload reports null', readState(INITIAL_STATE), null);
  store = {};
}


// --- loadSync seeds the first render (no flash of the blank/setup UI) ---
// Regression: an async-only load let React paint the blank state first,
// because a microtask setState is not guaranteed to flush before paint.
{
  store = {};
  const repo = createLocalRepository();
  eq('adapter offers a synchronous read', typeof repo.loadSync, 'function');
  eq('loadSync reports empty as null', repo.loadSync(), null);
  store['score-tracker:state'] = JSON.stringify({ version: 3, state: { ...INITIAL_STATE, myTeam: { name: 'Sync', priorW: 0, priorL: 0, priorT: 0 } } });
  eq('loadSync returns the stored season', repo.loadSync().myTeam.name, 'Sync');
  store['score-tracker:state'] = '{broken';
  eq('loadSync survives a corrupt payload', repo.loadSync(), null);
  store = {};
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
