// Standings are derived, never stored. Each finalized game is tallied on top
// of each team's prior record, so results accumulate across a season instead
// of the most recent game overwriting the one before it.

const MY_ID = 'me';

/**
 * Fold the game history into win/loss/tie records for our team and every
 * opposing team.
 *
 * Only our own games are in the history — we never see the opponents play each
 * other — so their records are their prior record plus whatever they did
 * against us. A game whose opponent has since been deleted still counts for
 * us; it simply has nobody to credit on the other side.
 */
export function tallyStandings(s) {
  const rows = [
    {
      id: MY_ID,
      name: s.myTeam.name,
      w: s.myTeam.priorW || 0,
      l: s.myTeam.priorL || 0,
      t: 0,
      you: true,
    },
    ...s.teams.map((team) => ({
      id: team.id,
      name: team.name,
      w: team.priorW || 0,
      l: team.priorL || 0,
      t: 0,
      you: false,
    })),
  ];

  const byId = new Map(rows.map((r) => [r.id, r]));
  const me = byId.get(MY_ID);

  s.history.forEach((g) => {
    const opp = byId.get(g.opponentId);
    if (g.result === 'W') {
      me.w += 1;
      if (opp) opp.l += 1;
    } else if (g.result === 'L') {
      me.l += 1;
      if (opp) opp.w += 1;
    } else {
      me.t += 1;
      if (opp) opp.t += 1;
    }
  });

  return rows.map((r) => ({ ...r, gp: r.w + r.l + r.t }));
}

/** Winning percentage, counting a tie as half a win. */
export const winPct = (r) => (r.gp ? (r.w + r.t / 2) / r.gp : 0);
