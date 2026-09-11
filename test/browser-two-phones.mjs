// TWO PHONES, ONE GAME — in real browsers, against a real Postgres.
//
// This is the harness for the claim phase 3 actually makes. Everything else
// can be argued from unit tests; this cannot. Two separate browser sessions,
// two separate accounts, two separate stores of localStorage, one game.
//
// What it drives, in order:
//
//   1. A manager starts a game and scores a play.
//   2. A scorer on the same team, on a different phone, is OFFERED that game
//      and joins it — and lands on the same score, because it replays the same
//      log.
//   3. Both phones enter plays. Each one appears on the other.
//   4. The second phone loses signal, scores two plays anyway, while the first
//      phone scores one. The two disagree, on purpose and visibly.
//   5. The second phone comes back. Its plays replay IN ITS OWN ORDER, on the
//      end of the server's order. Both phones converge on the same game — the
//      same score, the same stat lines, the same scorebook — and that game is
//      the one the server's order produces, not either phone's local guess.
//
// Manual harness, like viewports.mjs. Needs:
//   * the local Supabase stack   (npx supabase start --ignore-health-check)
//   * a dev server on :5173      (npm run dev)
//   * Chrome on :9222            (--remote-debugging-port=9222)
// Never runs against the hosted project: it creates users and scores games.

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
const differ = (label, a, b) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) console.log('ok   ' + label);
  else {
    fail++;
    console.log(`FAIL ${label} — they agreed, so the check proves nothing\n  both: ${JSON.stringify(a)}`);
  }
};
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

// ---- two accounts, and the session blobs their browsers will accept ----------
const password = 'Password123!';
const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 5)}`;

async function account(tag) {
  const email = `phones${tag}${stamp}@example.test`;
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  need(`the ${tag} account could be created`, !made.error, made.error && made.error.message);

  // Sign in through a storage shim so the exact entry supabase-js writes can be
  // handed to a browser. The app's own sign-in is an emailed code; reproducing
  // the mailbox dance would be testing Supabase's auth, not this slice.
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
  need('supabase-js wrote a session to storage', !!key, Object.keys(captured).join(', '));
  return { id: signIn.data.user.id, email, client, authKey: key, authValue: captured[key] };
}

const alice = await account('a');   // starts the game
const bob = await account('b');     // joins it

// ---- CDP, multiplexed over one browser connection ----------------------------
const ws = new WebSocket(browserWsUrl);
await new Promise((r) => ws.addEventListener('open', r));

let msgId = 0;
const pending = new Map();
const logs = new Map();          // sessionId -> console/exception lines
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
    bucket.push(
      m.params.type + ': ' +
        m.params.args.map((a) => String(a.value ?? a.description ?? '').slice(0, 90)).join(' § '),
    );
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

/**
 * One phone: its own browser context, so its localStorage, its session and its
 * network conditions are genuinely separate from the other's. Two tabs sharing
 * an origin would share storage, and would prove nothing.
 */
async function phone(name) {
  const { browserContextId } = await raw('Target.createBrowserContext', {});
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
    sessionId,
    send,
    js,
    logs: () => logs.get(sessionId),
    put: (k, v) => js(`localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)}), 1`),
    get: (k) => js(`localStorage.getItem(${JSON.stringify(k)})`),
    goto: (url) => send('Page.navigate', { url }),
    reload: () => send('Page.reload'),
    offline: (yes) =>
      send('Network.emulateNetworkConditions', {
        offline: yes, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
      }),
    buttons: () =>
      js(`[...document.querySelectorAll('button,[role=button]')].map((e)=>(e.textContent||'').replace(/\\s+/g,' ').trim())`),
    state: async () => {
      const stored = await js(`localStorage.getItem('score-tracker:state')`);
      try { return JSON.parse(stored).state; } catch { return null; }
    },
  };

  /**
   * Tap whatever is showing this text.
   *
   * Not just buttons: several of the things a scorer taps are cards — a div
   * with an onClick — and a harness that could only reach <button> would be
   * testing a different app from the one people use. The innermost element
   * carrying the text is clicked, and React's delegated handler takes it from
   * whichever ancestor is actually listening.
   */
  self.tap = async (text, ms = 10000) => {
    const hit = await until(() =>
      js(`(() => {
        const want = ${JSON.stringify(text)};
        const norm = (e) => (e.textContent || '').replace(/\\s+/g, ' ').trim();
        const matches = [...document.querySelectorAll('body *')].filter(
          (e) => norm(e).includes(want) && e.getBoundingClientRect().width > 0,
        );
        // The deepest match: anything that has another match inside it is a
        // container, not the control.
        const el = matches.find((e) => !matches.some((o) => o !== e && e.contains(o)));
        if (!el) return null;
        el.click();
        return 'OK';
      })()`), ms);
    if (hit) return 'OK';
    return `MISS "${text}" — on screen: ` + JSON.stringify(await self.buttons());
  };

  return self;
}

const A = await phone('phone A');
const B = await phone('phone B');

// ---- phone A: a season, signed in, migrated up -------------------------------
const { INITIAL_STATE } = await import(`${SRC}/data/league.js`);
const { SEEDED } = await import('./fixtures-history.js');
const seeded = SEEDED(INITIAL_STATE);

const boot = async (p, authKey, authValue, extra = {}) => {
  await p.goto('about:blank');
  await sleep(200);
  await p.send('Storage.clearDataForOrigin', { origin: APP, storageTypes: 'all' });
  await p.goto(APP);
  await until(() => p.js(`document.readyState === 'complete' ? 1 : null`), 15000);
  await p.put(authKey, authValue);
  for (const [k, v] of Object.entries(extra)) await p.put(k, v);
  await p.reload();
};

await boot(A, alice.authKey, alice.authValue, {
  'score-tracker:state': JSON.stringify({ version: 3, state: { ...seeded, history: [] } }),
});

const teamRow = await until(async () => {
  const r = await admin.from('teams').select('*').eq('created_by', alice.id);
  return (r.data || []).find((t) => t.name === seeded.myTeam.name) || null;
}, 40000);
ok('phone A signed in and its season reached the account', !!teamRow);
if (!teamRow) console.log('  page said: ' + (A.logs().join(' | ') || 'nothing'));
need('a team to score for', !!teamRow);
const teamId = teamRow.id;

// Signing in used to reconcile twice — the explicit getSession and the
// INITIAL_SESSION event both started one — and with a season to upload that
// meant import_season_and_claim ran twice, milliseconds apart. The result was
// two complete sets of opposing teams, a read-back check that correctly said
// the upload did not match the device, and a person told their season could
// not be uploaded when nothing was wrong with it.
const allTeams = await admin.from('teams').select('id, name').eq('created_by', alice.id);
eq('signing in uploaded the season once, not twice',
  (allTeams.data || []).length, seeded.teams.length + 1);

// ---- phone B: the same team, as a scorer -------------------------------------
const granted = await admin.from('memberships').insert({ user_id: bob.id, team_id: teamId, role: 'team_scorer' });
ok('phone B holds a scorer role on that team', !granted.error, granted.error && granted.error.message);
const primary = await bob.client.rpc('set_primary_team', { team_id: teamId });
ok('and that team is what phone B opens', !primary.error, primary.error && primary.error.message);

await boot(B, bob.authKey, bob.authValue, { 'score-tracker:teamId': teamId });

const bobSeason = await until(async () => {
  const s = await B.state();
  return s && s.roster && s.roster.length ? s : null;
}, 40000);
ok('phone B loaded the team from the account, with no local season of its own',
  !!bobSeason && bobSeason.roster.length === seeded.roster.length,
  bobSeason ? `roster ${bobSeason.roster.length}` : 'no season: ' + (B.logs().join(' | ') || 'nothing'));

// =============================================================================
console.log('\n--- phone A starts a game --------------------------------------');
// =============================================================================

eq('A: tapped the next-game card', await A.tap('Tap to start scoring'), 'OK');
eq('A: started the game', await A.tap('Start game'), 'OK');
eq('A: opened the entry tab', await A.tap('ENTRY'), 'OK');
eq('A: scored a home run', await A.tap('Home run'), 'OK');

const liveGame = await until(async () => {
  const r = await admin.from('games').select('*').eq('home_team_id', teamId).eq('status', 'live');
  return (r.data || [])[0] || null;
}, 25000);
if (!liveGame) {
  const s = await A.state();
  console.log('  A state   : ' + JSON.stringify({
    gameActive: s && s.gameActive, clientId: s && s.gameClientId,
    log: s && (s.gameLog || []).map((e) => e.kind), server: s && (s.serverLog || []).length,
  }));
  console.log('  A queue   : ' + String(await A.get('score-tracker:queue')).slice(0, 600));
  console.log('  A teamId  : ' + String(await A.get('score-tracker:teamId')));
  console.log('  A said    : ' + (A.logs().filter((l) => !l.includes('same key')).join('\n              ') || 'nothing'));
}
ok('the game reached the account while it was still being played', !!liveGame);
need('a live game', !!liveGame);

const logRows = await until(async () => {
  const r = await admin.from('game_events').select('*').eq('game_id', liveGame.id).order('seq');
  return (r.data || []).length >= 2 ? r.data : null;
}, 20000);
ok('and so did the plays, as events', !!logRows);
eq('the log opens with the start of the game', logRows[0].kind, 'start');
eq('and the sequence was assigned by the server', logRows.map((r) => Number(r.seq)), logRows.map((_, i) => i + 1));

const scoreOf = async (p) => {
  const s = await p.state();
  return s ? s.score : null;
};

eq('A: the home run is on A\'s board', await scoreOf(A), { home: 0, away: 1 });

// =============================================================================
console.log('\n--- phone B is offered the game, and joins ---------------------');
// =============================================================================

const offered = await until(async () => {
  const text = await B.js(`document.body.textContent.replace(/\\s+/g,' ')`);
  return text && text.includes('being scored now') ? text : null;
}, 30000);
ok('phone B is told a game is being scored right now', !!offered,
  'B never saw the offer: ' + (B.logs().join(' | ') || 'nothing'));

eq('B: joined the game', await B.tap('Tap to join and score it too'), 'OK');

const bJoined = await until(async () => {
  const s = await B.state();
  return s && s.gameActive && s.score ? s : null;
}, 25000);
ok('phone B is now in the game', !!bJoined);
need('phone B in the game', !!bJoined);
eq('B: and sees the score A put on the board', bJoined.score, { home: 0, away: 1 });
eq('B: on the same game', bJoined.gameClientId, liveGame.client_id);

// =============================================================================
console.log('\n--- both phones score, and each one sees the other -------------');
// =============================================================================

eq('B: opened the entry tab', await B.tap('ENTRY'), 'OK');
eq('B: scored a single', await B.tap('Single'), 'OK');

const aSawB = await until(async () => {
  const s = await A.state();
  return s && s.events && s.events.length >= 2 ? s : null;
}, 20000);
ok('phone A was told about the play phone B entered', !!aSawB,
  'A never saw it: ' + (A.logs().join(' | ') || 'nothing'));

eq('A: tapped a walk', await A.tap('Walk'), 'OK');
const bSawA = await until(async () => {
  const s = await B.state();
  return s && s.events && s.events.length >= 3 ? s : null;
}, 20000);
ok('phone B was told about the play phone A entered', !!bSawA);

const agree = async (label) => {
  const settled = await until(async () => {
    const a = await A.state();
    const b = await B.state();
    if (!a || !b) return null;
    return JSON.stringify([a.score, a.gameStats, a.events]) === JSON.stringify([b.score, b.gameStats, b.events])
      ? [a, b]
      : null;
  }, 25000);
  if (settled) {
    console.log('ok   ' + label);
    return settled[0];
  }
  fail++;
  const a = await A.state();
  const b = await B.state();
  console.log(`FAIL ${label}\n  A ${JSON.stringify(a && a.score)} stats ${JSON.stringify(a && a.gameStats)}\n  B ${JSON.stringify(b && b.score)} stats ${JSON.stringify(b && b.gameStats)}`);
  return a;
};

await agree('both phones show the same game: score, stat lines and scorebook');

// =============================================================================
console.log('\n--- phone B loses signal, and both keep scoring ----------------');
// =============================================================================

const beforeSplit = await A.state();
await B.offline(true);

eq('B (offline): scored a single', await B.tap('Single'), 'OK');
eq('B (offline): scored another single', await B.tap('Single'), 'OK');

const bOffline = await until(async () => {
  const s = await B.state();
  return s && s.events && s.events.length >= beforeSplit.events.length + 2 ? s : null;
}, 15000);
ok('phone B keeps scoring with no signal', !!bOffline);
need('phone B to have scored offline', !!bOffline);

eq('A: scored a home run while B was away', await A.tap('Home run'), 'OK');
const aAhead = await until(async () => {
  const s = await A.state();
  return s && s.events && s.events.length === beforeSplit.events.length + 1 ? s : null;
}, 15000);
ok('phone A recorded it', !!aAhead);

// The check only means something if the two genuinely disagree here.
differ('while B is offline the two phones disagree, as they must', aAhead && aAhead.score, bOffline && bOffline.score);

const eventsWhileSplit = await admin.from('game_events').select('*').eq('game_id', liveGame.id).order('seq');
ok('and nothing B entered offline reached the account',
  !(eventsWhileSplit.data || []).some((r) => (r.payload && r.payload.o && r.payload.o.k) === '1B'
    && Number(r.seq) > Number(logRows[logRows.length - 1].seq) + 2),
  JSON.stringify((eventsWhileSplit.data || []).map((r) => [Number(r.seq), r.kind])));

// =============================================================================
console.log('\n--- B comes back: its plays replay, everyone converges ---------');
// =============================================================================

await B.offline(false);
await B.js(`window.dispatchEvent(new Event('online')), 1`);

const converged = await agree('after B reconnects, both phones show the same game again');

const finalLog = await until(async () => {
  const r = await admin.from('game_events').select('*').eq('game_id', liveGame.id).order('seq');
  const rows = r.data || [];
  return rows.length >= eventsWhileSplit.data.length + 2 ? rows : null;
}, 30000);
ok('B\'s offline plays reached the account', !!finalLog);
need('the full log', !!finalLog);

eq('the log is one unbroken sequence', finalLog.map((r) => Number(r.seq)), finalLog.map((_, i) => i + 1));
eq('nothing was recorded twice', new Set(finalLog.map((r) => r.client_event_id)).size, finalLog.length);

// B's two offline plays are LAST, in the order B entered them — after the home
// run A scored while B was away. That is the whole ordering rule: the server's
// order for what it accepted, this phone's order for what it had not sent yet.
const tail = finalLog.slice(-3).map((r) => (r.payload && r.payload.o && r.payload.o.k) || r.kind);
eq('A\'s play is ahead of the two B was holding', tail, ['HR', '1B', '1B']);
eq('both are attributed to whoever entered them',
  finalLog.slice(-3).map((r) => (r.actor === alice.id ? 'A' : r.actor === bob.id ? 'B' : '?')),
  ['A', 'B', 'B']);

// And the game both phones landed on is the one the SERVER's order produces —
// not phone A's local guess and not phone B's.
const { replay } = await import(`${SRC}/game/events.js`);
const fromServer = replay(
  { ...seeded, history: [] },
  finalLog.map((r) => ({
    clientEventId: r.client_event_id,
    seq: Number(r.seq),
    kind: r.kind,
    payload: r.payload || {},
  })),
);
ok('replaying the account\'s own log reproduces it', !!fromServer);
if (fromServer && converged) {
  eq('the score both phones show is the one the log says', converged.score, fromServer.score);
  eq('and so is every stat line', converged.gameStats, fromServer.gameStats);
  eq('and the scorebook, play for play', converged.events, fromServer.events);
}

// ---- nothing fell over anywhere ----------------------------------------------
for (const p of [A, B]) {
  const crashed = await p.js(`!!document.body.textContent.match(/Something went wrong|TEMPLATES/)`);
  eq(`${p.name} never fell into its error boundary`, crashed, false);
  const bad = p.logs().filter((l) => l.startsWith('uncaught'));
  eq(`${p.name} reported no uncaught errors`, bad, []);
}

if (fail) {
  console.log('\nphone A said: ' + (A.logs().join('\n              ') || 'nothing'));
  console.log('phone B said: ' + (B.logs().join('\n              ') || 'nothing'));
}
console.log(fail ? `\n${fail} FAILED` : '\nall passed');
ws.close();
process.exit(fail ? 1 : 0);
