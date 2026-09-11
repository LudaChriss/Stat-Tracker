// League-wide standings and leaders, computed from rows rather than from a
// season.
//
// A deliberate sibling of standings.js rather than a rewrite of it, because the
// two answer different questions from different inputs:
//
//   standings.js  "how is MY season going" — from one team's history, where the
//                 opposition's record is their prior plus whatever they did
//                 against us, because we never see them play each other.
//
//   this module   "how is the LEAGUE going" — from every final game in it,
//                 where every team's record is complete because every game is
//                 visible.
//
// The rules they share are shared on purpose and stated once here: a tie counts
// as half a win, and a team's manually-entered prior record is added to what
// the app has actually tracked. Changing either would make the league table
// disagree with the season table on the same team, which is worse than either
// being wrong on its own.

/** Winning percentage, counting a tie as half a win. The same rule as a season. */
export const winPct = (r) => (r.gp ? (r.w + r.t / 2) / r.gp : 0);

/**
 * The league table.
 *
 * @param {Array} teams  `teams` rows in the league, with prior_w/l/t
 * @param {Array} games  `games` rows in the league; anything not final is ignored
 * @returns rows sorted by winning percentage, then by wins, then by name
 *
 * Only FINAL games count. A fixture is a plan and a cancelled game is a
 * tombstone; folding either into a table would put a 0-0 result against two
 * teams who have not played.
 *
 * A game's `result` is recorded from the HOME team's point of view, which is
 * what makes it absolute — the same row read from either dugout gives the same
 * answer.
 */
export function leagueStandings(teams, games) {
  const rows = (teams || []).map((t) => ({
    id: t.id,
    name: t.name,
    w: t.prior_w || 0,
    l: t.prior_l || 0,
    t: t.prior_t || 0,
    tracked: 0,
    rf: 0,
    ra: 0,
  }));
  const byId = new Map(rows.map((r) => [r.id, r]));

  for (const g of games || []) {
    if (g.status !== 'final') continue;
    const home = byId.get(g.home_team_id);
    const away = byId.get(g.away_team_id);

    // A game against a team that has since left the league still counts for
    // the team that is still here. There is simply nobody to credit on the
    // other side, which is the same rule a season already follows.
    if (home) {
      home.tracked += 1;
      home.rf += g.home_score || 0;
      home.ra += g.away_score || 0;
    }
    if (away) {
      away.tracked += 1;
      away.rf += g.away_score || 0;
      away.ra += g.home_score || 0;
    }

    if (g.result === 'W') {
      if (home) home.w += 1;
      if (away) away.l += 1;
    } else if (g.result === 'L') {
      if (home) home.l += 1;
      if (away) away.w += 1;
    } else {
      // No result recorded is treated as a tie rather than dropped: the game
      // was played and both teams turned up. A genuine 0-0 tie carries 'T'.
      if (home) home.t += 1;
      if (away) away.t += 1;
    }
  }

  return rows
    .map((r) => ({ ...r, gp: r.w + r.l + r.t, diff: r.rf - r.ra }))
    .sort((a, b) => winPct(b) - winPct(a) || b.w - a.w || a.name.localeCompare(b.name));
}

const STAT_KEYS = ['ab', 'h', 'r', 'rbi', 'bb', 'k', 'd', 't', 'hr'];

/**
 * Who is leading the league, in one stat.
 *
 * @param {Array} lines  `game_lines` rows for the league's final games
 * @param {Array} teams  `teams` rows, for the name beside each player
 * @param {object} opts  { stat, limit }
 *
 * Totals are keyed on the PLAYER ROW where there is one, and on the team plus
 * the name snapshot where there is not. That second case is not an edge: an
 * opposing team scored without a roster has no player rows at all, and their
 * lines carry only a name. Keying everything on the name alone would merge two
 * different people who happen to share one, which is the exact mistake the
 * scorebook's pids exist to prevent.
 */
export function leagueLeaders(lines, teams, { stat = 'r', limit = 5 } = {}) {
  if (!STAT_KEYS.includes(stat)) return [];
  const teamName = new Map((teams || []).map((t) => [t.id, t.name]));
  const totals = new Map();

  for (const l of lines || []) {
    const key = l.player_id ? `p:${l.player_id}` : `n:${l.team_id || '?'}:${l.name_snapshot}`;
    let row = totals.get(key);
    if (!row) {
      row = {
        key,
        name: l.name_snapshot,
        team: teamName.get(l.team_id) || null,
        games: 0,
      };
      for (const k of STAT_KEYS) row[k] = 0;
      totals.set(key, row);
    }
    row.games += 1;
    for (const k of STAT_KEYS) row[k] += l[k] || 0;
  }

  return [...totals.values()]
    .filter((r) => r[stat] > 0)
    .sort((a, b) => b[stat] - a[stat] || b.h - a.h || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** "12" for a counting stat. Kept here so the screen never formats one itself. */
export const statLabel = {
  r: 'Runs',
  rbi: 'RBI',
  h: 'Hits',
  hr: 'Home runs',
  bb: 'Walks',
};
