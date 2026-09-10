// The three account states, driven through the real app in a real browser.
//
//   1. Opening the app offline with a token that has aged out shows the season,
//      not a sign-in wall.
//   2. Finalising a game in that state still saves locally AND still queues.
//   3. Signing out with unsent writes warns, and keeps both the season and the
//      queue.
//
// The expiry is real: the local stack must be issuing short-lived tokens
// (jwt_expiry = 8 under [auth]), and this waits for one to actually pass its
// exp. It refuses to run otherwise rather than passing on a technicality.
//
// Manual harness. Needs the local stack, a dev server on :5173 and Chrome on
// --remote-debugging-port=9222. Never a hosted project.

import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const SRC = new URL('../src', import.meta.url).pathname;
const repoRoot = new URL('..', import.meta.url).pathname;
const APP = 'http://localhost:5173';
const MAX_WAIT = 30;

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
} catch (e) {
  need('the local Supabase stack must be running', false, String(e.message).split('\n')[0]);
}
need('the app must be pointed at the LOCAL stack', st.API_URL.includes('127.0.0.1'), st.API_URL);

let devOk = false;
try { devOk = (await fetch(APP, { signal: AbortSignal.timeout(3000) })).ok; } catch { /* below */ }
need(`a dev server must be serving ${APP}`, devOk);

let target;
try {
  const list = await (await fetch('http://localhost:9222/json', { signal: AbortSignal.timeout(3000) })).json();
  target = list.find((x) => x.type === 'page');
} catch { /* below */ }
need('Chrome must be running with --remote-debugging-port=9222', !!target);

const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const password = 'Password123!';
const email = `sess${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.test`;
const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
need('a test user could be created', !created.error, created.error?.message);

const captured = {};
const node = createClient(st.API_URL, st.ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: false,
    storage: {
      getItem: (k) => (k in captured ? captured[k] : null),
      setItem: (k, v) => { captured[k] = v; },
      removeItem: (k) => { delete captured[k]; },
    },
  },
});
const signIn = await node.auth.signInWithPassword({ email, password });
need('the test user could sign in', !signIn.error, signIn.error?.message);
const uid = signIn.data.user.id;
const authKey = Object.keys(captured).find((k) => k.startsWith('sb-'));

const claims = JSON.parse(Buffer.from(signIn.data.session.access_token.split('.')[1], 'base64').toString());
const lifetime = claims.exp - claims.iat;
console.log(`token lifetime: ${lifetime}s`);
need(
  `tokens must be short-lived for a real expiry (this build issues ${lifetime}s)`,
  lifetime <= MAX_WAIT,
  'Set jwt_expiry = 8 under [auth] in supabase/config.toml and restart the stack.',
);

const { INITIAL_STATE } = await import(`${SRC}/data/league.js`);
const { SEEDED } = await import('./fixtures-history.js');
const { TEMPLATES } = await import(`${SRC}/data/league.js`);
const { applyOutcome } = await import(`${SRC}/game/logic.js`);
const kb = (k) => TEMPLATES.kickball.groups.flatMap((g) => g.outcomes).find((x) => x.k === k);
const seeded = SEEDED(INITIAL_STATE);
const liveState = (plays) => {
  let live = { ...seeded, gameActive: true, half: 'bot', trackMode: 'both', screen: 'live', liveTab: 'entry' };
  for (const k of plays) live = applyOutcome(live, kb(k));
  return live;
};

// ---- CDP ----------------------------------------------------------------------
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let msgId = 0;
const pending = new Map();
const pageLog = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    pageLog.push('uncaught: ' + (m.params.exceptionDetails.exception?.description || '').split('\n')[0]);
  }
});
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++msgId;
    pending.set(i, (x) => (x.error ? rej(new Error(method + ' ' + JSON.stringify(x.error))) : res(x.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { ERR: (r.exceptionDetails.exception?.description || '').split('\n')[0] };
  return r.result.value;
};
const until = async (label, fn, ms = 20000, step = 250) => {
  const started = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - started > ms) return null;
    await sleep(step);
  }
};

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 3, mobile: false });

const put = (k, v) => js(`localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)}), 1`);
const get = (k) => js(`localStorage.getItem(${JSON.stringify(k)})`);
const appState = async () => {
  try { return JSON.parse(await get('score-tracker:state')).state; } catch { return null; }
};
const bodyText = () => js(`document.body.textContent.replace(/\\s+/g,' ').trim()`);
const buttons = () =>
  js(`[...document.querySelectorAll('button,[role=button]')].map((e) => (e.textContent || '').replace(/\\s+/g, ' ').trim())`);
const clickText = async (text, ms = 10000) => {
  const hit = await until(`"${text}"`, () =>
    js(`(() => {
      const norm = (e) => (e.textContent || '').replace(/\\s+/g, ' ').trim();
      const el = [...document.querySelectorAll('button,[role=button]')].reverse().find((e) => norm(e) === ${JSON.stringify(text)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      el.click();
      return 'OK';
    })()`), ms);
  return hit ? 'OK' : 'MISS — on screen: ' + JSON.stringify(await buttons());
};
const queue = async () => {
  try { return JSON.parse((await get('score-tracker:queue')) || '{"pending":[],"parked":[]}'); }
  catch { return { pending: [], parked: [] }; }
};
const gamesFor = async (teamId) =>
  ((await admin.from('games').select('id,client_id').or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)).data || []);

// ---- sign in for real, and let the season migrate up --------------------------
await send('Page.navigate', { url: 'about:blank' });
await sleep(200);
await send('Storage.clearDataForOrigin', { origin: APP, storageTypes: 'all' });
await send('Page.navigate', { url: APP });
await until('a clean boot', async () => (await js(`Object.keys(localStorage).length ? 1 : null`)), 15000);

await put(authKey, captured[authKey]);
await put('score-tracker:state', JSON.stringify({ version: 3, state: { ...seeded, screen: 'team' } }));
await send('Page.reload');

const teamRow = await until('the team to exist', async () => {
  const r = await admin.from('teams').select('*').eq('created_by', uid);
  return (r.data || []).find((t) => t.name === seeded.myTeam.name) || null;
}, 30000);
need('a migrated team', !!teamRow);
const teamId = teamRow.id;
const gamesAtStart = (await gamesFor(teamId)).length;
ok('signed in, the season is in the account', gamesAtStart === seeded.history.length);

// ---- 1. offline launch with an aged token shows the season --------------------
// Let the token genuinely expire, then make the refresh endpoint unreachable.
console.log(`waiting ${lifetime + 3}s for the token to actually expire…`);
await sleep((lifetime + 3) * 1000);
await send('Network.setBlockedURLs', { urls: ['*/auth/v1/token*'] });
await send('Page.reload');

const stale = await until('the app to come up with an unusable token', async () => {
  const t = await bodyText();
  return t && t.length > 40 && !/Loading…|Checking your season/.test(t) ? t : null;
}, 30000);
ok('the app comes up at all', !!stale, await bodyText());
need('the app to render', !!stale);

ok('it does NOT demand a sign-in', !/Email me a code|6-digit code/.test(stale), stale.slice(0, 200));
ok('the season is on screen', /GRASS STAINS|Grass Stains/i.test(stale), stale.slice(0, 200));
ok('and it says the account cannot be reached', /Can't reach your account|cannot be reached/i.test(stale),
  stale.slice(0, 240));

const staleState = await appState();
ok('the roster is intact', (staleState.roster || []).length === seeded.roster.length,
  `${(staleState.roster || []).length} players`);
ok('and so is the history', (staleState.history || []).length >= seeded.history.length);

// ---- 2. finalising while stale still saves AND still queues -------------------
await put('score-tracker:state', JSON.stringify({
  version: 3,
  state: { ...liveState(['1B', '2B', 'HR', 'K', 'BB', '1B']), history: staleState.history },
}));
const reloadAt = Date.now();
await send('Page.reload');

// Wait for the DOM, not for localStorage — the state there is what this test
// just wrote, so it says nothing about whether the app has rendered.
const painted = await until('the live screen to actually render', async () => {
  const t = await bodyText();
  return t && /Game completed/.test(t) ? t : null;
}, 45000, 300);
console.log(`     [timing] app rendered ${painted ? Math.round((Date.now() - reloadAt) / 100) / 10 + 's' : 'NEVER'} after reload with the auth endpoint blocked`);
if (!painted) {
  console.log('     [diag] on screen : ' + String(await bodyText()).slice(0, 200));
  console.log('     [diag] page said : ' + (pageLog.join(' | ') || 'nothing'));
}
ok('a game can still be scored while the account is unreachable', !!painted, 'the live screen never rendered');
need('a live game', !!painted);
const live = await appState();

const idsBefore = new Set((live.history || []).map((g) => g.id));
const queueBefore = (await queue()).pending.length;

eq('tapped Game completed', await clickText('Game completed'), 'OK');
eq('tapped Finalize', await clickText('Finalize & update standings'), 'OK');

const finalized = await until('the game to be recorded locally', async () => {
  const s = await appState();
  return (s && s.history ? s.history : []).find((g) => !idsBefore.has(g.id)) || null;
}, 20000);
ok('finalising while stale still saves the game on the device', !!finalized);
need('a finalized game', !!finalized);

const queued = await until('the write to be queued', async () => {
  const q = await queue();
  return q.pending.some((e) => e.kind === 'game' && e.payload.id === finalized.id) ? q : null;
}, 20000);
ok('and it is queued for the account, not dropped', !!queued,
  JSON.stringify((await queue()).pending.map((e) => e.kind)));
ok('the queue grew', (await queue()).pending.length > queueBefore);

const stamped = (await queue()).pending.find((e) => e.kind === 'game' && e.payload.id === finalized.id);
eq('the queued write is stamped with the account it belongs to', stamped && stamped.owner, uid);
eq('nothing was parked', (await queue()).parked.length, 0);
eq('and nothing reached the account while unreachable', (await gamesFor(teamId)).length, gamesAtStart);

// ---- 3. sign out with unsent writes warns, and keeps everything ---------------
// Let the token endpoint work again so the app can reach a settled state, but
// keep the game write from landing so the queue stays non-empty.
await send('Network.setBlockedURLs', { urls: ['*rpc/save_game*'] });
await put('score-tracker:state', JSON.stringify({
  version: 3,
  state: { ...(await appState()), screen: 'roster', gameActive: false },
}));
await send('Page.reload');
await until('the roster screen', async () => {
  const t = await bodyText();
  return t && /Season data/.test(t) ? t : null;
}, 30000);

const pendingAtSignOut = (await queue()).pending.length;
ok('there are still unsent writes', pendingAtSignOut > 0, JSON.stringify(await queue()));

eq('the account row offers a sign out', await clickText('Sign out'), 'OK');
const sheet = await until('the sign-out sheet', async () => {
  const t = await bodyText();
  return t && /Sign out/.test(t) && /not reached your account|Your season stays on this phone/.test(t) ? t : null;
}, 15000);
ok('signing out warns about the unsent writes', /not reached your account/.test(sheet || ''), (sheet || '').slice(0, 300));
ok('and says they stay addressed to this account', /addressed to this account/.test(sheet || ''), (sheet || '').slice(0, 400));
ok('and promises the season stays', /season stays on this phone/.test(sheet || ''), (sheet || '').slice(0, 400));

const seasonBefore = await appState();
eq('signed out', await clickText('Sign out anyway'), 'OK');

const afterSignOut = await until('the app to settle signed out', async () => {
  const t = await bodyText();
  return t && /Not signed in/.test(t) ? t : null;
}, 25000);
ok('it shows a signed-out banner rather than a wall', !!afterSignOut, (await bodyText()).slice(0, 200));
ok('the season is still on screen', !/Email me a code/.test(afterSignOut || ''), (afterSignOut || '').slice(0, 200));

const seasonAfter = await appState();
eq('the roster survived sign-out', (seasonAfter.roster || []).length, (seasonBefore.roster || []).length);
eq('the history survived sign-out', (seasonAfter.history || []).length, (seasonBefore.history || []).length);

const queueAfter = await queue();
eq('the queue survived sign-out', queueAfter.pending.length, pendingAtSignOut);
ok('and the entries are still addressed to that account',
  queueAfter.pending.every((e) => e.owner === uid || e.owner == null),
  JSON.stringify(queueAfter.pending.map((e) => e.owner)));

const markerAfter = await get('score-tracker:syncedGames');
eq('the synced-games marker was cleared', markerAfter, null);

// The sign-in screen is reachable, and leaveable.
eq('sign in is offered', await clickText('Sign in'), 'OK');
const signInScreen = await until('the sign-in screen', async () => {
  const t = await bodyText();
  return t && /Email me a code/.test(t) ? t : null;
}, 15000);
ok('sign-in is a screen you can reach', !!signInScreen);
eq('and one you can leave', await clickText('‹ Keep using this phone only'), 'OK');
const back = await until('the season again', async () => {
  const t = await bodyText();
  return t && /Season data|GRASS STAINS/i.test(t) ? t : null;
}, 15000);
ok('backing out returns to the season', !!back, (await bodyText()).slice(0, 160));

await send('Network.setBlockedURLs', { urls: [] });

const crashed = await js(`!!document.body.textContent.match(/Something went wrong/)`);
eq('the app never fell into its error boundary', crashed, false);
ok('no uncaught page errors', pageLog.length === 0, pageLog.join('\n  '));

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
ws.close();
process.exit(fail ? 1 : 0);
