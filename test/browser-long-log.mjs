// A long game, through joining, a dropped signal and a cold reload — timed.
//
// Phase 3 left this as a note: a long log is fetched whole when a phone joins.
// There is no pagination, and this does not add any. What it adds is a number,
// so "fine at rec-game scale" is a measurement rather than a guess.
//
// One real game, well past anything a rec game produces: a start, a play from the
// screen, and then PLAYS more appended as the manager through the same function
// the app uses, so every one is a real row with a real sequence number. Then:
//
//   1. JOIN   — a second phone joins it. Timed from the tap to that phone holding
//               every play and showing the game, and checked against a replay of
//               the account's own log.
//   2. SIGNAL — that phone loses signal while more plays go in, and gets it back.
//               Timed to caught up.
//   3. RELOAD — that phone is reloaded mid-game, the cold start a phone gets when
//               the app is closed and reopened. Timed to caught up.
//
// For each, every read of the log that phone made is recorded from the network:
// whether it asked for the whole log or only what was new, how many rows came
// back, how many bytes, and how long it took. And the fold itself — replaying the
// whole log in the page — is timed on its own, since that is the other half of a
// join.
//
// Numbers from a laptop against a local stack: a floor, not a phone on a field.
// The ratios between them are the useful part. Recorded in BUILD_TRACKER.md.

import { SRC, account, admin, boot, eq, finish, need, ok, phone, sleep, until } from './harness-browser.mjs';

const PLAYS = 320;
const MORE = 20;

const { INITIAL_STATE, TEMPLATES } = await import(`${SRC}/data/league.js`);
const { SEEDED } = await import('./fixtures-history.js');
const { replay } = await import(`${SRC}/game/events.js`);
const seeded = SEEDED(INITIAL_STATE);
const outcome = (k) => TEMPLATES.kickball.groups.flatMap((g) => g.outcomes).find((o) => o.k === k);

const alice = await account('long');   // manages the team, starts the game
const bob = await account('join');     // scores for the team, joins it

const A = await phone('phone A');
const B = await phone('phone B');

const SOCKET_TRACKER = `(() => {
    const Native = window.WebSocket;
    const realtime = [];
    window.__realtimeSockets = realtime;
    function Tracked(url, protocols) {
      const s = protocols === undefined ? new Native(url) : new Native(url, protocols);
      if (String(url).includes('/realtime/')) realtime.push(s);
      return s;
    }
    Tracked.prototype = Native.prototype;
    Object.assign(Tracked, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    window.WebSocket = Tracked;
  })();`;
await A.send('Page.addScriptToEvaluateOnNewDocument', { source: SOCKET_TRACKER });

// ---- a team, and two people on it ---------------------------------------------
ok('phone A booted', !!(await boot(A, alice, { ...seeded, history: [] })));
const team = await until(async () => {
  const r = await admin.from('teams').select('*').eq('created_by', alice.id);
  return (r.data || []).find((t) => t.name === seeded.myTeam.name) || null;
}, 40000);
need('a team', !!team, 'page said: ' + A.logs().join(' | '));
{
  const granted = await admin.from('memberships').insert({ user_id: bob.id, team_id: team.id, role: 'team_scorer' });
  need('phone B scores for the team', !granted.error, granted.error && granted.error.message);
  const primary = await bob.client.rpc('set_primary_team', { team_id: team.id });
  need('and opens it', !primary.error, primary.error && primary.error.message);
}
// Going offline does not close a WebSocket that is already open — messages are
// held and released when the signal comes back, which is not what a phone that
// lost signal experiences. So B's realtime sockets are tracked (tracked only;
// nothing about them changes) and closed along with the network.
await B.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    const Native = window.WebSocket;
    const realtime = [];
    window.__realtimeSockets = realtime;
    function Tracked(url, protocols) {
      const s = protocols === undefined ? new Native(url) : new Native(url, protocols);
      if (String(url).includes('/realtime/')) realtime.push(s);
      return s;
    }
    Tracked.prototype = Native.prototype;
    Object.assign(Tracked, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    window.WebSocket = Tracked;
  })();`,
});

ok('phone B booted with the team from the account',
  !!(await boot(B, bob, null, { 'score-tracker:teamId': team.id }, (s) => s.roster && s.roster.length === seeded.roster.length)));

// ---- the game --------------------------------------------------------------------
eq('A: tapped the next-game card', await A.tap('Tap to start scoring'), 'OK');
eq('A: started the game', await A.tap('Start game'), 'OK');
eq('A: opened the entry tab', await A.tap('ENTRY'), 'OK');
eq('A: a single from the screen', await A.tap('Single'), 'OK');

const game = await until(async () => {
  const r = await admin.from('games').select('*').eq('home_team_id', team.id).eq('status', 'live');
  return (r.data || [])[0] || null;
}, 25000);
need('the game in the account', !!game);
const countLog = async () => (await admin.from('game_events').select('id', { count: 'exact', head: true }).eq('game_id', game.id)).count || 0;
need('its first plays in the log', !!(await until(async () => ((await countLog()) >= 2 ? 1 : null), 20000)));

// Mostly hits, a strikeout every fifteenth: long half-innings, so a game of
// hundreds of plays stays in the first few innings rather than sending the app
// into the end-of-the-7th prompt.
let n = 0;
const appendPlays = async (count) => {
  for (let i = 0; i < count; i++, n++) {
    const r = await alice.client.rpc('append_game_event', {
      p_game_id: game.id,
      p_client_event_id: `long-${game.id}-${n}`,
      p_kind: 'outcome',
      p_payload: { o: outcome(n % 15 === 14 ? 'K' : '1B') },
    });
    need(`play ${n} appended`, !r.error, r.error && r.error.message);
  }
};

const appendStarted = Date.now();
await appendPlays(PLAYS);
const appendMs = Date.now() - appendStarted;
let total = await countLog();
ok(`the log holds more than ${PLAYS} events`, total > PLAYS, String(total));

const heldBy = async (p) => (((await p.state()) || {}).serverLog || []).length;
{
  const t = Date.now();
  const caught = await until(async () => ((await heldBy(A)) === total ? 1 : null), 60000, 100);
  ok('phone A, in the game while they were entered, holds all of them', !!caught, `A holds ${await heldBy(A)} of ${total}`);
  console.log(`  TIMING appended ${PLAYS} plays in ${appendMs} ms; A caught up ${Date.now() - t} ms after the last one`);
}

// =============================================================================
console.log('\n--- a hole: realtime drops plays and delivers the one after them ------');
// =============================================================================
//
// Realtime can lose messages and say nothing. The poll beside it exists to
// heal that — but it asked only for plays newer than the highest one held, so a
// phone that missed 201–269 and then heard 270 asked for "after 270" forever and
// sat on a game seventy plays short. Found by the first version of this harness,
// which saw phone A stuck at 264 of 322 with the wrong score. Made to happen here
// on purpose: A hears nothing for ten plays, then hears the eleventh.
{
  const { contiguousSeq, lastSeq } = await import(`${SRC}/game/liveness.js`);
  await A.block(['*game_events?*seq=gt.*', '*/realtime/v1/*']);
  eq('A: its realtime socket closed', await A.js(`(window.__realtimeSockets || []).map((s) => (s.close(), 1)).length > 0 ? 'OK' : 'NONE'`), 'OK');
  ok('A has lost its live connection', !!(await until(async () => (((await A.state()) || {}).liveConnected === false ? 1 : null), 20000)));
  const heldBefore = (((await A.state()) || {}).serverLog || []).length;
  await appendPlays(10);

  // Realtime may come back; the poll may not.
  await A.block(['*game_events?*seq=gt.*']);
  ok('A\'s live connection comes back', !!(await until(async () => (((await A.state()) || {}).liveConnected === true ? 1 : null), 40000)));
  await appendPlays(1);
  const withHole = await until(async () => {
    const log = ((await A.state()) || {}).serverLog || [];
    return log.length === heldBefore + 1 ? log : null;
  }, 20000);
  ok('A heard the play after the gap, and not the ten before it', !!withHole,
    async () => `A holds ${(((await A.state()) || {}).serverLog || []).length}, had ${heldBefore}`);
  if (withHole) eq('so A holds a log with a hole in it', contiguousSeq(withHole) < lastSeq(withHole), true);

  await A.block([]);
  const full = await countLog();
  const t = Date.now();
  ok('when the poll is allowed again, the hole is filled', !!(await until(async () => ((await heldBy(A)) === full ? 1 : null), 30000, 100)),
    async () => `A holds ${await heldBy(A)} of ${full}`);
  console.log(`  TIMING hole of 10 filled ${Date.now() - t} ms after the poll was allowed back (one poll interval is 6000 ms)`);
}

/** The account's log, folded the way every phone folds it. */
const accountReplay = async () => {
  const rows = (await admin.from('game_events').select('*').eq('game_id', game.id).order('seq')).data || [];
  return replay(
    { ...seeded, history: [] },
    rows.map((r) => ({ clientEventId: r.client_event_id, seq: Number(r.seq), kind: r.kind, payload: r.payload || {} })),
  );
};

// ---- every read of the log phone B makes -----------------------------------------
const reads = [];
{
  const open = new Map();
  B.on((m) => {
    if (m.method === 'Network.requestWillBeSent' && m.params.request.method === 'GET' && m.params.request.url.includes('/rest/v1/game_events')) {
      open.set(m.params.requestId, { url: m.params.request.url, t0: m.params.timestamp });
    } else if (m.method === 'Network.loadingFinished' && open.has(m.params.requestId)) {
      const r = open.get(m.params.requestId);
      open.delete(m.params.requestId);
      reads.push({ ...r, id: m.params.requestId, ms: Math.round((m.params.timestamp - r.t0) * 1000), bytes: m.params.encodedDataLength });
    } else if (m.method === 'Network.loadingFailed' && open.has(m.params.requestId)) {
      const r = open.get(m.params.requestId);
      open.delete(m.params.requestId);
      reads.push({ ...r, id: m.params.requestId, failed: true, ms: Math.round((m.params.timestamp - r.t0) * 1000), bytes: 0 });
    }
  });
}
/** The reads since `from`, each with the rows it returned. */
const readsSince = async (from) => {
  const out = [];
  for (const r of reads.slice(from)) {
    let rows = null;
    if (r.failed) {
      const since = /seq=gt\.(\d+)/.exec(r.url);
      out.push({ asked: since ? `since seq ${since[1]}` : 'the whole log', failed: true, ms: r.ms });
      continue;
    }
    try {
      const { body } = await B.send('Network.getResponseBody', { requestId: r.id });
      rows = JSON.parse(body).length;
    } catch {
      /* body no longer held: the count is simply not known */
    }
    const since = /seq=gt\.(\d+)/.exec(r.url);
    out.push({ asked: since ? `since seq ${since[1]}` : 'the whole log', rows, bytes: r.bytes, ms: r.ms });
  }
  return out;
};
const describe = (list) =>
  list.map((r) => (r.failed ? `${r.asked}: failed, no signal` : `${r.asked}: ${r.rows} rows, ${r.bytes} bytes, ${r.ms} ms`)).join('; ') || 'none';

// =============================================================================
total = await countLog();
console.log(`\n--- 1. JOIN: a second phone joins a game of ${total} events -----------`);
// =============================================================================

ok('phone B is offered the game', await B.sees('being scored now', 35000));
let mark = reads.length;
let t = Date.now();
eq('B: joined', await B.tap('Tap to join and score it too'), 'OK');
{
  const joined = await until(async () => {
    const s = await B.state();
    return s && s.gameActive && s.screen === 'live' && (s.serverLog || []).length === total ? s : null;
  }, 60000, 50);
  const joinMs = Date.now() - t;
  ok('B holds every event and is on the live screen', !!joined, `B holds ${await heldBy(B)} of ${total}`);
  const expected = await accountReplay();
  eq('and its game is the account\'s game, replayed', joined && joined.score, expected.score);
  eq('as is A\'s', ((await A.state()) || {}).score, expected.score);
  console.log(`  TIMING join: ${joinMs} ms from the tap to holding ${total} events on the live screen`);
  console.log(`  READS  join: ${describe(await readsSince(mark))}`);
}

// The fold on its own, in the page, on the log B just fetched.
{
  const fold = await B.js(`(async () => {
    const { replay } = await import('/src/game/events.js');
    const raw = JSON.parse(localStorage.getItem('score-tracker:state')).state;
    const log = raw.serverLog;
    const times = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      replay(raw, log);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return { events: log.length, medianMs: Math.round(times[2] * 10) / 10, worstMs: Math.round(times[4] * 10) / 10 };
  })()`);
  ok('the whole-log fold was timed in the page', fold && !fold.ERR && fold.events === total, JSON.stringify(fold));
  console.log(`  TIMING fold: replaying all ${fold.events} events in the page takes ${fold.medianMs} ms (median of 5), ${fold.worstMs} ms worst`);
}

// =============================================================================
console.log(`\n--- 2. SIGNAL: B loses signal while ${MORE} more plays go in -----------`);
// =============================================================================

mark = reads.length;
await B.offline(true);
eq('B: its realtime socket dropped with the signal',
  await B.js(`(window.__realtimeSockets || []).map((s) => (s.close(), 1)).length > 0 ? 'OK' : 'NONE'`), 'OK');
await sleep(1000);
await appendPlays(MORE);
const afterMore = await countLog();
ok('A hears about them', !!(await until(async () => ((await heldBy(A)) === afterMore ? 1 : null), 30000, 100)));
eq('B, with no signal, has not', await heldBy(B), total);

t = Date.now();
await B.offline(false);
{
  const caught = await until(async () => ((await heldBy(B)) === afterMore ? 1 : null), 60000, 50);
  const reconnectMs = Date.now() - t;
  ok(`B catches up to ${afterMore} when the signal comes back`, !!caught, `B holds ${await heldBy(B)}`);
  eq('on the same game', ((await B.state()) || {}).score, (await accountReplay()).score);
  console.log(`  TIMING signal back: ${reconnectMs} ms to caught up (${MORE} missed plays)`);
  console.log(`  READS  signal lost and back: ${describe(await readsSince(mark))}`);
}

// =============================================================================
console.log('\n--- 3. RELOAD: B is closed and reopened mid-game ------------------');
// =============================================================================

await sleep(1500);
mark = reads.length;
t = Date.now();
await B.reload();
{
  const back = await until(async () => {
    const s = await B.state();
    const onScreen = await B.js(`document.body.textContent.includes('Game completed')`);
    return s && s.gameActive && (s.serverLog || []).length === afterMore && onScreen === true ? s : null;
  }, 60000, 50);
  const reloadMs = Date.now() - t;
  ok('B reopens into the game, holding every event', !!back, `B holds ${await heldBy(B)}`);
  eq('the same game', back && back.score, (await accountReplay()).score);
  // Give the first poll after the reload time to happen, so its read is counted.
  await sleep(7000);
  // A phone that joined and has entered nothing used to append a `resume` on
  // reopening — its last saved snapshot, on the end of everyone's log, which
  // every phone then folded the game back to. Found by this harness's reads:
  // the log was one longer after the reload than before it.
  eq('reopening appended nothing to the log', await countLog(), afterMore);
  eq('and certainly no resume', ((await admin.from('game_events').select('id').eq('game_id', game.id).eq('kind', 'resume')).data || []).length, 0);
  console.log(`  TIMING reload: ${reloadMs} ms from reload to the live screen holding ${afterMore} events`);
  console.log(`  READS  reload (first 7 s): ${describe(await readsSince(mark))}`);
}

// Out of everybody's way.
{
  const { data } = await admin.from('game_events').select('seq').eq('game_id', game.id).order('seq', { ascending: false }).limit(1);
  const r = await alice.client.rpc('abandon_live_game', { p_game_id: game.id, p_seen_seq: Number(data[0].seq) });
  eq('the long game is abandoned, to leave nothing live behind', r.error, null);
}
ok('both phones leave it', !!(await until(async () => {
  const [a, b] = [await A.state(), await B.state()];
  return a && b && !a.gameActive && !b.gameActive ? 1 : null;
}, 40000)));
await A.tap('Leagues', 3000);

await finish([A, B]);
