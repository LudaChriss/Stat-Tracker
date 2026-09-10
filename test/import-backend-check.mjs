// Importing an exported season into the real backend, verified as a real user.
//
// Written independently of import_season: it signs in with a genuine session,
// imports the fixture season, then reads it back through the actual adapter and
// asserts the DERIVED figures — season stats, standings — match what the same
// season produces locally. Comparing rows would only prove the rows survived;
// comparing what the app shows proves the import is actually usable.
//
// Skips cleanly without a local Supabase so `npm test` still passes.

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { INITIAL_STATE } from '../src/data/league.js';
import { SEEDED } from './fixtures-history.js';
import { buildExport } from '../src/game/export.js';
import { createSupabaseRepository } from '../src/data/supabaseRepository.js';
import { seasonTotals } from '../src/game/stats.js';
import { tallyStandings } from '../src/game/standings.js';

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

// --- a real signed-in user ---------------------------------------------------
const email = `importer${Date.now()}@example.test`;
const password = 'Password123!';
await admin.auth.admin.createUser({ email, password, email_confirm: true });
const user = createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false } });
const signIn = await user.auth.signInWithPassword({ email, password });
if (signIn.error) {
  console.log('FAIL could not sign in: ' + signIn.error.message);
  process.exit(1);
}

// --- import the exact JSON the app exports -----------------------------------
const local = SEEDED(INITIAL_STATE);
const payload = buildExport(local);

const imported = await user.rpc('import_season', { payload });
eq('import succeeds', !imported.error, true);
if (imported.error) {
  console.log('  ' + imported.error.message);
  console.log(`\n${fail + 1} FAILED`);
  process.exit(1);
}
const teamId = imported.data;
eq('import returns the new team id', typeof teamId === 'string' && teamId.length > 0, true);

// --- read it back the way the app will ---------------------------------------
const repo = createSupabaseRepository(user, { getTeamId: () => teamId, cache: null });
const back = await repo.load();
eq('the season reads back', !!back, true);
if (!back) {
  console.log(`\n${fail + 1} FAILED (nothing read back)`);
  process.exit(1);
}

// --- identity ----------------------------------------------------------------
eq('team name survives', back.myTeam.name, local.myTeam.name);
eq('manual record offsets survive', [back.myTeam.priorW, back.myTeam.priorL, back.myTeam.priorT],
   [local.myTeam.priorW, local.myTeam.priorL, local.myTeam.priorT]);
eq('roster size survives', back.roster.length, local.roster.length);
eq('roster ids survive', back.roster.map((p) => p.id).sort((a, b) => a - b),
   local.roster.map((p) => p.id).sort((a, b) => a - b));
eq('roster names survive', back.roster.map((p) => p.name).sort(),
   local.roster.map((p) => p.name).sort());
eq('opposing teams survive', back.teams.map((t) => t.id).sort(), local.teams.map((t) => t.id).sort());
eq('game count survives', back.history.length, local.history.length);

// --- the perspective flip is the easy thing to get wrong ---------------------
// The client stores score and result from its own point of view; the row stores
// them from the home team's. An away game must come back unflipped.
const byId = (list) => Object.fromEntries(list.map((g) => [g.id, g]));
const localById = byId(local.history);
const backById = byId(back.history);

for (const g of local.history) {
  const b = backById[g.id];
  if (!b) { fail++; console.log(`FAIL game ${g.id} missing after import`); continue; }
  eq(`${g.label} (${g.home ? 'home' : 'away'}): result unchanged`, b.result, g.result);
  eq(`${g.label}: score unchanged from our perspective`, b.score, g.score);
  eq(`${g.label}: home/away flag unchanged`, b.home, g.home);
  eq(`${g.label}: opponent name unchanged`, b.opponent, g.opponent);
}

const awayGame = local.history.find((g) => g.home === false);
eq('the fixture actually contains an away game (or this proves nothing)', !!awayGame, true);

// --- box scores --------------------------------------------------------------
for (const g of local.history) {
  const b = backById[g.id];
  if (!b) continue;
  eq(`${g.label}: box score pids survive`,
     b.lines.map((l) => l.pid).sort(),
     g.lines.map((l) => l.pid).sort());
}
const sample = localById[local.history[0].id];
const sampleBack = backById[local.history[0].id];
const pick = (lines, pid) => lines.find((l) => l.pid === pid);
for (const pid of sample.lines.slice(0, 3).map((l) => l.pid)) {
  const a = pick(sample.lines, pid);
  const b = pick(sampleBack.lines, pid);
  eq(`line ${pid}: counting stats survive`,
     [b.ab, b.h, b.r, b.rbi, b.bb, b.k, b.d, b.t, b.hr],
     [a.ab, a.h, a.r, a.rbi, a.bb, a.k, a.d, a.t, a.hr]);
  eq(`line ${pid}: name snapshot survives`, b.name, a.name);
}

// --- what the app actually shows ---------------------------------------------
for (const pid of ['h0', 'h1', 'h2']) {
  const l = seasonTotals(local.history, pid);
  const r = seasonTotals(back.history, pid);
  eq(`derived season line matches for ${pid}`,
     [r.gp, r.ab, r.h, r.hr, r.avg, r.obp, r.slg, r.ops],
     [l.gp, l.ab, l.h, l.hr, l.avg, l.obp, l.slg, l.ops]);
}

const rebuilt = { ...local, ...back };
eq('standings match after a real import',
   tallyStandings(rebuilt).map((t) => [t.name, t.w, t.l, t.gp]).sort(),
   tallyStandings(local).map((t) => [t.name, t.w, t.l, t.gp]).sort());

// --- untracked opponent slots keep their identity without a player row -------
const anonLine = local.history.flatMap((g) => g.lines).find((l) => /^a\d+$/.test(l.pid));
if (anonLine) {
  const rows = await admin.from('game_lines').select('client_pid, player_id').eq('client_pid', anonLine.pid).limit(1);
  eq('an untracked opponent slot keeps its pid but has no player row',
     rows.data && rows.data[0] ? [rows.data[0].client_pid, rows.data[0].player_id] : null,
     [anonLine.pid, null]);
}

// --- another user cannot see the imported season -----------------------------
const other = createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false } });
const otherEmail = `nosy${Date.now()}@example.test`;
await admin.auth.admin.createUser({ email: otherEmail, password, email_confirm: true });
await other.auth.signInWithPassword({ email: otherEmail, password });
const peek = await other.from('players').select('*').eq('team_id', teamId);
eq('another user cannot read the imported roster', (peek.data || []).length, 0);
const tamper = await other.from('players').insert({ team_id: teamId, name: 'Injected', position: 'P' }).select();
eq('another user cannot add to the imported roster', !!tamper.error || (tamper.data || []).length === 0, true);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
