// What every multi-phone browser harness needs, once.
//
// The older harnesses each carry their own copy of this; they are left alone
// because they pass and rewriting them proves nothing. New harnesses import it,
// and get three things the copies do not have:
//
//   * need() that tidies up. A harness that stops early used to leave its
//     private browser contexts open, and enough of those start killing CDP
//     sessions in later runs for reasons that have nothing to do with the app.
//     Here, a failed need() throws, and the handler disposes every context this
//     run opened before exiting 2.
//   * the clock. The app exposes window.__scoreTrackerClock in development, so a
//     three-hour cutoff is tested by moving time rather than waiting for it.
//   * the viewport audit, on whatever the phone is showing.
//
// Not a suite and not a harness on its own: nothing here runs when imported
// except the preflight, which refuses loudly if the world is not ready.

import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { CLIPPED, MEASURE, VIEWPORTS } from './viewport-measure.mjs';

export const SRC = new URL('../src', import.meta.url).pathname;
const repoRoot = new URL('..', import.meta.url).pathname;
export const APP = 'http://localhost:5173';

// ---- counting ------------------------------------------------------------------
let failures = 0;
export const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failures++;
    console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  } else console.log('ok   ' + label);
};
export const ok = (label, cond, detail) => {
  if (cond) {
    console.log('ok   ' + label);
    return;
  }
  failures++;
  // A detail can be a function, so it is only worked out on failure — and an
  // async one, since most of what is worth printing is on a phone.
  const said = typeof detail === 'function' ? detail() : detail;
  if (said && typeof said.then === 'function') {
    console.log(`FAIL ${label}`);
    return said.then((text) => console.log(`  ${label} — ${text}`), () => {});
  }
  console.log(`FAIL ${label}${said ? '\n  ' + said : ''}`);
};
export const failed = () => failures;

// ---- stopping early, tidily --------------------------------------------------------
class NeedError extends Error {}
const contexts = [];
let ws = null;
let msgId = 0;
const pending = new Map();

async function disposeContexts() {
  if (!ws || ws.readyState !== 1) return;
  for (const browserContextId of contexts.splice(0)) {
    try {
      await raw('Target.disposeBrowserContext', { browserContextId });
    } catch {
      /* already gone */
    }
  }
}

process.on('uncaughtException', async (err) => {
  const planned = err instanceof NeedError;
  if (!planned) console.log('\nCRASHED: ' + (err && err.stack ? err.stack : err));
  await disposeContexts();
  try {
    if (ws) ws.close();
  } catch {
    /* closing anyway */
  }
  process.exit(planned ? 2 : 1);
});

/** Refuse to go on, loudly, and leave the browser as it was found. */
export const need = (what, cond, detail) => {
  if (cond) return;
  console.log(`\nCANNOT RUN: ${what}${detail ? '\n  ' + detail : ''}`);
  throw new NeedError(what);
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const until = async (fn, ms = 20000, step = 250) => {
  const started = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - started > ms) return null;
    await sleep(step);
  }
};

// ---- preflight ------------------------------------------------------------------------
let st;
try {
  st = JSON.parse(execSync('npx supabase status -o json', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString());
} catch (e) {
  need('the local Supabase stack must be running', false, String(e.message).split('\n')[0]);
}
need('the app must be built against the LOCAL stack', st.API_URL.includes('127.0.0.1'), st.API_URL);

let devOk = false;
try {
  devOk = (await fetch(APP, { signal: AbortSignal.timeout(3000) })).ok;
} catch { /* reported below */ }
need(`a dev server must be serving ${APP} (npm run dev)`, devOk);

let browserWsUrl;
try {
  const version = await (await fetch('http://localhost:9222/json/version', { signal: AbortSignal.timeout(3000) })).json();
  browserWsUrl = version.webSocketDebuggerUrl;
} catch { /* reported below */ }
need('Chrome must be running with --remote-debugging-port=9222', !!browserWsUrl);

{
  // A harness started too soon after `supabase db reset` otherwise HANGS, with
  // no output: supabase-js retries against an auth service still restarting.
  let up = false;
  for (let i = 0; i < 90 && !up; i++) {
    try {
      up = (await fetch(`${st.API_URL}/auth/v1/health`, { signal: AbortSignal.timeout(2000) })).ok;
    } catch { /* not yet */ }
    if (!up) await sleep(1000);
  }
  need('the auth service must be up (it restarts after `supabase db reset`)', up);
}

export const stack = st;
export const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
export const anonClient = () => createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false } });
export const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 5)}`;

/** A real account, signed in, with the session blob a browser will accept. */
export async function account(tag) {
  const password = 'Password123!';
  const email = `h${tag}${stamp}@example.test`;
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  need(`the ${tag} account could be created`, !made.error, made.error && made.error.message);
  const captured = {};
  const client = createClient(st.API_URL, st.ANON_KEY, {
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
  const signIn = await client.auth.signInWithPassword({ email, password });
  need(`the ${tag} account could sign in`, !signIn.error, signIn.error && signIn.error.message);
  const key = Object.keys(captured).find((k) => k.startsWith('sb-'));
  need('supabase-js wrote a session to storage', !!key);
  return { id: signIn.data.user.id, client, authKey: key, authValue: captured[key] };
}

// ---- CDP ----------------------------------------------------------------------------------
const logs = new Map();
const listeners = new Map(); // sessionId -> Set of (message) => void
ws = new WebSocket(browserWsUrl);
await new Promise((r) => ws.addEventListener('open', r));
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
    return;
  }
  if (!m.sessionId) return;
  for (const fn of listeners.get(m.sessionId) || []) {
    try {
      fn(m);
    } catch {
      /* a harness's listener must not take the connection down */
    }
  }
  const bucket = logs.get(m.sessionId);
  if (!bucket) return;
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    bucket.push(m.params.type + ': ' + m.params.args.map((a) => String(a.value ?? a.description ?? '').slice(0, 120)).join(' § '));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    bucket.push('uncaught: ' + (m.params.exceptionDetails.exception?.description || '').split('\n')[0]);
  }
});

function raw(method, params = {}, sessionId) {
  return new Promise((res, rej) => {
    const i = ++msgId;
    pending.set(i, (x) => (x.error ? rej(new Error(method + ' ' + JSON.stringify(x.error))) : res(x.result)));
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

const PHONE = { width: 393, height: 852, deviceScaleFactor: 2, mobile: false };

/** One phone, in its own private browser context: its own storage, its own network. */
export async function phone(name) {
  const { browserContextId } = await raw('Target.createBrowserContext', {});
  contexts.push(browserContextId);
  const { targetId } = await raw('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await raw('Target.attachToTarget', { targetId, flatten: true });
  logs.set(sessionId, []);

  const send = (method, params) => raw(method, params, sessionId);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', PHONE);

  const js = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { ERR: (r.exceptionDetails.exception?.description || '').split('\n')[0] };
    return r.result.value;
  };

  const self = {
    name,
    send,
    js,
    /** Hear every CDP event from this phone. Returns a function that stops. */
    on: (fn) => {
      if (!listeners.has(sessionId)) listeners.set(sessionId, new Set());
      listeners.get(sessionId).add(fn);
      return () => listeners.get(sessionId).delete(fn);
    },
    logs: () => logs.get(sessionId),
    goto: (url) => send('Page.navigate', { url }),
    reload: () => send('Page.reload'),
    text: async () => (await js(`document.body.textContent.replace(/\\s+/g,' ').trim()`)) || '',
    state: async () => {
      const stored = await js(`localStorage.getItem('score-tracker:state')`);
      try { return JSON.parse(stored).state; } catch { return null; }
    },
    offline: (yes) =>
      send('Network.emulateNetworkConditions', { offline: yes, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }),
    /** Refuse requests whose URL matches any of these patterns (`*` wildcards). [] lifts it. */
    block: (patterns) => send('Network.setBlockedURLs', { urls: patterns }),
    /** Move this phone's clock. Only the app's own "how long since" reads it. */
    advanceClock: (ms) => js(`window.__scoreTrackerClock ? (window.__scoreTrackerClock.advance(${Number(ms)}), 'OK') : 'NO CLOCK'`),
    resetClock: () => js(`window.__scoreTrackerClock ? (window.__scoreTrackerClock.reset(), 'OK') : 'NO CLOCK'`),
    buttons: () =>
      js(`[...document.querySelectorAll('button,[role=button]')].filter((e)=>e.getBoundingClientRect().width>0).map((e)=>(e.textContent||'').replace(/\\s+/g,' ').trim())`),
  };

  /** Tap whatever is showing this text — a real control wins over a container. */
  self.tap = async (text, ms = 12000) => {
    const hit = await until(() =>
      js(`(() => {
        const want = ${JSON.stringify(text)};
        const norm = (e) => (e.textContent || '').replace(/\\s+/g, ' ').trim();
        const matches = [...document.querySelectorAll('body *')].filter(
          (e) => norm(e).includes(want) && e.getBoundingClientRect().width > 0,
        );
        const clickable = matches.filter((e) => e.matches('button,[role=button]') && !e.disabled);
        const pool = clickable.length ? clickable : matches.filter((e) => !e.matches('button[disabled]'));
        const el = pool.find((e) => !pool.some((o) => o !== e && e.contains(o)));
        if (!el) return null;
        el.click();
        return 'OK';
      })()`), ms);
    if (hit) return 'OK';
    return `MISS "${text}" — on screen: ` + String(await self.text()).slice(0, 240);
  };

  /** Set an input's value the way React hears it. */
  self.type = (selector, value) =>
    js(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'MISS';
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'OK';
    })()`);

  /** Wait until the page says something. */
  self.sees = (want, ms = 20000) => until(async () => ((await self.text()).includes(want) ? true : null), ms);

  /**
   * The viewport audit, on whatever this phone is showing now, at all four
   * iPhone sizes. The same yardstick as viewports.mjs.
   */
  self.audit = async (when) => {
    for (const [vp, w, h, dsf] of VIEWPORTS) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dsf, mobile: false });
      await sleep(400);
      const m = await js(MEASURE);
      const clipped = await js(CLIPPED);
      ok(`${when}, ${vp}: nothing runs off the side`, m && !m.ERR && m.overflow <= 0 && !m.wide.length, JSON.stringify(m));
      ok(`${when}, ${vp}: nothing is clipped inside a scrolling screen`, Array.isArray(clipped) && !clipped.length, JSON.stringify(clipped));
      ok(`${when}, ${vp}: every control is big enough to hit`, m && m.smallCount === 0, JSON.stringify(m && m.small));
    }
    await send('Emulation.setDeviceMetricsOverride', PHONE);
    await sleep(300);
  };

  return self;
}

/**
 * Put a phone on the app, signed in, with a season, before any app script runs.
 * Seeding an already-running app races its own first save; injecting on the new
 * document does not.
 */
export async function boot(p, acct, state, extra = {}, ready = null) {
  await p.goto('about:blank');
  await sleep(150);
  await p.send('Storage.clearDataForOrigin', { origin: APP, storageTypes: 'all' });
  // `state` null is a phone with nothing of its own on it — a second phone that
  // takes its team from the account. `ready` says when such a phone has landed.
  const items = { [acct.authKey]: acct.authValue, ...extra };
  if (state) items['score-tracker:state'] = JSON.stringify({ version: 3, state });
  const { identifier } = await p.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try {\n${Object.entries(items).map(([k, v]) => `  localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n')}\n} catch (e) {}`,
  });
  await p.goto(APP);
  const landed = await until(async () => {
    const s = await p.state();
    if (!s) return null;
    if (ready) return ready(s) ? s : null;
    return s.myTeam && state && s.myTeam.name === state.myTeam.name ? s : null;
  }, 40000);
  await p.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  return landed;
}

/** Every phone silent, nothing crashed; then the browser put back and the verdict. */
export async function finish(phones) {
  for (const p of phones) {
    const crashed = await p.js(`!!document.body.textContent.match(/Something went wrong/)`);
    eq(`${p.name} never fell into its error boundary`, crashed, false);
    eq(`${p.name} logged nothing to the console at all`, p.logs(), []);
  }
  await disposeContexts();
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  ws.close();
  process.exit(failures ? 1 : 0);
}
