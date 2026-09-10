// A token that has genuinely run out of time.
//
// Nothing here fabricates an expiry. The local stack is configured to issue
// short-lived JWTs, the test waits for one to actually pass its `exp`, and then
// asks what the app's own entry point makes of it.
//
// Manual harness, like viewports.mjs — it needs supabase/config.toml set to a
// short lifetime and the stack restarted:
//
//     jwt_expiry = 8        # in [auth]
//     npx supabase stop && npx supabase start --ignore-health-check
//     node test/session-expiry.mjs
//
// It refuses to run rather than quietly passing if the lifetime is too long to
// wait out. A suite that skips on a setup problem reports success while proving
// nothing.

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { createAuth } from '../src/data/auth.js';

const repoRoot = new URL('..', import.meta.url).pathname;
const MAX_WAIT = 30; // seconds we are willing to sit here

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

function storageOver(store) {
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
}

let st;
try {
  st = JSON.parse(
    execSync('npx supabase status -o json', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString(),
  );
} catch (e) {
  console.log('\nCANNOT RUN: the local Supabase stack is not running.');
  process.exit(2);
}

const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const password = 'Password123!';
const email = `expiry${Date.now()}@example.test`;
const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (made.error) {
  console.log('\nCANNOT RUN: could not create a test user — ' + made.error.message);
  process.exit(2);
}

const store = {};
globalThis.localStorage = storageOver(store);
const clientOver = (s, extra = {}) =>
  createClient(st.API_URL, st.ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: false, storage: storageOver(s) },
    ...extra,
  });

const signedIn = clientOver(store);
const { data, error } = await signedIn.auth.signInWithPassword({ email, password });
if (error) {
  console.log('\nCANNOT RUN: sign-in failed — ' + error.message);
  process.exit(2);
}

const claims = JSON.parse(Buffer.from(data.session.access_token.split('.')[1], 'base64').toString());
const lifetime = claims.exp - claims.iat;
console.log(`token lifetime, from its own claims: ${lifetime}s`);

if (lifetime > MAX_WAIT) {
  console.log(`\nCANNOT RUN: tokens last ${lifetime}s here, which is longer than this test will wait.`);
  console.log('Set jwt_expiry = 8 under [auth] in supabase/config.toml, restart the stack, and re-run.');
  console.log('(test/session-check.mjs covers the same states via real server-side revocation.)');
  process.exit(2);
}

console.log(`waiting ${lifetime + 3}s for it to genuinely expire…`);
await new Promise((r) => setTimeout(r, (lifetime + 3) * 1000));

const stillClaimsFresh = claims.exp * 1000 > Date.now();
ok('the token really is past its expiry now', !stillClaimsFresh,
  'exp is still in the future — the wait was too short');

// --- expired, but the server is reachable: it should just refresh ------------
{
  const auth = createAuth(clientOver(store));
  const detailed = await auth.getSessionDetailed();
  ok('an expired token refreshes itself when the server is reachable', !!detailed.session);
  eq('and reports a healthy session', detailed.reason, 'ok');
  if (detailed.session) {
    const fresh = JSON.parse(Buffer.from(detailed.session.access_token.split('.')[1], 'base64').toString());
    ok('with a genuinely newer token', fresh.exp > claims.exp, `${fresh.exp} vs ${claims.exp}`);
  }
}

// --- expired AND the server cannot be reached: stale, not signed out ---------
{
  // Age it again so the client must go back to the server.
  const offlineStore = {};
  const c = clientOver(offlineStore);
  await c.auth.signInWithPassword({ email, password });
  console.log(`waiting ${lifetime + 3}s again, for the offline case…`);
  await new Promise((r) => setTimeout(r, (lifetime + 3) * 1000));

  globalThis.localStorage = storageOver(offlineStore);
  const auth = createAuth(
    clientOver(offlineStore, { global: { fetch: () => Promise.reject(new TypeError('Failed to fetch')) } }),
  );
  const detailed = await auth.getSessionDetailed();

  eq('with no connection there is no usable session', detailed.session, null);
  eq('but it is offline, NOT signed out', detailed.reason, 'offline');
  eq('and the session is still on the device', auth.hasStoredSession(), true);
  ok('so the app keeps the season on screen rather than demanding a sign-in', detailed.reason === 'offline');
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
