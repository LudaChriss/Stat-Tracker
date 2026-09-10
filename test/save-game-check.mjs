// Persisting a finalized game: the guard, idempotency, the perspective flip,
// and the promise that a game is never coalesced away by a season save.
//
// Run against the LOCAL Supabase stack — a real Postgres with the same
// migrations. Never against a hosted project: it holds real data, and a test
// that writes games and users into it is not worth the risk.

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { INITIAL_STATE } from '../src/data/league.js';
import { SEEDED } from './fixtures-history.js';
import { buildExport } from '../src/game/export.js';
import { createSupabaseRepository } from '../src/data/supabaseRepository.js';
import { verifyGame } from '../src/data/seasonSync.js';
import { seasonTotals } from '../src/game/stats.js';
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
const refused = (label, { error }, fragment) => {
  if (!error) {
    fail++;
    console.log('FAIL accepted (should have refused): ' + label);
    return;
  }
  if (fragment && !error.message.includes(fragment)) {
    fail++;
    console.log(`FAIL refused but did not say why: ${label}\n  ${error.message}`);
    return;
  }
  console.log('ok   refused: ' + label);
};

// --- the queue promise needs no database ------------------------------------
{
  let store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
  };
  const q = createOfflineQueue({ storageKey: 'test:queue' });
  q.enqueue({ kind: 'game', payload: { id: 'g-1' } });
  q.enqueue({ kind: 'season', payload: { a: 1 }, coalesceKey: 'team-1' });
  q.enqueue({ kind: 'season', payload: { a: 2 }, coalesceKey: 'team-1' });
  q.enqueue({ kind: 'game', payload: { id: 'g-2' } });

  const kinds = q.list().map((e) => `${e.kind}:${e.payload.id || e.payload.a}`);
  eq('a season snapshot coalesces, a game never does', kinds, ['game:g-1', 'season:2', 'game:g-2']);
  eq('both games survive a later season save', kinds.filter((k) => k.startsWith('game')).length, 2);

  q.enqueue({ kind: 'game', payload: { id: 'g-1' } });
  eq('even an identical game is kept separately', q.list().filter((e) => e.kind === 'game').length, 3);
}

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

const password = 'Password123!';
const email = `game${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.test`;
await admin.auth.admin.createUser({ email, password, email_confirm: true });
const api = createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false } });
const signIn = await api.auth.signInWithPassword({ email, password });
if (signIn.error) {
  console.log('FAIL sign in: ' + signIn.error.message);
  process.exit(1);
}

const seeded = SEEDED(INITIAL_STATE);
const imported = await api.rpc('import_season_and_claim', { payload: buildExport(seeded) });
eq('setup: a season exists', !imported.error, true);
const teamId = imported.data;
const gameCount = async () =>
  ((await admin.from('games').select('id').or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)).data || []).length;
const before = await gameCount();

// A newly finalized game, in the shape buildGameRecord produces.
const newGame = {
  id: `g-new-${Date.now()}`,
  opponentId: 'rubber-chickens',
  opponent: 'Rubber Chickens',
  home: true,
  date: '2026-09-10',
  label: 'Sep 10',
  score: { us: 6, them: 4 },
  result: 'W',
  sport: 'kickball',
  innings: 7,
  lines: [
    { pid: 'h0', name: 'Maya Ortiz', team: 'home', ab: 4, h: 3, r: 2, rbi: 1, bb: 0, k: 0, d: 1, t: 0, hr: 1 },
    { pid: 'h1', name: 'Deon Wallace', team: 'home', ab: 4, h: 2, r: 1, rbi: 2, bb: 0, k: 1, d: 0, t: 0, hr: 0 },
  ],
};

// --- the guard ---------------------------------------------------------------
refused('a game with no box-score lines',
  await api.rpc('save_game', { p_team_id: teamId, payload: { ...newGame, lines: [] } }),
  'no box-score lines');
refused('a game with no score',
  await api.rpc('save_game', { p_team_id: teamId, payload: { ...newGame, score: null } }),
  'no final score');
refused('a result that contradicts the score',
  await api.rpc('save_game', { p_team_id: teamId, payload: { ...newGame, result: 'L' } }),
  'disagrees with the score');
refused('a game with no id',
  await api.rpc('save_game', { p_team_id: teamId, payload: { ...newGame, id: null } }),
  'no id');
eq('none of the refusals wrote anything', await gameCount(), before);

// A 0-0 tie is a legitimate final, not an incomplete game.
const nilNil = {
  ...newGame,
  id: `g-nil-${Date.now()}`,
  score: { us: 0, them: 0 },
  result: 'T',
  // A different player, so this game cannot skew the h0 totals asserted below.
  lines: [{ pid: 'h2', name: 'Priya Shah', team: 'home', ab: 3, h: 0, r: 0, rbi: 0, bb: 0, k: 1, d: 0, t: 0, hr: 0 }],
};
const tie = await api.rpc('save_game', { p_team_id: teamId, payload: nilNil });
eq('a 0-0 tie is accepted', !tie.error, true);

// --- the happy path ----------------------------------------------------------
const saved = await api.rpc('save_game', { p_team_id: teamId, payload: newGame });
eq('a finished game is written', !saved.error, true);
eq('two games now exist that did not before (the tie and this one)', await gameCount(), before + 2);

// --- idempotency -------------------------------------------------------------
const again = await api.rpc('save_game', { p_team_id: teamId, payload: newGame });
eq('writing the same game again succeeds', !again.error, true);
eq('and does not create a second row', await gameCount(), before + 2);
eq('and returns the same game id', again.data, saved.data);
const lines = await admin.from('game_lines').select('id').eq('game_id', saved.data);
eq('nor duplicates its box score', (lines.data || []).length, newGame.lines.length);

// --- read back through the real adapter, and check derived figures -----------
const repo = createSupabaseRepository(api, { getTeamId: () => teamId, cache: null });
const season = await repo.load();
const readBack = (season.history || []).find((g) => g.id === newGame.id);
const verdict = verifyGame(newGame, readBack);
eq('the game verifies on read-back', verdict.ok, true);
eq('with nothing flagged', verdict.differences, []);

// The figures the app would actually show.
const withGame = seasonTotals(season.history, 'h0');
const withoutGame = seasonTotals(seeded.history, 'h0');
eq('the new game moved the season line', withGame.gp, withoutGame.gp + 1);
eq('and the hits accrued', withGame.h, withoutGame.h + 3);
eq('and the home run accrued', withGame.hr, withoutGame.hr + 1);

// --- an away game must not come back inverted --------------------------------
const awayGame = {
  ...newGame,
  id: `g-away-${Date.now()}`,
  home: false,
  score: { us: 3, them: 5 },
  result: 'L',
};
const awaySaved = await api.rpc('save_game', { p_team_id: teamId, payload: awayGame });
eq('an away loss is written', !awaySaved.error, true);
const season2 = await repo.load();
const awayBack = (season2.history || []).find((g) => g.id === awayGame.id);
eq('the away game reads back as a loss, not a win', awayBack?.result, 'L');
eq('with the score still from our point of view', awayBack?.score, { us: 3, them: 5 });
eq('and still marked away', awayBack?.home, false);
eq('verifyGame agrees', verifyGame(awayGame, awayBack).ok, true);

// --- verifyGame must actually catch a bad read-back --------------------------
eq('an inverted result is caught', verifyGame(awayGame, { ...awayBack, result: 'W' }).ok, false);
eq('a wrong stat line is caught',
  verifyGame(awayGame, { ...awayBack, lines: awayBack.lines.map((l) => ({ ...l, h: l.h + 1 })) }).ok, false);
eq('a missing game is caught', verifyGame(awayGame, null).ok, false);

// --- another user cannot record games for this team --------------------------
const other = createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false } });
const otherEmail = `intruder${Date.now()}@example.test`;
await admin.auth.admin.createUser({ email: otherEmail, password, email_confirm: true });
await other.auth.signInWithPassword({ email: otherEmail, password });
refused('a stranger recording a game for this team',
  await other.rpc('save_game', { p_team_id: teamId, payload: { ...newGame, id: 'g-intruder' } }),
  'not allowed');

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
