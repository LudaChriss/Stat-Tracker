// Adversarial RLS probe — written independently of the policy author.
//
// A passing policy test only proves the test agrees with the policy. This suite
// attacks the database as a real signed-in user and asserts the attacks fail,
// which is a different question. It was written after the policies and found
// four real defects on its first run:
//
//   * a brand-new signup had no profile row, so the first thing anyone does —
//     create a team — failed on a foreign key
//   * created_by had no default while the insert policies required it to equal
//     auth.uid(), so ordinary inserts were rejected as policy violations
//   * games demanded team name snapshots the caller should not have to supply
//   * creating a league did not make you its admin, so you could end up with a
//     league you could not administer, or (if private) could not even read
//
// Skips cleanly when there is no local Supabase, so `npm test` still passes on
// a machine without Docker.

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';

const repoRoot = new URL('..', import.meta.url).pathname;

let st;
try {
  st = JSON.parse(
    execSync('npx supabase status -o json', {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString(),
  );
} catch {
  console.log('skipped — no local Supabase stack (npx supabase start --ignore-health-check)');
  process.exit(0);
}

const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
try {
  // Probe the dependency we actually need, not just the REST root: right after
  // a db reset the API answers before GoTrue is ready.
  const probe = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (probe.error) throw probe.error;
} catch {
  console.log('skipped — local Supabase not reachable');
  process.exit(0);
}

let fail = 0;

/** An attack passes when it is refused, or silently filtered to nothing. */
const denied = (label, { error, data }) => {
  const blocked = !!error || !data || (Array.isArray(data) && data.length === 0);
  if (blocked) console.log('ok   blocked: ' + label);
  else {
    fail++;
    console.log('FAIL SECURITY HOLE — allowed: ' + label);
  }
};

const allowed = (label, condition) => {
  if (condition) console.log('ok   ' + label);
  else {
    fail++;
    console.log('FAIL ' + label);
  }
};

const signUp = async (email) => {
  const password = 'Password123!';
  await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const client = createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { client, id: data.user.id };
};

const n = Date.now();
const anon = createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false } });
const mallory = await signUp(`mallory${n}@example.test`);
const victim = await signUp(`victim${n}@example.test`);

// --- a new account can actually get started ---------------------------------
const profile = await admin.from('profiles').select('id').eq('id', victim.id).maybeSingle();
allowed('a new signup gets a profile row automatically', !!profile.data);

const { data: teamId, error: teamErr } = await victim.client.rpc('create_team_with_manager', {
  team_name: 'Victim FC',
});
allowed('a new user can create a team', !teamErr && !!teamId);
if (teamErr) {
  console.log(`\n1 FAILED (setup: ${teamErr.message})`);
  process.exit(1);
}

// --- privilege escalation ----------------------------------------------------
denied(
  'granting yourself league_admin by inserting a membership',
  await mallory.client
    .from('memberships')
    .insert({ user_id: mallory.id, team_id: teamId, role: 'league_admin' })
    .select(),
);
denied(
  "granting yourself team_manager on someone else's team",
  await mallory.client
    .from('memberships')
    .insert({ user_id: mallory.id, team_id: teamId, role: 'team_manager' })
    .select(),
);
denied(
  'escalating your own existing membership by update',
  await victim.client.from('memberships').update({ role: 'league_admin' }).eq('team_id', teamId).select(),
);

// --- cross-team tampering ----------------------------------------------------
denied(
  "inserting a player onto another manager's team",
  await mallory.client.from('players').insert({ team_id: teamId, name: 'Injected', position: 'P' }).select(),
);
denied(
  "renaming another manager's team",
  await mallory.client.from('teams').update({ name: 'Owned' }).eq('id', teamId).select(),
);
denied(
  'creating an invite for a team you do not manage',
  await mallory.client
    .from('invites')
    .insert({ code: `evil${n}`, team_id: teamId, role: 'team_manager' })
    .select(),
);

// --- anonymous writes --------------------------------------------------------
denied('anonymous creating a team', await anon.from('teams').insert({ name: 'Anon FC' }).select());
denied(
  'anonymous inserting a membership',
  await anon.from('memberships').insert({ user_id: mallory.id, team_id: teamId, role: 'viewer' }).select(),
);

// --- the event log is append-only -------------------------------------------
const league = await victim.client.rpc('create_league_with_admin', { league_name: `L${n}` });
allowed('a signed-in user can create a league', !league.error);

const { data: team2 } = await victim.client.rpc('create_team_with_manager', { team_name: 'Opponent FC' });
const game = await victim.client
  .from('games')
  .insert({
    league_id: league.data ?? null,
    home_team_id: teamId,
    away_team_id: team2,
    status: 'live',
    sport: 'kickball',
  })
  .select()
  .maybeSingle();
allowed('a manager can schedule a game between their teams', !game.error);

if (game.data) {
  const appended = await victim.client
    .from('game_events')
    .insert({ game_id: game.data.id, seq: 1, kind: 'outcome', payload: { k: '1B' }, actor: victim.id })
    .select();
  allowed('a scorer can append to their own game log', !appended.error);

  denied(
    'rewriting your own event (the log must be immutable)',
    await victim.client.from('game_events').update({ payload: { k: 'HR' } }).eq('game_id', game.data.id).select(),
  );
  denied(
    'deleting your own event',
    await victim.client.from('game_events').delete().eq('game_id', game.data.id).select(),
  );
  denied(
    'appending to a game you are not scoring',
    await mallory.client
      .from('game_events')
      .insert({ game_id: game.data.id, seq: 2, kind: 'outcome', payload: {}, actor: mallory.id })
      .select(),
  );
}

// --- league visibility -------------------------------------------------------
const priv = await victim.client.rpc('create_league_with_admin', {
  league_name: `P${n}`,
  league_sport: 'kickball',
  league_visibility: 'private',
});
allowed('a signed-in user can create a private league', !priv.error);

if (priv.data) {
  denied('anonymous reading a private league', await anon.from('leagues').select('*').eq('id', priv.data));
  const pub = await anon.from('leagues').select('*').eq('id', league.data);
  allowed('anonymous can read a public league', !!(pub.data && pub.data.length));
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
