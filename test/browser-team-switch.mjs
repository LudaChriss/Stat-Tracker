// Looking at a different team, and being told when a team is not yours.
//
// Two things 4b adds to a screen, and both of them are the kind that unit tests
// cannot settle:
//
//   * SWITCHING. Until now, joining a second team granted the membership and
//     changed nothing — the phone kept showing the season it already had. The
//     dangerous part is not the switch, it is the moment after it: there is one
//     local mirror, and if the new team's app came up seeded with the PREVIOUS
//     team's season, the next save would write one team's roster into another
//     team's row. This drives the switch and then checks what is on screen and
//     what reached the account.
//
//   * BEING A SCORER. A scorer and a viewer have always been shown the same
//     roster controls as the manager, which row-level security then refused. A
//     button that only ever fails is worse than no button.
//
// Manual harness. Needs the local Supabase stack, a dev server on :5173, and
// Chrome on :9222. Never runs against the hosted project.

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
need('the app must be built against the LOCAL stack', st.API_URL.includes('127.0.0.1'), st.API_URL);

let devOk = false;
try { devOk = (await fetch(APP, { signal: AbortSignal.timeout(3000) })).ok; } catch { /* below */ }
need(`a dev server must be serving ${APP}`, devOk);

let browserWsUrl;
try {
  browserWsUrl = (await (await fetch('http://localhost:9222/json/version', { signal: AbortSignal.timeout(3000) })).json())
    .webSocketDebuggerUrl;
} catch { /* below */ }
need('Chrome must be running with --remote-debugging-port=9222', !!browserWsUrl);

const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const password = 'Password123!';
const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 5)}`;

async function account(tag) {
  const email = `sw${tag}${stamp}@example.test`;
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
  return { id: signIn.data.user.id, client, authKey: key, authValue: captured[key] };
}

const both = await account('both');   // manages two teams
const scorer = await account('scr');  // scores for one of them

// ---- CDP ---------------------------------------------------------------------
const ws = new WebSocket(browserWsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let msgId = 0;
const pending = new Map();
const logs = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (!m.sessionId) return;
  const bucket = logs.get(m.sessionId);
  if (!bucket) return;
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    bucket.push(m.params.type + ': ' + m.params.args.map((a) => String(a.value ?? a.description ?? '').slice(0, 90)).join(' § '));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    bucket.push('uncaught: ' + (m.params.exceptionDetails.exception?.description || '').split('\n')[0]);
  }
});
const raw = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const i = ++msgId;
    pending.set(i, (x) => (x.error ? rej(new Error(method + ' ' + JSON.stringify(x.error))) : res(x.result)));
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 25000, step = 250) => {
  const started = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - started > ms) return null;
    await sleep(step);
  }
};

const contexts = [];
async function phone(name) {
  const { browserContextId } = await raw('Target.createBrowserContext', {});
  contexts.push(browserContextId);
  const { targetId } = await raw('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await raw('Target.attachToTarget', { targetId, flatten: true });
  logs.set(sessionId, []);
  const send = (m, p) => raw(m, p, sessionId);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 2, mobile: false });
  const js = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { ERR: (r.exceptionDetails.exception?.description || '').split('\n')[0] };
    return r.result.value;
  };
  const self = {
    name, send, js,
    logs: () => logs.get(sessionId),
    put: (k, v) => js(`localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)}), 1`),
    goto: (url) => send('Page.navigate', { url }),
    reload: () => send('Page.reload'),
    text: () => js(`document.body.textContent.replace(/\\s+/g,' ').trim()`),
    state: async () => {
      const stored = await js(`localStorage.getItem('score-tracker:state')`);
      try { return JSON.parse(stored).state; } catch { return null; }
    },
  };
  self.tap = async (text, ms = 12000) => {
    const hit = await until(() =>
      js(`(() => {
        const want = ${JSON.stringify(text)};
        const norm = (e) => (e.textContent || '').replace(/\\s+/g, ' ').trim();
        const matches = [...document.querySelectorAll('body *')].filter(
          (e) => norm(e).includes(want) && e.getBoundingClientRect().width > 0);
        const clickable = matches.filter((e) => e.matches('button,[role=button]'));
        const pool = clickable.length ? clickable : matches;
        const el = pool.find((e) => !pool.some((o) => o !== e && e.contains(o)));
        if (!el) return null;
        el.click();
        return 'OK';
      })()`), ms);
    return hit ? 'OK' : `MISS "${text}" — on screen: ` + String(await self.text()).slice(0, 220);
  };
  return self;
}

const A = await phone('phone A');
const B = await phone('phone B');

const { INITIAL_STATE } = await import(`${SRC}/data/league.js`);
const { SEEDED } = await import('./fixtures-history.js');
const seeded = SEEDED(INITIAL_STATE);

const boot = async (p, acct, seedState) => {
  // Seed BEFORE the app's own scripts run. Writing localStorage into an
  // already-running app races its first save — it boots on empty storage,
  // writes the blank starting season, and whichever lands last wins. Injecting
  // on the new document is not a race at all.
  await p.goto('about:blank');
  await sleep(150);
  await p.send('Storage.clearDataForOrigin', { origin: APP, storageTypes: 'all' });
  const lines = [`localStorage.setItem(${JSON.stringify(acct.authKey)}, ${JSON.stringify(acct.authValue)});`];
  if (seedState) {
    lines.push(
      `localStorage.setItem('score-tracker:state', ${JSON.stringify(JSON.stringify({ version: 3, state: seedState }))});`,
    );
  }
  const { identifier } = await p.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { ${lines.join(' ')} } catch (e) {}`,
  });
  await p.goto(APP);
  if (seedState) {
    const landed = await until(async () => {
      const s = await p.state();
      return s && s.myTeam && s.myTeam.name === seedState.myTeam.name ? s : null;
    }, 25000);
    need(`${p.name}'s seeded season is in place before the app runs`, !!landed);
  } else {
    await until(() => p.js(`document.readyState === 'complete' ? 1 : null`), 20000);
  }
  // Remove it, or every later reload would re-seed over whatever the app has
  // since done.
  await p.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
};

// ---- one account, two teams ---------------------------------------------------
const FIRST = `Harbour Eels ${stamp}`;
const SECOND = `Ridge Runners ${stamp}`;

await boot(A, both, { ...seeded, myTeam: { ...seeded.myTeam, name: FIRST }, history: [] });

const firstTeam = await until(async () => {
  const r = await admin.from('teams').select('*').eq('created_by', both.id);
  return (r.data || []).find((t) => t.name === FIRST) || null;
}, 45000);
if (!firstTeam) {
  console.log('  A keys  : ' + JSON.stringify(await A.js(`Object.keys(localStorage)`)));
  console.log('  A season: ' + JSON.stringify(((await A.state()) || {}).myTeam));
  console.log('  A screen: ' + String(await A.text()).slice(0, 260));
  console.log('  A teams : ' + JSON.stringify((await admin.from('teams').select('name').eq('created_by', both.id)).data));
}
ok('the first team reached the account', !!firstTeam, 'page said: ' + (A.logs().join(' | ') || 'nothing'));
need('a first team', !!firstTeam);

// A second team, with a roster of its own, created the way create_team_with_manager
// does it — the account genuinely manages both.
const secondTeam = await both.client.rpc('create_team_with_manager', { team_name: SECOND });
need('a second team could be created', !secondTeam.error, secondTeam.error && secondTeam.error.message);
const secondId = secondTeam.data;
{
  const made = await admin.from('players').insert([
    { team_id: secondId, name: 'Robin Vega', position: 'P', color: '#0E7490', client_id: 0, sort_order: 0, lineup_order: 1 },
    { team_id: secondId, name: 'Kit Moreau', position: 'C', color: '#123D63', client_id: 1, sort_order: 1, lineup_order: 2 },
  ]);
  need('the second team has a roster', !made.error, made.error && made.error.message);
}

// =============================================================================
console.log('\n--- switching to the other team --------------------------------');
// =============================================================================

eq('A: opened Manage', await A.tap('Manage'), 'OK');
ok('the first team\'s roster is on screen',
  !!(await until(async () => ((await A.text()) || '').includes(FIRST) ? 1 : null, 20000)),
  'on screen: ' + String(await A.text()).slice(0, 220));

eq('A: opened the team switcher', await A.tap('Switch team'), 'OK');
ok('both teams are offered',
  !!(await until(async () => {
    const t = (await A.text()) || '';
    return t.includes(FIRST) && t.includes(SECOND) ? 1 : null;
  }, 20000)),
  'on screen: ' + String(await A.text()).slice(0, 320));
ok('and the one being shown says so', String(await A.text()).includes('SHOWING'));

eq('A: picked the other team', await A.tap(SECOND), 'OK');

const switched = await until(async () => {
  const s = await A.state();
  return s && s.myTeam && s.myTeam.name === SECOND ? s : null;
}, 30000);
ok('the app is now showing the other team', !!switched,
  'state: ' + JSON.stringify(((await A.state()) || {}).myTeam) + ' page said: ' + (A.logs().join(' | ') || 'nothing'));
need('a switched season', !!switched);

eq('with that team\'s roster, not the first one\'s', switched.roster.map((p) => p.name), ['Robin Vega', 'Kit Moreau']);
eq('and that team\'s batting order', switched.lineup, [0, 1]);
eq('the device records which team it is on', await A.js(`localStorage.getItem('score-tracker:teamId')`), secondId);

{
  const { data } = await admin.from('profiles').select('primary_team_id').eq('id', both.id).single();
  eq('and so does the account, so the next launch agrees', data.primary_team_id, secondId);
}

// THE DANGEROUS PART. The first team's roster must not have been written into
// the second team's row on the way past.
await sleep(2500); // longer than the season write debounce
{
  const { data } = await admin.from('players').select('name').eq('team_id', secondId).order('client_id');
  eq('the second team still has only its own players', data.map((r) => r.name), ['Robin Vega', 'Kit Moreau']);
  const first = await admin.from('players').select('id').eq('team_id', firstTeam.id);
  eq('and the first team still has all of its own', (first.data || []).length, seeded.roster.length);
  const { data: t } = await admin.from('teams').select('name').eq('id', secondId).single();
  eq('nor was it renamed', t.name, SECOND);
}

// =============================================================================
console.log('\n--- and back again ---------------------------------------------');
// =============================================================================

eq('A: opened Manage again', await A.tap('Manage'), 'OK');
eq('A: opened the switcher', await A.tap('Switch team'), 'OK');
eq('A: picked the first team', await A.tap(FIRST), 'OK');

const back = await until(async () => {
  const s = await A.state();
  return s && s.myTeam && s.myTeam.name === FIRST ? s : null;
}, 30000);
ok('the first team comes back', !!back);
if (back) {
  eq('with its own roster intact', back.roster.length, seeded.roster.length);
  // The other team this account manages shows up as an opposing team, which is
  // the existing rule for what an opponent is: a team you belong to that is not
  // the one you are looking at. Managing two teams is how you come to play
  // yourself, so this is the design working, not leaking.
  eq('and its opposing teams, plus the other team this account manages',
    back.teams.length, seeded.teams.length + 1);
}

// =============================================================================
console.log('\n--- a scorer is not shown the manager\'s controls ---------------');
// =============================================================================

{
  const granted = await admin.from('memberships').insert({ user_id: scorer.id, team_id: firstTeam.id, role: 'team_scorer' });
  need('the scorer holds a role on the first team', !granted.error, granted.error && granted.error.message);
  const claimed = await scorer.client.rpc('set_primary_team', { team_id: firstTeam.id });
  need('and it is the team they open', !claimed.error, claimed.error && claimed.error.message);
}

await boot(B, scorer, null);
ok('the scorer\'s phone loaded the team from the account',
  !!(await until(async () => {
    const s = await B.state();
    return s && s.myTeam && s.myTeam.name === FIRST ? s : null;
  }, 45000)),
  'page said: ' + (B.logs().join(' | ') || 'nothing'));

eq('B: opened Manage', await B.tap('Manage'), 'OK');
const scorerView = await until(async () => {
  const t = (await B.text()) || '';
  return t.includes('Manage roster') ? t : null;
}, 20000);
ok('the roster screen opens for a scorer too', !!scorerView);

ok('but it says the roster is somebody else\'s',
  String(scorerView || '').includes("somebody else's roster"),
  'on screen: ' + String(scorerView || '').slice(0, 300));
ok('there is no Add player button', !String(scorerView || '').includes('+ Add player'));
ok('and no Rename button', !String(scorerView || '').includes('Rename'));
// 4d: the manual record for games never scored here is the team's own, and its
// manager's to set. It counts towards the team's place in a league table, which
// is what makes whose it is more than a detail.
ok('nor a way to adjust the team\'s record',
  !String(scorerView || '').includes('Adjust for untracked games'));
ok('but it is explained rather than simply missing',
  String(scorerView || '').includes("its manager's to set"),
  'on screen: ' + String(scorerView || '').slice(0, 400));
ok('while the manager still has both',
  (await A.tap('Manage')) === 'OK' &&
    !!(await until(async () => {
      const t = (await A.text()) || '';
      return t.includes('+ Add player') && t.includes('Rename')
        && t.includes('Adjust for untracked games') ? 1 : null;
    }, 20000)));

// ---- nothing fell over -------------------------------------------------------
for (const p of [A, B]) {
  const crashed = await p.js(`!!document.body.textContent.match(/Something went wrong|TEMPLATES/)`);
  eq(`${p.name} never fell into its error boundary`, crashed, false);
  eq(`${p.name} logged nothing to the console at all`, p.logs(), []);
}

if (fail) {
  console.log('\nphone A said: ' + (A.logs().join('\n              ') || 'nothing'));
  console.log('phone B said: ' + (B.logs().join('\n              ') || 'nothing'));
}

for (const browserContextId of contexts) {
  try { await raw('Target.disposeBrowserContext', { browserContextId }); } catch { /* gone */ }
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
ws.close();
process.exit(fail ? 1 : 0);
