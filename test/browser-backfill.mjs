// "Send past games to my account", driven through the real UI.
//
// The unit suite proves the adapter and the pre-flight. This proves the button
// exists, the sheet says the right numbers, tapping it actually writes, and the
// summary matches what the database holds afterwards.
//
// Manual harness. Needs the local Supabase stack, a dev server on :5173 and
// Chrome on --remote-debugging-port=9222. Never a hosted project.

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
const email = `bf${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.test`;
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
const base = SEEDED(INITIAL_STATE);

// One legacy record among the good ones: a level game stored as a win, which
// the original engine produced because it used >=. save_game refuses it, so it
// must be named on screen rather than quietly dropped. Restoring a backup that
// contains one is a real way to arrive here.
const legacy = {
  ...base.history[0],
  id: 'g-legacy-tie',
  label: 'Legacy tie',
  score: { us: 4, them: 4 },
  result: 'W',
};
const seeded = { ...base, history: [...base.history, legacy] };
const sendableCount = base.history.length;

// ---- CDP ---------------------------------------------------------------------
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
const clickPrefix = async (prefix, ms = 10000) => {
  const hit = await until(`a button starting "${prefix}"`, () =>
    js(`(() => {
      const norm = (e) => (e.textContent || '').replace(/\\s+/g, ' ').trim();
      const el = [...document.querySelectorAll('button,[role=button]')].reverse().find((e) => norm(e).startsWith(${JSON.stringify(prefix)}));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      el.click();
      return norm(el);
    })()`), ms);
  return hit || 'MISS — on screen: ' + JSON.stringify(await buttons());
};

const gamesFor = async (teamId) =>
  ((await admin.from('games').select('id,client_id').or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)).data || []);

// ---- local-only mode must not show the button --------------------------------
await send('Page.navigate', { url: 'about:blank' });
await sleep(200);
await send('Storage.clearDataForOrigin', { origin: APP, storageTypes: 'all' });
await send('Page.navigate', { url: APP });
await until('a clean boot', async () => (await js(`Object.keys(localStorage).length ? 1 : null`)), 15000);

await put('score-tracker:state', JSON.stringify({ version: 3, state: { ...seeded, screen: 'roster' } }));
await send('Page.reload');
{
  // Since phase 2a, being signed out is a banner over a working app rather
  // than a wall in front of it.
  const shown = await until('whatever the app shows with no session', async () => {
    const t = await bodyText();
    return t && t.length > 40 ? t : null;
  }, 20000);
  ok('with no session the app says so', /Not signed in/.test(shown || ''), (shown || '').slice(0, 160));
  ok('and the local season is reachable anyway',
    /Season data|Export season/.test(shown || ''), (shown || '').slice(0, 200));
  ok('without demanding a sign-in first',
    !/Email me a code|6-digit code/.test(shown || ''), (shown || '').slice(0, 200));

  const list = await buttons();
  ok('so the backfill button is not offered either',
    !list.some((b) => b.includes('Send past games')), JSON.stringify(list));
}

// ---- signed in, with a season that migrates up -------------------------------
await put(authKey, captured[authKey]);
await send('Page.reload');

const teamRow = await until('the team to exist', async () => {
  const r = await admin.from('teams').select('*').eq('created_by', uid);
  return (r.data || []).find((t) => t.name === seeded.myTeam.name) || null;
}, 30000);
need('a migrated team', !!teamRow);
const teamId = teamRow.id;

const afterMigration = await gamesFor(teamId);
eq('the migration put the whole history in the account', afterMigration.length, seeded.history.length);

// Get to the roster screen the way a person would, then settle.
await until('the app to settle on a screen', async () => {
  const s = await appState();
  return s && s.myTeam && s.myTeam.name ? s : null;
}, 25000);
await put('score-tracker:state', JSON.stringify({ version: 3, state: { ...seeded, screen: 'roster' } }));
await send('Page.reload');
await until('the roster screen', async () => {
  const t = await bodyText();
  return t && /Season data/.test(t) ? t : null;
}, 25000);

{
  const signedInText = await bodyText();
  ok('signed in, the export note says the account holds the season',
    /saved to your account/.test(signedInText), signedInText.slice(0, 300));
  ok('and no longer claims a reinstall takes the season with it',
    !/lives only in this browser/.test(signedInText), signedInText.slice(0, 300));
  ok('while still pointing at the export as a file copy',
    /file copy you keep yourself/.test(signedInText), signedInText.slice(0, 300));
}

eq('signed in, the button is offered', await clickText('⇪ Send past games to my account'), 'OK');

// ---- the sheet ----------------------------------------------------------------
const sheet = await until('the pre-flight to load', async () => {
  const t = await bodyText();
  return t && /Send past games to your account/.test(t) && !/Checking your account/.test(t) ? t : null;
}, 25000);
ok('the pre-flight sheet opened', !!sheet, await bodyText());

ok('it says these games are already in the account rather than missing',
  /already in your account/.test(sheet || ''), sheet);
ok('it tells you to export first', /Export first/.test(sheet || ''), sheet);
ok('the legacy game is named as unsendable', /1 GAME CAN'T BE SENT/.test(sheet || ''), sheet);
ok('and it is named by its label', /Legacy tie/.test(sheet || ''), sheet);
ok('with the reason spelled out',
  /recorded as a win but the score was 4–4/.test(sheet || ''), sheet);
ok('and it says those games stay on the phone',
  /stay on your phone/.test(sheet || ''), sheet);

// The responsive audit cannot reach this sheet — it is transient state, so it
// cannot be injected and reloaded into. Measure it here instead, on the
// smallest screen, with the blocked list open.
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

for (const [name, w, h] of [['iPhone SE', 375, 667], ['iPhone 15 Pro Max', 430, 932]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false });
  await sleep(400);
  const m = await js(MEASURE);
  eq(`${name}: the sheet does not overflow sideways`, m.overflow <= 0, true);
  eq(`${name}: nothing is clipped off the edge`, m.wide, []);
  eq(`${name}: every control in it is tappable`, m.small, []);
}
await send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 3, mobile: false });
await sleep(300);

const label = await clickPrefix('Re-check');
ok('the action names what it will do', String(label).startsWith('Re-check'), String(label));

const done = await until('the run to finish', async () => {
  const t = await bodyText();
  return t && /of \d+ sent/.test(t) ? t : null;
}, 30000);
ok('a summary appeared', !!done, await bodyText());
ok(`it reports ${sendableCount} of ${sendableCount} sent`,
  new RegExp(`${sendableCount} of ${sendableCount} sent`).test(done || ''), done);
ok('the unsendable game is STILL listed after the run', /CAN'T BE SENT/.test(done || ''), done);
ok('and still named', /Legacy tie/.test(done || ''), done);
ok('and says nothing was duplicated', /Nothing was duplicated|not send them twice/.test(done || ''), done);

eq('the account did NOT gain any rows', (await gamesFor(teamId)).length, afterMigration.length);

const marked = JSON.parse((await get('score-tracker:syncedGames')) || '[]');
eq('only the sendable games are marked sent', marked.length, sendableCount);
ok('the legacy game was never marked sent', !marked.includes('g-legacy-tie'), JSON.stringify(marked));

eq('the summary closes', await clickText('Done'), 'OK');

// ---- re-opening now finds nothing ---------------------------------------------
eq('the button is still there', await clickText('⇪ Send past games to my account'), 'OK');
const second = await until('the second pre-flight', async () => {
  const t = await bodyText();
  return t && /CAN'T BE SENT/.test(t) && !/Checking your account/.test(t) ? t : null;
}, 25000);
ok('re-opening still names the game that cannot be sent', !!second, await bodyText());
ok('and no longer offers anything to send',
  /No games can be sent as they stand/.test(second || ''), second);
eq('and closes cleanly', await clickText('Close'), 'OK');

const onDevice = await appState();
const stillWrong = (onDevice.history || []).find((g) => g.id === 'g-legacy-tie');
eq('the legacy record was NOT rewritten on the device', stillWrong ? stillWrong.result : null, 'W');

// ---- the sign-out sheet, while genuinely signed in --------------------------
// Measured here rather than in browser-session.mjs because that harness only
// runs with a short jwt_expiry, and this UI should be checked on every run.
{
  eq('the account row offers a sign out', await clickText('Sign out'), 'OK');
  const sheet = await until('the sign-out sheet', async () => {
    const t = await bodyText();
    return t && /Your season stays on this phone/.test(t) ? t : null;
  }, 15000);
  ok('signing out explains what happens to the season', !!sheet, (await bodyText()).slice(0, 200));
  ok('and names the account', /Signed in as/.test(sheet || ''), (sheet || '').slice(0, 200));
  ok('with nothing queued, it does not invent a warning',
    !/have not reached your account/.test(sheet || ''), (sheet || '').slice(0, 300));

  for (const [name, w, h] of [['iPhone SE', 375, 667], ['iPhone 15 Pro Max', 430, 932]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false });
    await sleep(400);
    const m = await js(MEASURE);
    eq(`${name}: the sign-out sheet does not overflow`, m.overflow <= 0, true);
    eq(`${name}: nothing clipped`, m.wide, []);
    eq(`${name}: every control tappable`, m.small, []);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 3, mobile: false });

  eq('and it can be dismissed without signing out', await clickText('Cancel'), 'OK');
  const stillIn = await until('the roster again', async () => {
    const t = await bodyText();
    return t && /Season data/.test(t) && !/Your season stays on this phone/.test(t) ? t : null;
  }, 15000);
  ok('cancelling leaves you signed in', !!stillIn, (await bodyText()).slice(0, 160));
  ok('and the account is still shown', /syncs to this account/.test(stillIn || ''), (stillIn || '').slice(0, 400));
}

const crashed = await js(`!!document.body.textContent.match(/Something went wrong/)`);
eq('the app never fell into its error boundary', crashed, false);
ok('no uncaught page errors', pageLog.length === 0, pageLog.join('\n  '));

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
ws.close();
process.exit(fail ? 1 : 0);
