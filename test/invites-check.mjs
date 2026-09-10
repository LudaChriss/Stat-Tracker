// Invites: who can mint them, what they grant, and how they run out.
//
// Every assertion is made as a real signed-in user against real Postgres with
// row-level security on. The promises:
//
//   * only a manager (or the league admin) can create one
//   * a team invite can grant team_manager, team_scorer or viewer — never
//     league_admin
//   * accepting one lands the person in the right team with the right role
//   * single-use: the second attempt fails, and the first one's membership
//     is not disturbed
//   * expiring: a code past its date is refused
//   * a code cannot be found by anyone who was not given it
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
const ok = (label, cond, detail) => {
  if (cond) console.log('ok   ' + label);
  else {
    fail++;
    console.log(`FAIL ${label}${detail ? '\n  ' + detail : ''}`);
  }
};
const refused = (label, { error }, fragment) => {
  if (!error) {
    fail++;
    console.log(`FAIL allowed (should have been refused): ${label}`);
    return;
  }
  if (fragment && !error.message.includes(fragment)) {
    fail++;
    console.log(`FAIL refused but not for the stated reason: ${label}\n  ${error.message}`);
    return;
  }
  console.log('ok   refused: ' + label);
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

async function person(tag) {
  const email = `${tag}${stamp}@example.test`;
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (made.error) throw new Error(`could not create ${tag}: ${made.error.message}`);
  const client = createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`could not sign in ${tag}: ${error.message}`);
  return { id: made.data.user.id, email, client };
}

const manager = await person('imgr');
const invitee = await person('inv');
const second = await person('inv2');
const stranger = await person('istr');

const team = await manager.client.rpc('create_team_with_manager', { team_name: `Invite FC ${stamp}` });
eq('setup: a team exists', !team.error, true);
const teamId = team.data;

// --- who may mint one ---------------------------------------------------------
{
  refused('a stranger creating an invite for a team they do not manage',
    await stranger.client.rpc('create_invite', { p_team_id: teamId, p_role: 'viewer' }),
    'not allowed to invite');

  const made = await manager.client.rpc('create_invite', { p_team_id: teamId, p_role: 'team_scorer' });
  ok('a manager can mint one', !made.error, made.error && made.error.message);
  ok('and it comes back with a code', !!(made.data && made.data.code), JSON.stringify(made.data));
  eq('with the role asked for', made.data.role, 'team_scorer');
  eq('scoped to the team', made.data.team_id, teamId);
  eq('and unused', made.data.used_at, null);

  const days = (new Date(made.data.expires_at) - Date.now()) / 86400000;
  ok('expiring about a week out by default', days > 6.5 && days < 7.5, String(days));

  ok('the code is long enough to not be guessed', made.data.code.length >= 10, made.data.code);
  ok('and uses no easily-confused letters', !/[ILOU]/.test(made.data.code), made.data.code);

  // A second one is a different code.
  const another = await manager.client.rpc('create_invite', { p_team_id: teamId, p_role: 'viewer' });
  ok('two invites do not collide', another.data.code !== made.data.code);
}

// --- what it may grant --------------------------------------------------------
{
  refused('a team invite granting league_admin',
    await manager.client.rpc('create_invite', { p_team_id: teamId, p_role: 'league_admin' }),
    'not league_admin');
  refused('a team invite granting a role that does not exist',
    await manager.client.rpc('create_invite', { p_team_id: teamId, p_role: 'owner' }));

  // The lifetime is bounded at both ends.
  const long = await manager.client.rpc('create_invite', { p_team_id: teamId, p_role: 'viewer', p_days: 3650 });
  const longDays = (new Date(long.data.expires_at) - Date.now()) / 86400000;
  ok('a request for a ten-year invite is capped', longDays <= 30.1, String(longDays));

  const short = await manager.client.rpc('create_invite', { p_team_id: teamId, p_role: 'viewer', p_days: -5 });
  const shortDays = (new Date(short.data.expires_at) - Date.now()) / 86400000;
  ok('and a negative one is not already expired', shortDays > 0.5, String(shortDays));
}

// --- accepting ----------------------------------------------------------------
let acceptedCode;
{
  const made = await manager.client.rpc('create_invite', { p_team_id: teamId, p_role: 'team_scorer' });
  acceptedCode = made.data.code;

  // What the invitee can learn before committing to it.
  const peek = await invitee.client.rpc('peek_invite', { invite_code: acceptedCode });
  ok('an invitee can see what a code is for', !peek.error, peek.error && peek.error.message);
  const info = (peek.data || [])[0];
  ok('it names the team', info && info.team_name === `Invite FC ${stamp}`, JSON.stringify(info));
  eq('and the role', info && info.role, 'team_scorer');
  eq('and says it is usable', info && info.usable, true);

  // But not by reading the table.
  eq('the invitee cannot list the team\'s invites',
    ((await invitee.client.from('invites').select('id').eq('team_id', teamId)).data || []).length, 0);

  const accepted = await invitee.client.rpc('accept_invite', { invite_code: acceptedCode });
  ok('the invite is accepted', !accepted.error, accepted.error && accepted.error.message);
  eq('and grants the role it advertised', accepted.data && accepted.data.role, 'team_scorer');
  eq('on the right team', accepted.data && accepted.data.team_id, teamId);

  const membership = await admin.from('memberships').select('role').eq('user_id', invitee.id).eq('team_id', teamId);
  eq('the membership is real', (membership.data || []).map((m) => m.role), ['team_scorer']);

  // And the role actually works: this is the 2b reach, reached through 2c.
  const scored = await invitee.client.rpc('save_game', {
    p_team_id: teamId,
    payload: { id: `inv-${stamp}`, opponentId: 'someone', opponent: 'Someone', home: true,
      date: '2026-09-14', label: 'Sep 14', score: { us: 3, them: 1 }, result: 'W', sport: 'kickball', innings: 7,
      lines: [{ pid: 'h1', name: 'A Player', team: 'home', ab: 3, h: 2, r: 1, rbi: 1, bb: 0, k: 0, d: 0, t: 0, hr: 0 }] },
  });
  ok('the invited scorer can immediately finalize a game', !scored.error, scored.error && scored.error.message);

  // ...but only the scoring half.
  refused('the invited scorer saving the roster',
    await invitee.client.rpc('save_season', { p_team_id: teamId, payload: { myTeam: { name: 'No' }, roster: [] } }));
}

// --- single use ---------------------------------------------------------------
{
  refused('the same code a second time, by someone else',
    await second.client.rpc('accept_invite', { invite_code: acceptedCode }),
    'already used');

  eq('and the second person got nothing',
    ((await admin.from('memberships').select('id').eq('user_id', second.id).eq('team_id', teamId)).data || []).length, 0);

  const membership = await admin.from('memberships').select('role').eq('user_id', invitee.id).eq('team_id', teamId);
  eq('while the first person keeps theirs', (membership.data || []).map((m) => m.role), ['team_scorer']);

  const peek = await second.client.rpc('peek_invite', { invite_code: acceptedCode });
  eq('and a spent code says so before it is tried', ((peek.data || [])[0] || {}).usable, false);
}

// --- expiry -------------------------------------------------------------------
{
  const made = await manager.client.rpc('create_invite', { p_team_id: teamId, p_role: 'viewer' });
  // Age it past its date. The REFUSAL below is accept_invite's own.
  await admin.from('invites').update({ expires_at: new Date(Date.now() - 60000).toISOString() }).eq('id', made.data.id);

  const peek = await second.client.rpc('peek_invite', { invite_code: made.data.code });
  eq('an expired code reports itself unusable', ((peek.data || [])[0] || {}).usable, false);

  refused('accepting an expired code', await second.client.rpc('accept_invite', { invite_code: made.data.code }), 'expired');
  eq('and it granted nothing',
    ((await admin.from('memberships').select('id').eq('user_id', second.id).eq('team_id', teamId)).data || []).length, 0);
}

// --- a code nobody gave you ---------------------------------------------------
{
  refused('a made-up code', await stranger.client.rpc('accept_invite', { invite_code: 'NOTACODE99' }), 'invalid');
  eq('and peeking at one tells you nothing',
    ((await stranger.client.rpc('peek_invite', { invite_code: 'NOTACODE99' })).data || []).length, 0);
}

// --- accepting twice as the same person ---------------------------------------
{
  const made = await manager.client.rpc('create_invite', { p_team_id: teamId, p_role: 'viewer' });
  refused('a second invite for someone who already has a role on that team',
    await invitee.client.rpc('accept_invite', { invite_code: made.data.code }),
    'already exists');

  const membership = await admin.from('memberships').select('role').eq('user_id', invitee.id).eq('team_id', teamId);
  eq('their existing role is not downgraded', (membership.data || []).map((m) => m.role), ['team_scorer']);

  const stillGood = await admin.from('invites').select('used_at').eq('id', made.data.id).single();
  eq('and the invite was not burned by the failed attempt', stillGood.data.used_at, null);
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
