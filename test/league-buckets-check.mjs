// Which list a league game is shown in, and who a game in progress is with.
//
// Pins a regression 4e introduced: "Score this game" flips a fixture from
// `scheduled` to `live`, and the league screen only had lists for `scheduled`
// and `final` — so the game vanished from the league until it was finished, and
// a phone not on either team could not see it was being played at all.
//
// Pure. The rows are the shapes the database returns. That a real fixture lands
// in "In progress" on a real screen is checked in browser-leagues.mjs.

import { bucketLeagueGames, scorerLine, scorersByGame } from '../src/data/leagues.js';

let fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    fail++;
    console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  } else console.log('ok   ' + label);
};

const g = (id, status) => ({ id, status, home_team_id: 'a', away_team_id: 'b' });
const ids = (rows) => rows.map((r) => r.id);

// ---------------------------------------------------------------------------
// Every game has one home, and a cancelled game has none
// ---------------------------------------------------------------------------
{
  const games = [
    g('plan-1', 'scheduled'),
    g('now-1', 'live'),
    g('done-1', 'final'),
    g('gone-1', 'cancelled'),
    g('plan-2', 'scheduled'),
    g('now-2', 'live'),
  ];
  const b = bucketLeagueGames(games);

  eq('scheduled games are on the schedule', ids(b.fixtures), ['plan-1', 'plan-2']);
  eq('live games are in progress — the ones that used to vanish', ids(b.inProgress), ['now-1', 'now-2']);
  eq('final games are played', ids(b.played), ['done-1']);

  const shown = [...b.fixtures, ...b.inProgress, ...b.played];
  eq('a cancelled game is in none of the three', shown.some((x) => x.status === 'cancelled'), false);
  eq('every other game is in exactly one',
    shown.length, games.filter((x) => x.status !== 'cancelled').length);
  eq('and none is in two', new Set(ids(shown)).size, shown.length);
  eq('the order the database gave is kept within a list', ids(bucketLeagueGames([...games].reverse()).fixtures), ['plan-2', 'plan-1']);
}

{
  // The exact regression: one fixture, before and after somebody taps
  // "Score this game".
  const before = bucketLeagueGames([g('fx', 'scheduled')]);
  const during = bucketLeagueGames([g('fx', 'live')]);
  const after = bucketLeagueGames([g('fx', 'final')]);
  eq('a fixture starts on the schedule', [before.fixtures.length, before.inProgress.length, before.played.length], [1, 0, 0]);
  eq('moves to in progress when scoring starts', [during.fixtures.length, during.inProgress.length, during.played.length], [0, 1, 0]);
  eq('and to played when it is finalised', [after.fixtures.length, after.inProgress.length, after.played.length], [0, 0, 1]);
}

{
  const EMPTY = { fixtures: [], inProgress: [], stopped: [], played: [], calledOff: [] };
  eq('no games, every list empty', bucketLeagueGames([]), EMPTY);
  eq('null is survivable', bucketLeagueGames(null), EMPTY);
  eq('an unknown status is not guessed into a list', bucketLeagueGames([g('odd', 'postponed')]), EMPTY);
}

// ---------------------------------------------------------------------------
// A live game that stopped is not in progress
// ---------------------------------------------------------------------------
{
  const { STALE_AFTER_MS } = await import('../src/game/liveness.js');
  const now = Date.parse('2026-09-20T23:00:00Z');
  const games = [
    { ...g('fresh', 'live'), updated_at: '2026-09-20T18:00:00Z' },
    { ...g('quiet', 'live'), updated_at: '2026-09-20T18:00:00Z' },
    { ...g('edge', 'live'), updated_at: '2026-09-20T18:00:00Z' },
    { ...g('empty-log', 'live'), updated_at: '2026-09-20T18:00:00Z' },
    { ...g('unread', 'live'), updated_at: '2026-09-20T18:00:00Z' },
  ];
  const activity = {
    fresh: { lastSeq: 40, lastEventAt: now - 60 * 1000, plays: 39 },
    quiet: { lastSeq: 12, lastEventAt: now - STALE_AFTER_MS - 60 * 1000, plays: 11 },
    edge: { lastSeq: 5, lastEventAt: now - STALE_AFTER_MS, plays: 4 },
    // Started, and the first append never arrived: measured from the row.
    'empty-log': { lastSeq: 0, lastEventAt: null, plays: 0 },
    // `unread` has no activity at all — its events could not be read.
  };
  const b = bucketLeagueGames(games, { activity, now });
  eq('a game whose log moved a minute ago is in progress, and so is one exactly at the cutoff, and one nobody could read',
    ids(b.inProgress), ['fresh', 'edge', 'unread']);
  eq('one quiet for longer than the cutoff has stopped, and so has one whose first append never came',
    ids(b.stopped), ['quiet', 'empty-log']);
  eq('without a time to judge by, nothing is called stopped',
    [ids(bucketLeagueGames(games, { activity }).stopped), ids(bucketLeagueGames(games).stopped)], [[], []]);
}

// ---------------------------------------------------------------------------
// Called off, until it is back on the schedule
// ---------------------------------------------------------------------------
{
  const b = bucketLeagueGames([
    g('rained-off', 'cancelled'),
    { ...g('put-back', 'cancelled'), replaced_by: 'its-replacement' },
    g('its-replacement', 'scheduled'),
  ]);
  eq('a cancelled fixture nobody has dealt with is called off', ids(b.calledOff), ['rained-off']);
  eq('one already put back is not — its replacement is the fixture', ids(b.fixtures), ['its-replacement']);
  eq('and no cancelled game is in any list everyone reads',
    [...b.fixtures, ...b.inProgress, ...b.stopped, ...b.played].some((x) => x.status === 'cancelled'), false);
}

// ---------------------------------------------------------------------------
// Who has the game
// ---------------------------------------------------------------------------
{
  const rows = [
    // Out of order on purpose: the lowest seq is the start that counts.
    { game_id: 'g1', seq: 9, actor: 'u-late', payload: { teamId: 'b' } },
    { game_id: 'g1', seq: 1, actor: 'u-boss', payload: { teamId: 'a' } },
    { game_id: 'g2', seq: 1, actor: 'u-old', payload: { gameClientId: 'x' } },
  ];
  const s = scorersByGame(rows);
  eq('the first start of a game is the one that says who has it', s.g1, { teamId: 'a', actor: 'u-boss' });
  eq('a start from before teamId was recorded still records the actor', s.g2, { teamId: null, actor: 'u-old' });
  eq('no rows, nobody', scorersByGame([]), {});
  eq('null rows, nobody', scorersByGame(null), {});

  const teams = [{ id: 'a', name: 'Anchors' }, { id: 'b', name: 'Bakers' }];
  eq('the scorer is told it is them', scorerLine(s.g1, { teams, userId: 'u-boss' }), 'You’re scoring this');
  eq('anyone else is told which team', scorerLine(s.g1, { teams, userId: 'u-follower' }), 'Scored by Anchors');
  eq('signed out, still the team', scorerLine(s.g1, { teams, userId: null }), 'Scored by Anchors');
  eq('an old start with no team says only that it is being scored',
    scorerLine(s.g2, { teams, userId: 'u-follower' }), 'Being scored');
  eq('the scorer of an old start is still told it is them', scorerLine(s.g2, { teams, userId: 'u-old' }), 'You’re scoring this');
  eq('a team no longer in the league is not named', scorerLine({ teamId: 'z', actor: 'u' }, { teams }), 'Being scored');
  eq('no start read at all', scorerLine(undefined, { teams, userId: 'u-boss' }), 'Being scored');
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
