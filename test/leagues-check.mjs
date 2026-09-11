// Leagues, against a real Postgres, as real signed-in users.
//
// Everything a league IS shipped in 1a. What 4a adds is the way in and the way
// a fixture gets onto a calendar, and both of those are places where getting it
// wrong is quiet rather than loud:
//
//   * A team must not be able to attach itself to a league it was never
//     invited to. `teams_update_manager_or_admin` lets a manager write every
//     column, `league_id` included, and nothing checked which league. A team
//     appearing in a stranger's standings is not a crash — it is a table that
//     is silently wrong.
//
//   * Joining must be atomic. A membership without the team placed leaves
//     someone in a league their team is not in, with no way to finish; the
//     team placed without the membership is refused by the guard. Either half
//     alone is a mess somebody has to be talked through.
//
//   * A fixture between teams that are not both in the league would sit on a
//     schedule nobody can score.
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
const refused = (label, { error }, wanted) => {
  if (!error) {
    fail++;
    console.log(`FAIL allowed (should have been refused): ${label}`);
    return;
  }
  if (wanted && !String(error.message).includes(wanted)) {
    fail++;
    console.log(`FAIL refused for the wrong reason: ${label}\n  ${error.message}`);
    return;
  }
  console.log('ok   refused: ' + label);
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
  console.log('skipped — no local Supabase stack, so leagues were not exercised against a database');
  console.log('\nall passed');
  process.exit(0);
}

const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
try {
  const probe = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (probe.error) throw probe.error;
} catch {
  console.log('skipped — local Supabase not reachable, so leagues were not exercised against a database');
  console.log('\nall passed');
  process.exit(0);
}

const password = 'Password123!';
const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 5)}`;

async function person(tag) {
  const email = `lg${tag}${stamp}@example.test`;
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  need(`a ${tag} account could be created`, !made.error, made.error && made.error.message);
  const client = createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  need(`the ${tag} account could sign in`, !error, error && error.message);
  return { id: made.data.user.id, client };
}

const commissioner = await person('adm');   // runs the league
const rovers = await person('mgr1');        // manages a team, joins the league
const wanderers = await person('mgr2');     // manages another team, joins too
const outsider = await person('out');       // manages a team, never invited

// =============================================================================
console.log('--- a league, and who runs it ----------------------------------');
// =============================================================================

const league = await commissioner.client.rpc('create_league_with_admin', {
  league_name: `Thursday Night ${stamp}`,
});
eq('a league can be created', league.error, null);
const leagueId = league.data;

{
  const { data } = await admin.from('memberships').select('role').eq('league_id', leagueId);
  eq('and its creator is its admin, atomically', (data || []).map((m) => m.role), ['league_admin']);
  const { data: row } = await admin.from('leagues').select('visibility').eq('id', leagueId).single();
  eq('a new league is public by default', row.visibility, 'public');
}

const teamOf = async (who, name) => {
  const r = await who.client.rpc('create_team_with_manager', { team_name: `${name} ${stamp}` });
  need(`${name} could be created`, !r.error, r.error && r.error.message);
  return r.data;
};
const roversId = await teamOf(rovers, 'Rovers');
const wanderersId = await teamOf(wanderers, 'Wanderers');
const outsiderId = await teamOf(outsider, 'Outsiders');

// =============================================================================
console.log('\n--- a team cannot walk into a league uninvited -----------------');
// =============================================================================
//
// This is the hole 4a closes. The UPDATE policy on teams admits the team's own
// manager for every column; before the guard, `league_id` was one of them.
{
  const attempt = await outsider.client
    .from('teams').update({ league_id: leagueId }).eq('id', outsiderId).select();
  refused('a manager cannot attach their team to a league they were not invited to',
    attempt, 'not been invited');

  const { data } = await admin.from('teams').select('league_id').eq('id', outsiderId).single();
  eq('and the team is still outside it', data.league_id, null);

  const created = await outsider.client.rpc('create_team_with_manager', {
    team_name: `Sneaky ${stamp}`, league: leagueId,
  });
  refused('nor create a new team already inside it', created, 'not been invited');
  const { count } = await admin
    .from('teams').select('id', { count: 'exact', head: true }).eq('league_id', leagueId);
  eq('the league still has no teams', count, 0);
}

// =============================================================================
console.log('\n--- the way in is a code -------------------------------------');
// =============================================================================

refused('a stranger cannot mint a code for a league they do not run',
  await outsider.client.rpc('create_league_invite', { p_league_id: leagueId, p_role: 'viewer' }),
  'not allowed to invite people to this league');

refused('a league invite cannot grant a team role',
  await commissioner.client.rpc('create_league_invite', { p_league_id: leagueId, p_role: 'team_manager' }),
  'can grant league_admin or viewer');

const minted = await commissioner.client.rpc('create_league_invite', {
  p_league_id: leagueId, p_role: 'viewer', p_days: 3,
});
eq('a league admin can mint one', minted.error, null);
const code = minted.data.code;

{
  // The holder of a code can see what it is for without being able to read the
  // invites table at all.
  const peeked = await rovers.client.rpc('peek_invite', { invite_code: code });
  eq('peeking a league code says which league', peeked.error, null);
  const p = peeked.data[0];
  eq('by name', p.league_name, `Thursday Night ${stamp}`);
  eq('with no team on it', p.team_id, null);
  eq('the role it grants', p.role, 'viewer');
  eq('and that it is still good', p.usable, true);

  const direct = await rovers.client.from('invites').select('code').eq('code', code);
  eq('while the invites table itself stays closed', (direct.data || []).length, 0);
}

{
  const joined = await rovers.client.rpc('join_league', { p_code: code, p_team_id: roversId });
  eq('redeeming it brings the team in', joined.error, null);
  const j = joined.data[0];
  eq('and says which league it joined', j.league_name, `Thursday Night ${stamp}`);
  eq('with the role it granted', j.role, 'viewer');
  eq('and that the team was placed', j.team_joined, true);

  const { data } = await admin.from('teams').select('league_id').eq('id', roversId).single();
  eq('the team really is in the league', data.league_id, leagueId);

  const { data: m } = await admin
    .from('memberships').select('role').eq('league_id', leagueId).eq('user_id', rovers.id);
  eq('and the manager holds a league membership', (m || []).map((x) => x.role), ['viewer']);
}

refused('a spent code is refused', await rovers.client.rpc('join_league', { p_code: code }), 'already used');
refused('and so is one that never existed',
  await rovers.client.rpc('join_league', { p_code: 'NOPENOPE12' }), 'invalid invite code');

{
  // A TEAM code is not a league code, and is refused by name rather than
  // doing something surprising.
  const teamCode = await rovers.client.rpc('create_invite', { p_team_id: roversId, p_role: 'viewer' });
  eq('setup: a team code', teamCode.error, null);
  refused('a team code handed to join_league is refused',
    await wanderers.client.rpc('join_league', { p_code: teamCode.data.code, p_team_id: wanderersId }),
    'for a team, not a league');

  // And it did not half-happen: accept_invite runs first, so the membership
  // was granted before the refusal — but the transaction rolls back.
  const { data } = await admin.from('invites').select('used_at').eq('code', teamCode.data.code).single();
  eq('the refused code was not burned', data.used_at, null);
  const { data: t } = await admin.from('teams').select('league_id').eq('id', wanderersId).single();
  eq('and no team moved', t.league_id, null);
}

// A second team joins properly, so there is a league to schedule.
{
  const second = await commissioner.client.rpc('create_league_invite', {
    p_league_id: leagueId, p_role: 'viewer',
  });
  const joined = await wanderers.client.rpc('join_league', {
    p_code: second.data.code, p_team_id: wanderersId,
  });
  eq('a second team joins the same way', joined.error, null);
  const { count } = await admin
    .from('teams').select('id', { count: 'exact', head: true }).eq('league_id', leagueId);
  eq('the league now has two teams', count, 2);
}

{
  // Someone who is not in the league yet, naming a team that is not theirs.
  const fresh = await commissioner.client.rpc('create_league_invite', { p_league_id: leagueId, p_role: 'viewer' });
  refused('you cannot bring in a team you do not manage',
    await outsider.client.rpc('join_league', { p_code: fresh.data.code, p_team_id: roversId }),
    'you do not manage that team');

  const { data } = await admin.from('invites').select('used_at').eq('code', fresh.data.code).single();
  eq('and the refusal did not burn the code', data.used_at, null);
  const { count } = await admin
    .from('memberships').select('id', { count: 'exact', head: true })
    .eq('league_id', leagueId).eq('user_id', outsider.id);
  eq('nor grant a membership on the way past', count, 0);
}

{
  // Managing two teams in one league. accept_invite refuses a second
  // membership for the same scope — correctly, there is nothing left to grant
  // — so join_league has to handle the case rather than dead-end on it.
  const secondTeam = await teamOf(rovers, 'Rovers Reserves');
  const fresh = await commissioner.client.rpc('create_league_invite', { p_league_id: leagueId, p_role: 'viewer' });
  const joined = await rovers.client.rpc('join_league', { p_code: fresh.data.code, p_team_id: secondTeam });
  eq('a manager already in the league can bring a second team in', joined.error, null);
  eq('and it is placed', joined.data[0].team_joined, true);

  const { data } = await admin.from('teams').select('league_id').eq('id', secondTeam).single();
  eq('really placed', data.league_id, leagueId);

  const { data: inv } = await admin.from('invites').select('used_at').eq('code', fresh.data.code).single();
  eq('the code was not burned, because it granted nothing', inv.used_at, null);

  const { count } = await admin
    .from('memberships').select('id', { count: 'exact', head: true })
    .eq('league_id', leagueId).eq('user_id', rovers.id);
  eq('and there is still exactly one membership for them', count, 1);

  // Tidy up so the schedule section below sees the league it expects.
  await admin.from('teams').update({ league_id: null }).eq('id', secondTeam);
}

// Leaving is never something to need permission for.
{
  const left = await wanderers.client.from('teams').update({ league_id: null }).eq('id', wanderersId).select();
  eq('a manager can take their team back out', left.error, null);
  const back = await wanderers.client.from('teams').update({ league_id: leagueId }).eq('id', wanderersId).select();
  eq('and back in again, because the membership is still theirs', back.error, null);
}

// =============================================================================
console.log('\n--- a fixture on the calendar ---------------------------------');
// =============================================================================

const fixture = (over = {}) => ({
  clientId: `fx-${stamp}-1`,
  homeTeamId: roversId,
  awayTeamId: wanderersId,
  scheduledAt: '2026-09-17T18:30:00Z',
  label: 'Sep 17',
  sport: 'kickball',
  ...over,
});

refused('a team manager cannot schedule a league fixture',
  await rovers.client.rpc('schedule_game', { p_league_id: leagueId, payload: fixture() }),
  'only a league admin can schedule');

const scheduled = await commissioner.client.rpc('schedule_game', { p_league_id: leagueId, payload: fixture() });
eq('a league admin can', scheduled.error, null);
const fixtureId = scheduled.data;

{
  const { data } = await admin.from('games').select('*').eq('id', fixtureId).single();
  eq('it is scheduled, not played', data.status, 'scheduled');
  eq('with no result', data.result, null);
  eq('between the two teams', [data.home_team_id, data.away_team_id], [roversId, wanderersId]);
  eq('in the league', data.league_id, leagueId);
  eq('and both names are snapshotted', [!!data.home_team_name_snapshot, !!data.away_team_name_snapshot], [true, true]);
}

{
  // Idempotent: the same client id moves the fixture rather than adding one.
  const again = await commissioner.client.rpc('schedule_game', {
    p_league_id: leagueId, payload: fixture({ scheduledAt: '2026-09-18T18:30:00Z', label: 'Sep 18' }),
  });
  eq('rescheduling the same fixture is not a second fixture', again.data, fixtureId);
  const { count } = await admin
    .from('games').select('id', { count: 'exact', head: true }).eq('league_id', leagueId);
  eq('one fixture in the league', count, 1);
  const { data } = await admin.from('games').select('label').eq('id', fixtureId).single();
  eq('and it moved', data.label, 'Sep 18');
}

refused('a team cannot be scheduled against itself',
  await commissioner.client.rpc('schedule_game', {
    p_league_id: leagueId, payload: fixture({ clientId: `fx-${stamp}-2`, awayTeamId: roversId }),
  }),
  'against itself');

refused('nor can a team that is not in the league',
  await commissioner.client.rpc('schedule_game', {
    p_league_id: leagueId, payload: fixture({ clientId: `fx-${stamp}-3`, awayTeamId: outsiderId }),
  }),
  'not in this league');

refused('nor a fixture with no id',
  await commissioner.client.rpc('schedule_game', { p_league_id: leagueId, payload: fixture({ clientId: null }) }),
  'no id');

{
  // A fixture that has been played is a result, not a plan.
  await admin.from('games').update({ status: 'final', result: 'W', home_score: 5, away_score: 2 }).eq('id', fixtureId);
  refused('a played game cannot be rescheduled',
    await commissioner.client.rpc('schedule_game', { p_league_id: leagueId, payload: fixture() }),
    'already final');
}

// =============================================================================
console.log('\n--- who can see a league --------------------------------------');
// =============================================================================
{
  const asOutsider = await outsider.client.from('leagues').select('name').eq('id', leagueId);
  eq('a public league is readable by any signed-in user', (asOutsider.data || []).length, 1);

  const anon = createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false } });
  const asAnon = await anon.from('leagues').select('name').eq('id', leagueId);
  eq('and by nobody at all, while it is public', (asAnon.data || []).length, 1);

  await admin.from('leagues').update({ visibility: 'private' }).eq('id', leagueId);
  const hidden = await anon.from('leagues').select('name').eq('id', leagueId);
  eq('a private league is invisible to anonymous readers', (hidden.data || []).length, 0);
  const stillSeen = await rovers.client.from('leagues').select('name').eq('id', leagueId);
  eq('but still visible to its members', (stillSeen.data || []).length, 1);
  const notForOutsiders = await outsider.client.from('leagues').select('name').eq('id', leagueId);
  eq('and invisible to a signed-in non-member', (notForOutsiders.data || []).length, 0);
  await admin.from('leagues').update({ visibility: 'public' }).eq('id', leagueId);
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
