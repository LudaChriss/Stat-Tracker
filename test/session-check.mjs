// Session states, and writes that belong to an account.
//
// The rule this pins: "cannot refresh right now" is not "signed out". One is a
// network condition and the season must stay on screen; the other is the server
// telling us the session is gone. Treating them the same locked someone out of
// a season sitting on their own phone.
//
// The revocation half is real: the session is revoked server-side through the
// admin API and the client is then asked what it makes of it. Nothing about the
// auth server is stubbed. (Time-based expiry needs a short jwt_expiry and lives
// in test/session-expiry.mjs, which is run by hand.)

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { classifyAuthFailure, createAuth } from '../src/data/auth.js';
import { createOfflineQueue } from '../src/data/offlineQueue.js';

const repoRoot = new URL('..', import.meta.url).pathname;

/**
 * A stand-in with the real Storage shape — including length and key(), which
 * is how code is supposed to enumerate it. A plain object silently answers
 * Object.keys() with its own method names instead.
 */
function storageOver(store) {
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };
}

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

// --- classification, from the error shapes a real server produces ------------
{
  // Observed: a network failure surfaces as status 0 / AuthRetryableFetchError.
  const offline = { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' };
  eq('a network failure is offline, not signed out', classifyAuthFailure(offline, true), 'offline');
  eq('even with nothing stored', classifyAuthFailure(offline, false), 'offline');

  // Observed: a revoked refresh token comes back 400 refresh_token_not_found.
  const revoked = { status: 400, code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' };
  eq('a rejected refresh token is signed out', classifyAuthFailure(revoked, false), 'revoked');
  eq('and stays signed out even if storage lags', classifyAuthFailure(revoked, true), 'revoked');

  eq('no error and nothing stored means nobody signed in', classifyAuthFailure(null, false), 'none');
  eq('no error but a stored session means we could not use it', classifyAuthFailure(null, true), 'offline');

  // The safety default: an error we do not recognise, with a session still on
  // the device, must not throw the person out.
  const weird = { status: 503, message: 'gateway exploded' };
  eq('an unrecognised error with a stored session leans offline', classifyAuthFailure(weird, true), 'offline');
  eq('and with no stored session, there is nothing to keep', classifyAuthFailure(weird, false), 'none');
}

// --- the queue is addressed to an account ------------------------------------
{
  let store = {};
  globalThis.localStorage = storageOver(store);

  const q = createOfflineQueue({ storageKey: 'test:owner' });
  q.enqueue({ kind: 'game', payload: { id: 'mine-1' }, owner: 'user-a' });
  q.enqueue({ kind: 'game', payload: { id: 'theirs' }, owner: 'user-b' });
  q.enqueue({ kind: 'game', payload: { id: 'mine-2' }, owner: 'user-a' });

  const seen = [];
  const handlers = { game: async (p) => { seen.push(p.id); } };

  const result = await q.flush(handlers, { owner: 'user-a' });
  eq('only this account\'s writes are applied', seen, ['mine-1', 'mine-2']);
  eq('and the other account\'s is reported, not silently skipped', result.heldForOtherAccounts, 1);
  eq('it is still queued', q.list().map((e) => e.payload.id), ['theirs']);
  eq('and findable', q.foreign('user-a').map((e) => e.payload.id), ['theirs']);

  // Signing in as that other account picks it up, and only it.
  const seenB = [];
  await q.flush({ game: async (p) => { seenB.push(p.id); } }, { owner: 'user-b' });
  eq('the other account gets its own write when it signs in', seenB, ['theirs']);
  eq('and the queue is empty', q.list().length, 0);

  // An entry queued before owners existed belongs to whoever is signed in.
  const legacy = createOfflineQueue({ storageKey: 'test:legacy' });
  legacy.enqueue({ kind: 'game', payload: { id: 'no-owner' } });
  const seenC = [];
  await legacy.flush({ game: async (p) => { seenC.push(p.id); } }, { owner: 'user-a' });
  eq('an unstamped entry is still applied', seenC, ['no-owner']);

  // Coalescing must not let one account's snapshot stand in for another's.
  const co = createOfflineQueue({ storageKey: 'test:coalesce' });
  co.enqueue({ kind: 'season', payload: { v: 1 }, coalesceKey: 'team-1', owner: 'user-a' });
  co.enqueue({ kind: 'season', payload: { v: 2 }, coalesceKey: 'team-1', owner: 'user-b' });
  eq('two accounts keep two snapshots for the same team', co.list().length, 2);
  co.enqueue({ kind: 'season', payload: { v: 3 }, coalesceKey: 'team-1', owner: 'user-a' });
  eq('but the same account still coalesces its own', co.list().length, 2);
  eq('keeping the newest', co.list().find((e) => e.owner === 'user-a').payload.v, 3);
}

// --- against the real auth server --------------------------------------------
let st;
try {
  st = JSON.parse(
    execSync('npx supabase status -o json', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString(),
  );
} catch {
  console.log('skipped the server half — no local Supabase stack');
  console.log(fail ? `\n${fail} FAILED` : '\nall passed');
  process.exit(fail ? 1 : 0);
}

const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
try {
  const probe = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (probe.error) throw probe.error;
} catch {
  console.log('skipped the server half — local Supabase not reachable');
  console.log(fail ? `\n${fail} FAILED` : '\nall passed');
  process.exit(fail ? 1 : 0);
}

const password = 'Password123!';

/** A client whose session lives in the fake localStorage above. */
function signedInClient(store) {
  return createClient(st.API_URL, st.ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      storage: {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = v; },
        removeItem: (k) => { delete store[k]; },
      },
    },
  });
}

// --- a session the server has genuinely revoked ------------------------------
{
  const email = `revoked${Date.now()}@example.test`;
  await admin.auth.admin.createUser({ email, password, email_confirm: true });

  const store = {};
  const client = signedInClient(store);
  const { data } = await client.auth.signInWithPassword({ email, password });
  ok('setup: signed in', !!data.session);

  // Really revoked, server-side, the way "signed out everywhere" works.
  const revoke = await admin.auth.admin.signOut(data.session.access_token, 'global');
  ok('setup: the session was revoked server-side', !revoke.error, revoke.error && revoke.error.message);
  await new Promise((r) => setTimeout(r, 400));

  // Force the client to go back to the server: age the stored token so it
  // cannot be used as-is. The REJECTION below is the server's, not ours.
  const key = Object.keys(store).find((k) => /auth-token/.test(k));
  const stored = JSON.parse(store[key]);
  stored.expires_at = Math.floor(Date.now() / 1000) - 60;
  store[key] = JSON.stringify(stored);

  globalThis.localStorage = storageOver(store);

  const auth = createAuth(signedInClient(store));
  const detailed = await auth.getSessionDetailed();
  eq('a revoked session yields no session', detailed.session, null);
  eq('and is classified as revoked, not offline', detailed.reason, 'revoked');
  eq('the server wiped the stored session', Object.keys(store).some((k) => /auth-token/.test(k)), false);
}

// --- a valid session the server simply cannot be reached for -----------------
{
  const email = `unreachable${Date.now()}@example.test`;
  await admin.auth.admin.createUser({ email, password, email_confirm: true });

  const store = {};
  const client = signedInClient(store);
  await client.auth.signInWithPassword({ email, password });

  const key = Object.keys(store).find((k) => /auth-token/.test(k));
  const stored = JSON.parse(store[key]);
  stored.expires_at = Math.floor(Date.now() / 1000) - 60;
  store[key] = JSON.stringify(stored);

  globalThis.localStorage = storageOver(store);

  // A real transport failure, not a fabricated error object.
  const offlineClient = createClient(st.API_URL, st.ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      storage: {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = v; },
        removeItem: (k) => { delete store[k]; },
      },
    },
    global: { fetch: () => Promise.reject(new TypeError('Failed to fetch')) },
  });

  const auth = createAuth(offlineClient);
  const detailed = await auth.getSessionDetailed();
  eq('an unreachable server yields no session either', detailed.session, null);
  eq('but it is classified offline, NOT signed out', detailed.reason, 'offline');
  eq('and the session is still on the device', auth.hasStoredSession(), true);
}

// --- and a healthy session is just a session ---------------------------------
{
  const email = `healthy${Date.now()}@example.test`;
  await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const store = {};
  const client = signedInClient(store);
  await client.auth.signInWithPassword({ email, password });

  globalThis.localStorage = storageOver(store);

  const auth = createAuth(signedInClient(store));
  const detailed = await auth.getSessionDetailed();
  ok('a healthy session comes back', !!detailed.session);
  eq('with reason ok', detailed.reason, 'ok');
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
