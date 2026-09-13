// Abandoning a stale live game, and putting a called-off fixture back on the
// schedule — against a real Postgres, as real signed-in users.
//
// Two functions from _023, and every one of the ways they must say no:
//
//   * abandon_live_game ends a game on somebody else's behalf. The people who
//     may do it are the people who may score it — and nobody else, not a
//     follower, not a stranger, not somebody signed out. It must refuse if a
//     play has landed since the caller looked, because "stale" is decided on a
//     phone holding a list that can be seconds old. And what it leaves behind
//     must keep its whole log while counting for nothing: not a result, not a
//     line in anybody's season, not a row in the table.
//
//   * reschedule_called_off_game makes a NEW fixture for a called-off one. Only
//     a commissioner of that league. And the old game must stay shut: a phone
//     that comes back with plays it never sent must be refused, not allowed to
//     pour them into the fixture that replaced it. That refusal is the entire
//     reason this is a new row rather than the old one reopened (D19).
//
// Runs against the LOCAL stack only.

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';

const repoRoot = new URL('..', import.meta.url).pathname;

let fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    fail++;
    console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  } else console.log('ok   ' + label);
};
const refused = (label, { error }, wanted) => {
  if (!error) {
    fail++;
    console.log(`FAIL allowed (should have been refused): ${label}`);
    return;
  }
  if (wanted && !String(error.message).includes(wanted)) {
    fail++;
    console.log(`FAIL refused for the wrong reason: ${label}\n  ${error.message}`);
    return;
  }
  console.log('ok   refused: ' + label);
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
} catch {
  console.log('skipped — no local Supabase stack, so abandoning a game was not exercised against a database');
  console.log('\nall passed');
  process.exit(0);
}

const admin = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
try {
  const probe = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (probe.error) throw probe.error;
} catch {
  console.log('skipped — local Supabase not reachable, so abandoning a game was not exercised against a database');
  console.log('\nall passed');
  process.exit(0);
}

const { rowsToSeason } = await import('../src/data/seasonMapping.js');
const { leagueLeaders, leagueStandings } = await import('../src/game/leagueTables.js');
const { bucketLeagueGames, createLeagues } = await import('../src/data/leagues.js');
const { seasonTotals } = await import('../src/game/stats.js');
const { tallyStandings } = await import('../src/game/standings.js');

const password = 'Password123!';
const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 5)}`;

async function person(tag) {
  const email = `ab${tag}${stamp}@example.test`;
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  need(`a ${tag} account could be created`, !made.error, made.error && made.error.message);
  const client = createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  need(`the ${tag} account could sign in`, !error, error && error.message);
  return { id: made.data.user.id, client };
}

const commissioner = await person('adm');   // runs the league
const rovers = await person('mgr1');        // manages the home team
const wanderers = await person('mgr2');     // manages the away team
const scorer = await person('scr');         // scores for the home team
const follower = await person('view');      // a viewer on the home team
const outsider = await person('out');       // on nothing at all
const otherAdmin = await person('adm2');    // commissioner of a different league
const anon = createClient(st.API_URL, st.ANON_KEY, { auth: { persistSession: false } });

// ---- a league, two teams in it, and the people around them -------------------
const league = await commissioner.client.rpc('create_league_with_admin', { league_name: `Rainy ${stamp}` });
need('a league', !league.error, league.error && league.error.message);
const leagueId = league.data;
const other = await otherAdmin.client.rpc('create_league_with_admin', { league_name: `Elsewhere ${stamp}` });
need('a second league', !other.error, other.error && other.error.message);

const teamOf = async (who, name) => {
  const r = await who.client.rpc('create_team_with_manager', { team_name: `${name} ${stamp}` });
  need(`${name} could be created`, !r.error, r.error && r.error.message);
  return r.data;
};
const roversId = await teamOf(rovers, 'Rovers');
const wanderersId = await teamOf(wanderers, 'Wanderers');

// Placed with the service key, as roles-check does: how a team gets into a
// league is leagues-check's business, not this suite's.
for (const id of [roversId, wanderersId]) {
  const placed = await admin.from('teams').update({ league_id: leagueId }).eq('id', id);
  need('a team placed in the league', !placed.error, placed.error && placed.error.message);
}
{
  const granted = await admin.from('memberships').insert([
    { user_id: scorer.id, team_id: roversId, role: 'team_scorer' },
    { user_id: follower.id, team_id: roversId, role: 'viewer' },
  ]);
  need('scorer and follower memberships', !granted.error, granted.error && granted.error.message);
}

const outcome = (k) => ({ o: { k, label: k, type: k === 'K' ? 'out' : 'hit', n: 1, mode: 'fly' } });

/** Schedule a fixture, start it as the scorer, and enter `plays` plays. */
async function liveFixture(tag, plays) {
  const clientId = `fx-${tag}-${stamp}`;
  const scheduled = await commissioner.client.rpc('schedule_game', {
    p_league_id: leagueId,
    payload: { clientId, homeTeamId: roversId, awayTeamId: wanderersId, scheduledAt: '2026-09-20T18:00:00Z', label: 'Sep 20', sport: 'kickball' },
  });
  need(`fixture ${tag} scheduled`, !scheduled.error, scheduled.error && scheduled.error.message);
  const started = await scorer.client.rpc('start_live_game', {
    p_team_id: roversId,
    payload: { clientId, opponentId: 'wanderers-slug', opponent: 'Wanderers', opponentTeamId: wanderersId, sport: 'kickball', home: true },
  });
  need(`fixture ${tag} started`, !started.error, started.error && started.error.message);
  const gameId = started.data;
  const append = (kind, payload, n) =>
    scorer.client.rpc('append_game_event', {
      p_game_id: gameId, p_client_event_id: `${tag}-${n}-${stamp}`, p_kind: kind, p_payload: payload,
    });
  const first = await append('start', { gameClientId: clientId, teamId: roversId, sport: 'kickball', lineup: [], bench: [] }, 0);
  need(`fixture ${tag}'s start event`, !first.error, first.error && first.error.message);
  for (let i = 1; i <= plays; i++) {
    const r = await append('outcome', outcome(i % 3 ? '1B' : 'K'), i);
    need(`fixture ${tag}'s play ${i}`, !r.error, r.error && r.error.message);
  }
  return { gameId, clientId, lastSeq: plays + 1 };
}

const logOf = async (gameId) =>
  (await admin.from('game_events').select('seq, kind, payload, actor, client_event_id').eq('game_id', gameId).order('seq')).data || [];
const statusOf = async (gameId) =>
  ((await admin.from('games').select('status, replaced_by').eq('id', gameId).single()).data) || {};

// =============================================================================
console.log('--- who may abandon a game ---------------------------------------');
// =============================================================================

const rained = await liveFixture('rain', 5);
{
  const args = { p_game_id: rained.gameId, p_seen_seq: rained.lastSeq };
  refused('somebody signed out cannot abandon a game', await anon.rpc('abandon_live_game', args));
  refused('a stranger cannot abandon a game', await outsider.client.rpc('abandon_live_game', args), 'not allowed to score');
  refused('a follower of the team cannot abandon it', await follower.client.rpc('abandon_live_game', args), 'not allowed to score');
  refused('the commissioner of a DIFFERENT league cannot', await otherAdmin.client.rpc('abandon_live_game', args), 'not allowed to score');

  eq('after all of that the game is still live', (await statusOf(rained.gameId)).status, 'live');
  eq('and its log is untouched', (await logOf(rained.gameId)).length, rained.lastSeq);
}

// =============================================================================
console.log('\n--- not out from under a scorer --------------------------------');
// =============================================================================
{
  refused('saying nothing about what you saw is refused',
    await scorer.client.rpc('abandon_live_game', { p_game_id: rained.gameId, p_seen_seq: null }), 'say which play');
  refused('a game that moved on since you looked is refused, by name',
    await commissioner.client.rpc('abandon_live_game', { p_game_id: rained.gameId, p_seen_seq: rained.lastSeq - 2 }),
    '2 play(s) have been entered since you looked');
  eq('and it is still live', (await statusOf(rained.gameId)).status, 'live');
  eq('with nothing added to its log', (await logOf(rained.gameId)).length, rained.lastSeq);
}

// =============================================================================
console.log('\n--- abandoned: kept, and counting for nothing --------------------');
// =============================================================================
{
  const before = await logOf(rained.gameId);
  const done = await commissioner.client.rpc('abandon_live_game', { p_game_id: rained.gameId, p_seen_seq: rained.lastSeq });
  eq('the commissioner abandons it', done.error, null);

  const after = await logOf(rained.gameId);
  eq('it is the cancelled tombstone', (await statusOf(rained.gameId)).status, 'cancelled');
  eq('every play entered is still in the log', after.slice(0, before.length), before);
  eq('with one event on the end', after.length, before.length + 1);
  const last = after[after.length - 1];
  eq('a cancel, saying it was abandoned and what was seen', [last.kind, last.payload], ['cancel', { reason: 'abandoned', seenSeq: rained.lastSeq }]);
  eq('recorded as the commissioner', last.actor, commissioner.id);
  eq('in the next place in the log', Number(last.seq), rained.lastSeq + 1);

  eq('asking again succeeds quietly',
    (await scorer.client.rpc('abandon_live_game', { p_game_id: rained.gameId, p_seen_seq: 0 })).error, null);
  eq('and adds nothing', (await logOf(rained.gameId)).length, after.length);

  refused('a play arriving afterwards is refused',
    await scorer.client.rpc('append_game_event', {
      p_game_id: rained.gameId, p_client_event_id: `rain-late-${stamp}`, p_kind: 'outcome', p_payload: outcome('HR'),
    }), 'already cancelled');
  refused('and nobody can finalise it',
    await scorer.client.rpc('save_game', {
      p_team_id: roversId,
      payload: {
        id: rained.clientId, date: '2026-09-20', label: 'Sep 20', opponentId: 'wanderers-slug', opponent: 'Wanderers',
        opponentTeamId: wanderersId, home: true, score: { us: 3, them: 0 }, result: 'W', sport: 'kickball', innings: 7,
        lines: [{ pid: 'h0', name: 'Someone', team: 'home', ab: 3, h: 3, r: 3, rbi: 3, bb: 0, k: 0, d: 0, t: 0, hr: 0 }],
      },
    }), 'it was cancelled');
}

// Is it in anybody's season, or the table? Read the way the app reads — as the
// people themselves, through row-level security.
{
  for (const [who, teamId, tag] of [[rovers, roversId, 'home'], [wanderers, wanderersId, 'away']]) {
    const { data: team } = await who.client.from('teams').select('*').eq('id', teamId).single();
    const { data: games } = await who.client.from('games').select('*').or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`);
    eq(`the ${tag} team can still see the abandoned row`, (games || []).some((g) => g.id === rained.gameId), true);
    const season = rowsToSeason({ team, games: games || [], gameLines: [] });
    eq(`but it is not in the ${tag} team's history`, season.history.some((g) => g.id === rained.clientId), false);
  }
  const { data: teams } = await follower.client.from('teams').select('*').eq('league_id', leagueId);
  const { data: games } = await follower.client.from('games').select('*').eq('league_id', leagueId);
  const table = leagueStandings(teams || [], games || []);
  eq('nor in the league table, for either team', table.map((r) => r.gp), [0, 0]);
  eq('the follower can read its log, as any league game', (await follower.client.from('game_events').select('id').eq('game_id', rained.gameId)).data.length, rained.lastSeq + 1);
}

// =============================================================================
console.log('\n--- the scorers of either team can abandon; nothing else can be --');
// =============================================================================
{
  const byAway = await liveFixture('away', 2);
  eq('the OTHER team\'s manager can abandon a game they are in',
    (await wanderers.client.rpc('abandon_live_game', { p_game_id: byAway.gameId, p_seen_seq: byAway.lastSeq })).error, null);

  const byScorer = await liveFixture('scorer', 1);
  eq('and so can a scorer', (await scorer.client.rpc('abandon_live_game', { p_game_id: byScorer.gameId, p_seen_seq: byScorer.lastSeq })).error, null);

  const planned = await commissioner.client.rpc('schedule_game', {
    p_league_id: leagueId,
    payload: { clientId: `fx-planned-${stamp}`, homeTeamId: roversId, awayTeamId: wanderersId, scheduledAt: '2026-10-01T18:00:00Z', label: 'Oct 1' },
  });
  refused('a fixture nobody has started cannot be abandoned',
    await commissioner.client.rpc('abandon_live_game', { p_game_id: planned.data, p_seen_seq: 0 }), 'has not been started');
  refused('nor a game that does not exist',
    await commissioner.client.rpc('abandon_live_game', { p_game_id: '00000000-0000-0000-0000-000000000000', p_seen_seq: 0 }));

  // A finished game.
  const played = await liveFixture('played', 1);
  const saved = await scorer.client.rpc('save_game', {
    p_team_id: roversId,
    payload: {
      id: played.clientId, date: '2026-09-20', label: 'Sep 20', opponentId: 'wanderers-slug', opponent: 'Wanderers',
      opponentTeamId: wanderersId, home: true, score: { us: 1, them: 0 }, result: 'W', sport: 'kickball', innings: 7,
      lines: [{ pid: 'h0', name: 'Someone', team: 'home', ab: 1, h: 1, r: 1, rbi: 0, bb: 0, k: 0, d: 0, t: 0, hr: 0 }],
    },
  });
  need('a finished game to try', !saved.error, saved.error && saved.error.message);
  refused('a finished game cannot be abandoned',
    await commissioner.client.rpc('abandon_live_game', { p_game_id: played.gameId, p_seen_seq: 99 }), 'already been finalised');
  eq('and it is still a result', (await statusOf(played.gameId)).status, 'final');
}

// =============================================================================
console.log('\n--- back on the schedule, as a new fixture -----------------------');
// =============================================================================

const fixture = (tag) => ({ clientId: `fx-again-${tag}-${stamp}`, scheduledAt: '2026-09-27T18:00:00Z', label: 'Sep 27' });

{
  const args = { p_game_id: rained.gameId, payload: fixture('rain') };
  refused('somebody signed out cannot reschedule', await anon.rpc('reschedule_called_off_game', args));
  refused('a team manager cannot reschedule a league fixture', await rovers.client.rpc('reschedule_called_off_game', args), 'only a league admin');
  refused('nor can a scorer', await scorer.client.rpc('reschedule_called_off_game', args), 'only a league admin');
  refused('nor the commissioner of another league', await otherAdmin.client.rpc('reschedule_called_off_game', args), 'only a league admin');
  refused('a fixture with no new id is refused',
    await commissioner.client.rpc('reschedule_called_off_game', { p_game_id: rained.gameId, payload: {} }), 'no id');

  const live = await liveFixture('stillLive', 1);
  refused('a game still being played cannot be put back on the schedule',
    await commissioner.client.rpc('reschedule_called_off_game', { p_game_id: live.gameId, payload: fixture('live') }), 'not called off');

  eq('none of that made a fixture',
    (await admin.from('games').select('id').eq('client_id', fixture('rain').clientId)).data.length, 0);
}

{
  const again = await commissioner.client.rpc('reschedule_called_off_game', { p_game_id: rained.gameId, payload: fixture('rain') });
  eq('the commissioner puts the abandoned fixture back on the schedule', again.error, null);
  const newId = again.data;

  const { data: row } = await admin.from('games').select('*').eq('id', newId).single();
  eq('as a new row', newId !== rained.gameId, true);
  eq('scheduled, between the same teams, in the same league',
    [row.status, row.home_team_id, row.away_team_id, row.league_id], ['scheduled', roversId, wanderersId, leagueId]);
  eq('on the new date, under its own id', [row.scheduled_at.slice(0, 10), row.client_id], ['2026-09-27', fixture('rain').clientId]);
  eq('with no log of its own', (await logOf(newId)).length, 0);

  const old = await statusOf(rained.gameId);
  eq('the old game is still the tombstone', old.status, 'cancelled');
  eq('and says what replaced it', old.replaced_by, newId);
  eq('with its whole log', (await logOf(rained.gameId)).length, rained.lastSeq + 1);

  const retry = await commissioner.client.rpc('reschedule_called_off_game', { p_game_id: rained.gameId, payload: fixture('rain-retry') });
  eq('asking twice lands on the same fixture', retry.data, newId);
  eq('rather than making another', (await admin.from('games').select('id').eq('client_id', fixture('rain-retry').clientId)).data.length, 0);

  // The whole point. Score the replacement, and have the phone from the
  // abandoned game come back with a play it never sent.
  const restarted = await scorer.client.rpc('start_live_game', {
    p_team_id: roversId,
    payload: { clientId: fixture('rain').clientId, opponentId: 'wanderers-slug', opponent: 'Wanderers', opponentTeamId: wanderersId, sport: 'kickball', home: true },
  });
  eq('the replacement can be scored', [restarted.error, restarted.data], [null, newId]);
  refused('a play from the abandoned game is still refused while the replacement is live',
    await scorer.client.rpc('append_game_event', {
      p_game_id: rained.gameId, p_client_event_id: `rain-very-late-${stamp}`, p_kind: 'outcome', p_payload: outcome('HR'),
    }), 'already cancelled');
  eq('and the replacement\'s log did not get it', (await logOf(newId)).length, 0);
}

{
  // A fixture started and abandoned before a single play.
  const empty = await liveFixture('empty', 0);
  eq('a fixture with no plays is abandoned the same way',
    (await commissioner.client.rpc('abandon_live_game', { p_game_id: empty.gameId, p_seen_seq: empty.lastSeq })).error, null);
  const back = await commissioner.client.rpc('reschedule_called_off_game', { p_game_id: empty.gameId, payload: fixture('empty') });
  eq('and put back on the schedule the same way', back.error, null);
  eq('as a scheduled fixture', ((await statusOf(back.data)).status), 'scheduled');

  // A cancelled fixture whose team has since left the league.
  const left = await liveFixture('left', 1);
  await commissioner.client.rpc('abandon_live_game', { p_game_id: left.gameId, p_seen_seq: left.lastSeq });
  await admin.from('teams').update({ league_id: null }).eq('id', wanderersId);
  refused('a fixture against a team that has left the league cannot be put back',
    await commissioner.client.rpc('reschedule_called_off_game', { p_game_id: left.gameId, payload: fixture('left') }), 'not in this league');
  await admin.from('teams').update({ league_id: leagueId }).eq('id', wanderersId);

  // A friendly has no league to go back into.
  const friendly = await rovers.client.rpc('start_live_game', {
    p_team_id: roversId, payload: { clientId: `friendly-${stamp}`, opponentId: 'pickup', opponent: 'Pickup', sport: 'kickball', home: true },
  });
  await rovers.client.rpc('cancel_live_game', { p_game_id: friendly.data });
  refused('a friendly cannot be put on a league schedule',
    await commissioner.client.rpc('reschedule_called_off_game', { p_game_id: friendly.data, payload: fixture('friendly') }), 'no such league game');
}

// =============================================================================
console.log('\n--- called off, put back, played: counted once, and only the replacement --');
// =============================================================================
//
// The whole life of a fixture that did not go to plan, read the ways the app
// reads it. A fixture is scored for four plays and abandoned; a box-score line
// is attached to the tombstone anyway (the INSERT policy on game_lines admits any
// scorer of a game, whatever its status — so this can happen); it is put back on
// the schedule; the replacement is played and finalised. Then, before and after
// that final:
//
//   * league-wide, through createLeagues().detail() — the league screen's own
//     read — as a follower: the table, the leaders, and which list each row is in;
//   * per team, through fetchSeason's own queries as the team's manager, folded by
//     rowsToSeason: the history, the season standings, a player's season line.
//
// The answer must be one game, the replacement, and nothing from the tombstone.
{
  const off = await liveFixture('counted', 4);
  eq('the fixture that went wrong is abandoned',
    (await commissioner.client.rpc('abandon_live_game', { p_game_id: off.gameId, p_seen_seq: off.lastSeq })).error, null);

  const stray = await scorer.client.from('game_lines').insert({
    game_id: off.gameId, team_id: roversId, name_snapshot: 'Stray Line', home_away: 'home',
    ab: 4, h: 4, r: 4, rbi: 4, bb: 0, k: 0, d: 0, t: 0, hr: 4, client_pid: 'h0',
  });
  eq('a box-score line can still be attached to the tombstone by a scorer', stray.error, null);

  const again = fixture('counted');
  const put = await commissioner.client.rpc('reschedule_called_off_game', { p_game_id: off.gameId, payload: again });
  eq('and it is put back on the schedule', put.error, null);
  const replacementId = put.data;

  /** Everything the league screen and each team's season would show, right now. */
  const look = async () => {
    const detail = await createLeagues(follower.client).detail(leagueId);
    need('the league read as a follower', !detail.error, detail.error && detail.error.message);
    const lists = bucketLeagueGames(detail.games);
    const table = Object.fromEntries(leagueStandings(detail.teams, detail.games).map((r) => [r.id, r]));
    const leaders = leagueLeaders(detail.lines, detail.teams, { stat: 'h', limit: 50 });

    const season = async (who, teamId) => {
      const [team, players, games] = await Promise.all([
        who.client.from('teams').select('*').eq('id', teamId).maybeSingle(),
        who.client.from('players').select('*').eq('team_id', teamId).order('sort_order'),
        who.client.from('games').select('*').or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`),
      ]);
      const ids = (games.data || []).map((g) => g.id);
      const lines = ids.length ? (await who.client.from('game_lines').select('*').in('game_id', ids)).data || [] : [];
      const s = rowsToSeason({ team: team.data, players: players.data || [], games: games.data || [], gameLines: lines });
      const me = tallyStandings({ ...s, teams: s.teams || [] }).find((r) => r.you);
      return { history: s.history, record: [me.w, me.l, me.t], h0: seasonTotals(s.history, 'h0'), linesRead: lines.length };
    };
    return { lists, table, leaders, home: await season(rovers, roversId), away: await season(wanderers, wanderersId) };
  };

  const before = await look();
  eq('before the replacement is played, the tombstone is in no list everyone reads',
    [...before.lists.fixtures, ...before.lists.inProgress, ...before.lists.stopped, ...before.lists.played].some((g) => g.id === off.gameId), false);
  eq('and not called off either, now it has been put back', before.lists.calledOff.some((g) => g.id === off.gameId), false);
  eq('its replacement is on the schedule, once', before.lists.fixtures.filter((g) => g.id === replacementId).length, 1);
  eq('the stray line was read with the season — it is there to be ignored', before.home.linesRead > 0, true);
  eq('and the tombstone is in neither team\'s history', [before.home, before.away].map((t) => t.history.some((h) => h.id === off.clientId)), [false, false]);
  eq('nor its stray line in the league leaders', before.leaders.some((p) => p.name === 'Stray Line'), false);

  // Play the replacement, from the start, and finalise it.
  const started = await scorer.client.rpc('start_live_game', {
    p_team_id: roversId,
    payload: { clientId: again.clientId, opponentId: 'wanderers-slug', opponent: 'Wanderers', opponentTeamId: wanderersId, sport: 'kickball', home: true },
  });
  eq('the replacement starts', [started.error, started.data], [null, replacementId]);
  await scorer.client.rpc('append_game_event', {
    p_game_id: replacementId, p_client_event_id: `counted-again-0-${stamp}`, p_kind: 'start',
    p_payload: { gameClientId: again.clientId, teamId: roversId, sport: 'kickball', lineup: [], bench: [] },
  });
  const saved = await scorer.client.rpc('save_game', {
    p_team_id: roversId,
    payload: {
      id: again.clientId, date: '2026-09-27', label: 'Sep 27', opponentId: 'wanderers-slug', opponent: 'Wanderers',
      opponentTeamId: wanderersId, home: true, score: { us: 5, them: 2 }, result: 'W', sport: 'kickball', innings: 7,
      lines: [{ pid: 'h0', name: 'Casey Rivera', team: 'home', ab: 3, h: 2, r: 1, rbi: 2, bb: 0, k: 0, d: 0, t: 0, hr: 0 }],
    },
  });
  eq('and is finalised, into its own row', [saved.error, saved.data], [null, replacementId]);

  const after = await look();

  // League-wide.
  eq('league: the replacement is played, once', after.lists.played.filter((g) => g.id === replacementId).length, 1);
  eq('league: the tombstone is still not played', after.lists.played.some((g) => g.id === off.gameId), false);
  eq('league table: exactly one more scored game for each team',
    [after.table[roversId].tracked - before.table[roversId].tracked, after.table[wanderersId].tracked - before.table[wanderersId].tracked], [1, 1]);
  eq('league table: a win for one and a loss for the other, once',
    [after.table[roversId].w - before.table[roversId].w, after.table[wanderersId].l - before.table[wanderersId].l], [1, 1]);
  eq('league leaders: the replacement\'s line counts', after.leaders.some((p) => p.name === 'Casey Rivera' && p.h === 2), true);
  eq('league leaders: the tombstone\'s never does', after.leaders.some((p) => p.name === 'Stray Line'), false);

  // Per team.
  for (const [tag, b, a] of [['home', before.home, after.home], ['away', before.away, after.away]]) {
    eq(`${tag} team's season: the replacement is in the history once`, a.history.filter((h) => h.id === again.clientId).length, 1);
    eq(`${tag} team's season: the tombstone still is not`, a.history.some((h) => h.id === off.clientId), false);
    eq(`${tag} team's season: one more game in total, not two`, a.history.length - b.history.length, 1);
  }
  eq('home season standings: one more win, nothing else moved',
    after.home.record.map((n, i) => n - before.home.record[i]), [1, 0, 0]);
  eq('away season standings: one more loss, nothing else moved',
    after.away.record.map((n, i) => n - before.away.record[i]), [0, 1, 0]);
  eq('a player\'s season line: one game and the replacement\'s two hits — not the tombstone\'s four',
    [after.home.h0.gp - before.home.h0.gp, after.home.h0.h - before.home.h0.h, after.home.h0.hr - before.home.h0.hr], [1, 2, 0]);

  // Differences cannot see a tombstone counted the same way before and after.
  // So, in absolute terms, against what the database itself says was played —
  // worked out with the service key, independently of every read above.
  const finals = (await admin.from('games').select('id, home_team_id, away_team_id')
    .eq('league_id', leagueId).eq('status', 'final')).data || [];
  const playedBy = (id) => finals.filter((g) => g.home_team_id === id || g.away_team_id === id);
  const finalLines = (await admin.from('game_lines').select('client_pid, ab, bb, h, hr, team_id')
    .in('game_id', finals.map((g) => g.id))).data || [];
  const h0 = finalLines.filter((l) => l.client_pid === 'h0' && l.team_id === roversId);

  eq('league table, absolutely: each team\'s scored games are exactly its final games',
    [after.table[roversId].tracked, after.table[wanderersId].tracked], [playedBy(roversId).length, playedBy(wanderersId).length]);
  eq('home season, absolutely: its history is exactly its final games',
    after.home.history.length, playedBy(roversId).length);
  eq('away season, absolutely: its history is exactly its final games',
    after.away.history.length, playedBy(wanderersId).length);
  eq('a player\'s season line, absolutely: exactly the hits in final games\' box scores',
    [after.home.h0.h, after.home.h0.hr], [h0.reduce((n, l) => n + l.h, 0), h0.reduce((n, l) => n + l.hr, 0)]);
}

// =============================================================================
console.log('\n--- known, and not new: the scorers\' direct UPDATE on games ------');
// =============================================================================
//
// games_update_scorer has always let a scorer of either team write any column
// of a game directly — status and score included. replaced_by is one more such
// column. This records what that means for it rather than pretending it is
// closed: a scorer can mark a called-off fixture as dealt with, which hides it
// from the commissioner's list. They could already do worse to the same row.
{
  const hidden = await liveFixture('hidden', 1);
  await scorer.client.rpc('abandon_live_game', { p_game_id: hidden.gameId, p_seen_seq: hidden.lastSeq });
  const poke = await scorer.client.from('games').update({ replaced_by: rained.gameId }).eq('id', hidden.gameId).select('id');
  eq('a scorer\'s direct update of replaced_by is accepted, as every other column is', (poke.data || []).length, 1);
  const stranger = await outsider.client.from('games').update({ replaced_by: null }).eq('id', hidden.gameId).select('id');
  eq('a stranger\'s is not', (stranger.data || []).length, 0);
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
