// A game that exists only on this device must survive loading the account.
//
// The bug this pins: `load()` merged the account's season over the local one
// and then mirrored the result back to localStorage. History came from the
// account, so a game the account had not been told about yet was dropped from
// the running state AND overwritten in localStorage. The queue would still have
// replayed it eventually, but the phone stopped showing it in the meantime,
// which is indistinguishable from data loss.
//
// Exercised through the real storage API and a real database, because that is
// the combination that produced it: an in-memory check of the merge alone would
// not have noticed the mirror being written straight afterwards.
//
// Runs against the LOCAL Supabase stack. Never a hosted project.

import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { INITIAL_STATE } from '../src/data/league.js';
import { SEEDED } from './fixtures-history.js';
import { buildExport } from '../src/game/export.js';
import { createLocalRepository } from '../src/data/localRepository.js';
import { createSupabaseRepository } from '../src/data/supabaseRepository.js';
import { createOfflineQueue } from '../src/data/offlineQueue.js';

const repoRoot = new URL('..', import.meta.url).pathname;

let fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    fail++;
    console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  } else console.log('ok   ' + label);
};

let st;
try {
  st = JSON.parse(
    execSync('npx supabase status -o json', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString(),
  );
} catch {
  console.log('skipped — no local Supabase stack');
  console.log(fail ? `\n${fail} FAILED` : '\nall passed');
  process.exit(fail ? 1 : 0);
}

const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
try {
  const probe = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (probe.error) throw probe.error;
} catch {
  console.log('skipped — local Supabase not reachable');
  console.log(fail ? `\n${fail} FAILED` : '\nall passed');
  process.exit(fail ? 1 : 0);
}

// The real storage API, over a real (in-process) localStorage.
let store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = v; },
  removeItem: (k) => { delete store[k]; },
};

const password = 'Password123!';
const email = `mirror${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.test`;
await admin.auth.admin.createUser({ email, password, email_confirm: true });
const api = createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false } });
const signIn = await api.auth.signInWithPassword({ email, password });
if (signIn.error) {
  console.log('FAIL sign in: ' + signIn.error.message);
  process.exit(1);
}

const seeded = SEEDED(INITIAL_STATE);
const imported = await api.rpc('import_season_and_claim', { payload: buildExport(seeded) });
eq('setup: the account holds the season', !imported.error, true);
const teamId = imported.data;

// A game finalised on this phone whose write has not landed yet.
const deviceOnly = {
  ...seeded.history[0],
  id: `g-not-sent-yet-${Date.now()}`,
  label: 'Just finished',
  date: '2026-09-20',
  score: { us: 6, them: 2 },
  result: 'W',
};

const local = createLocalRepository();
local.save({ ...seeded, history: [...seeded.history, deviceOnly] });

const queue = createOfflineQueue({ storageKey: 'score-tracker:queue' });
const repo = createSupabaseRepository(api, { getTeamId: () => teamId, cache: local, queue });

// It is queued, as it would be after a failed write at the field.
queue.enqueue({ kind: 'game', payload: deviceOnly });
eq('setup: the write is waiting in the queue', queue.list().length, 1);
eq('setup: the account does not have it',
  ((await admin.from('games').select('id')
    .eq('client_id', deviceOnly.id)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)).data || []).length, 0);

// --- the load ----------------------------------------------------------------
const loaded = await repo.load();
const ids = (loaded.history || []).map((g) => g.id);

eq('the account\'s games are all there', ids.filter((id) => id !== deviceOnly.id).length, seeded.history.length);
eq('and the unsent game is still in the running state', ids.includes(deviceOnly.id), true);
eq('it is last, because it is the newest', ids[ids.length - 1], deviceOnly.id);
eq('it appears exactly once', ids.filter((id) => id === deviceOnly.id).length, 1);

const onDisk = local.loadSync();
eq('it survives in localStorage too', (onDisk.history || []).some((g) => g.id === deviceOnly.id), true);
eq('and the account games are in localStorage as well',
  (onDisk.history || []).length, seeded.history.length + 1);
eq('the queued write was not disturbed', queue.list().length, 1);

// --- loading again must not duplicate it -------------------------------------
const twice = await repo.load();
eq('a second load does not duplicate it',
  (twice.history || []).filter((g) => g.id === deviceOnly.id).length, 1);
eq('nor grow the history', (twice.history || []).length, seeded.history.length + 1);

// --- once it lands, the account's copy is the one that counts ----------------
{
  const sent = await api.rpc('save_game', { p_team_id: teamId, payload: deviceOnly });
  eq('the queued game is finally written', !sent.error, true);

  const after = await repo.load();
  const back = (after.history || []).filter((g) => g.id === deviceOnly.id);
  eq('it is still there exactly once', back.length, 1);
  eq('with the same result', back[0].result, deviceOnly.result);
  eq('and the same score', back[0].score, deviceOnly.score);
  eq('and the history did not grow', (after.history || []).length, seeded.history.length + 1);
}

// --- the account stays authoritative for games it does know about ------------
{
  // Rewrite the device's copy of a shared game to something wrong, the way a
  // stale mirror would be, and confirm the account's version wins.
  const stale = local.loadSync();
  const target = seeded.history[0].id;
  local.save({
    ...stale,
    history: (stale.history || []).map((g) =>
      g.id === target ? { ...g, result: 'L', score: { us: 0, them: 9 } } : g,
    ),
  });

  const loadedAgain = await repo.load();
  const shared = (loadedAgain.history || []).find((g) => g.id === target);
  const original = seeded.history[0];
  eq('a game the account knows comes from the account', shared.result, original.result);
  eq('with the account\'s score', shared.score, original.score);
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
