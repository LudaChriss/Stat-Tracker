// Proves the RLS policies + SECURITY DEFINER functions in
// supabase/migrations/20260101000001_rls_policies.sql actually enforce the
// access model against a real local Supabase stack. Skips cleanly (exit 0)
// when the stack isn't reachable, so `npm test` still passes with no Docker.
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

let fail = 0;
let ran = 0;
const eq = (label, got, want) => {
  ran++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log('ok   ' + label);
};

// --- discover local credentials, or skip gracefully -----------------------
let API_URL, ANON_KEY, SERVICE_ROLE_KEY;
try {
  const raw = execSync('npx supabase status -o json', {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 45000,
  }).toString();
  const status = JSON.parse(raw);
  API_URL = status.API_URL;
  ANON_KEY = status.ANON_KEY;
  SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY;
  if (!API_URL || !ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('missing keys in supabase status output');
} catch (e) {
  console.log('skipped — no local Supabase (npx supabase status failed: ' + e.message.split('\n')[0] + ')');
  process.exit(0);
}

const PREFIX = 'RLS Test';
const EMAIL_PREFIX = 'rls-test-';
// Unique per run. Previously these were fixed addresses, cleaned up beforehand
// by listing users and deleting the stale ones — but listUsers is paginated and
// defaults to 50 per page, so once other suites had created enough users the
// stale ones fell off page one, survived the cleanup, and the next createUser
// failed on a duplicate email. That looked like flakiness under load; it was a
// suite that could not be run twice against a database anyone else was using.
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const PASSWORD = 'rls-test-password-123!';

const admin = createClient(API_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(API_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

// A reachability probe against the actual dependency fixture setup needs
// (GoTrue's admin API), with a short retry -- `supabase status` can report a
// running stack moments before every service inside it is actually ready to
// answer requests (e.g. right after `supabase db reset`).
let reachable = false;
let lastErr;
for (let attempt = 0; attempt < 5 && !reachable; attempt++) {
  if (attempt > 0) await new Promise((r) => setTimeout(r, 1000));
  try {
    const { error } = await admin.auth.admin.listUsers({ perPage: 1 });
    if (error) throw new Error(error.message);
    reachable = true;
  } catch (e) {
    lastErr = e;
  }
}
if (!reachable) {
  console.log('skipped — no local Supabase (API not reachable: ' + lastErr?.message + ')');
  process.exit(0);
}

async function cleanup() {
  // Dependency order: games first (cascades game_events/game_lines), then
  // teams (cascades players), then invites/leagues, then auth users
  // (cascades profiles, which cascades memberships).
  await admin.from('games').delete().ilike('label', `${PREFIX}%`);
  await admin.from('teams').delete().ilike('name', `${PREFIX}%`);
  await admin.from('invites').delete().ilike('code', `${EMAIL_PREFIX}%`);
  await admin.from('leagues').delete().ilike('name', `${PREFIX}%`);
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const stale = (data?.users || []).filter((u) => u.email?.startsWith(EMAIL_PREFIX));
  for (const u of stale) await admin.auth.admin.deleteUser(u.id);
}

async function makeUser(handle) {
  const email = `${EMAIL_PREFIX}${handle}-${RUN_ID}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser(${handle}): ${error.message}`);
  const id = data.user.id;
  // A signup trigger creates the profile now, so this only names it. Inserting
  // one by hand here is what hid the missing-profile bug in the first place.
  const { error: perr } = await admin
    .from('profiles')
    .upsert({ id, display_name: handle }, { onConflict: 'id' });
  if (perr) throw new Error(`profile(${handle}): ${perr.message}`);
  return { id, email };
}

async function loginAs(email) {
  const client = createClient(API_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return client;
}

await cleanup();

// --- fixtures ---------------------------------------------------------------
const aManagerU = await makeUser('a-manager');
const aScorerU = await makeUser('a-scorer');
const aViewerU = await makeUser('a-viewer');
const bManagerU = await makeUser('b-manager');
const privAdminU = await makeUser('priv-admin');
const randoU = await makeUser('rando');
const invitee1U = await makeUser('invitee1');
const invitee2U = await makeUser('invitee2');
const bootstrapU = await makeUser('bootstrap');

const { data: publicLeague, error: plErr } = await admin
  .from('leagues')
  .insert({ name: `${PREFIX} Public League`, sport: 'kickball', visibility: 'public', created_by: aManagerU.id })
  .select()
  .single();
if (plErr) throw new Error('fixture: public league: ' + plErr.message);

const { data: privateLeague, error: prErr } = await admin
  .from('leagues')
  .insert({ name: `${PREFIX} Private League`, sport: 'kickball', visibility: 'private', created_by: privAdminU.id })
  .select()
  .single();
if (prErr) throw new Error('fixture: private league: ' + prErr.message);

const { data: teamA, error: taErr } = await admin
  .from('teams')
  .insert({ name: `${PREFIX} Team A`, league_id: publicLeague.id, created_by: aManagerU.id })
  .select()
  .single();
if (taErr) throw new Error('fixture: team A: ' + taErr.message);

const { data: teamB, error: tbErr } = await admin
  .from('teams')
  .insert({ name: `${PREFIX} Team B`, league_id: publicLeague.id, created_by: bManagerU.id })
  .select()
  .single();
if (tbErr) throw new Error('fixture: team B: ' + tbErr.message);

const { data: teamBPlayer, error: tbpErr } = await admin
  .from('players')
  .insert({ team_id: teamB.id, name: `${PREFIX} B Player`, position: 'P', color: '#112233' })
  .select()
  .single();
if (tbpErr) throw new Error('fixture: team B player: ' + tbpErr.message);

const memberships = [
  { user_id: aManagerU.id, team_id: teamA.id, role: 'team_manager' },
  { user_id: aScorerU.id, team_id: teamA.id, role: 'team_scorer' },
  { user_id: aViewerU.id, team_id: teamA.id, role: 'viewer' },
  { user_id: bManagerU.id, team_id: teamB.id, role: 'team_manager' },
  { user_id: privAdminU.id, league_id: privateLeague.id, role: 'league_admin' },
];
const { error: memErr } = await admin.from('memberships').insert(memberships);
if (memErr) throw new Error('fixture: memberships: ' + memErr.message);

const { data: gameAB, error: gErr } = await admin
  .from('games')
  .insert({
    league_id: publicLeague.id,
    home_team_id: teamA.id,
    away_team_id: teamB.id,
    home_team_name_snapshot: teamA.name,
    away_team_name_snapshot: teamB.name,
    label: `${PREFIX} Game AB`,
    scheduled_at: new Date().toISOString(),
    status: 'final',
    sport: 'kickball',
    home_score: 5,
    away_score: 3,
    result: 'W',
    created_by: aManagerU.id,
  })
  .select()
  .single();
if (gErr) throw new Error('fixture: game AB: ' + gErr.message);

const { error: glErr } = await admin.from('game_lines').insert([
  { game_id: gameAB.id, team_id: teamA.id, name_snapshot: 'A Hitter', home_away: 'home', ab: 3, h: 2 },
  { game_id: gameAB.id, team_id: teamB.id, name_snapshot: 'B Hitter', home_away: 'away', ab: 3, h: 1 },
]);
if (glErr) throw new Error('fixture: game_lines: ' + glErr.message);

const inviteCode = `${EMAIL_PREFIX}invite-code-1`;
const { error: invErr } = await admin.from('invites').insert({
  code: inviteCode,
  team_id: teamA.id,
  role: 'team_scorer',
  created_by: aManagerU.id,
  expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
});
if (invErr) throw new Error('fixture: invite: ' + invErr.message);

const expiredInviteCode = `${EMAIL_PREFIX}invite-code-expired`;
const { error: invExpErr } = await admin.from('invites').insert({
  code: expiredInviteCode,
  team_id: teamA.id,
  role: 'viewer',
  created_by: aManagerU.id,
  expires_at: new Date(Date.now() - 3600 * 1000).toISOString(),
});
if (invExpErr) throw new Error('fixture: expired invite: ' + invExpErr.message);

// --- signed-in clients --------------------------------------------------
const aManager = await loginAs(aManagerU.email);
const aScorer = await loginAs(aScorerU.email);
const aViewer = await loginAs(aViewerU.email);
const rando = await loginAs(randoU.email);
const invitee1 = await loginAs(invitee1U.email);
const invitee2 = await loginAs(invitee2U.email);
const bootstrapUser = await loginAs(bootstrapU.email);

// =============================================================================
// anonymous access
// =============================================================================
{
  const { data, error } = await anon.from('leagues').select('id').eq('id', publicLeague.id);
  eq('anon reads public league', [error, data?.length], [null, 1]);
}
{
  const { data, error } = await anon.from('teams').select('id').eq('league_id', publicLeague.id).order('id');
  eq('anon reads public league teams', [error, data?.length], [null, 2]);
}
{
  const { data, error } = await anon.from('game_lines').select('id').eq('game_id', gameAB.id);
  eq('anon reads finished box scores', [error, data?.length], [null, 2]);
}
{
  const { data, error } = await anon.from('leagues').select('id').eq('id', privateLeague.id);
  eq('anon cannot read private league', [error, data], [null, []]);
}
{
  const { error } = await anon
    .from('leagues')
    .insert({ name: `${PREFIX} anon-created`, sport: 'kickball', visibility: 'public' });
  eq('anon cannot write (insert league)', error?.code, '42501');
}

// =============================================================================
// team_scorer / team_manager roster boundaries
// =============================================================================
{
  // team_scorer of A trying to insert into B's roster: no permissive INSERT
  // policy applies -> hard error.
  const { error } = await aScorer.from('players').insert({ team_id: teamB.id, name: 'Intruder', position: 'P', color: '#000000' });
  eq('team_scorer of A cannot insert into team B roster', error?.code, '42501');
}
{
  // team_scorer of A trying to update an existing B player: RLS filters the
  // row out silently (0 rows, no error) rather than erroring.
  const { data, error } = await aScorer.from('players').update({ name: 'Hacked' }).eq('id', teamBPlayer.id).select();
  eq('team_scorer of A cannot edit team B roster (no-op)', [error, data], [null, []]);
  const { data: check } = await admin.from('players').select('name').eq('id', teamBPlayer.id).single();
  eq('team B player name unchanged after scorer A attempt', check.name, `${PREFIX} B Player`);
}
{
  // team_manager of A CAN edit their own roster.
  const { data, error } = await aManager
    .from('players')
    .insert({ team_id: teamA.id, name: `${PREFIX} A Player`, position: 'C', color: '#654321' })
    .select();
  eq('team_manager of A can insert into own roster', [error, data?.length], [null, 1]);
}
{
  // team_manager of A CANNOT edit team B's roster.
  const { data, error } = await aManager.from('players').update({ name: 'Hacked2' }).eq('id', teamBPlayer.id).select();
  eq('team_manager of A cannot edit team B roster (no-op)', [error, data], [null, []]);
  const { data: check } = await admin.from('players').select('name').eq('id', teamBPlayer.id).single();
  eq('team B player name still unchanged after manager A attempt', check.name, `${PREFIX} B Player`);
}

// =============================================================================
// game_events: append-only
// =============================================================================
{
  const { error } = await aViewer.from('game_events').insert({ game_id: gameAB.id, seq: 1, kind: 'note', payload: {} });
  eq('viewer cannot insert game_events', error?.code, '42501');
}

let insertedEvent;
{
  const { data, error } = await aScorer
    .from('game_events')
    .insert({ game_id: gameAB.id, seq: 1, kind: 'note', payload: { text: 'hello' } })
    .select()
    .single();
  eq('team_scorer of A can insert game_events for game AB', [error, !!data?.id], [null, true]);
  insertedEvent = data;
}
{
  const { data, error } = await aScorer
    .from('game_events')
    .update({ payload: { text: 'tampered' } })
    .eq('id', insertedEvent.id)
    .select();
  eq('author cannot UPDATE a game_event (no-op)', [error, data], [null, []]);
}
{
  const { data, error } = await aScorer.from('game_events').delete().eq('id', insertedEvent.id).select();
  eq('author cannot DELETE a game_event (no-op)', [error, data], [null, []]);
}
{
  const { data: check } = await admin.from('game_events').select('payload').eq('id', insertedEvent.id).single();
  eq('game_event payload survives untouched', check.payload, { text: 'hello' });
}

// =============================================================================
// privilege escalation: memberships must not be directly insertable
// =============================================================================
{
  const { error } = await rando
    .from('memberships')
    .insert({ user_id: randoU.id, league_id: publicLeague.id, role: 'league_admin' });
  eq('user cannot self-grant a membership directly', error?.code, '42501');
}
{
  const { data } = await admin.from('memberships').select('id').eq('user_id', randoU.id);
  eq('no membership exists for the escalation attempt', data, []);
}

// =============================================================================
// accept_invite: the only legitimate path to a new membership
// =============================================================================
{
  const { data, error } = await invitee1.rpc('accept_invite', { invite_code: inviteCode });
  eq('accept_invite with a valid code succeeds', [error, data?.role, data?.team_id], [null, 'team_scorer', teamA.id]);
}
{
  const { data } = await admin
    .from('memberships')
    .select('id')
    .eq('user_id', invitee1U.id)
    .eq('team_id', teamA.id)
    .eq('role', 'team_scorer');
  eq('accept_invite actually granted the membership', data?.length, 1);
}
{
  const { data, error } = await invitee2.rpc('accept_invite', { invite_code: inviteCode });
  eq('a second use of the same code fails', [data, !!error], [null, true]);
}
{
  const { data } = await admin.from('memberships').select('id').eq('user_id', invitee2U.id);
  eq('second (failed) redeemer got no membership', data, []);
}
{
  // Bonus: an already-expired code must also be refused.
  const { data, error } = await rando.rpc('accept_invite', { invite_code: expiredInviteCode });
  eq('accept_invite refuses an expired code', [data, !!error], [null, true]);
}
{
  // Bonus: a bogus code must be refused, not silently ignored.
  const { data, error } = await rando.rpc('accept_invite', { invite_code: 'not-a-real-code' });
  eq('accept_invite refuses an unknown code', [data, !!error], [null, true]);
}

// =============================================================================
// create_team_with_manager: atomic bootstrap
// =============================================================================
{
  const { data: newTeamId, error } = await bootstrapUser.rpc('create_team_with_manager', {
    team_name: `${PREFIX} Bootstrap Team`,
    league: null,
  });
  eq('create_team_with_manager succeeds', [error, typeof newTeamId], [null, 'string']);
  const { data: m } = await admin
    .from('memberships')
    .select('role')
    .eq('user_id', bootstrapU.id)
    .eq('team_id', newTeamId);
  eq('creator got a team_manager membership atomically', m, [{ role: 'team_manager' }]);
}

await cleanup();

console.log(fail ? `\n${fail} FAILED (${ran} assertions)` : `\nall passed — ${ran} assertions`);
process.exit(fail ? 1 : 0);
