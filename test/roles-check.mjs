// What each role can actually reach.
//
// Every assertion here is made as a real signed-in user against a real
// Postgres, through PostgREST, with row-level security on. Nothing asserts that
// a policy expression "looks right": the 1b lesson was that 26 passing
// assertions hid a brand-new user who could not create a team at all.
//
// The four roles and the promise for each:
//
//   league_admin   everything within their league
//   team_manager   owns the roster and the lineup; can score
//   team_scorer    can score their own team's games and edit those box scores;
//                  cannot touch the roster
//   viewer         reads; changes nothing
//
// Runs against the LOCAL stack only.

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';

const repoRoot = new URL('..', import.meta.url).pathname;

let fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    fail++;
    console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  } else console.log('ok   ' + label);
};
const allowed = (label, { error }) => {
  if (error) {
    fail++;
    console.log(`FAIL blocked (should have been allowed): ${label}\n  ${error.code || ''} ${error.message}`);
  } else console.log('ok   allowed: ' + label);
};
const refused = (label, { error }) => {
  if (!error) {
    fail++;
    console.log(`FAIL allowed (should have been refused): ${label}`);
  } else console.log('ok   refused: ' + label);
};
/** A write that RLS silently turns into a no-op rather than an error. */
const changedNothing = async (label, check, want) => {
  const got = await check();
  eq(label, got, want);
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

const password = 'Password123!';
const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 5)}`;

/** A real signed-in client, the way the app has one. */
async function person(tag) {
  const email = `${tag}${stamp}@example.test`;
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (made.error) throw new Error(`could not create ${tag}: ${made.error.message}`);
  const client = createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`could not sign in ${tag}: ${error.message}`);
  return { id: made.data.user.id, email, client };
}

const manager = await person('mgr');
const scorer = await person('scr');
const viewer = await person('vwr');
const leagueAdmin = await person('adm');
const stranger = await person('str');

// --- a league, a team in it, and a game ---------------------------------------
const league = await leagueAdmin.client.rpc('create_league_with_admin', { league_name: `Roles League ${stamp}` });
eq('setup: the league was created', !league.error, true);
const leagueId = league.data;

// Created OUTSIDE the league. Since 4a a team can only enter a league whose
// code its manager has redeemed, and this manager has not — putting a team
// into somebody else's league by naming its id is exactly what that guard
// stops. The next line places it with the service key, which is what an admin
// doing it on their own league amounts to here; this suite is about role
// reach, not about joining.
const team = await manager.client.rpc('create_team_with_manager', { team_name: `Roles FC ${stamp}` });
eq('setup: the team was created', !team.error, true);
const teamId = team.data;

// Put the team in the league, as its admin would.
const placed = await admin.from('teams').update({ league_id: leagueId }).eq('id', teamId);
eq('setup: the team is in the league', !placed.error, true);

// The other roles are granted the way 2c will grant them: through memberships.
// Inserted here with the service key so this file tests REACH, not the invite
// flow — that is invites-check.mjs.
const grant = await admin.from('memberships').insert([
  { user_id: scorer.id, team_id: teamId, role: 'team_scorer' },
  { user_id: viewer.id, team_id: teamId, role: 'viewer' },
]);
eq('setup: a scorer and a viewer hold roles on the team', !grant.error, true);

const opponent = await manager.client.rpc('create_team_with_manager', { team_name: `Roles Opp ${stamp}` });
const opponentId = opponent.data;

const player = await admin.from('players')
  .insert({ team_id: teamId, name: 'Test Player', position: 'P', color: '#0E7490', client_id: 1, sort_order: 1 })
  .select('id').single();
eq('setup: the team has a player', !player.error, true);
if (player.error) { console.log('CANNOT RUN: ' + player.error.message); process.exit(2); }

const game = await admin.from('games').insert({
  home_team_id: teamId, away_team_id: opponentId, league_id: leagueId,
  status: 'scheduled', sport: 'kickball', created_by: manager.id,
}).select('id').single();
eq('setup: a game exists', !game.error, true);
const gameId = game.data.id;

// =============================================================================
console.log('\n--- viewer: reads, changes nothing -----------------------------');
// =============================================================================
allowed('a viewer reads the team', await viewer.client.from('teams').select('*').eq('id', teamId).single());
allowed('a viewer reads the roster', await viewer.client.from('players').select('*').eq('team_id', teamId));
allowed('a viewer reads the games', await viewer.client.from('games').select('*').eq('id', gameId));

await changedNothing(
  'a viewer cannot rename the team',
  async () => {
    await viewer.client.from('teams').update({ name: 'Viewer Was Here' }).eq('id', teamId);
    const { data } = await admin.from('teams').select('name').eq('id', teamId).single();
    return data.name;
  },
  `Roles FC ${stamp}`,
);
await changedNothing(
  'a viewer cannot rename a player',
  async () => {
    await viewer.client.from('players').update({ name: 'Viewer Was Here' }).eq('id', player.data.id);
    const { data } = await admin.from('players').select('name').eq('id', player.data.id).single();
    return data.name;
  },
  'Test Player',
);
await changedNothing(
  'a viewer cannot add a player',
  async () => {
    await viewer.client.from('players').insert({ team_id: teamId, name: 'Sneaked In', position: 'P', color: '#0E7490', client_id: 99 });
    const { data } = await admin.from('players').select('id').eq('team_id', teamId);
    return data.length;
  },
  1,
);
await changedNothing(
  'a viewer cannot change the score',
  async () => {
    await viewer.client.from('games').update({ home_score: 99 }).eq('id', gameId);
    const { data } = await admin.from('games').select('home_score').eq('id', gameId).single();
    return data.home_score;
  },
  0, // the column default; the point is that it is not 99
);
refused('a viewer finalizing a game',
  await viewer.client.rpc('save_game', {
    p_team_id: teamId,
    payload: { id: `v-${stamp}`, opponent: 'X', home: true, score: { us: 1, them: 0 }, result: 'W',
      lines: [{ pid: 'h1', name: 'Test Player', team: 'home', ab: 1, h: 1 }] },
  }));
refused('a viewer saving the roster',
  await viewer.client.rpc('save_season', { p_team_id: teamId, payload: { myTeam: { name: 'Nope' }, roster: [] } }));
refused('a viewer creating an invite',
  await viewer.client.from('invites').insert({ team_id: teamId, role: 'viewer', code: `vw${stamp}`,
    expires_at: new Date(Date.now() + 8.64e7).toISOString(), created_by: viewer.id }));

// =============================================================================
console.log('\n--- scorer: scores their team, owns no roster -------------------');
// =============================================================================
allowed('a scorer reads the roster', await scorer.client.from('players').select('*').eq('team_id', teamId));

await changedNothing(
  'a scorer cannot add a player',
  async () => {
    await scorer.client.from('players').insert({ team_id: teamId, name: 'Scorer Added', position: 'P', color: '#0E7490', client_id: 98 });
    const { data } = await admin.from('players').select('id').eq('team_id', teamId);
    return data.length;
  },
  1,
);
await changedNothing(
  'a scorer cannot rename a player',
  async () => {
    await scorer.client.from('players').update({ name: 'Scorer Renamed' }).eq('id', player.data.id);
    const { data } = await admin.from('players').select('name').eq('id', player.data.id).single();
    return data.name;
  },
  'Test Player',
);
await changedNothing(
  'a scorer cannot rename the team',
  async () => {
    await scorer.client.from('teams').update({ name: 'Scorer FC' }).eq('id', teamId);
    const { data } = await admin.from('teams').select('name').eq('id', teamId).single();
    return data.name;
  },
  `Roles FC ${stamp}`,
);
refused('a scorer saving the roster',
  await scorer.client.rpc('save_season', { p_team_id: teamId, payload: { myTeam: { name: 'Nope' }, roster: [] } }));

allowed('a scorer updates the live score',
  await scorer.client.from('games').update({ home_score: 3, away_score: 1 }).eq('id', gameId));
allowed('a scorer writes a box-score line',
  await scorer.client.from('game_lines').insert({
    game_id: gameId, team_id: teamId, player_id: player.data.id, name_snapshot: 'Test Player',
    home_away: 'home', ab: 3, h: 2, client_pid: 'h1',
  }));
allowed('a scorer edits that box-score line',
  await scorer.client.from('game_lines').update({ h: 3 }).eq('game_id', gameId).eq('client_pid', 'h1'));
allowed('a scorer appends a game event',
  await scorer.client.from('game_events').insert({ game_id: gameId, seq: 1, kind: 'test', payload: {} }));

// THE 2b REQUIREMENT: a scorer can finalize their team's game.
allowed('a scorer finalizes their team\'s game',
  await scorer.client.rpc('save_game', {
    p_team_id: teamId,
    payload: { id: `s-${stamp}`, opponentId: 'roles-opp', opponent: `Roles Opp ${stamp}`, home: true,
      date: '2026-09-11', label: 'Sep 11', score: { us: 6, them: 2 }, result: 'W',
      sport: 'kickball', innings: 7,
      lines: [{ pid: 'h1', name: 'Test Player', team: 'home', ab: 4, h: 3, r: 1, rbi: 2, bb: 0, k: 0, d: 0, t: 0, hr: 1 }] },
  }));

// ...and only for their own team.
const foreign = await person('fgn');
const foreignTeam = await foreign.client.rpc('create_team_with_manager', { team_name: `Foreign FC ${stamp}` });
refused('a scorer finalizing a game for a team they have no role on',
  await scorer.client.rpc('save_game', {
    p_team_id: foreignTeam.data,
    payload: { id: `s2-${stamp}`, opponent: 'X', home: true, score: { us: 1, them: 0 }, result: 'W',
      lines: [{ pid: 'h1', name: 'X', team: 'home', ab: 1, h: 1 }] },
  }));
refused('a scorer creating an invite',
  await scorer.client.from('invites').insert({ team_id: teamId, role: 'viewer', code: `sc${stamp}`,
    expires_at: new Date(Date.now() + 8.64e7).toISOString(), created_by: scorer.id }));

// =============================================================================
console.log('\n--- manager: everything about their own team --------------------');
// =============================================================================
allowed('a manager adds a player',
  await manager.client.from('players').insert({ team_id: teamId, name: 'Manager Added', position: 'P', color: '#0E7490', client_id: 2, sort_order: 2 }));
allowed('a manager renames the team',
  await manager.client.from('teams').update({ name: `Roles FC ${stamp}` }).eq('id', teamId));
allowed('a manager saves the roster',
  await manager.client.rpc('save_season', {
    p_team_id: teamId,
    payload: { myTeam: { name: `Roles FC ${stamp}` }, roster: [{ id: 1, name: 'Test Player', num: 7, pos: 'P', c: '#0E7490' }] },
  }));
allowed('a manager finalizes a game',
  await manager.client.rpc('save_game', {
    p_team_id: teamId,
    payload: { id: `m-${stamp}`, opponentId: 'roles-opp', opponent: `Roles Opp ${stamp}`, home: true,
      date: '2026-09-12', label: 'Sep 12', score: { us: 4, them: 4 }, result: 'T', sport: 'kickball', innings: 7,
      lines: [{ pid: 'h1', name: 'Test Player', team: 'home', ab: 3, h: 1, r: 0, rbi: 0, bb: 0, k: 0, d: 0, t: 0, hr: 0 }] },
  }));
allowed('a manager creates an invite',
  await manager.client.from('invites').insert({ team_id: teamId, role: 'team_scorer', code: `mg${stamp}`,
    expires_at: new Date(Date.now() + 8.64e7).toISOString(), created_by: manager.id }));

// =============================================================================
console.log('\n--- league admin: their league, and nothing outside it ----------');
// =============================================================================
allowed('a league admin renames a team in their league',
  await leagueAdmin.client.from('teams').update({ name: `Roles FC ${stamp}` }).eq('id', teamId));
allowed('a league admin edits a roster in their league',
  await leagueAdmin.client.from('players').update({ number: 12 }).eq('id', player.data.id));
allowed('a league admin finalizes a game in their league',
  await leagueAdmin.client.rpc('save_game', {
    p_team_id: teamId,
    payload: { id: `a-${stamp}`, opponentId: 'roles-opp', opponent: `Roles Opp ${stamp}`, home: true,
      date: '2026-09-13', label: 'Sep 13', score: { us: 2, them: 5 }, result: 'L', sport: 'kickball', innings: 7,
      lines: [{ pid: 'h1', name: 'Test Player', team: 'home', ab: 3, h: 0, r: 0, rbi: 0, bb: 0, k: 1, d: 0, t: 0, hr: 0 }] },
  }));

await changedNothing(
  'a league admin cannot touch a team outside their league',
  async () => {
    await leagueAdmin.client.from('teams').update({ name: 'Admin Reached Too Far' }).eq('id', foreignTeam.data);
    const { data } = await admin.from('teams').select('name').eq('id', foreignTeam.data).single();
    return data.name;
  },
  `Foreign FC ${stamp}`,
);

// =============================================================================
console.log('\n--- stranger: nothing ------------------------------------------');
// =============================================================================
await changedNothing(
  'a stranger cannot rename the team',
  async () => {
    await stranger.client.from('teams').update({ name: 'Stranger FC' }).eq('id', teamId);
    const { data } = await admin.from('teams').select('name').eq('id', teamId).single();
    return data.name;
  },
  `Roles FC ${stamp}`,
);
refused('a stranger finalizing a game',
  await stranger.client.rpc('save_game', {
    p_team_id: teamId,
    payload: { id: `x-${stamp}`, opponent: 'X', home: true, score: { us: 1, them: 0 }, result: 'W',
      lines: [{ pid: 'h1', name: 'X', team: 'home', ab: 1, h: 1 }] },
  }));
eq('a stranger cannot even see the invites',
  ((await stranger.client.from('invites').select('id').eq('team_id', teamId)).data || []).length, 0);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
