// A write that cannot be sent, seen the way the person scoring would see it.
//
// The game is refused by save_game's own guard against a real Postgres — no
// stubbing — and the test then checks that the app is honest about it: a bar
// that cannot be dismissed, a screen naming the game and quoting the database,
// survival across a reload, and a retry that does not reorder anything.
//
// Manual harness. Needs the local stack, a dev server on :5173 and Chrome on
// --remote-debugging-port=9222. Never a hosted project.

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
const email = `parked${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.test`;
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

const { INITIAL_STATE } = await import(`${SRC}/data/league.js`);
const { SEEDED } = await import('./fixtures-history.js');
const seeded = SEEDED(INITIAL_STATE);

// ---- CDP ----------------------------------------------------------------------
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let msgId = 0;
const pendingCalls = new Map();
const pageLog = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pendingCalls.has(m.id)) { pendingCalls.get(m.id)(m); pendingCalls.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    pageLog.push('uncaught: ' + (m.params.exceptionDetails.exception?.description || '').split('\n')[0]);
  }
});
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++msgId;
    pendingCalls.set(i, (x) => (x.error ? rej(new Error(method + ' ' + JSON.stringify(x.error))) : res(x.result)));
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
await send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 3, mobile: false });

const put = (k, v) => js(`localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)}), 1`);
const get = (k) => js(`localStorage.getItem(${JSON.stringify(k)})`);
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
const queueState = async () => {
  try { return JSON.parse((await get('score-tracker:queue')) || '{"pending":[],"parked":[]}'); }
  catch { return { pending: [], parked: [] }; }
};

const MEASURE = `(() => {
  const vw = window.innerWidth;
  const overflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw;
  const inScroller = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ov = getComputedStyle(p).overflowX;
      if (ov === 'auto' || ov === 'scroll') return true;
    }
    return false;
  };
  const wide = [...document.querySelectorAll('*')].filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const ov = getComputedStyle(el).overflowX;
    if (ov === 'auto' || ov === 'scroll') return false;
    if (inScroller(el)) return false;
    return r.right > vw + 1 || r.left < -1;
  }).slice(0, 3).map((el) => el.tagName + ' "' + (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 20) + '"');
  const small = [...document.querySelectorAll('button,[role=button]')].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && (r.width < 40 || r.height < 40);
  }).map((el) => (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 20));
  return { overflow, wide, small };
})()`;

// ---- sign in and migrate ------------------------------------------------------
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

await until('the app to settle', async () => {
  const t = await bodyText();
  return t && !/Loading…|Checking your season/.test(t) ? t : null;
}, 25000);

// ---- plant a write the database will refuse on its own terms -----------------
// A finished game with no box score. save_game's guard rejects it; nothing here
// fabricates the failure. It is queued the way the app queues its own writes.
const doomedId = `g-doomed-${Date.now()}`;
const doomed = {
  ...seeded.history[0],
  id: doomedId,
  label: 'Oct 4',
  opponent: 'Rubber Chickens',
  lines: [],
};

const beforeQueue = await queueState();
await js(`(() => {
  const KEY = 'score-tracker:queue';
  const state = JSON.parse(localStorage.getItem(KEY) || '{"seq":0,"pending":[],"parked":[]}');
  const seq = (state.seq || 0) + 1;
  state.seq = seq;
  state.pending.push({
    id: 'q' + seq, seq, kind: 'game', payload: ${JSON.stringify(doomed)},
    coalesceKey: null, owner: ${JSON.stringify(uid)}, status: 'pending',
    attempts: 0, lastError: null, createdAt: Date.now(), updatedAt: Date.now(),
  });
  localStorage.setItem(KEY, JSON.stringify(state));
  return 1;
})()`);
ok('a refusable write is queued', (await queueState()).pending.length === beforeQueue.pending.length + 1);

// A reload makes the app pick it up and try it.
await send('Page.reload');

const parked = await until('the write to be parked by the server', async () => {
  const q = await queueState();
  return q.parked.some((e) => e.payload && e.payload.id === doomedId) ? q : null;
}, 30000);
ok('the database refused it and it parked', !!parked, JSON.stringify(await queueState()).slice(0, 300));
need('a parked write', !!parked);
eq('it is not still pending', (await queueState()).pending.some((e) => e.payload?.id === doomedId), false);
eq('and it never reached the account',
  ((await admin.from('games').select('id').eq('client_id', doomedId)).data || []).length, 0);

// ---- the indicator ------------------------------------------------------------
const withBar = await until('the indicator', async () => {
  const t = await bodyText();
  return t && /didn.t save/.test(t) ? t : null;
}, 20000);
ok('a bar says something did not save', !!withBar, (await bodyText()).slice(0, 200));
ok('and says where it still is', /Still on this phone/.test(withBar || ''), (withBar || '').slice(0, 200));

const barButtons = await buttons();
ok('there is no way to dismiss it',
  !barButtons.some((b) => /dismiss|ignore|×|✕|discard/i.test(b)), JSON.stringify(barButtons.slice(0, 12)));

// It must survive moving around the app.
await js(`(() => {
  const raw = JSON.parse(localStorage.getItem('score-tracker:state'));
  raw.state.screen = 'roster';
  localStorage.setItem('score-tracker:state', JSON.stringify(raw));
  return 1;
})()`);
await send('Page.reload');
const stillThere = await until('the bar on another screen', async () => {
  const t = await bodyText();
  return t && /didn.t save/.test(t) && /Season data/.test(t) ? t : null;
}, 25000);
ok('the indicator is on other screens too, not just one', !!stillThere, (await bodyText()).slice(0, 200));

// ---- the screen ---------------------------------------------------------------
eq('opened the review screen', await clickText('Review'), 'OK');
const screen = await until('the parked list', async () => {
  const t = await bodyText();
  return t && /Changes that didn.t save/.test(t) ? t : null;
}, 15000);
ok('it lists them', !!screen, (await bodyText()).slice(0, 200));

ok('the entry says it was a game', /GAME/.test(screen || ''), (screen || '').slice(0, 400));
ok('and names which game', /Oct 4/.test(screen || '') && /Rubber Chickens/.test(screen || ''),
  (screen || '').slice(0, 400));
ok('and quotes what the database actually said',
  /no box-score lines/.test(screen || ''), (screen || '').slice(0, 500));
ok('and says when', /ago|just now/.test(screen || ''), (screen || '').slice(0, 400));
ok('and reassures that nothing was lost',
  /still on this phone|nothing has been lost/i.test(screen || ''), (screen || '').slice(0, 500));

const screenButtons = await buttons();
ok('there is no discard control anywhere on it',
  !screenButtons.some((b) => /discard|delete|remove|dismiss|clear/i.test(b)), JSON.stringify(screenButtons));
ok('but there is a retry', screenButtons.some((b) => /Try again/i.test(b)), JSON.stringify(screenButtons));

for (const [name, w, h] of [['iPhone SE', 375, 667], ['iPhone 15 Pro Max', 430, 932]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false });
  await sleep(400);
  const m = await js(MEASURE);
  eq(`${name}: the list does not overflow`, m.overflow <= 0, true);
  eq(`${name}: nothing clipped`, m.wide, []);
  eq(`${name}: every control tappable`, m.small, []);
}
await send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 3, mobile: false });

// ---- retry, on something that still cannot succeed ---------------------------
eq('tapped try again', await clickText('Try again'), 'OK');
await sleep(2500);
const afterRetry = await queueState();
eq('it is still parked, because the server still refuses it', afterRetry.parked.length, 1);
eq('and it was not lost in the attempt', afterRetry.parked[0].payload.id, doomedId);
const stillListed = await bodyText();
ok('the screen still shows it', /no box-score lines/.test(stillListed), stillListed.slice(0, 300));

// ---- it survives a reload ----------------------------------------------------
await send('Page.reload');
const afterReload = await until('the indicator after a reload', async () => {
  const t = await bodyText();
  return t && /didn.t save/.test(t) ? t : null;
}, 25000);
ok('after a full reload the parked write is still surfaced', !!afterReload, (await bodyText()).slice(0, 200));
eq('and still in the queue', (await queueState()).parked.length, 1);

// ---- fixing it lets it through, and the bar goes on its own ------------------
await js(`(() => {
  const KEY = 'score-tracker:queue';
  const state = JSON.parse(localStorage.getItem(KEY));
  state.parked[0].payload.lines = ${JSON.stringify(seeded.history[0].lines)};
  localStorage.setItem(KEY, JSON.stringify(state));
  return 1;
})()`);

eq('reopened the list', await clickText('Review'), 'OK');
eq('tapped try all again', await clickText('Try again'), 'OK');

const cleared = await until('the write to go through', async () => {
  const rows = (await admin.from('games').select('id').eq('client_id', doomedId)).data || [];
  return rows.length ? rows : null;
}, 25000);
ok('once it can succeed, retrying sends it', !!cleared);
eq('the parked list empties by SUCCEEDING, not by being cleared', (await queueState()).parked.length, 0);

const afterFix = await until('the indicator to disappear', async () => {
  const t = await bodyText();
  return t && !/didn.t save/.test(t) ? t : null;
}, 20000);
ok('and the indicator goes away on its own', !!afterFix, (await bodyText()).slice(0, 200));

const crashed = await js(`!!document.body.textContent.match(/Something went wrong/)`);
eq('the app never fell into its error boundary', crashed, false);
ok('no uncaught page errors', pageLog.length === 0, pageLog.join('\n  '));

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
ws.close();
process.exit(fail ? 1 : 0);
