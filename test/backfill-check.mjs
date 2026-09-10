// Sending past games to the account.
//
// The promises under test, in the order they matter:
//   1. It never sends a game twice, including one the one-time import already
//      put there.
//   2. It stops at the first failure, names the game, and leaves everything
//      after it untouched — no silent skipping, no ambiguity about how far it got.
//   3. Stopping is resumable: what was sent is marked sent.
//   4. It refuses to start when the queue is busy or the device is offline.
//   5. Unsendable games are identified BEFORE anything is written.
//
// Runs against the LOCAL Supabase stack. Never a hosted project: it creates
// users and writes games, and the hosted project holds a real season.

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { INITIAL_STATE } from '../src/data/league.js';
import { SEEDED } from './fixtures-history.js';
import { buildExport } from '../src/game/export.js';
import { createSupabaseRepository } from '../src/data/supabaseRepository.js';
import { createOfflineQueue } from '../src/data/offlineQueue.js';
import { planBackfill, inspectGame, legacyResultReport, REASONS } from '../src/data/backfill.js';

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

// --- the pre-flight needs no database ----------------------------------------
{
  const good = {
    id: 'g-1', opponent: 'Rubber Chickens', label: 'Sep 1', score: { us: 5, them: 3 }, result: 'W',
    lines: [{ pid: 'h0', name: 'A', team: 'home', ab: 3, h: 2 }],
  };

  eq('a complete game is sendable', inspectGame(good).ok, true);
  eq('a game with no id is not', inspectGame({ ...good, id: null }).reason, REASONS.NO_ID);
  eq('nor one with no box score', inspectGame({ ...good, lines: [] }).reason, REASONS.NO_LINES);
  eq('nor one with no score', inspectGame({ ...good, score: null }).reason, REASONS.NO_SCORE);

  // The legacy shape: the original engine used >=, so a level game was stored
  // as a win. save_game refuses it, and it is wrong in the standings today.
  const tieAsWin = { ...good, id: 'g-tie', score: { us: 4, them: 4 }, result: 'W' };
  eq('a tie recorded as a win is refused', inspectGame(tieAsWin).reason, REASONS.RESULT_DISAGREES);
  ok('and the reason says both figures',
    /recorded as a win/.test(inspectGame(tieAsWin).detail) && /4–4/.test(inspectGame(tieAsWin).detail),
    inspectGame(tieAsWin).detail);

  eq('a genuine 0-0 tie is sendable', inspectGame({ ...good, score: { us: 0, them: 0 }, result: 'T' }).ok, true);

  const history = [good, tieAsWin, { ...good, id: 'g-sent' }, { ...good, id: 'g-nolines', lines: [] }];
  const plan = planBackfill(history, new Set(['g-sent']));
  eq('already-sent games are not offered again', plan.alreadySent, 1);
  eq('sendable counts only what will go', plan.sendable.length, 1);
  eq('and the rest are named as blocked', plan.blocked.map((b) => b.id).sort(), ['g-nolines', 'g-tie']);
  eq('a blocked game still gets a readable title', /vs Rubber Chickens/.test(plan.blocked[0].title), true);

  const labelled = planBackfill([good], new Set(), new Set(['g-1']));
  eq('a game the account already has is labelled an update', labelled.sendable[0].action, 'update');
  eq('and one it does not have, a create', planBackfill([good], new Set(), new Set()).sendable[0].action, 'create');

  eq('an empty history has nothing to do', planBackfill([], new Set()).nothingToDo, true);

  // The reporting half: these are a local data bug, counted but never rewritten.
  const report = legacyResultReport([tieAsWin, { ...good, id: 'z', score: { us: 0, them: 0 }, result: 'L' }, good]);
  eq('ties stored as a decision are counted', report.tieStoredAsDecision, 2);
  eq('and the 0-0 subset is counted separately', report.zeroZeroWithDecision, 1);
}

// --- the database half -------------------------------------------------------
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

let store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = v; },
  removeItem: (k) => { delete store[k]; },
};

const password = 'Password123!';
const email = `backfill${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.test`;
await admin.auth.admin.createUser({ email, password, email_confirm: true });
const api = createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false } });
const signIn = await api.auth.signInWithPassword({ email, password });
if (signIn.error) {
  console.log('FAIL sign in: ' + signIn.error.message);
  process.exit(1);
}

// A season with history, imported the way a real migration does it. Every one
// of these games is therefore ALREADY in the account but is NOT in this
// device's synced-games marker — the exact trap a naive backfill falls into.
const seeded = SEEDED(INITIAL_STATE);
const imported = await api.rpc('import_season_and_claim', { payload: buildExport(seeded) });
eq('setup: a season was imported', !imported.error, true);
const teamId = imported.data;

const gameCount = async () =>
  ((await admin.from('games').select('id').or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)).data || [])
    .length;
const afterImport = await gameCount();
eq('setup: the history is in the account', afterImport, seeded.history.length);

const queue = createOfflineQueue({ storageKey: 'test:backfill:queue' });
const repo = createSupabaseRepository(api, { getTeamId: () => teamId, cache: null, queue });

// --- re-sending imported games must not duplicate them -----------------------
{
  const plan = await repo.backfillPlan(seeded.history);
  eq('every imported game is offered (the marker is per-device)', plan.sendable.length, seeded.history.length);
  eq('and every one is labelled an update, not a create',
    plan.sendable.every((c) => c.action === 'update'), true);
  eq('nothing blocks the run', plan.blockedBecause, null);

  const seen = [];
  const result = await repo.backfillGames(plan.sendable, { onProgress: (p) => seen.push(p.done) });
  eq('the run succeeded', result.ok, true);
  eq('every game was sent', result.sent.length, seeded.history.length);
  eq('the account did NOT gain rows', await gameCount(), afterImport);
  eq('progress was reported for each game', seen.length, seeded.history.length + 1);

  const again = await repo.backfillPlan(seeded.history);
  eq('re-running now finds nothing to send', again.sendable.length, 0);
  eq('because they are all marked sent', again.alreadySent, seeded.history.length);
  eq('and it says so plainly', again.nothingToDo, true);
}

// --- a genuinely new game, plus one that must stop the run -------------------
{
  store = {}; // a fresh device: nothing marked as sent
  const base = seeded.history[0];
  const newGame = (n, over) => ({
    ...base,
    id: `g-back-${n}-${Date.now()}`,
    label: `Oct ${n}`,
    opponent: 'Rubber Chickens',
    opponentId: base.opponentId,
    score: { us: 7, them: 2 },
    result: 'W',
    ...over,
  });

  // An opponent this device has never played before: the run has to create the
  // opposing team on the way past, which is the common case for a real backfill.
  const games = [newGame(1), newGame(2), { ...newGame(3), opponentId: null, opponent: 'Ghosts' }, newGame(4)];

  const before = await gameCount();
  const plan = await repo.backfillPlan(games);
  eq('all four look sendable before the run', plan.sendable.length, 4);
  eq('and all four are labelled new', plan.sendable.every((c) => c.action === 'create'), true);

  const result = await repo.backfillGames(plan.sendable, {});
  eq('a run of genuinely new games succeeds', result.ok, true);
  eq('and the account gained exactly four', await gameCount(), before + 4);

  const verified = await repo.backfillPlan(games);
  eq('all four are now marked sent', verified.alreadySent, 4);
}

// --- stopping: the run halts at the offending game and names it --------------
{
  store = {};
  const base = seeded.history[0];
  const good1 = { ...base, id: `g-stop-1-${Date.now()}`, label: 'Nov 1' };
  const good2 = { ...base, id: `g-stop-2-${Date.now()}`, label: 'Nov 2' };
  // Passes the local pre-flight (score present, result agrees, lines present)
  // but the database refuses it: no id survives the payload.
  const bad = { ...base, id: `g-stop-3-${Date.now()}`, label: 'Nov 3', innings: 'not-a-number' };
  const never = { ...base, id: `g-stop-4-${Date.now()}`, label: 'Nov 4' };

  const before = await gameCount();
  const result = await repo.backfillGames([{ game: good1 }, { game: good2 }, { game: bad }, { game: never }], {});

  if (result.ok) {
    // The planted failure did not fail. Say so rather than quietly passing.
    ok('the planted failure actually failed', false,
      'all four were accepted — this assertion proves nothing until the fixture really breaks');
    eq('cleanup: count', await gameCount(), before + 4);
  } else {
    eq('the run stopped', result.ok, false);
    eq('the two before it were sent', result.sent.length, 2);
    eq('and it names the game it stopped on', result.stoppedAt.id, bad.id);
    ok('with a reason', !!result.error, JSON.stringify(result));
    console.log('     (the message shown on screen: ' + result.error + ')');
    eq('the game after it was never attempted', await gameCount(), before + 2);

    const resumed = await repo.backfillPlan([good1, good2, bad, never]);
    eq('the sent ones are not offered again', resumed.alreadySent, 2);
    ok('and the untouched ones still are',
      resumed.sendable.concat(resumed.blocked).length === 2, JSON.stringify(resumed.sendable.map((c) => c.game.id)));
  }
}

// --- refusing to start -------------------------------------------------------
{
  store = {};
  const busy = createOfflineQueue({ storageKey: 'test:backfill:busy' });
  busy.enqueue({ kind: 'game', payload: { id: 'waiting' } });
  const busyRepo = createSupabaseRepository(api, { getTeamId: () => teamId, cache: null, queue: busy });

  const result = await busyRepo.backfillGames([{ game: seeded.history[0] }], {});
  eq('it refuses to start while writes are queued', result.refusedToStart, true);
  eq('and sends nothing', result.sent.length, 0);
  ok('and says why', /waiting to sync/.test(result.error), result.error);

  const plan = await busyRepo.backfillPlan(seeded.history);
  ok('the pre-flight says so too', /waiting to sync/.test(plan.blockedBecause || ''), plan.blockedBecause);

  // Offline. Node 22 defines `navigator` as a getter-only global, so it has to
  // be replaced through the property descriptor rather than assigned.
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
  const offlineRepo = createSupabaseRepository(api, {
    getTeamId: () => teamId, cache: null, queue: createOfflineQueue({ storageKey: 'test:backfill:off' }),
  });
  const offline = await offlineRepo.backfillGames([{ game: seeded.history[0] }], {});
  eq('it refuses to start with no connection', offline.refusedToStart, true);
  ok('and says that is why', /connection/.test(offline.error), offline.error);
  if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
  else delete globalThis.navigator;

  // No account at all.
  const nowhere = createSupabaseRepository(api, {
    getTeamId: () => null, cache: null, queue: createOfflineQueue({ storageKey: 'test:backfill:none' }),
  });
  const none = await nowhere.backfillGames([{ game: seeded.history[0] }], {});
  eq('and it refuses when not signed in to an account', none.refusedToStart, true);
}

// --- a blocked game is never sent, and never silently dropped ----------------
{
  store = {};
  const base = seeded.history[0];
  const tieAsWin = { ...base, id: `g-legacy-${Date.now()}`, score: { us: 4, them: 4 }, result: 'W' };
  const fine = { ...base, id: `g-fine-${Date.now()}`, label: 'Dec 1' };

  const before = await gameCount();
  const plan = await repo.backfillPlan([tieAsWin, fine]);
  eq('the legacy game is held back by the pre-flight', plan.blocked.length, 1);
  eq('and it is named', plan.blocked[0].id, tieAsWin.id);
  eq('while the good one is offered', plan.sendable.map((c) => c.game.id), [fine.id]);

  const result = await repo.backfillGames(plan.sendable, {});
  eq('sending the rest works', result.ok, true);
  eq('and only the good one reached the account', await gameCount(), before + 1);

  const row = await admin.from('games').select('id').eq('client_id', tieAsWin.id);
  eq('the blocked game was never written', (row.data || []).length, 0);

  // It must NOT have been repaired on the way past: that is a separate,
  // deliberate step the user asked to be kept out of this flow.
  eq('and it was not rewritten on the device', tieAsWin.result, 'W');
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
