// Standings are derived, never stored. Each finalized game is tallied on top
// of the pre-app baseline, so results accumulate across a season instead of
// the most recent game overwriting the one before it.

import { HOME_TEAM, SEASON_BASELINE } from '../data/league.js';

/**
 * Fold the game history into win/loss/tie records.
 *
 * Only our own games are in the history — we never see the opponents play each
 * other — so their records are the baseline plus whatever they did against us.
 */
export function tallyStandings(history) {
  const table = new Map(
    SEASON_BASELINE.map((t) => [t.name, { name: t.name, w: t.w, l: t.l, t: 0 }]),
  );

  const bump = (team, key) => {
    const row = table.get(team);
    if (row) row[key] += 1; // a team outside the league table is ignored
  };

  history.forEach((g) => {
    if (g.result === 'W') {
      bump(HOME_TEAM, 'w');
      bump(g.opponent, 'l');
    } else if (g.result === 'L') {
      bump(HOME_TEAM, 'l');
      bump(g.opponent, 'w');
    } else {
      bump(HOME_TEAM, 't');
      bump(g.opponent, 't');
    }
  });

  return [...table.values()].map((r) => ({ ...r, gp: r.w + r.l + r.t }));
}

/** Winning percentage, counting a tie as half a win. */
export const winPct = (r) => (r.gp ? (r.w + r.t / 2) / r.gp : 0);
