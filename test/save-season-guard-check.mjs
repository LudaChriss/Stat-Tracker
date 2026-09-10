// save_season used to delete every player absent from the incoming payload,
// and accepted an empty payload without complaint. A save carrying blank or
// half-loaded state therefore emptied the roster, while the team name survived
// because that is a separate update — a team with a name and no players.
//
// This pins the guard: an accidental wipe is refused loudly, while every
// legitimate roster edit still works.

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

const password = 'Password123!';
const email = `guard${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.test`;
await admin.auth.admin.createUser({ email, password, email_confirm: true });
const api = createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false } });
const signIn = await api.auth.signInWithPassword({ email, password });
if (signIn.error) {
  console.log('FAIL could not sign in: ' + signIn.error.message);
  process.exit(1);
}

const seeded = SEEDED(INITIAL_STATE);
const imported = await api.rpc('import_season_and_claim', { payload: buildExport(seeded) });
eq('setup: season imported', !imported.error, true);
const teamId = imported.data;
const players = async () => ((await admin.from('players').select('id').eq('team_id', teamId)).data || []).length;

eq('the roster is there to begin with', await players(), seeded.roster.length);

// --- the accident ------------------------------------------------------------
const blank = await api.rpc('save_season', { p_team_id: teamId, payload: { myTeam: { name: '' }, roster: [] } });
eq('a save carrying an empty roster is refused', !!blank.error, true);
eq('and says how many it would have removed', /refusing to remove all 10 players/.test(blank.error?.message || ''), true);
eq('the roster is untouched by the refused save', await players(), seeded.roster.length);

// A missing roster key entirely — same accident, different shape.
const missing = await api.rpc('save_season', { p_team_id: teamId, payload: { myTeam: { name: 'X' } } });
eq('a payload with no roster key at all is refused too', !!missing.error, true);
eq('still untouched', await players(), seeded.roster.length);

// --- the legitimate edits, which must all still work -------------------------
const grown = [...seeded.roster, { id: 99, name: 'New Signing', num: 12, pos: 'SS', c: '#0E7490' }];
const added = await api.rpc('save_season', { p_team_id: teamId, payload: { myTeam: seeded.myTeam, roster: grown } });
eq('adding a player works', !added.error, true);
eq('and it persists', await players(), seeded.roster.length + 1);

const renamed = grown.map((p) => (p.id === 99 ? { ...p, name: 'Renamed Signing' } : p));
await api.rpc('save_season', { p_team_id: teamId, payload: { myTeam: seeded.myTeam, roster: renamed } });
const row = await admin.from('players').select('name').eq('team_id', teamId).eq('client_id', 99).maybeSingle();
eq('renaming a player works', row.data?.name, 'Renamed Signing');

const fewer = renamed.filter((p) => p.id !== 99);
const removed = await api.rpc('save_season', { p_team_id: teamId, payload: { myTeam: seeded.myTeam, roster: fewer } });
eq('removing one player still works', !removed.error, true);
eq('and it is gone', await players(), seeded.roster.length);

// Shrinking to a single player is legitimate and must not be blocked — only
// emptying is treated as an accident.
const one = [seeded.roster[0]];
const shrunk = await api.rpc('save_season', { p_team_id: teamId, payload: { myTeam: seeded.myTeam, roster: one } });
eq('shrinking to one player is allowed', !shrunk.error, true);
eq('leaving exactly that player', await players(), 1);

// --- clearing on purpose is still possible -----------------------------------
const cleared = await api.rpc('save_season', {
  p_team_id: teamId,
  payload: { myTeam: seeded.myTeam, roster: [] },
  allow_empty_roster: true,
});
eq('clearing deliberately is allowed with the explicit flag', !cleared.error, true);
eq('and empties the roster', await players(), 0);

// --- and an empty roster on an already-empty team is not an error ------------
const again = await api.rpc('save_season', { p_team_id: teamId, payload: { myTeam: seeded.myTeam, roster: [] } });
eq('saving an empty roster over an empty team is fine', !again.error, true);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
