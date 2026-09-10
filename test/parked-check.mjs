// Writes that cannot be sent, and refuse to disappear.
//
// The promises:
//   1. A write the server permanently refuses is parked, not dropped and not
//      retried forever.
//   2. It says what it was and what the server actually said.
//   3. It survives a reload — the queue is durable, and a parked write that
//      vanished on relaunch would be the very failure this is meant to prevent.
//   4. Retrying puts it back in its ORIGINAL place in the queue, so a write
//      made earlier still reaches the server first.
//   5. Nothing offers to discard one.
//
// The refusal is real: save_game's own guard rejects the write, against a real
// Postgres. Runs against the LOCAL stack only.

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { INITIAL_STATE } from '../src/data/league.js';
import { SEEDED } from './fixtures-history.js';
import { buildExport } from '../src/game/export.js';
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
const ok = (label, cond, detail) => {
  if (cond) console.log('ok   ' + label);
  else {
    fail++;
    console.log(`FAIL ${label}${detail ? '\n  ' + detail : ''}`);
  }
};

function storageOver(store) {
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
}

// --- retry must not reorder, and nothing may discard -------------------------
{
  const store = {};
  globalThis.localStorage = storageOver(store);

  const q = createOfflineQueue({ storageKey: 'test:parked' });
  const order = [];
  const failing = new Set(['b']);
  const handlers = {
    game: async (p) => {
      if (failing.has(p.id)) {
        const err = new Error('refused');
        err.status = 400; // permanent
        throw err;
      }
      order.push(p.id);
    },
  };

  q.enqueue({ kind: 'game', payload: { id: 'a' } });
  q.enqueue({ kind: 'game', payload: { id: 'b' } });
  q.enqueue({ kind: 'game', payload: { id: 'c' } });

  await q.flush(handlers);            // a applies, b parks, c blocked behind it
  await q.flush(handlers);            // c now runs
  eq('the refused write parked', q.parked().map((e) => e.payload.id), ['b']);
  eq('and the others went, in order', order, ['a', 'c']);

  // Now let it succeed and put it back.
  failing.clear();
  const revived = q.retryParked(q.parked()[0].id);
  eq('retrying one revives exactly that one', revived.length, 1);
  eq('and it keeps its original sequence number', revived[0].seq, 2);
  eq('so it sits before anything queued after it', q.list().map((e) => e.payload.id), ['b']);

  await q.flush(handlers);
  eq('it applies on retry', order, ['a', 'c', 'b']);
  eq('and the parked list is empty because it SUCCEEDED', q.parked().length, 0);

  // Ordering with a later pending entry present.
  const q2 = createOfflineQueue({ storageKey: 'test:parked2' });
  const seen = [];
  const stubborn = { game: async (p) => { if (p.id === 'x') { const e = new Error('no'); e.status = 400; throw e; } seen.push(p.id); } };
  q2.enqueue({ kind: 'game', payload: { id: 'x' } });
  await q2.flush(stubborn);
  q2.enqueue({ kind: 'game', payload: { id: 'y' } });
  q2.retryParked();
  eq('a revived entry goes back BEFORE a later one', q2.list().map((e) => e.payload.id), ['x', 'y']);

  // A subscription so the UI can notice.
  let notified = 0;
  const stop = q2.subscribe(() => { notified++; });
  q2.enqueue({ kind: 'game', payload: { id: 'z' } });
  ok('the queue notifies listeners on change', notified > 0);
  stop();
  const before = notified;
  q2.enqueue({ kind: 'game', payload: { id: 'w' } });
  eq('and stops when unsubscribed', notified, before);
}

// --- no discard exists anywhere ----------------------------------------------
{
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = `${dir}/${entry}`;
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|jsx)$/.test(entry)) {
        const src = readFileSync(full, 'utf8');
        src.split('\n').forEach((l, i) => {
          // A parked write must not be removable. `clear()` on the queue would
          // do it wholesale; a "discard"/"dismiss" action would do it one at a
          // time. Neither may be wired to anything in the app.
          if (/\b(discardParked|dismissParked|deleteParked|dropParked)\b/.test(l)) {
            offenders.push(`${full.replace(repoRoot, '')}:${i + 1}`);
          }
        });
      }
    }
  };
  walk(`${repoRoot}src`);
  eq('nothing in the app can discard a parked write', offenders, []);
}

// --- against the real database -----------------------------------------------
let st;
try {
  st = JSON.parse(
    execSync('npx supabase status -o json', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString(),
  );
} catch {
  console.log('skipped the database half — no local Supabase stack');
  console.log(fail ? `\n${fail} FAILED` : '\nall passed');
  process.exit(fail ? 1 : 0);
}

const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
try {
  const probe = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (probe.error) throw probe.error;
} catch {
  console.log('skipped the database half — local Supabase not reachable');
  console.log(fail ? `\n${fail} FAILED` : '\nall passed');
  process.exit(fail ? 1 : 0);
}

const store = {};
globalThis.localStorage = storageOver(store);

const password = 'Password123!';
const email = `parked${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.test`;
await admin.auth.admin.createUser({ email, password, email_confirm: true });
const api = createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false } });
const signIn = await api.auth.signInWithPassword({ email, password });
if (signIn.error) {
  console.log('FAIL sign in: ' + signIn.error.message);
  process.exit(1);
}
const uid = signIn.data.user.id;

const seeded = SEEDED(INITIAL_STATE);
const imported = await api.rpc('import_season_and_claim', { payload: buildExport(seeded) });
eq('setup: a season exists', !imported.error, true);
const teamId = imported.data;

const QUEUE_KEY = 'score-tracker:queue';
const makeRepo = () =>
  createSupabaseRepository(api, {
    getTeamId: () => teamId,
    getUserId: () => uid,
    cache: null,
    queue: createOfflineQueue({ storageKey: QUEUE_KEY }),
  });

// A game the database will refuse on its own terms: no box-score lines. This is
// save_game's guard talking, not a stubbed error.
const doomed = {
  ...seeded.history[0],
  id: `g-doomed-${Date.now()}`,
  label: 'Oct 4',
  opponent: 'Rubber Chickens',
  lines: [],
};

{
  const repo = makeRepo();
  repo.saveGame(doomed);
  // Let the flush run to completion.
  await new Promise((r) => setTimeout(r, 1500));

  const parked = repo.parkedWrites();
  eq('the refused write is parked', parked.length, 1);
  eq('and it knows it was a game', parked[0].kind, 'game');
  ok('it names the game rather than saying "a write"',
    /Oct 4/.test(parked[0].title) && /Rubber Chickens/.test(parked[0].title), parked[0].title);
  ok('and carries the database\'s own words',
    /box-score lines/.test(parked[0].error), parked[0].error);
  ok('with a timestamp', !!parked[0].at, JSON.stringify(parked[0]));
  eq('nothing was written to the account',
    ((await admin.from('games').select('id').eq('client_id', doomed.id)).data || []).length, 0);
}

// --- it survives a reload ----------------------------------------------------
{
  // A brand new repository over the same storage: exactly what a relaunch does.
  const afterReload = makeRepo();
  const parked = afterReload.parkedWrites();
  eq('after a reload it is still parked', parked.length, 1);
  ok('still with its reason', /box-score lines/.test(parked[0].error), parked[0].error);

  // Retrying something that cannot succeed leaves it parked, and says so again.
  const remaining = await afterReload.retryParked(parked[0].id);
  eq('retrying a write the server still refuses leaves it parked', remaining, 1);
  const again = afterReload.parkedWrites();
  eq('it is the same one', again.length, 1);
  ok('with the same reason', /box-score lines/.test(again[0].error), again[0].error);
}

// --- a later, valid write is not lost behind it ------------------------------
{
  const repo = makeRepo();
  const good = {
    ...seeded.history[0],
    id: `g-good-${Date.now()}`,
    label: 'Oct 5',
  };
  repo.saveGame(good);
  await new Promise((r) => setTimeout(r, 2000));

  const landed = (await admin.from('games').select('id').eq('client_id', good.id)).data || [];
  eq('a valid write made afterwards still reaches the account', landed.length, 1);
  eq('and the refused one is still parked, not quietly dropped', repo.parkedWrites().length, 1);
  eq('with nothing left pending', repo.unsent().pending, 0);
}

// --- fixing the problem lets it through --------------------------------------
{
  const repo = makeRepo();
  const parkedId = repo.parkedWrites()[0].id;

  // The queue holds the payload it was given; a fixed version is a new write.
  // What matters here is that retrying is the ONLY route out, and that a write
  // which now succeeds leaves the list on its own.
  const raw = JSON.parse(localStorage.getItem(QUEUE_KEY));
  const entry = raw.parked.find((e) => e.id === parkedId);
  entry.payload = { ...entry.payload, lines: seeded.history[0].lines };
  localStorage.setItem(QUEUE_KEY, JSON.stringify(raw));

  const fixed = makeRepo();
  const left = await fixed.retryParked(parkedId);
  eq('once the write is acceptable, retrying clears it', left, 0);
  eq('the list is empty', fixed.parkedWrites().length, 0);
  eq('and it reached the account',
    ((await admin.from('games').select('id').eq('client_id', doomed.id)).data || []).length, 1);
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
