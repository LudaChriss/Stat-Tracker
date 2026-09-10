// The migration path, end to end against the real backend as a real user.
//
// This is the one flow where a mistake costs someone their season, so it is
// tested as a sequence rather than in pieces: decide, import, verify, and — on
// a verification failure — roll back so nothing half-trusted is left behind.
//
// Also asserts the promise that local data is never destroyed: not by adopting
// the backend, not by a successful migration, not by a failed one.

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { INITIAL_STATE } from '../src/data/league.js';
import { SEEDED } from './fixtures-history.js';
import { buildExport } from '../src/game/export.js';
import { createSupabaseRepository } from '../src/data/supabaseRepository.js';
import { decideSync, verifyMigration } from '../src/data/seasonSync.js';

const repoRoot = new URL('..', import.meta.url).pathname;

let fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    fail++;
    console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  } else console.log('ok   ' + label);
};

// --- a promise that holds with or without a backend --------------------------
// Nothing in the app may delete the stored season. This is a static check so it
// cannot be satisfied by a code path simply not being exercised.
{
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = `${dir}/${entry}`;
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|jsx)$/.test(entry)) {
        const src = readFileSync(full, 'utf8');
        // Two keys may legitimately be removed, and only these two:
        //   PREVIOUS_KEY     the separate recovery copy (clearPreserved)
        //   SYNCED_GAMES_KEY the "already in the account" marker, cleared on
        //                    sign-out because it is a claim about an account we
        //                    no longer know the identity of. It is not data —
        //                    re-sending a game is idempotent.
        // The season and the write queue are never removed by anything.
        //   USER_KEY         which account this device last spoke to.
        const ALLOWED = /PREVIOUS_KEY|previous|SYNCED_GAMES_KEY|USER_KEY/;
        const lines = src.split('\n');
        lines.forEach((l, i) => {
          if (/removeItem\s*\(/.test(l) && !ALLOWED.test(l)) {
            offenders.push(`${full.replace(repoRoot, '')}:${i + 1}`);
          }
          if (/localStorage\.clear\s*\(/.test(l)) {
            offenders.push(`${full.replace(repoRoot, '')}:${i + 1} (clear)`);
          }
          // Named-key removals of the two that must survive everything,
          // including sign-out.
          if (/removeItem\s*\(\s*['"`]score-tracker:(state|queue)['"`]/.test(l)) {
            offenders.push(`${full.replace(repoRoot, '')}:${i + 1} (season or queue)`);
          }
        });
      }
    }
  };
  walk(`${repoRoot}src`);
  eq('no code path deletes the stored season', offenders, []);
}

let st;
try {
  st = JSON.parse(
    execSync('npx supabase status -o json', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString(),
  );
} catch {
  console.log('skipped the backend half — no local Supabase stack');
  console.log(fail ? `\n${fail} FAILED` : '\nall passed');
  process.exit(fail ? 1 : 0);
}

const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
try {
  const probe = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (probe.error) throw probe.error;
} catch {
  console.log('skipped the backend half — local Supabase not reachable');
  console.log(fail ? `\n${fail} FAILED` : '\nall passed');
  process.exit(fail ? 1 : 0);
}

const password = 'Password123!';
const signUp = async (tag) => {
  const email = `${tag}${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.test`;
  await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const client = createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
};

const local = SEEDED(INITIAL_STATE);

// --- the decision, before anything is written --------------------------------
const user = await signUp('migrator');
eq('a signed-in user with a local season and an empty account migrates up',
   decideSync({ local, remote: null, signedIn: true }).action, 'migrate-up');

// --- migrate ------------------------------------------------------------------
const imported = await user.rpc('import_season', { payload: buildExport(local) });
eq('the import runs', !imported.error, true);
const teamId = imported.data;

const repo = createSupabaseRepository(user, { getTeamId: () => teamId, cache: null });
const readBack = await repo.load();
const verdict = verifyMigration(local, readBack);
eq('the migration verifies against what the app would show', verdict.ok, true);
eq('with nothing flagged', verdict.differences, []);

// --- once verified, the two sides agree, so no prompt is ever shown -----------
eq('a device now in sync adopts silently',
   decideSync({ local, remote: readBack, signedIn: true }).action, 'adopt-backend');

// --- a verification failure must leave nothing behind ------------------------
const second = await signUp('rollback');
const secondImport = await second.rpc('import_season', { payload: buildExport(local) });
eq('a second import runs', !secondImport.error, true);
const badTeamId = secondImport.data;

// Stand in for a bad import by verifying against a season that disagrees.
const disagrees = JSON.parse(JSON.stringify(local));
disagrees.history.pop();
const badVerdict = verifyMigration(disagrees, await createSupabaseRepository(second, { getTeamId: () => badTeamId, cache: null }).load());
eq('a mismatch is caught', badVerdict.ok, false);
eq('and is explained', badVerdict.differences.length > 0, true);

const rolledBack = await second.rpc('discard_import', { team_id: badTeamId });
eq('the failed import is rolled back', !rolledBack.error, true);

const leftovers = await admin.from('teams').select('id').eq('id', badTeamId);
eq('no team is left behind', (leftovers.data || []).length, 0);
const orphanGames = await admin.from('games').select('id').or(`home_team_id.eq.${badTeamId},away_team_id.eq.${badTeamId}`);
eq('no games are left behind', (orphanGames.data || []).length, 0);

// --- and the first user is entirely unaffected by the second's rollback -------
const firstStill = await repo.load();
eq('the successful migration is untouched by the other rollback',
   firstStill && firstStill.history.length, local.history.length);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
