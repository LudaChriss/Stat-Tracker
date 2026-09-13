// A live game nobody finished, driven through the real screens on two phones.
//
// Everything the database half proves in abandon-check.mjs, this proves is what
// a person actually sees and can do:
//
//   * a game that has gone quiet stops being offered as a game being scored,
//     on the season screen AND the league screen — with the clock MOVED three
//     hours, never waited for;
//   * a manager or scorer abandons it from the offer card, from inside the game,
//     and a commissioner from the league screen;
//   * abandoning refuses when a play landed in the meantime, and says so;
//   * a phone that walked away with a play it never sent comes back to a game
//     that is over, has that play refused where it can see it, and nothing
//     reaches anybody's history or any table;
//   * a commissioner calls off a fixture nothing was scored in without waiting
//     for the cutoff, and puts called-off fixtures back on the schedule;
//   * a commissioner makes the league private and public again.
//
// And the viewport audit at all four iPhone sizes on every new sheet, banner and
// section on the way.
//
// Manual harness. Needs the local stack, a dev server on :5173 (it must be the
// DEV server — the clock is not reachable in a production build) and Chrome on
// :9222.

import {
  SRC, account, admin, anonClient, boot, eq, finish, need, ok, phone, sleep, stamp, until,
} from './harness-browser.mjs';

const HOUR = 60 * 60 * 1000;
const PAST_CUTOFF = 3 * HOUR + 60 * 1000;

const { INITIAL_STATE, TEMPLATES } = await import(`${SRC}/data/league.js`);
const { SEEDED } = await import('./fixtures-history.js');
const seeded = SEEDED(INITIAL_STATE);
const outcome = (k) => TEMPLATES.kickball.groups.flatMap((g) => g.outcomes).find((o) => o.k === k);

const boss = await account('boss');   // commissioner, and manages Boss United
const mgr = await account('mgr');     // manages Manager City

const A = await phone('phone A');
const B = await phone('phone B');

const seasonFor = (name) => ({ ...seeded, myTeam: { ...seeded.myTeam, name }, history: [] });
const teamRowFor = (acct, name) =>
  until(async () => {
    const r = await admin.from('teams').select('*').eq('created_by', acct.id);
    return (r.data || []).find((t) => t.name === name) || null;
  }, 40000);

ok('phone A booted', !!(await boot(A, boss, seasonFor(`Boss United ${stamp}`))));
const bossTeam = await teamRowFor(boss, `Boss United ${stamp}`);
need('a team for phone A', !!bossTeam, 'page said: ' + A.logs().join(' | '));
ok('phone B booted', !!(await boot(B, mgr, seasonFor(`Manager City ${stamp}`))));
const cityTeam = await teamRowFor(mgr, `Manager City ${stamp}`);
need('a team for phone B', !!cityTeam, 'page said: ' + B.logs().join(' | '));

eq('the clock can be moved on phone A', await A.js(`typeof window.__scoreTrackerClock`), 'object');
eq('and on phone B', await B.js(`typeof window.__scoreTrackerClock`), 'object');
need('a movable clock — this must be the dev server', (await B.js(`typeof window.__scoreTrackerClock`)) === 'object');

// A league with both teams in it. How teams get in is browser-leagues.mjs's
// business; here they are placed with the service key.
const league = await boss.client.rpc('create_league_with_admin', { league_name: `Rain Delay ${stamp}` });
need('a league', !league.error, league.error && league.error.message);
const leagueId = league.data;
const leagueName = `Rain Delay ${stamp}`;
for (const t of [bossTeam, cityTeam]) {
  const placed = await admin.from('teams').update({ league_id: leagueId }).eq('id', t.id);
  need('a team placed in the league', !placed.error, placed.error && placed.error.message);
}
{
  // B follows the league, as redeeming its code would have made it.
  const joined = await admin.from('memberships').insert({ user_id: mgr.id, league_id: leagueId, role: 'viewer' });
  need('phone B follows the league', !joined.error, joined.error && joined.error.message);
}

/**
 * Tap a button inside the card that shows `cardText`. The league screen lists
 * several cards with the same buttons; this is the one a person would reach for.
 */
const tapInCard = (p, cardText, buttonText) =>
  until(() =>
    p.js(`(() => {
      const norm = (e) => (e.textContent || '').replace(/\\s+/g, ' ').trim();
      const cards = [...document.querySelectorAll('div')].filter((d) =>
        norm(d).includes(${JSON.stringify(cardText)}) &&
        [...d.querySelectorAll('button')].some((b) => norm(b) === ${JSON.stringify(buttonText)}));
      const card = cards.find((c) => !cards.some((o) => o !== c && c.contains(o)));
      if (!card) return null;
      [...card.querySelectorAll('button')].find((b) => norm(b) === ${JSON.stringify(buttonText)}).click();
      return 'OK';
    })()`), 12000);

let fixtureN = 0;
/** A fixture on the calendar. */
async function fixture(tag) {
  const clientId = `fx-${tag}-${stamp}-${++fixtureN}`;
  const r = await boss.client.rpc('schedule_game', {
    p_league_id: leagueId,
    payload: {
      clientId, homeTeamId: bossTeam.id, awayTeamId: cityTeam.id,
      scheduledAt: new Date(Date.now() + fixtureN * 60000).toISOString(), label: `Game ${tag}`, sport: 'kickball',
    },
  });
  need(`fixture ${tag}`, !r.error, r.error && r.error.message);
  return { id: r.data, clientId };
}

/**
 * A fixture somebody started scoring from another phone and walked away from:
 * started, a start event, `plays` plays. Real appends as a real user.
 */
async function walkedAway(tag, plays) {
  const f = await fixture(tag);
  const started = await boss.client.rpc('start_live_game', {
    p_team_id: bossTeam.id,
    payload: { clientId: f.clientId, opponentId: 'city', opponent: cityTeam.name, opponentTeamId: cityTeam.id, sport: 'kickball', home: true },
  });
  need(`${tag} started`, !started.error, started.error && started.error.message);
  let seq = 0;
  const append = async (kind, payload) => {
    const r = await boss.client.rpc('append_game_event', {
      p_game_id: started.data, p_client_event_id: `${tag}-${stamp}-${seq}`, p_kind: kind, p_payload: payload,
    });
    need(`${tag} event ${seq}`, !r.error, r.error && r.error.message);
    seq++;
    return r;
  };
  await append('start', { gameClientId: f.clientId, teamId: bossTeam.id, sport: 'kickball', lineup: seeded.lineup, bench: [], trackMode: 'both' });
  for (let i = 0; i < plays; i++) await append('outcome', { o: outcome(i % 4 === 3 ? 'K' : '1B') });
  return { ...f, id: started.data, append: (k, p) => append(k, p) };
}

const statusOf = async (id) => ((await admin.from('games').select('status, replaced_by').eq('id', id).single()).data) || {};
const logOf = async (id) => (await admin.from('game_events').select('seq, kind, payload, actor').eq('game_id', id).order('seq')).data || [];

// Where a phone is, and a league read fresh from wherever that is.
const whereAmI = async (p) => {
  const t = await p.text();
  if (t.includes('Teams ·')) return 'detail';
  if (t.includes('Your leagues')) return 'list';
  return 'elsewhere';
};
const openLeagueFresh = async (p) => {
  if ((await whereAmI(p)) === 'elsewhere') {
    const opened = await p.tap('Leagues');
    if (opened !== 'OK') return opened;
    await until(async () => ((await whereAmI(p)) === 'elsewhere' ? null : 1), 15000);
  }
  if ((await whereAmI(p)) === 'detail') {
    const back = await p.tap('‹ Back');
    if (back !== 'OK') return back;
    await until(async () => ((await whereAmI(p)) === 'list' ? 1 : null), 15000);
  }
  return p.tap(leagueName);
};
const goHome = async (p) => {
  for (let i = 0; i < 3 && (await whereAmI(p)) !== 'elsewhere'; i++) {
    await p.tap('‹ Back');
    await sleep(400);
  }
};

// =============================================================================
console.log('\n--- a game somebody walked away from stops being offered as live ---');
// =============================================================================

const one = await walkedAway('one', 3);

ok('phone B is offered it while it is fresh, as a game being scored',
  await B.sees('being scored now', 35000), () => 'on screen: ' + 'B ' + JSON.stringify(B.logs()));

eq('B: three hours and a minute pass', await B.advanceClock(PAST_CUTOFF), 'OK');
{
  const t = (await until(async () => {
    const text = await B.text();
    return text.includes('STOPPED') ? text : null;
  }, 10000)) || (await B.text());
  ok('the card now says the game stopped', t.includes('STOPPED'), 'on screen: ' + t.slice(0, 300));
  ok('and for how long', t.includes('no plays for 3 hr'), 'on screen: ' + t.slice(0, 300));
  eq('and it is no longer offered as a game being scored', t.includes('being scored now'), false);
}

eq('B: tapped the stopped game', await B.tap('Tap to abandon or resume it'), 'OK');
{
  const t = (await until(async () => {
    const text = await B.text();
    return text.includes('This game has stopped') ? text : null;
  }, 10000)) || '';
  ok('a sheet says what happened', t.includes('This game has stopped'), 'on screen: ' + (await B.text()).slice(0, 300));
  ok('including how much was entered', t.includes('3 plays were entered before that'), t.slice(0, 400));
  const buttons = await B.buttons();
  eq('and offers both ways out', ['Abandon it', 'Resume scoring it', 'Not now'].every((b) => buttons.includes(b)), true);
}
await B.audit('stopped-game sheet');

eq('B: abandoned it', await B.tap('Abandon it'), 'OK');
ok('the game is the cancelled tombstone in the account',
  !!(await until(async () => ((await statusOf(one.id)).status === 'cancelled' ? 1 : null), 20000)),
  () => 'status ' + JSON.stringify(one.id));
{
  const log = await logOf(one.id);
  eq('every play is still in its log, with the abandonment on the end', log.map((e) => e.kind), ['start', 'outcome', 'outcome', 'outcome', 'cancel']);
  const last = log[log.length - 1] || {};
  eq('saying it was abandoned, by phone B\'s manager', [last.payload && last.payload.reason, last.actor], ['abandoned', mgr.id]);
}
ok('and phone B is no longer offered it',
  !!(await until(async () => {
    const t = await B.text();
    return !t.includes('STOPPED') && !t.includes('being scored now') ? 1 : null;
  }, 20000)));
eq('B: back to the real clock', await B.resetClock(), 'OK');

// =============================================================================
console.log('\n--- not out from under a scorer: a play lands while B decides -------');
// =============================================================================

const two = await walkedAway('two', 2);
ok('phone B is offered the next one', await B.sees('being scored now', 35000));
await B.advanceClock(PAST_CUTOFF);
ok('it has stopped, as far as B can tell', await B.sees('STOPPED', 10000));
eq('B: opened it', await B.tap('Tap to abandon or resume it'), 'OK');
ok('the sheet is open', await B.sees('This game has stopped', 10000));

// Freeze B's view of the game — its offer refreshes on a timer, and a refresh
// landing in the next half-second would make B's abandon correct rather than
// refused, which is not the case under test. The abandon itself goes to an rpc
// URL this does not match.
await B.block(['*/rest/v1/games?*']);
await two.append('outcome', { o: outcome('HR') });
eq('B: tapped Abandon a moment after the rain stopped and a play went in', await B.tap('Abandon it'), 'OK');
ok('B is told why it did not happen',
  await B.sees('Someone has just entered a play in that game, so it was not abandoned.', 15000),
  () => 'on screen: ' + 'see B');
await sleep(500);
eq('and the game is still live in the account', (await statusOf(two.id)).status, 'live');
eq('with nothing added to its log', (await logOf(two.id)).map((e) => e.kind).pop(), 'outcome');
await B.block([]);
await B.resetClock();
ok('back on the real clock, it is a game being scored again', await B.sees('being scored now', 35000));

// Out of the way of what follows.
{
  const seen = (await logOf(two.id)).length;
  const r = await boss.client.rpc('abandon_live_game', { p_game_id: two.id, p_seen_seq: seen });
  need('the second game abandoned before moving on', !r.error, r.error && r.error.message);
  ok('and B stops being offered it', !!(await until(async () => (!(await B.text()).includes('being scored now') ? 1 : null), 35000)));
}

// =============================================================================
console.log('\n--- abandoned from inside the game, while the other phone is away ----');
// =============================================================================

const three = await fixture('three');
eq('A: opened the league', await openLeagueFresh(A), 'OK');
ok('A sees the fixture on the schedule', await A.sees('Game three', 20000));
eq('A: started scoring it', await A.tap('Score this game'), 'OK');
ok('A is in the game', !!(await until(async () => {
  const s = await A.state();
  return s && s.gameActive && s.gameClientId === three.clientId ? 1 : null;
}, 25000)));
eq('A: opened the entry tab', await A.tap('ENTRY'), 'OK');
eq('A: a strikeout', await A.tap('Strikeout'), 'OK');
eq('A: another', await A.tap('Strikeout'), 'OK');
ok('both reached the account', !!(await until(async () => ((await logOf(three.id)).filter((e) => e.kind === 'outcome').length === 2 ? 1 : null), 25000)));

ok('phone B, on the other team, is offered it', await B.sees('being scored now', 35000));
eq('B: joined', await B.tap('Tap to join and score it too'), 'OK');
ok('B is in the game, from the other dugout', !!(await until(async () => {
  const s = await B.state();
  return s && s.gameActive && s.gameClientId === three.clientId && s.gameHome === false ? 1 : null;
}, 25000)), async () => JSON.stringify((await B.state() || {}).gameClientId));

// A walks away mid-inning with a play it never managed to send.
await A.offline(true);
eq('A (no signal): a strikeout nobody else will see', await A.tap('Strikeout'), 'OK');
await sleep(800);
eq('and it has not reached the account', (await logOf(three.id)).filter((e) => e.kind === 'outcome').length, 2);

eq('B: three hours pass with nobody scoring', await B.advanceClock(PAST_CUTOFF), 'OK');
ok('B\'s game screen says the game has stopped', await B.sees('No plays for 3 hr', 10000), async () => (await B.text()).slice(0, 300));
await B.audit('game screen, stopped banner');
eq('B: tapped Abandon game', await B.tap('Abandon game'), 'OK');
ok('B is asked first', await B.sees('Abandon this game?', 10000));
await B.audit('game screen, abandon confirmation');
eq('B: confirmed', await B.tap('Abandon the game'), 'OK');

ok('the game is abandoned in the account', !!(await until(async () => ((await statusOf(three.id)).status === 'cancelled' ? 1 : null), 20000)));
ok('B is out of the game', !!(await until(async () => {
  const s = await B.state();
  return s && !s.gameActive && s.screen !== 'live' ? 1 : null;
}, 15000)));
await B.resetClock();

// A comes back.
await A.offline(false);
ok('phone A is taken out of the game it walked away from', !!(await until(async () => {
  const s = await A.state();
  return s && !s.gameActive ? 1 : null;
}, 40000)), async () => JSON.stringify({ active: ((await A.state()) || {}).gameActive }));
ok('and the play it never sent is refused where A can see it, not dropped',
  await A.sees("change didn't save", 40000), async () => (await A.text()).slice(0, 300));
{
  const log = await logOf(three.id);
  eq('nothing reached the log after the abandonment', log[log.length - 1].kind, 'cancel');
  eq('A\'s offline play is not in it', log.filter((e) => e.kind === 'outcome').length, 2);
}

// =============================================================================
console.log('\n--- the league screen: in progress, stopped, called off, and back -----');
// =============================================================================

const four = await walkedAway('four', 4);   // scored, then walked away from
const five = await walkedAway('five', 0);   // started, and nothing scored

eq('A: opened the league', await openLeagueFresh(A), 'OK');
{
  const t = (await until(async () => {
    const text = await A.text();
    return text.includes('In progress · 2') ? text : null;
  }, 25000)) || (await A.text());
  ok('both are in progress while they are fresh', t.includes('In progress · 2'), t.slice(0, 500));
  ok('and the commissioner is told which one nothing was scored in', t.includes('Nothing has been scored in it yet.'));
  eq('with Call it off on that one only', (await A.buttons()).filter((b) => b === 'Call it off').length, 1);
}

// Nothing scored: called off at once, no waiting for the cutoff.
eq('A: Call it off', await A.tap('Call it off'), 'OK');
ok('A is asked first', await A.sees('This ends it on every phone', 10000));
eq('A: confirmed', await A.tap('Abandon it'), 'OK');
ok('the empty fixture is abandoned in the account', !!(await until(async () => ((await statusOf(five.id)).status === 'cancelled' ? 1 : null), 20000)));
// Three already called off above: the offer card's, the guarded one's and the
// game screen's. This is the fourth.
ok('and is Called off on the commissioner\'s screen', await A.sees('Called off · 4', 20000), async () => (await A.text()).slice(0, 600));

// B, the other team's manager, looks at the same league three hours later.
eq('B: opened the league', await openLeagueFresh(B), 'OK');
ok('B sees it in progress first', await B.sees('In progress · 1', 20000));
await B.advanceClock(PAST_CUTOFF);
{
  const t = (await until(async () => {
    const text = await B.text();
    return text.includes('Stopped · 1') ? text : null;
  }, 10000)) || (await B.text());
  ok('then Stopped, not in progress', t.includes('Stopped · 1') && !t.includes('In progress ·'), t.slice(0, 500));
  ok('saying for how long, and how much was entered', t.includes('No plays for 3 hr') && t.includes('4 plays entered'));
  eq('B may abandon it — a manager of a team in it', (await B.buttons()).includes('Abandon this game'), true);
  eq('B is not shown the commissioner\'s called-off list', t.includes('Called off'), false);
}
await B.resetClock();

await A.advanceClock(PAST_CUTOFF);
ok('A sees the scored one has stopped', await A.sees('Stopped · 1', 10000));
await A.audit('league screen, stopped and called off');
eq('A: Abandon this game', await A.tap('Abandon this game'), 'OK');
eq('A: confirmed', await A.tap('Abandon it'), 'OK');
ok('abandoned in the account', !!(await until(async () => ((await statusOf(four.id)).status === 'cancelled' ? 1 : null), 20000)));
ok('and called off, beside the others', await A.sees('Called off · 5', 20000), async () => (await A.text()).slice(0, 600));
await A.resetClock();

// Both back on the schedule.
for (const [g, when, label] of [[four, '2026-10-04T18:30', 'Game four'], [five, '2026-10-11T18:30', 'Game five']]) {
  const before = (await admin.from('games').select('id').eq('league_id', leagueId).eq('status', 'scheduled')).data.length;
  eq(`A: Put back on the schedule, on ${label}`, await tapInCard(A, label, 'Put back on the schedule'), 'OK');
  ok('a date is asked for', !!(await until(async () => ((await A.js(`!!document.querySelector('input[type=datetime-local]')`)) ? 1 : null), 10000)));
  if (g === four) await A.audit('league screen, putting a game back');
  eq('A: picked a date', await A.type('input[type=datetime-local]', when), 'OK');
  eq('A: Schedule it', await A.tap('Schedule it'), 'OK');
  ok('a new fixture is on the calendar', !!(await until(async () =>
    ((await admin.from('games').select('id').eq('league_id', leagueId).eq('status', 'scheduled')).data.length === before + 1 ? 1 : null), 20000)));
}
{
  const replaced = (await admin.from('games').select('id, replaced_by').in('id', [four.id, five.id])).data || [];
  eq('both called-off games say what replaced them', replaced.every((r) => r.replaced_by), true);
  const news = (await admin.from('games').select('*').in('id', replaced.map((r) => r.replaced_by))).data || [];
  eq('scheduled, between the same two teams', news.map((n) => [n.status, n.home_team_id, n.away_team_id]),
    news.map(() => ['scheduled', bossTeam.id, cityTeam.id]));
  eq('on the dates picked', news.map((n) => new Date(n.scheduled_at).toLocaleDateString('en-CA')).sort(), ['2026-10-04', '2026-10-11']);
  eq('and the old ones are still the tombstones, logs and all',
    [(await statusOf(four.id)).status, (await logOf(four.id)).length], ['cancelled', 6]);
}
ok('the two put back have left the called-off list, and the three from before are still on it',
  await A.sees('Called off · 3', 20000), async () => (await A.text()).slice(0, 600));
eq('and it names neither of them', /Game four|Game five/.test(await A.text()), false);

// =============================================================================
console.log('\n--- none of it is a result -------------------------------------------');
// =============================================================================
{
  const abandonedIds = [one, two, three, four, five].map((g) => g.clientId);
  const { leagueStandings } = await import(`${SRC}/game/leagueTables.js`);
  const teams = (await admin.from('teams').select('*').eq('league_id', leagueId)).data;
  const games = (await admin.from('games').select('*').eq('league_id', leagueId)).data;
  // gp includes each team's own manual prior record; `tracked` is the games
  // actually scored in this league, which is the thing that must not move.
  eq('the league table has no scored games in it for either team', leagueStandings(teams, games).map((r) => r.tracked), [0, 0]);
  ok('and the screen says so', (await A.text()).includes('No games scored in this league yet.'));

  for (const p of [A, B]) {
    await p.reload();
    const s = await until(async () => {
      const got = await p.state();
      return got && got.myTeam && got.myTeam.name ? got : null;
    }, 30000);
    eq(`nothing abandoned is in ${p.name}'s history`, (s.history || []).filter((h) => abandonedIds.includes(h.id)), []);
  }
}

// =============================================================================
console.log('\n--- a commissioner decides who can see the league ----------------------');
// =============================================================================
{
  eq('A: opened the league', await openLeagueFresh(A), 'OK');
  ok('A is told it is public', await A.sees('Public: anyone can see', 20000));
  eq('A: Make this league private', await A.tap('Make this league private'), 'OK');
  ok('it is private in the account', !!(await until(async () =>
    ((await admin.from('leagues').select('visibility').eq('id', leagueId).single()).data.visibility === 'private' ? 1 : null), 20000)));
  const anon = anonClient();
  eq('somebody signed out can no longer read it', ((await anon.from('leagues').select('id').eq('id', leagueId)).data || []).length, 0);
  ok('and A is told so', await A.sees('Private: only people in the league can see', 20000));
  eq('A: Make this league public', await A.tap('Make this league public'), 'OK');
  ok('public again', !!(await until(async () =>
    ((await admin.from('leagues').select('visibility').eq('id', leagueId).single()).data.visibility === 'public' ? 1 : null), 20000)));
  eq('and readable signed out', ((await anon.from('leagues').select('id').eq('id', leagueId)).data || []).length, 1);

  // A manager who is not the commissioner has no such control.
  eq('B: opened the league', await openLeagueFresh(B), 'OK');
  ok('B sees the league', await B.sees('Teams ·', 20000));
  eq('B is offered no way to change who can see it',
    (await B.buttons()).some((b) => /Make this league/.test(b)), false);
}

await goHome(A);
await finish([A, B]);
