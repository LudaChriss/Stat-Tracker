// The league table and the league leaders.
//
// A deliberate sibling of the season's standings rather than a rewrite, and the
// point of this suite is that the two AGREE where they overlap. A league table
// and a season table that disagree about the same team's record is worse than
// either being wrong on its own: one of them is on screen and the other is in
// somebody's head.
//
// Pure. The rows are the shapes the database returns; there is no database
// here. The round trip from real rows is exercised by league-tables-db-check
// territory in leagues-check.mjs and by the browser harness.

import { leagueLeaders, leagueStandings, winPct } from '../src/game/leagueTables.js';
import { tallyStandings, winPct as seasonWinPct } from '../src/game/standings.js';

let fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    fail++;
    console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  } else console.log('ok   ' + label);
};
const is = (label, cond, detail) => {
  if (cond) console.log('ok   ' + label);
  else {
    fail++;
    console.log(`FAIL ${label}${detail ? '\n  ' + detail : ''}`);
  }
};

const team = (id, name, over = {}) => ({ id, name, prior_w: 0, prior_l: 0, prior_t: 0, ...over });
const game = (home, away, hs, as, result, over = {}) => ({
  id: `g-${home}-${away}-${hs}-${as}`,
  home_team_id: home,
  away_team_id: away,
  home_score: hs,
  away_score: as,
  result,
  status: 'final',
  ...over,
});

const TEAMS = [team('a', 'Anchors'), team('b', 'Bakers'), team('c', 'Cutters')];

// ---------------------------------------------------------------------------
// Only played games count
// ---------------------------------------------------------------------------
{
  const rows = leagueStandings(TEAMS, [
    game('a', 'b', 5, 2, 'W'),
    game('b', 'c', 1, 1, 'T'),
    game('c', 'a', 0, 4, 'L'),
    // Neither of these has been played.
    game('a', 'c', 0, 0, null, { status: 'scheduled' }),
    game('b', 'a', 0, 0, null, { status: 'cancelled' }),
  ]);

  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  eq('a win at home and a win away', [byName.Anchors.w, byName.Anchors.l, byName.Anchors.t], [2, 0, 0]);
  eq('a loss and a tie', [byName.Bakers.w, byName.Bakers.l, byName.Bakers.t], [0, 1, 1]);
  eq('a tie and a loss', [byName.Cutters.w, byName.Cutters.l, byName.Cutters.t], [0, 1, 1]);
  eq('a scheduled game is not a 0-0 result', byName.Anchors.gp, 2);
  eq('and neither is a cancelled one', byName.Bakers.gp, 2);
  eq('the table is sorted by winning percentage', rows.map((r) => r.name), ['Anchors', 'Bakers', 'Cutters']);
  eq('runs for and against are tallied from both dugouts', [byName.Anchors.rf, byName.Anchors.ra], [9, 2]);
  eq('and the difference with them', byName.Anchors.diff, 7);
}

// ---------------------------------------------------------------------------
// A result is read from the home team's point of view, in both directions
// ---------------------------------------------------------------------------
{
  const rows = leagueStandings(TEAMS, [game('a', 'b', 2, 7, 'L')]);
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  eq('the home team lost', [byName.Anchors.w, byName.Anchors.l], [0, 1]);
  eq('so the away team won', [byName.Bakers.w, byName.Bakers.l], [1, 0]);
  eq('and the away team\'s runs are the away score', [byName.Bakers.rf, byName.Bakers.ra], [7, 2]);
}

// ---------------------------------------------------------------------------
// Manually entered records are added, not replaced
// ---------------------------------------------------------------------------
{
  const rows = leagueStandings(
    [team('a', 'Anchors', { prior_w: 3, prior_l: 1, prior_t: 1 }), team('b', 'Bakers')],
    [game('a', 'b', 5, 2, 'W')],
  );
  const anchors = rows.find((r) => r.name === 'Anchors');
  eq('a prior record is the starting point', [anchors.w, anchors.l, anchors.t], [4, 1, 1]);
  eq('games played counts both', anchors.gp, 6);
  eq('but only one of them was tracked', anchors.tracked, 1);
}

// ---------------------------------------------------------------------------
// A team that has left still counts for the one that is still here
// ---------------------------------------------------------------------------
{
  const rows = leagueStandings([team('a', 'Anchors')], [game('a', 'gone', 6, 1, 'W')]);
  eq('the remaining team keeps the win', [rows[0].w, rows[0].gp], [1, 1]);
  eq('and there is nobody to credit on the other side', rows.length, 1);
}

// ---------------------------------------------------------------------------
// A tie counts as half a win — the SAME rule the season table uses
// ---------------------------------------------------------------------------
{
  eq('a tie is half a win', winPct({ w: 1, l: 0, t: 1, gp: 2 }), 0.75);
  eq('no games played is not a division by zero', winPct({ w: 0, l: 0, t: 0, gp: 0 }), 0);

  // The two modules must not drift. Same row, same answer.
  const row = { w: 3, l: 2, t: 2, gp: 7 };
  eq('the league and the season agree on what a percentage is', winPct(row), seasonWinPct(row));
}

// ---------------------------------------------------------------------------
// AND THE ONE THAT MATTERS: a team's league record agrees with its own season
// ---------------------------------------------------------------------------
//
// The same three games, told twice — once as the league sees them and once as
// the team's own season does. If these ever disagree, one of the two tables on
// a person's phone is lying about the same team.
{
  const leagueRows = leagueStandings(TEAMS, [
    game('a', 'b', 5, 2, 'W'),   // Anchors beat Bakers at home
    game('c', 'a', 1, 4, 'L'),   // Anchors beat Cutters away
    game('a', 'c', 3, 3, 'T'),   // Anchors tied Cutters at home
  ]);
  const fromLeague = leagueRows.find((r) => r.name === 'Anchors');

  // The same three games as the Anchors' own season: results are recorded from
  // OUR point of view there, so the away win is still a W.
  const season = {
    myTeam: { name: 'Anchors', priorW: 0, priorL: 0, priorT: 0 },
    teams: [{ id: 'b', name: 'Bakers' }, { id: 'c', name: 'Cutters' }],
    history: [
      { opponentId: 'b', result: 'W' },
      { opponentId: 'c', result: 'W' },
      { opponentId: 'c', result: 'T' },
    ],
  };
  const fromSeason = tallyStandings(season).find((r) => r.you);

  eq('the league table and the team\'s own season agree, W-L-T',
    [fromLeague.w, fromLeague.l, fromLeague.t], [fromSeason.w, fromSeason.l, fromSeason.t]);
  eq('and on games played', fromLeague.gp, fromSeason.gp);
  eq('and on the percentage', winPct(fromLeague), seasonWinPct(fromSeason));
}

// ---------------------------------------------------------------------------
// Leaders
// ---------------------------------------------------------------------------
const line = (over) => ({
  game_id: 'g1', team_id: 'a', player_id: null, name_snapshot: 'Someone',
  ab: 0, h: 0, r: 0, rbi: 0, bb: 0, k: 0, d: 0, t: 0, hr: 0, ...over,
});

{
  const lines = [
    line({ player_id: 'p1', name_snapshot: 'Maya Ortiz', r: 2, h: 3, ab: 4 }),
    line({ player_id: 'p1', name_snapshot: 'Maya Ortiz', r: 1, h: 1, ab: 3, game_id: 'g2' }),
    line({ player_id: 'p2', name_snapshot: 'Deon Wallace', team_id: 'b', r: 2, h: 2, ab: 4, hr: 1 }),
    line({ player_id: 'p3', name_snapshot: 'Priya Shah', team_id: 'b', r: 0, h: 0, ab: 2 }),
  ];

  const runs = leagueLeaders(lines, TEAMS, { stat: 'r' });
  eq('totals are added across games', runs[0].r, 3);
  eq('the leader is the leader', runs[0].name, 'Maya Ortiz');
  eq('with the team beside them', runs[0].team, 'Anchors');
  eq('and games counted', runs[0].games, 2);
  eq('nobody with none of that stat is listed', runs.map((r) => r.name), ['Maya Ortiz', 'Deon Wallace']);

  eq('a different stat is a different table', leagueLeaders(lines, TEAMS, { stat: 'hr' })[0].name, 'Deon Wallace');
  eq('and the limit is honoured', leagueLeaders(lines, TEAMS, { stat: 'h', limit: 1 }).length, 1);
  eq('a stat that is not one is refused rather than guessed', leagueLeaders(lines, TEAMS, { stat: 'wins' }), []);
}

// TWO PEOPLE WITH THE SAME NAME are two people. The scorebook keys every stat
// line by a pid precisely so this cannot happen; the league table must not
// undo it.
{
  const lines = [
    line({ player_id: 'p1', name_snapshot: 'Alex Kim', r: 3 }),
    line({ player_id: 'p9', name_snapshot: 'Alex Kim', team_id: 'b', r: 2 }),
  ];
  const runs = leagueLeaders(lines, TEAMS, { stat: 'r' });
  eq('two players sharing a name are not merged', runs.length, 2);
  eq('each keeps their own total', runs.map((r) => r.r), [3, 2]);
  eq('and their own team', runs.map((r) => r.team), ['Anchors', 'Bakers']);
}

// An opponent scored with no roster has no player row at all — only a name.
// Those still have to total up, and still must not merge across teams.
{
  const lines = [
    line({ player_id: null, name_snapshot: 'Batter 3', team_id: 'b', r: 1 }),
    line({ player_id: null, name_snapshot: 'Batter 3', team_id: 'b', r: 2, game_id: 'g2' }),
    line({ player_id: null, name_snapshot: 'Batter 3', team_id: 'c', r: 4 }),
  ];
  const runs = leagueLeaders(lines, TEAMS, { stat: 'r' });
  eq('an unrostered player still totals up', runs.length, 2);
  eq('within their own team', runs.map((r) => [r.team, r.r]), [['Cutters', 4], ['Bakers', 3]]);
}

// Nothing at all is not a crash.
{
  eq('no teams, no table', leagueStandings([], []), []);
  eq('no lines, no leaders', leagueLeaders([], []), []);
  is('and nulls are survivable', leagueStandings(null, null).length === 0 && leagueLeaders(null, null).length === 0);
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
