// Finalizing a game in the REAL app, in a real browser, against a real Postgres.
//
// The unit tests prove save_game behaves. They cannot prove the app calls it:
// the season-fragment crash and the blank-flash both passed every unit test.
// So this drives the actual UI — tap "Game completed", tap "Finalize" — and
// then looks in the database.
//
// Manual harness, like viewports.mjs. Needs:
//   * the local Supabase stack   (npx supabase start)
//   * a dev server on :5173      (npm run dev)
//   * Chrome on :9222            (--remote-debugging-port=9222)
// Never runs against the hosted project: it creates users and writes games.

import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const SRC = new URL('../src', import.meta.url).pathname;
const repoRoot = new URL('..', import.meta.url).pathname;
const APP = 'http://localhost:5173';

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
// Setup failures must stop the run loudly. A harness that quietly skips its
// database half and prints "all passed" is worse than no harness.
const need = (what, cond, detail) => {
  if (!cond) {
    console.log(`\nCANNOT RUN: ${what}${detail ? '\n  ' + detail : ''}`);
    process.exit(2);
  }
};

// ---- the stack ---------------------------------------------------------------
let st;
try {
  st = JSON.parse(
    execSync('npx supabase status -o json', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString(),
  );
} catch (e) {
  need('the local Supabase stack must be running (npx supabase start)', false, String(e.message).split('\n')[0]);
}
need('the app must be built against the LOCAL stack', st.API_URL.includes('127.0.0.1'), st.API_URL);

let devOk = false;
try {
  devOk = (await fetch(APP, { signal: AbortSignal.timeout(3000) })).ok;
} catch { /* reported below */ }
need(`a dev server must be serving ${APP} (npm run dev)`, devOk);

let target;
try {
  const list = await (await fetch('http://localhost:9222/json', { signal: AbortSignal.timeout(3000) })).json();
  target = list.find((x) => x.type === 'page');
} catch { /* reported below */ }
need('Chrome must be running with --remote-debugging-port=9222', !!target);

const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ---- a session the browser will accept ---------------------------------------
// Sign in here, capturing the exact storage key supabase-js writes, then hand
// that entry to the page. The app's own sign-in is email OTP; reproducing the
// mailbox dance would test Supabase's auth, not this slice.
const password = 'Password123!';
const email = `browser${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.test`;
const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
need('a test user could be created', !created.error, created.error?.message);

const captured = {};
const shim = {
  getItem: (k) => (k in captured ? captured[k] : null),
  setItem: (k, v) => { captured[k] = v; },
  removeItem: (k) => { delete captured[k]; },
};
const node = createClient(st.API_URL, st.ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: false, storage: shim },
});
const signIn = await node.auth.signInWithPassword({ email, password });
need('the test user could sign in', !signIn.error, signIn.error?.message);
const uid = signIn.data.user.id;
const authKey = Object.keys(captured).find((k) => k.startsWith('sb-'));
need('supabase-js wrote a session to storage', !!authKey, Object.keys(captured).join(', '));

// ---- a season with a game in progress ----------------------------------------
const { INITIAL_STATE, TEMPLATES } = await import(`${SRC}/data/league.js`);
const { SEEDED } = await import('./fixtures-history.js');
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
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const pageLog = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    pageLog.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  }
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
/** Poll until a predicate holds, so timing never decides whether a test passes. */
const until = async (label, fn, ms = 15000, step = 250) => {
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

const setOffline = (offline) =>
  send('Network.emulateNetworkConditions', {
    offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
  });

const put = (key, value) =>
  js(`localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)}), 1`);
const get = (key) => js(`localStorage.getItem(${JSON.stringify(key)})`);

const buttons = () =>
  js(`[...document.querySelectorAll('button,[role=button]')].map((e) => (e.textContent || '').replace(/\\s+/g, ' ').trim())`);

/**
 * Tap a control by its label, waiting for it to appear. A fixed sleep here
 * makes the harness time-dependent, and a harness that fails on timing teaches
 * nothing about the app.
 */
const clickText = async (text, ms = 8000) => {
  const hit = await until(`the "${text}" control`, () =>
    js(`(() => {
      const norm = (e) => (e.textContent || '').replace(/\\s+/g, ' ').trim();
      const el = [...document.querySelectorAll('button,[role=button]')].reverse().find((e) => norm(e) === ${JSON.stringify(text)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      el.click();
      return 'OK';
    })()`), ms);
  if (hit) return 'OK';
  return 'MISS — on screen: ' + JSON.stringify(await buttons());
};

const appState = async () => {
  const raw = await get('score-tracker:state');
  try { return JSON.parse(raw).state; } catch { return null; }
};

const gamesFor = async (teamId) => {
  const r = await admin.from('games').select('*').or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`);
  return r.data || [];
};

// ---- boot signed in, with a game in progress ----------------------------------
// Start from a genuinely clean origin. Letting the previous run's session boot
// first, then clearing storage underneath it, leaves async work from that boot
// racing the injection — which is what made this harness flaky.
await send('Page.navigate', { url: 'about:blank' });
await sleep(200);
await send('Storage.clearDataForOrigin', { origin: APP, storageTypes: 'all' });
await send('Page.navigate', { url: APP });
await until('a clean, signed-out boot', async () => {
  const keys = await js(`Object.keys(localStorage).length ? Object.keys(localStorage) : null`);
  return keys ? keys : null;
}, 15000);

await put(authKey, captured[authKey]);
await put('score-tracker:state', JSON.stringify({ version: 3, state: liveState(['1B', '2B', 'HR', 'BB', 'K', '1B']) }));
await send('Page.reload');

const teamRow = await until('team created', async () => {
  const r = await admin.from('teams').select('*').eq('created_by', uid).order('created_at');
  return (r.data || []).find((t) => t.name === seeded.myTeam.name) || null;
}, 30000);
if (!teamRow) {
  console.log('  page keys : ' + JSON.stringify(await js(`Object.keys(localStorage)`)));
  console.log('  on screen : ' + (await js(`document.body.textContent.replace(/\\s+/g,' ').trim().slice(0,200)`)));
  console.log('  page said : ' + (pageLog.join('\n              ') || 'nothing'));
}
ok('signing in migrated this device\'s season up to the account', !!teamRow,
  'no team was created for the signed-in user');
need('a team to record games for', !!teamRow);
const teamId = teamRow.id;

const playersUp = await admin.from('players').select('id').eq('team_id', teamId);
eq('the roster went up with it', (playersUp.data || []).length, seeded.roster.length);

// Wait for the backend load to settle before touching anything. A real user
// taps a settled screen; racing the load would only test the harness.
const settled = async () => {
  const seen = await until('the season to settle', async () => {
    const a = await appState();
    if (!a || !a.gameActive) return null;
    await sleep(600);
    const b = await appState();
    if (!b || !b.gameActive) return null;
    return (a.history || []).length === (b.history || []).length ? b : null;
  }, 25000);
  return seen;
};

const liveVisible = await settled();
ok('the game in progress survived sign-in and the backend load', !!liveVisible,
  'the live game was replaced by the account season — the merge regressed');
need('a live game to finalize', !!liveVisible);
eq('and it is on the live screen', liveVisible.screen, 'live');

const before = await gamesFor(teamId);
// Identify the new record by what was NOT there before, rather than by a count:
// the account's history is whatever migrated up, which is not the harness's to
// assume.
const idsBefore = new Set((liveVisible.history || []).map((g) => g.id));

// ---- finalize, online ----------------------------------------------------------
eq('tapped Game completed', await clickText('Game completed'), 'OK');
eq('tapped Finalize', await clickText('Finalize & update standings'), 'OK');

const finalized = await until('the record to be written locally', async () => {
  const s = await appState();
  return (s && s.history ? s.history : []).find((g) => !idsBefore.has(g.id)) || null;
});
ok('the game was recorded on the device', !!finalized);
need('a finalized record to look for', !!finalized);

const row = await until('the game to reach the backend', async () => {
  const rows = await gamesFor(teamId);
  return rows.find((g) => g.client_id === finalized.id) || null;
}, 20000);
if (!row) {
  const q = JSON.parse((await get('score-tracker:queue')) || '{}');
  console.log('  queue pending: ' + JSON.stringify((q.pending || []).map((e) => e.kind + '/' + e.attempts)));
  console.log('  queue parked : ' + JSON.stringify((q.parked || []).map((e) => e.kind + ': ' + (e.error || ''))));
  console.log('  page said    : ' + (pageLog.join('\n                 ') || 'nothing'));
}
ok('finalizing wrote the game to the backend', !!row, 'no row with client_id ' + finalized.id);
need('a game row to inspect', !!row);

eq('exactly one game was added', (await gamesFor(teamId)).length, before.length + 1);
eq('it is final, not in progress', row.status, 'final');

// The row is from the home team's point of view; the device is from ours.
const weHome = finalized.home;
eq('our score is filed on the right side', weHome ? row.home_score : row.away_score, finalized.score.us);
eq('theirs on the other', weHome ? row.away_score : row.home_score, finalized.score.them);
eq('the result is not inverted', weHome ? row.result : { W: 'L', L: 'W', T: 'T' }[row.result], finalized.result);

const dbLines = await admin.from('game_lines').select('*').eq('game_id', row.id);
eq('the whole box score went with it', (dbLines.data || []).length, finalized.lines.length);
const ours = (dbLines.data || []).filter((l) => l.team_id === teamId);
eq('our lines are filed to our team', ours.length, finalized.lines.filter((l) => l.team === 'home').length);
ok('every line of ours is linked to a real player, not just a name',
  ours.every((l) => l.player_id), ours.filter((l) => !l.player_id).map((l) => l.name_snapshot).join(', '));

// The write is not done when the row appears. writeGame reads the game back and
// compares the figures the app would show before marking it synced, so wait for
// that rather than for the insert.
const syncedA = await until('the read-back check to pass', async () => {
  const list = JSON.parse((await get('score-tracker:syncedGames')) || '[]');
  return list.includes(finalized.id) ? list : null;
}, 20000);
ok('the app read the game back and confirmed it matches', !!syncedA,
  'syncedGames never included ' + finalized.id);

const queueA = await until('the queue to drain', async () => {
  const q = JSON.parse((await get('score-tracker:queue')) || '{"pending":[],"parked":[]}');
  return q.pending.length === 0 ? q : null;
}, 15000);
ok('nothing is left queued', !!queueA);
if (queueA) eq('and nothing is parked', queueA.parked.length, 0);

// ---- the game must come back from the account, not from this device -------------
await js(`localStorage.removeItem('score-tracker:state'), 1`);
await send('Page.reload');
const reloaded = await until('the season to load from the account', async () => {
  const s = await appState();
  return s && (s.history || []).some((g) => g.id === finalized.id) ? s : null;
}, 25000);
ok('with local storage wiped, the game still comes back from the account', !!reloaded);
if (reloaded) {
  const back = reloaded.history.find((g) => g.id === finalized.id);
  eq('and reads back as the same result', back.result, finalized.result);
  eq('with the same score, from our point of view', back.score, finalized.score);
  eq('and the same number of box-score lines', (back.lines || []).length, finalized.lines.length);
}

// ---- finalize with no connection ------------------------------------------------
// The phone loses signal at the field constantly. A game finalized offline must
// not be lost, and must not be coalesced away by the season save that follows.
await put('score-tracker:state', JSON.stringify({
  version: 3,
  state: { ...liveState(['1B', '1B', '2B', 'K', 'K', 'HR']), history: reloaded ? reloaded.history : seeded.history },
}));
await send('Page.reload');
const liveAgain = await settled();
ok('a second game can be started after the first was finalized', !!liveAgain);
need('a second live game', !!liveAgain);
const idsBeforeOffline = new Set((liveAgain.history || []).map((g) => g.id));
const beforeOffline = (await gamesFor(teamId)).length;

await setOffline(true);
eq('tapped Game completed (offline)', await clickText('Game completed'), 'OK');
eq('tapped Finalize (offline)', await clickText('Finalize & update standings'), 'OK');

const offlineRecord = await until('the offline record locally', async () => {
  const s = await appState();
  return (s && s.history ? s.history : []).find((g) => !idsBeforeOffline.has(g.id)) || null;
});
ok('the game is recorded on the device with no connection', !!offlineRecord);

const parked = await until('the write to be queued', async () => {
  const q = JSON.parse((await get('score-tracker:queue')) || '{"pending":[],"parked":[]}');
  return q.pending.some((e) => e.kind === 'game') ? q : null;
}, 15000);
ok('the write is queued rather than lost', !!parked);
eq('and nothing reached the backend while offline', (await gamesFor(teamId)).length, beforeOffline);

await setOffline(false);
await js(`window.dispatchEvent(new Event('online')), 1`);

const offlineRow = await until('the queued game to land', async () => {
  const rows = await gamesFor(teamId);
  return offlineRecord ? rows.find((g) => g.client_id === offlineRecord.id) || null : null;
}, 25000);
ok('coming back online delivers the game that was finalized offline', !!offlineRow);
if (offlineRow) {
  const syncedB = await until('the replayed game to verify', async () => {
    const list = JSON.parse((await get('score-tracker:syncedGames')) || '[]');
    return list.includes(offlineRecord.id) ? list : null;
  }, 20000);
  ok('and it verified on read-back too', !!syncedB, 'never marked synced');
  ok('the earlier game was not disturbed', !!syncedB && syncedB.includes(finalized.id),
    'syncedGames: ' + JSON.stringify(syncedB));
  eq('both games are in the account', (await gamesFor(teamId)).length, beforeOffline + 1);
}

const queueB = await until('the queue to drain', async () => {
  const q = JSON.parse((await get('score-tracker:queue')) || '{"pending":[],"parked":[]}');
  return q.pending.length === 0 ? q : null;
}, 15000);
ok('the queue drained', !!queueB);
if (queueB) eq('with nothing parked', queueB.parked.length, 0);

// ---- no crash anywhere along the way --------------------------------------------
const crashed = await js(`!!document.body.textContent.match(/Something went wrong|TEMPLATES/)`);
eq('the app never fell into its error boundary', crashed, false);

if (fail && pageLog.length) console.log('\nthe page reported:\n  ' + pageLog.join('\n  '));
console.log(fail ? `\n${fail} FAILED` : '\nall passed');
ws.close();
process.exit(fail ? 1 : 0);
