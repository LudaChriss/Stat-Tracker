// An invite, end to end, through the real UI.
//
// A manager mints a code in the app; a different account, in the same browser,
// signs in and redeems it; the database is then asked whether the membership is
// real and whether the role does what it claims.
//
// The part that matters most is the last section: redeeming an invite on a
// device that already holds a season must not touch that season.
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
const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 5)}`;

/** A signed-in session captured the way the app stores one. */
async function sessionFor(tag) {
  const email = `${tag}${stamp}@example.test`;
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  need(`could create ${tag}`, !made.error, made.error?.message);
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
  const { error } = await client.auth.signInWithPassword({ email, password });
  need(`could sign in ${tag}`, !error, error?.message);
  const key = Object.keys(captured).find((k) => k.startsWith('sb-'));
  return { id: made.data.user.id, email, authKey: key, authValue: captured[key] };
}

const managerSession = await sessionFor('bmgr');
const inviteeSession = await sessionFor('binv');
const secondSession = await sessionFor('bsec');

const { INITIAL_STATE } = await import(`${SRC}/data/league.js`);
const { SEEDED } = await import('./fixtures-history.js');
const seeded = SEEDED(INITIAL_STATE);

// ---- CDP ----------------------------------------------------------------------
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let msgId = 0;
const calls = new Map();
const pageLog = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && calls.has(m.id)) { calls.get(m.id)(m); calls.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    pageLog.push('uncaught: ' + (m.params.exceptionDetails.exception?.description || '').split('\n')[0]);
  }
});
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++msgId;
    calls.set(i, (x) => (x.error ? rej(new Error(method + ' ' + JSON.stringify(x.error))) : res(x.result)));
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
const clickText = async (text, ms = 12000) => {
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
  const small = [...document.querySelectorAll('button,[role=button],input')].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && (r.width < 40 || r.height < 40);
  }).map((el) => (el.textContent || el.placeholder || '').replace(/\\s+/g, ' ').trim().slice(0, 20));
  return { overflow, wide, small };
})()`;

/** The sheets are transient, so the responsive audit cannot reach them. */
async function measureSheet(name) {
  for (const [vp, w, h] of [['iPhone SE', 375, 667], ['iPhone 15 Pro Max', 430, 932]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false });
    await sleep(400);
    const m = await js(MEASURE);
    eq(`${vp}: ${name} does not overflow`, m.overflow <= 0, true);
    eq(`${vp}: ${name} is not clipped`, m.wide, []);
    eq(`${vp}: every control in ${name} is tappable`, m.small, []);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 3, mobile: false });
  await sleep(250);
}

/** Boot the app as a given account, on the roster screen. */
async function bootAs(session, seasonState) {
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(200);
  await send('Storage.clearDataForOrigin', { origin: APP, storageTypes: 'all' });
  await send('Page.navigate', { url: APP });
  await until('a clean boot', async () => (await js(`Object.keys(localStorage).length ? 1 : null`)), 15000);
  await put(session.authKey, session.authValue);
  if (seasonState) await put('score-tracker:state', JSON.stringify({ version: 3, state: seasonState }));
  await send('Page.reload');
  return until('the app to settle', async () => {
    const t = await bodyText();
    return t && !/Loading…|Checking your season/.test(t) ? t : null;
  }, 30000);
}

// =============================================================================
console.log('--- a manager mints a code -------------------------------------');
// =============================================================================
await bootAs(managerSession, { ...seeded, screen: 'roster' });

const teamRow = await until('the manager\'s team', async () => {
  const r = await admin.from('teams').select('*').eq('created_by', managerSession.id);
  return (r.data || []).find((t) => t.name === seeded.myTeam.name) || null;
}, 30000);
need('a migrated team', !!teamRow);
const teamId = teamRow.id;

await until('the roster screen', async () => {
  const t = await bodyText();
  return t && /Season data/.test(t) ? t : null;
}, 25000);

// The role is a round trip of its own, so wait for it rather than reading the
// screen the instant the roster paints.
const rosterText = await until('the account card to know the role', async () => {
  const t = await bodyText();
  return t && /Manager ·/.test(t) ? t : null;
}, 25000) || (await bodyText());

ok('the account card names the role this account holds',
  /Manager ·/.test(rosterText), rosterText.slice(rosterText.indexOf('Account'), rosterText.indexOf('Account') + 160));
ok('a manager is offered the invite control', /Invite someone/.test(rosterText),
  rosterText.slice(rosterText.indexOf('Account'), rosterText.indexOf('Account') + 200));
ok('and a way to join another team', /Join a team/.test(rosterText),
  rosterText.slice(rosterText.indexOf('Account'), rosterText.indexOf('Account') + 200));

eq('opened the invite sheet', await clickText('Invite someone'), 'OK');
const sheet = await until('the role picker', async () => {
  const t = await bodyText();
  return t && /Invite someone/.test(t) && /Scorer/.test(t) ? t : null;
}, 15000);
ok('it offers the roles', !!sheet, (await bodyText()).slice(0, 300));
ok('with what each one means', /Cannot change the roster/.test(sheet || ''), (sheet || '').slice(0, 500));
ok('and does not offer league admin', !/League admin/i.test(sheet || ''), (sheet || '').slice(0, 500));

await measureSheet('the role picker');

eq('created the code', await clickText('Create invite code'), 'OK');
const codeShown = await until('a code', async () => {
  const t = await bodyText();
  return t && /Share this code/.test(t) ? t : null;
}, 20000);
ok('the code is shown', !!codeShown, (await bodyText()).slice(0, 300));
ok('with the role it grants', /Joining as Scorer/.test(codeShown || ''), (codeShown || '').slice(0, 400));
ok('and when it runs out', /expires/.test(codeShown || ''), (codeShown || '').slice(0, 400));

await measureSheet('the code screen');

const inviteRow = await until('the invite in the database', async () => {
  const r = await admin.from('invites').select('*').eq('team_id', teamId).order('created_at', { ascending: false });
  return (r.data || [])[0] || null;
}, 15000);
ok('it exists in the database', !!inviteRow);
eq('as a scorer invite', inviteRow.role, 'team_scorer');
eq('unused', inviteRow.used_at, null);
const code = inviteRow.code;

// =============================================================================
console.log('\n--- a different account redeems it -----------------------------');
// =============================================================================
// A fresh device with nothing on it: the ordinary case for someone being
// invited to score.
await bootAs(inviteeSession, null);

// Reach the roster screen the way the app allows.
await js(`(() => {
  const raw = JSON.parse(localStorage.getItem('score-tracker:state') || '{"version":3,"state":{}}');
  raw.state = { ...(raw.state || {}), screen: 'roster' };
  localStorage.setItem('score-tracker:state', JSON.stringify(raw));
  return 1;
})()`);
await send('Page.reload');
await until('the invitee\'s roster screen', async () => {
  const t = await bodyText();
  return t && /Season data|Join a team/.test(t) ? t : null;
}, 25000);

const inviteeText = await until('the invitee\'s account card', async () => {
  const t = await bodyText();
  return t && /Join a team/.test(t) ? t : null;
}, 25000) || (await bodyText());
ok('an invitee with no team is not offered the invite control',
  !/Invite someone/.test(inviteeText), inviteeText.slice(0, 300));
ok('but is offered the join control', /Join a team/.test(inviteeText), inviteeText.slice(0, 300));

eq('opened join', await clickText('Join a team'), 'OK');
await until('the code field', async () => {
  const t = await bodyText();
  return t && /Enter the code/.test(t) ? t : null;
}, 15000);

await js(`(() => {
  const el = document.querySelector('input[placeholder="BQ7K-2M9X-RT"]');
  if (!el) return 'MISS';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(code)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'OK';
})()`);

eq('continued', await clickText('Continue'), 'OK');
const preview = await until('the preview', async () => {
  const t = await bodyText();
  return t && /This code adds you to/.test(t) ? t : null;
}, 20000);
ok('it says what the code grants before accepting', !!preview, (await bodyText()).slice(0, 300));
ok('naming the team', new RegExp(seeded.myTeam.name).test(preview || ''), (preview || '').slice(0, 400));
ok('and the role', /as Scorer/.test(preview || ''), (preview || '').slice(0, 400));

await measureSheet('the join sheet');

eq('joined', await clickText('Join as Scorer'), 'OK');
const joined = await until('the confirmation', async () => {
  const t = await bodyText();
  return t && /You're in|You&#39;re in|You joined/.test(t) ? t : null;
}, 25000);
ok('the app confirms', !!joined, (await bodyText()).slice(0, 300));

const membership = await until('the membership', async () => {
  const r = await admin.from('memberships').select('role').eq('user_id', inviteeSession.id).eq('team_id', teamId);
  return (r.data || []).length ? r.data : null;
}, 15000);
ok('the membership is real', !!membership);
eq('with the invited role', membership.map((m) => m.role), ['team_scorer']);

const spent = await admin.from('invites').select('used_at,used_by').eq('code', code).single();
ok('the code is spent', !!spent.data.used_at);
eq('by the person who used it', spent.data.used_by, inviteeSession.id);

// They land in the team: with nothing of their own, there is nothing to lose.
const landed = await until('the invitee to be looking at that team', async () => {
  const s = await appState();
  return s && s.myTeam && s.myTeam.name === seeded.myTeam.name ? s : null;
}, 25000);
ok('and the invitee lands in the team they joined', !!landed,
  JSON.stringify((await appState())?.myTeam || null));

const profile = await admin.from('profiles').select('primary_team_id').eq('id', inviteeSession.id).single();
eq('their primary team is set to it', profile.data.primary_team_id, teamId);

// =============================================================================
console.log('\n--- the same code cannot be used again -------------------------');
// =============================================================================
await bootAs(secondSession, null);
await js(`(() => {
  const raw = JSON.parse(localStorage.getItem('score-tracker:state') || '{"version":3,"state":{}}');
  raw.state = { ...(raw.state || {}), screen: 'roster' };
  localStorage.setItem('score-tracker:state', JSON.stringify(raw));
  return 1;
})()`);
await send('Page.reload');
await until('the roster screen', async () => {
  const t = await bodyText();
  return t && /Join a team/.test(t) ? t : null;
}, 25000);

eq('opened join', await clickText('Join a team'), 'OK');
await until('the code field', async () => {
  const t = await bodyText();
  return t && /Enter the code/.test(t) ? t : null;
}, 15000);
await js(`(() => {
  const el = document.querySelector('input[placeholder="BQ7K-2M9X-RT"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(code)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'OK';
})()`);
eq('continued', await clickText('Continue'), 'OK');

const refusedText = await until('the refusal', async () => {
  const t = await bodyText();
  return t && /already been used|has expired/.test(t) ? t : null;
}, 20000);
ok('a spent code is refused, in words', !!refusedText, (await bodyText()).slice(0, 300));
eq('and grants nothing',
  ((await admin.from('memberships').select('id').eq('user_id', secondSession.id).eq('team_id', teamId)).data || []).length, 0);

// =============================================================================
console.log('\n--- joining with a season already on the phone ------------------');
// =============================================================================
// The safety case. This device has its own season; accepting an invite must
// leave it exactly as it is.
const ownerSession = await sessionFor('bown');
const secondInvite = await admin.from('invites').insert({
  code: `KEEPMINE${stamp}`.toUpperCase().slice(0, 20),
  team_id: teamId,
  role: 'viewer',
  expires_at: new Date(Date.now() + 8.64e7).toISOString(),
  created_by: managerSession.id,
}).select('code').single();
need('a second invite could be planted', !secondInvite.error, secondInvite.error?.message);

await bootAs(ownerSession, { ...seeded, screen: 'roster' });
await until('their own team to migrate up', async () => {
  const r = await admin.from('teams').select('id').eq('created_by', ownerSession.id);
  return (r.data || []).length ? r.data : null;
}, 30000);
await until('the roster screen', async () => {
  const t = await bodyText();
  return t && /Season data/.test(t) ? t : null;
}, 25000);

const before = await appState();
const beforeProfile = await admin.from('profiles').select('primary_team_id').eq('id', ownerSession.id).single();

eq('opened join', await clickText('Join a team'), 'OK');
await until('the code field', async () => {
  const t = await bodyText();
  return t && /Enter the code/.test(t) ? t : null;
}, 15000);
await js(`(() => {
  const el = document.querySelector('input[placeholder="BQ7K-2M9X-RT"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(secondInvite.data.code)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'OK';
})()`);
eq('continued', await clickText('Continue'), 'OK');

const warned = await until('the preview', async () => {
  const t = await bodyText();
  return t && /This code adds you to/.test(t) ? t : null;
}, 20000);
ok('it warns that their own season stays as it is',
  /Your own season stays as it is/.test(warned || ''), (warned || '').slice(0, 600));

eq('joined anyway', await clickText('Join as Viewer'), 'OK');
await until('the confirmation', async () => {
  const t = await bodyText();
  return t && /has not changed|You joined/.test(t) ? t : null;
}, 25000);

const after = await appState();
eq('the roster on this phone is untouched', (after.roster || []).length, (before.roster || []).length);
eq('the history is untouched', (after.history || []).length, (before.history || []).length);
eq('the team on screen is still theirs', after.myTeam.name, before.myTeam.name);

const afterProfile = await admin.from('profiles').select('primary_team_id').eq('id', ownerSession.id).single();
eq('their primary team was NOT repointed', afterProfile.data.primary_team_id, beforeProfile.data.primary_team_id);

// They now hold a role on the invited team as well as their own. The raw count
// is higher than two: importing a season also makes them manager of each
// opposing team it creates.
const bothRoles = await admin.from('memberships').select('role,team_id').eq('user_id', ownerSession.id);
const onInvited = (bothRoles.data || []).filter((m) => m.team_id === teamId);
eq('they hold the invited role on the invited team', onInvited.map((m) => m.role), ['viewer']);
const ownTeam = (await admin.from('teams').select('id').eq('created_by', ownerSession.id)
  .eq('name', seeded.myTeam.name).single()).data;
const onOwn = (bothRoles.data || []).filter((m) => m.team_id === ownTeam.id);
eq('and still manage their own', onOwn.map((m) => m.role), ['team_manager']);

const crashed = await js(`!!document.body.textContent.match(/Something went wrong/)`);
eq('the app never fell into its error boundary', crashed, false);
ok('no uncaught page errors', pageLog.length === 0, pageLog.join('\n  '));

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
ws.close();
process.exit(fail ? 1 : 0);
