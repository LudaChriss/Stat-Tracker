// Leagues, driven through the real screens in real browsers.
//
// The database half is leagues-check.mjs. This is the half that cannot be
// argued: a commissioner starts a league, brings their own team in, and hands
// out a code; a manager on another phone types that code and their team lands
// in the same league; the commissioner puts a fixture on the calendar and the
// manager sees it.
//
// Two browser contexts, so the two phones have genuinely separate localStorage
// and separate sessions. Two tabs on one origin share storage and would prove
// nothing.
//
// Manual harness. Needs:
//   * the local Supabase stack   (npx supabase start --ignore-health-check)
//   * a dev server on :5173      (npm run dev)
//   * Chrome on :9222            (--remote-debugging-port=9222)
// Never runs against the hosted project: it creates users, leagues and teams.

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

// ---- preflight ---------------------------------------------------------------
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

const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// The stack answers /auth/v1/health only once GoTrue is actually up, and the
// containers restart on `supabase db reset`. supabase-js retries a failed
// request with a long backoff, so a harness started a moment too early does not
// fail — it HANGS, silently, with no output at all. That is the worst of the
// three outcomes and it cost most of an afternoon twice.
{
  let up = false;
  for (let i = 0; i < 90 && !up; i++) {
    try {
      up = (await fetch(`${st.API_URL}/auth/v1/health`, { signal: AbortSignal.timeout(2000) })).ok;
    } catch { /* not yet */ }
    if (!up) await new Promise((r) => setTimeout(r, 1000));
  }
  need('the auth service must be up (it restarts after `supabase db reset`)', up);
}

// ---- two accounts, and the session blobs their browsers will accept ----------
const password = 'Password123!';
const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 5)}`;

async function account(tag) {
  const email = `lgui${tag}${stamp}@example.test`;
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

const boss = await account('boss');   // runs the league, and manages a team
const mgr = await account('mgr');     // manages another team

// ---- CDP, multiplexed over one browser connection ----------------------------
const ws = new WebSocket(browserWsUrl);
await new Promise((r) => ws.addEventListener('open', r));

let msgId = 0;
const pending = new Map();
const logs = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
    return;
  }
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
const until = async (fn, ms = 20000, step = 250) => {
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

  const send = (method, params) => raw(method, params, sessionId);
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
    name,
    send,
    js,
    logs: () => logs.get(sessionId),
    put: (k, v) => js(`localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)}), 1`),
    get: (k) => js(`localStorage.getItem(${JSON.stringify(k)})`),
    goto: (url) => send('Page.navigate', { url }),
    reload: () => send('Page.reload'),
    text: () => js(`document.body.textContent.replace(/\\s+/g,' ').trim()`),
    state: async () => {
      const stored = await js(`localStorage.getItem('score-tracker:state')`);
      try { return JSON.parse(stored).state; } catch { return null; }
    },
  };

  /** Tap whatever is showing this text — controls win over containers. */
  self.tap = async (text, ms = 12000) => {
    const hit = await until(() =>
      js(`(() => {
        const want = ${JSON.stringify(text)};
        const norm = (e) => (e.textContent || '').replace(/\\s+/g, ' ').trim();
        const matches = [...document.querySelectorAll('body *')].filter(
          (e) => norm(e).includes(want) && e.getBoundingClientRect().width > 0,
        );
        const clickable = matches.filter((e) => e.matches('button,[role=button]'));
        const pool = clickable.length ? clickable : matches;
        const el = pool.find((e) => !pool.some((o) => o !== e && e.contains(o)));
        if (!el) return null;
        el.click();
        return 'OK';
      })()`), ms);
    if (hit) return 'OK';
    return `MISS "${text}" — on screen: ` + String(await self.text()).slice(0, 200);
  };

  /** Type into the first visible input matching a placeholder or type. */
  self.type = async (selector, value) => {
    return js(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'MISS';
      const setter = Object.getOwnPropertyDescriptor(
        el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el.constructor.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'OK';
    })()`);
  };

  return self;
}

/**
 * Open a league with FRESH data, from wherever the phone happens to be.
 *
 * The leagues screen keeps the league it was last looking at, so walking
 * straight back in reads the copy it already had. Stepping out to the list and
 * back in re-reads it. Where the phone starts from varies — the season home
 * after finalising a game, the list after a reload, the detail after looking at
 * one — so this asks rather than assumes.
 */
const whereAmI = async (p) => {
  const t = (await p.text()) || '';
  if (t.includes('Teams \u00b7')) return 'detail';
  if (t.includes('Your leagues')) return 'list';
  return 'elsewhere';
};

const openLeagueFresh = async (p, name) => {
  if ((await whereAmI(p)) === 'elsewhere') {
    const opened = await p.tap('Leagues');
    if (opened !== 'OK') return opened;
    await until(async () => ((await whereAmI(p)) === 'elsewhere' ? null : 1), 15000);
  }
  if ((await whereAmI(p)) === 'detail') {
    const back = await p.tap('\u2039 Back');
    if (back !== 'OK') return back;
    await until(async () => ((await whereAmI(p)) === 'list' ? 1 : null), 15000);
  }
  return p.tap(name);
};

const A = await phone('phone A');
const B = await phone('phone B');

const { INITIAL_STATE } = await import(`${SRC}/data/league.js`);
const { SEEDED } = await import('./fixtures-history.js');
const seeded = SEEDED(INITIAL_STATE);

const boot = async (p, acct, teamName) => {
  const state = JSON.stringify({
    version: 3,
    state: { ...seeded, myTeam: { ...seeded.myTeam, name: teamName }, history: [] },
  });

  // Seed BEFORE the app's own scripts run.
  //
  // Writing localStorage into an already-running app races its first save:
  // it boots on empty storage, writes the blank starting season, and whichever
  // of the two lands last wins. That is why an earlier version of this harness
  // failed intermittently with the app showing first-run setup. Injecting on
  // the new document puts the session and the season in place before React ever
  // mounts, which is not a race at all.
  await p.goto('about:blank');
  await sleep(150);
  await p.send('Storage.clearDataForOrigin', { origin: APP, storageTypes: 'all' });
  const { identifier } = await p.send('Page.addScriptToEvaluateOnNewDocument', {
    source:
      `try {\n` +
      `  localStorage.setItem(${JSON.stringify(acct.authKey)}, ${JSON.stringify(acct.authValue)});\n` +
      `  localStorage.setItem('score-tracker:state', ${JSON.stringify(state)});\n` +
      `} catch (e) {}`,
  });
  await p.goto(APP);
  const landed = await until(async () => {
    const s = await p.state();
    return s && s.myTeam && s.myTeam.name === teamName ? s : null;
  }, 25000);
  // Remove it, or every later reload would re-seed over whatever the app has
  // since done.
  await p.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  if (!landed) return null;

  const team = await until(async () => {
    const r = await admin.from('teams').select('*').eq('created_by', acct.id);
    return (r.data || []).find((t) => t.name === teamName) || null;
  }, 40000);
  return team;
};

const bossTeam = await boot(A, boss, `Boss United ${stamp}`);
if (!bossTeam) {
  console.log('  A keys  : ' + JSON.stringify(await A.js(`Object.keys(localStorage)`)));
  console.log('  A screen: ' + String(await A.text()).slice(0, 300));
  console.log('  A teams : ' + JSON.stringify((await admin.from('teams').select('name').eq('created_by', boss.id)).data));
}
ok('phone A signed in and its season reached the account', !!bossTeam,
  'page said: ' + (A.logs().join(' | ') || 'nothing'));
need('a team for phone A', !!bossTeam);

const mgrTeam = await boot(B, mgr, `Manager City ${stamp}`);
ok('phone B signed in and its season reached the account', !!mgrTeam,
  'page said: ' + (B.logs().join(' | ') || 'nothing'));
need('a team for phone B', !!mgrTeam);

// =============================================================================
console.log('\n--- phone A starts a league -----------------------------------');
// =============================================================================

eq('A: opened the leagues screen', await A.tap('Leagues'), 'OK');
ok('it says there are none yet',
  !!(await until(async () => ((await A.text()) || '').includes('not in a league yet') ? 1 : null, 15000)),
  'on screen: ' + String(await A.text()).slice(0, 200));

eq('A: opened the create form', await A.tap('Start a league'), 'OK');
eq('A: named it', await A.type('input[placeholder="Thursday Night Kickball"]', `Sunday Social ${stamp}`), 'OK');
eq('A: created it', await A.tap('Create it'), 'OK');

const leagueRow = await until(async () => {
  const r = await admin.from('leagues').select('*').eq('name', `Sunday Social ${stamp}`);
  return (r.data || [])[0] || null;
}, 25000);
ok('the league exists in the account', !!leagueRow, 'page said: ' + (A.logs().join(' | ') || 'nothing'));
need('a league', !!leagueRow);

{
  const { data } = await admin.from('memberships').select('role, user_id').eq('league_id', leagueRow.id);
  eq('and its creator is its commissioner', (data || []).map((m) => [m.user_id === boss.id, m.role]), [[true, 'league_admin']]);
}

ok('A lands on the league it just made',
  !!(await until(async () => ((await A.text()) || '').includes('Commissioner') ? 1 : null, 15000)),
  'on screen: ' + String(await A.text()).slice(0, 240));

// =============================================================================
console.log('\n--- A brings its own team in, and hands out a code -------------');
// =============================================================================

eq('A: brought its team in', await A.tap('Bring my team into this league'), 'OK');
ok('the team is in the league',
  !!(await until(async () => {
    const { data } = await admin.from('teams').select('league_id').eq('id', bossTeam.id).single();
    return data && data.league_id === leagueRow.id ? 1 : null;
  }, 25000)));
ok('and the screen says so',
  !!(await until(async () => ((await A.text()) || '').includes('YOURS') ? 1 : null, 15000)),
  'on screen: ' + String(await A.text()).slice(0, 240));

eq('A: opened the invite form', await A.tap('Invite someone to this league'), 'OK');
eq('A: minted a code', await A.tap('Make a code'), 'OK');

const inviteRow = await until(async () => {
  const r = await admin.from('invites').select('*').eq('league_id', leagueRow.id).order('created_at', { ascending: false });
  return (r.data || [])[0] || null;
}, 25000);
ok('a league code was minted', !!inviteRow);
need('a code', !!inviteRow);
eq('scoped to the league, not a team', [inviteRow.league_id === leagueRow.id, inviteRow.team_id], [true, null]);
eq('granting the role that was picked', inviteRow.role, 'viewer');

ok('and it is shown on screen, once',
  String(await A.text()).includes(inviteRow.code),
  'code ' + inviteRow.code + ' not on screen: ' + String(await A.text()).slice(0, 300));

// =============================================================================
console.log('\n--- phone B types the code and brings its team in --------------');
// =============================================================================

eq('B: opened the leagues screen', await B.tap('Leagues'), 'OK');
eq('B: opened the join form', await B.tap('I have a code'), 'OK');
eq('B: typed the code', await B.type('input[placeholder="BQ7K-2M9X-RT"]', inviteRow.code), 'OK');
eq('B: joined', await B.tap('Join'), 'OK');

ok('B\'s team is now in the league',
  !!(await until(async () => {
    const { data } = await admin.from('teams').select('league_id').eq('id', mgrTeam.id).single();
    return data && data.league_id === leagueRow.id ? 1 : null;
  }, 30000)),
  'page said: ' + (B.logs().join(' | ') || 'nothing'));

{
  const { data } = await admin
    .from('memberships').select('role').eq('league_id', leagueRow.id).eq('user_id', mgr.id);
  eq('and B holds a league membership', (data || []).map((m) => m.role), ['viewer']);
  const { data: inv } = await admin.from('invites').select('used_by').eq('code', inviteRow.code).single();
  eq('the code was spent by B', inv.used_by, mgr.id);
}

ok('B is looking at the league, as a follower',
  !!(await until(async () => {
    const t = (await B.text()) || '';
    return t.includes('Follower') && t.includes(`Sunday Social ${stamp}`) ? 1 : null;
  }, 20000)),
  'on screen: ' + String(await B.text()).slice(0, 240));

ok('and sees both teams in it',
  !!(await until(async () => {
    const t = (await B.text()) || '';
    return t.includes(`Boss United ${stamp}`) && t.includes(`Manager City ${stamp}`) ? 1 : null;
  }, 20000)),
  'on screen: ' + String(await B.text()).slice(0, 300));

ok('a follower is offered no commissioner controls',
  !String(await B.text()).includes('Invite someone to this league'),
  'on screen: ' + String(await B.text()).slice(0, 300));

// =============================================================================
console.log('\n--- A puts a fixture on the calendar --------------------------');
// =============================================================================

// Re-open so A sees the team that joined after its last read.
eq('A: re-opened the league', await openLeagueFresh(A, `Sunday Social ${stamp}`), 'OK');
ok('A sees both teams too',
  !!(await until(async () => {
    const t = (await A.text()) || '';
    return t.includes(`Manager City ${stamp}`) ? 1 : null;
  }, 20000)));

eq('A: opened the schedule form', await A.tap('Schedule a game'), 'OK');
const selects = await A.js(`document.querySelectorAll('select').length`);
eq('two team pickers are offered', selects, 2);
eq('A: picked home', await A.type('select', bossTeam.id), 'OK');
eq('A: picked away', await A.js(`(() => {
  const el = document.querySelectorAll('select')[1];
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(mgrTeam.id)});
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return 'OK';
})()`), 'OK');
eq('A: added it', await A.tap('Add to the schedule'), 'OK');

const fixture = await until(async () => {
  const r = await admin.from('games').select('*').eq('league_id', leagueRow.id).eq('status', 'scheduled');
  return (r.data || [])[0] || null;
}, 25000);
ok('the fixture is on the calendar', !!fixture, 'page said: ' + (A.logs().join(' | ') || 'nothing'));
need('a fixture', !!fixture);
eq('between the two teams', [fixture.home_team_id, fixture.away_team_id], [bossTeam.id, mgrTeam.id]);
eq('scheduled, not played', fixture.status, 'scheduled');
eq('and it has no result', fixture.result, null);

ok('A sees it on the schedule',
  !!(await until(async () => {
    const t = (await A.text()) || '';
    return t.includes('Schedule · 1') ? 1 : null;
  }, 20000)),
  'on screen: ' + String(await A.text()).slice(0, 300));

// B sees it too, once it looks again. A fixture is not live data; it does not
// need a socket.
eq('B: re-opened the league', await openLeagueFresh(B, `Sunday Social ${stamp}`), 'OK');
ok('B sees the fixture the commissioner made',
  !!(await until(async () => {
    const t = (await B.text()) || '';
    return t.includes('Schedule · 1') && t.includes(`Boss United ${stamp} vs Manager City ${stamp}`) ? 1 : null;
  }, 25000)),
  'on screen: ' + String(await B.text()).slice(0, 320));

// =============================================================================
console.log('\n--- A scores the fixture, and it becomes a league result -------');
// =============================================================================
//
// The wire that was missing until now. The season screen's opponent picker
// works in device-side slugs, so a game scored the normal way resolved its
// opponent to a team OUTSIDE the league and the table never heard about it.
// Scoring from the fixture uses the fixture's own client id and names the
// opposition by its real team id, so the game that gets finalised IS the
// fixture — in the table, and in both teams' seasons.

eq('A: started scoring the fixture', await A.tap('Score this game'), 'OK');

const scoring = await until(async () => {
  const s = await A.state();
  return s && s.gameActive && s.gameClientId === fixture.client_id ? s : null;
}, 25000);
ok('A is now scoring that fixture, under its id', !!scoring,
  'state: ' + JSON.stringify(((await A.state()) || {}).gameClientId) + ' page said: ' + (A.logs().join(' | ') || 'nothing'));
need('a game in progress', !!scoring);
eq('against the other league team, by id', scoring.gameOpponentTeamId, mgrTeam.id);
eq('and at home, because that is which side the fixture put us on', scoring.gameHome, true);

// The fixture stops being a plan the moment somebody starts scoring it.
ok('the fixture is live in the account, not still scheduled',
  !!(await until(async () => {
    const { data } = await admin.from('games').select('status').eq('id', fixture.id).single();
    return data && data.status === 'live' ? 1 : null;
  }, 25000)));
{
  const { count } = await admin
    .from('games').select('id', { count: 'exact', head: true }).eq('client_id', fixture.client_id);
  eq('and it is one game, not a fixture and a game beside it', count, 1);
}

eq('A: opened the entry tab', await A.tap('ENTRY'), 'OK');
// Three outs to get through the opposition's half, then our own hitters.
eq('A: struck one out', await A.tap('Strikeout'), 'OK');
eq('A: struck another out', await A.tap('Strikeout'), 'OK');
eq('A: struck a third out', await A.tap('Strikeout'), 'OK');
ok('our side is batting',
  !!(await until(async () => {
    const s = await A.state();
    return s && s.half === 'bot' ? s : null;
  }, 20000)));
eq('A: hit a home run', await A.tap('Home run'), 'OK');
eq('A: and another', await A.tap('Home run'), 'OK');

const beforeFinal = await until(async () => {
  const s = await A.state();
  return s && s.score && s.score.home === 2 ? s : null;
}, 20000);
ok('two runs on the board', !!beforeFinal);

eq('A: tapped Game completed', await A.tap('Game completed'), 'OK');
eq('A: finalized', await A.tap('Finalize & update standings'), 'OK');

const result = await until(async () => {
  const { data } = await admin.from('games').select('*').eq('id', fixture.id).single();
  return data && data.status === 'final' ? data : null;
}, 35000);
ok('the fixture is now a result', !!result,
  'row: ' + JSON.stringify((await admin.from('games').select('status').eq('id', fixture.id)).data)
    + ' page said: ' + (A.logs().join(' | ') || 'nothing'));
need('a finished fixture', !!result);

eq('scored 2-0 to the home side', [result.home_score, result.away_score], [2, 0]);
eq('a win for the home team', result.result, 'W');
eq('between the two league teams', [result.home_team_id, result.away_team_id], [bossTeam.id, mgrTeam.id]);
eq('and filed under the league', result.league_id, leagueRow.id);
{
  const { count } = await admin
    .from('games').select('id', { count: 'exact', head: true }).eq('client_id', fixture.client_id);
  eq('still exactly one row for it', count, 1);

  // No team was invented from a slug on the way past — the whole point.
  const { data: invented } = await admin.from('teams').select('id, name').eq('created_by', boss.id);
  eq('and no extra team was created for the opposition',
    (invented || []).map((t) => t.name).sort(),
    [`Boss United ${stamp}`].concat(seeded.teams.map((t) => t.name)).sort());
}

const lines = (await admin.from('game_lines').select('*').eq('game_id', fixture.id)).data || [];
ok('the box score went with it', lines.length > 0);
eq('our lines are filed to our team, on the home side',
  lines.filter((l) => l.team_id === bossTeam.id).every((l) => l.home_away === 'home'), true);
eq('and the opposition\'s to theirs',
  lines.filter((l) => l.team_id === mgrTeam.id).every((l) => l.home_away === 'away'), true);

// ---- it is in A's own season -------------------------------------------------
{
  const s = await A.state();
  const mine = (s.history || []).find((g) => g.id === fixture.client_id);
  ok('the game is in A\'s season history', !!mine, 'history: ' + JSON.stringify((s.history || []).map((g) => g.id)));
  if (mine) {
    eq('with the score from A\'s point of view', mine.score, { us: 2, them: 0 });
    eq('and recorded as a win', mine.result, 'W');
  }
}

// ---- and in B's, once B reads the account ------------------------------------
await B.reload();
const bHistory = await until(async () => {
  const s = await B.state();
  return s && (s.history || []).some((g) => g.id === fixture.client_id) ? s : null;
}, 40000);
ok('the game reaches the other team\'s season too', !!bHistory,
  'B history: ' + JSON.stringify((((await B.state()) || {}).history || []).map((g) => g.id)));
if (bHistory) {
  const theirs = bHistory.history.find((g) => g.id === fixture.client_id);
  eq('from THEIR point of view, which is the other way round', theirs.score, { us: 0, them: 2 });
  eq('and recorded as a loss', theirs.result, 'L');
}

// ---- and in the league table -------------------------------------------------
eq('A: re-opened the league, freshly', await openLeagueFresh(A, `Sunday Social ${stamp}`), 'OK');

const tableOnA = await until(async () => {
  const t = (await A.text()) || '';
  return t.includes('TEAM') && t.includes('PCT') ? t : null;
}, 25000);
ok('the league table is on screen', !!tableOnA, 'on screen: ' + String(await A.text()).slice(0, 320));

// Read the table as a table, not as a paragraph.
const readTable = async (p) =>
  p.js(`(() => {
    const grids = [...document.querySelectorAll('div')].filter(
      (d) => d.style.display === 'grid' && d.children.length === 6);
    return grids.map((g) => [...g.children].map((c) => (c.textContent || '').replace(/\\s+/g, ' ').trim()));
  })()`);

const rowsOnA = await readTable(A);
ok('the table has a header and a row per team', Array.isArray(rowsOnA) && rowsOnA.length === 3,
  JSON.stringify(rowsOnA));
if (Array.isArray(rowsOnA) && rowsOnA.length === 3) {
  eq('the columns are the ones a table has', rowsOnA[0], ['', 'TEAM', 'W', 'L', 'T', 'PCT']);
  // Both teams migrated up from SEEDED, which carries a manual 4-1-0. The game
  // just scored is added to that, which is the rule the season table already
  // follows and the league table agreeing with it is the point.
  eq('the team that won is top, with the win added to its own prior record',
    rowsOnA[1].slice(1), [`Boss United ${stamp}YOU`, '5', '1', '0', '.833']);
  eq('and the team that lost below it',
    rowsOnA[2].slice(1), [`Manager City ${stamp}`, '4', '2', '0', '.667']);
}

ok('the leaders are filled in from the box score just written',
  !!(await until(async () => {
    const t = (await A.text()) || '';
    return t.includes('Leaders') && t.includes('Maya Ortiz') ? t : null;
  }, 20000)),
  'on screen: ' + String(await A.text()).slice(0, 400));

eq('A: switched the leaders to home runs', await A.tap('HR'), 'OK');
ok('and the home-run leaders are the two who hit them',
  !!(await until(async () => {
    const t = (await A.text()) || '';
    return t.includes('Home runs across every game') ? 1 : null;
  }, 20000)),
  'on screen: ' + String(await A.text()).slice(0, 400));

// The follower sees the same table. It is the league's, not the commissioner's.
eq('B: opened the league, freshly', await openLeagueFresh(B, `Sunday Social ${stamp}`), 'OK');
ok('the follower sees the same table, with the game in it',
  !!(await until(async () => {
    const t = (await B.text()) || '';
    return t.includes('PCT') && t.includes('Leaders') && t.includes(`Boss United ${stamp}`) ? 1 : null;
  }, 25000)),
  'on screen: ' + String(await B.text()).slice(0, 400));

// =============================================================================
console.log('\n--- leaving is never a favour ---------------------------------');
// =============================================================================

eq('B: left the league', await B.tap('Leave this league'), 'OK');
ok('B\'s team is out',
  !!(await until(async () => {
    const { data } = await admin.from('teams').select('league_id').eq('id', mgrTeam.id).single();
    return data && data.league_id === null ? 1 : null;
  }, 25000)));
{
  const { data } = await admin
    .from('memberships').select('role').eq('league_id', leagueRow.id).eq('user_id', mgr.id);
  eq('but the membership is kept, so they can come back', (data || []).length, 1);
}

// ---- the season was never touched --------------------------------------------
{
  const a = await A.state();
  const b = await B.state();
  eq('phone A\'s season is untouched', [a.myTeam.name, a.roster.length], [`Boss United ${stamp}`, seeded.roster.length]);
  eq('phone B\'s season is untouched', [b.myTeam.name, b.roster.length], [`Manager City ${stamp}`, seeded.roster.length]);
  eq('and neither is mid-game', [a.gameActive, b.gameActive], [false, false]);
}

// ---- nothing fell over anywhere ----------------------------------------------
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
  try {
    await raw('Target.disposeBrowserContext', { browserContextId });
  } catch {
    /* already gone */
  }
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
ws.close();
process.exit(fail ? 1 : 0);
