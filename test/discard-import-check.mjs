// discard_import is the rollback for a failed migration, and it deletes teams —
// so its refusals matter more than its successes. Every constraint is attacked
// here as a real signed-in user.
//
// It may only remove teams that the caller created, that were created by
// import rather than by hand, and that nobody else has joined.
//
// Skips cleanly without a local Supabase so `npm test` still passes.

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { INITIAL_STATE } from '../src/data/league.js';
import { SEEDED } from './fixtures-history.js';
import { buildExport } from '../src/game/export.js';

const repoRoot = new URL('..', import.meta.url).pathname;

let st;
try {
  st = JSON.parse(
    execSync('npx supabase status -o json', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString(),
  );
} catch {
  console.log('skipped — no local Supabase stack (npx supabase start --ignore-health-check)');
  process.exit(0);
}

const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
try {
  const probe = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (probe.error) throw probe.error;
} catch {
  console.log('skipped — local Supabase not reachable');
  process.exit(0);
}

let fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    fail++;
    console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  } else console.log('ok   ' + label);
};
const refused = (label, { error }) => {
  if (error) console.log('ok   refused: ' + label);
  else {
    fail++;
    console.log('FAIL allowed (should have been refused): ' + label);
  }
};

const password = 'Password123!';
const signUp = async (tag) => {
  const email = `${tag}${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.test`;
  await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const client = createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { client, id: data.user.id, email };
};

const season = buildExport(SEEDED(INITIAL_STATE));
const owner = await signUp('owner');
const stranger = await signUp('stranger');

// --- an import can be undone by the person who made it -----------------------
const imported = await owner.client.rpc('import_season', { payload: season });
eq('import succeeds', !imported.error, true);
const teamId = imported.data;

const beforeTeams = await admin.from('teams').select('id, import_batch, source').eq('id', teamId).maybeSingle();
eq('the imported team is tagged as an import', beforeTeams.data?.source, 'import');
eq('and carries a batch id', typeof beforeTeams.data?.import_batch === 'string', true);
const batch = beforeTeams.data.import_batch;

const batchTeams = await admin.from('teams').select('id').eq('import_batch', batch);
eq('the batch covers my team plus its opponents', batchTeams.data.length > 1, true);
const gamesBefore = await admin.from('games').select('id').in('home_team_id', batchTeams.data.map((t) => t.id));
eq('games were written', gamesBefore.data.length > 0, true);

// --- refusals ----------------------------------------------------------------
refused(
  'a stranger discarding a team they did not create',
  await stranger.client.rpc('discard_import', { team_id: teamId }),
);

const manual = await owner.client.rpc('create_team_with_manager', { team_name: 'Built By Hand' });
refused(
  'discarding a team that was built by hand, not imported',
  await owner.client.rpc('discard_import', { team_id: manual.data }),
);

// A second member makes it shared data, not a private import to undo.
const joiner = await signUp('joiner');
const grant = await admin
  .from('memberships')
  .insert({ user_id: joiner.id, team_id: teamId, role: 'team_scorer' });
eq('a second member can be added (via service role, for the test)', !grant.error, true);
refused(
  'discarding once someone else has joined',
  await owner.client.rpc('discard_import', { team_id: teamId }),
);

const stillThere = await admin.from('teams').select('id').eq('id', teamId).maybeSingle();
eq('the refused discard left the team intact', !!stillThere.data, true);

// --- the happy path, once the other member is gone ---------------------------
await admin.from('memberships').delete().eq('user_id', joiner.id).eq('team_id', teamId);
const removed = await owner.client.rpc('discard_import', { team_id: teamId });
eq('the owner can now discard it', !removed.error, true);
eq('the whole batch went, not just my team', removed.data, batchTeams.data.length);

const afterTeams = await admin.from('teams').select('id').eq('import_batch', batch);
eq('no teams from the batch remain', afterTeams.data.length, 0);
const afterGames = await admin.from('games').select('id').in('id', gamesBefore.data.map((g) => g.id));
eq('its games are gone', afterGames.data.length, 0);
const afterLines = await admin.from('game_lines').select('id').in('game_id', gamesBefore.data.map((g) => g.id));
eq('its box score lines are gone', afterLines.data.length, 0);
const afterPlayers = await admin.from('players').select('id').eq('team_id', teamId);
eq('its players are gone', afterPlayers.data.length, 0);

// --- and the hand-built team is untouched by any of this ---------------------
const manualStill = await admin.from('teams').select('id').eq('id', manual.data).maybeSingle();
eq('the hand-built team is untouched', !!manualStill.data, true);

// --- discarding something that does not exist --------------------------------
refused(
  'discarding a team id that does not exist',
  await owner.client.rpc('discard_import', { team_id: '00000000-0000-0000-0000-000000000000' }),
);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
