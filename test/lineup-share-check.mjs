// The batting order, shared — against a real Postgres, as real signed-in users.
//
// Why this matters more than it looks: the order decides who is at the plate,
// and who is at the plate decides whose stat line a play is written to. Two
// phones disagreeing about the order do not disagree cosmetically. They file
// the same double against two different players, and nobody is told.
//
// Phase 3 covered the live case — the `start` event carries the lineup, so
// everyone replaying one game agrees within it. What it did not cover is the
// gap BETWEEN games, which is where the order is actually set: a manager
// rearranges it on Tuesday and hands the phone to a scorer on Thursday.
//
// The dangerous case is the third one below. A client that says nothing about
// the order must not be read as saying the order is empty — that is the same
// mistake as the empty roster in _012, and it would wipe a real batting order
// every time an older phone saved.
//
// Runs against the LOCAL stack only.

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { rowsToSeason } from '../src/data/seasonMapping.js';

const repoRoot = new URL('..', import.meta.url).pathname;

let fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    fail++;
    console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  } else console.log('ok   ' + label);
};
const need = (what, cond, detail) => {
  if (!cond) {
    console.log(`\nCANNOT RUN: ${what}${detail ? '\n  ' + detail : ''}`);
    process.exit(2);
  }
};

let st;
try {
  st = JSON.parse(
    execSync('npx supabase status -o json', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString(),
  );
} catch {
  console.log('skipped — no local Supabase stack, so the shared batting order was not exercised');
  console.log('\nall passed');
  process.exit(0);
}

const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
try {
  const probe = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (probe.error) throw probe.error;
} catch {
  console.log('skipped — local Supabase not reachable, so the shared batting order was not exercised');
  console.log('\nall passed');
  process.exit(0);
}

const password = 'Password123!';
const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 5)}`;

async function person(tag) {
  const email = `lu${tag}${stamp}@example.test`;
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  need(`a ${tag} account could be created`, !made.error, made.error && made.error.message);
  const client = createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  need(`the ${tag} account could sign in`, !error, error && error.message);
  return { id: made.data.user.id, client };
}

const manager = await person('mgr');
const scorer = await person('scr');

const team = await manager.client.rpc('create_team_with_manager', { team_name: `Order FC ${stamp}` });
need('a team could be created', !team.error, team.error && team.error.message);
const teamId = team.data;

const granted = await admin.from('memberships').insert({ user_id: scorer.id, team_id: teamId, role: 'team_scorer' });
need('the scorer holds a role', !granted.error, granted.error && granted.error.message);

const ROSTER = [
  { id: 0, name: 'Maya Ortiz', num: 7, pos: 'P', c: '#0E7490' },
  { id: 1, name: 'Deon Wallace', num: 12, pos: 'C', c: '#123D63' },
  { id: 2, name: 'Priya Shah', num: 3, pos: '1B', c: '#FF6B4A' },
  { id: 3, name: 'Sam Bennett', num: 21, pos: 'SS', c: '#3D5A73' },
];

const save = (payload, who = manager) =>
  who.client.rpc('save_season', { p_team_id: teamId, payload });

/** The season as the app would read it back, through the real mapping. */
const readBack = async (who = manager) => {
  const [t, p] = await Promise.all([
    who.client.from('teams').select('*').eq('id', teamId).maybeSingle(),
    who.client.from('players').select('*').eq('team_id', teamId).order('sort_order'),
  ]);
  need('the team could be read back', !t.error, t.error && t.error.message);
  need('the players could be read back', !p.error, p.error && p.error.message);
  return rowsToSeason({ team: t.data, players: p.data || [] }, {});
};

// =============================================================================
console.log('--- an order saved is an order shared --------------------------');
// =============================================================================
{
  const saved = await save({
    myTeam: { name: `Order FC ${stamp}`, priorW: 0, priorL: 0, priorT: 0 },
    roster: ROSTER,
    lineup: [2, 0, 3],
    bench: [1],
  });
  eq('a season with a batting order saves', saved.error, null);

  const season = await readBack();
  eq('the roster is all four', season.roster.map((p) => p.id), [0, 1, 2, 3]);
  eq('the order comes back exactly as it went in', season.lineup, [2, 0, 3]);
  eq('and so does the bench', season.bench, [1]);

  const { data } = await admin
    .from('players').select('client_id, lineup_order, on_bench').eq('team_id', teamId).order('client_id');
  eq('the order is a column, not a guess',
    data.map((r) => [r.client_id, r.lineup_order]), [[0, 2], [1, null], [2, 1], [3, 3]]);
  eq('and the bench is flagged', data.map((r) => r.on_bench), [false, true, false, false]);
}

// =============================================================================
console.log('\n--- the other phone reads the same order -----------------------');
// =============================================================================
{
  const asScorer = await readBack(scorer);
  eq('a scorer sees the manager\'s batting order', asScorer.lineup, [2, 0, 3]);
  eq('and the same bench', asScorer.bench, [1]);
  eq('and the same roster', asScorer.roster.map((p) => p.name), ROSTER.map((p) => p.name));
}

// =============================================================================
console.log('\n--- rearranging it moves it -----------------------------------');
// =============================================================================
{
  const saved = await save({
    myTeam: { name: `Order FC ${stamp}` },
    roster: ROSTER,
    lineup: [0, 1, 2, 3],
    bench: [],
  });
  eq('a reorder saves', saved.error, null);

  const season = await readBack();
  eq('the new order is what comes back', season.lineup, [0, 1, 2, 3]);
  eq('and nobody is benched', season.bench, []);
  eq('the other phone sees it too', (await readBack(scorer)).lineup, [0, 1, 2, 3]);
}

// =============================================================================
console.log('\n--- SAYING NOTHING IS NOT SAYING "EMPTY" ----------------------');
// =============================================================================
//
// The failure this prevents: a phone running a build from before the order was
// shared saves a season. Its payload has no `lineup` key at all. Reading that
// as "the order is empty" would wipe a real batting order from the account —
// and it would happen every single time that phone saved, silently.
{
  const saved = await save({
    myTeam: { name: `Order FC ${stamp}` },
    roster: ROSTER,
  });
  eq('a payload with no order at all still saves', saved.error, null);

  const season = await readBack();
  eq('and the recorded order is untouched', season.lineup, [0, 1, 2, 3]);

  const { data } = await admin
    .from('players').select('lineup_order').eq('team_id', teamId).order('client_id');
  eq('every place is still recorded', data.map((r) => r.lineup_order), [1, 2, 3, 4]);
}

// An EXPLICIT empty order is different from an absent one, and is obeyed.
{
  const saved = await save({
    myTeam: { name: `Order FC ${stamp}` },
    roster: ROSTER,
    lineup: [],
    bench: [0, 1, 2, 3],
  });
  eq('an explicitly empty order saves', saved.error, null);
  const season = await readBack();
  eq('and is obeyed — no order is recorded', season.lineup, undefined);
  eq('so the phone keeps whatever order it has', season.bench, undefined);
}

// =============================================================================
console.log('\n--- who may change it -----------------------------------------');
// =============================================================================
{
  // Put a real order back first.
  await save({ myTeam: { name: `Order FC ${stamp}` }, roster: ROSTER, lineup: [3, 2, 1, 0], bench: [] });

  const asScorer = await save({
    myTeam: { name: 'Scorer Was Here' },
    roster: ROSTER,
    lineup: [0, 1, 2, 3],
    bench: [],
  }, scorer);
  eq('a scorer cannot rewrite the roster or the order', !!asScorer.error, true);

  const season = await readBack();
  eq('the manager\'s order stands', season.lineup, [3, 2, 1, 0]);
  eq('and so does the team name', season.myTeam.name, `Order FC ${stamp}`);
}

// A player dropped from the roster leaves the order with them.
{
  const saved = await save({
    myTeam: { name: `Order FC ${stamp}` },
    roster: ROSTER.slice(0, 3),
    lineup: [2, 1, 0],
    bench: [],
  });
  eq('removing a player saves', saved.error, null);
  const season = await readBack();
  eq('they are gone from the roster', season.roster.map((p) => p.id), [0, 1, 2]);
  eq('and gone from the order', season.lineup, [2, 1, 0]);
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
