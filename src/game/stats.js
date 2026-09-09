// Season aggregation. Nothing here is stored — a player's season line is the
// sum of their per-game lines in the history, recomputed on read. Finishing a
// game therefore updates real season totals with no separate write path.

export const EMPTY_LINE = { ab: 0, h: 0, r: 0, rbi: 0, bb: 0, k: 0, d: 0, t: 0, hr: 0 };

const COUNTING = Object.keys(EMPTY_LINE);

/** Fill in fields a record predates, so old games don't poison a sum with NaN. */
export const normalizeLine = (l) => ({ ...EMPTY_LINE, ...l });

export function addLines(a, b) {
  const out = {};
  COUNTING.forEach((k) => {
    out[k] = (a[k] || 0) + (b[k] || 0);
  });
  return out;
}

/** Singles are whatever's left after the extra-base hits are accounted for. */
export function totalBases(l) {
  const singles = Math.max(0, l.h - l.d - l.t - l.hr);
  return singles + 2 * l.d + 3 * l.t + 4 * l.hr;
}

/**
 * Format a rate the way a scorebook does: leading dot to three places, but
 * spelled out once it reaches 1.000 — SLG and OPS routinely exceed it.
 */
export function fmtRate(v) {
  if (v == null || Number.isNaN(v)) return '—';
  const milli = Math.round(v * 1000);
  return milli >= 1000 ? (milli / 1000).toFixed(3) : `.${milli.toString().padStart(3, '0')}`;
}

export const rateString = (num, den) => fmtRate(den ? num / den : null);

/** Attach the derived rates to a counting-stat total. */
export function withRates(t) {
  const tb = totalBases(t);
  const onBase = t.ab + t.bb;
  const avg = t.ab ? t.h / t.ab : null;
  const obp = onBase ? (t.h + t.bb) / onBase : null;
  const slg = t.ab ? tb / t.ab : null;
  const ops = obp == null && slg == null ? null : (obp ?? 0) + (slg ?? 0);

  return {
    ...t,
    tb,
    avg: fmtRate(avg),
    obp: fmtRate(obp),
    slg: fmtRate(slg),
    ops: fmtRate(ops),
    opsValue: ops ?? 0,
  };
}

/** On-base percentage for a single game line. */
export const obpString = (g) => rateString(g.h + g.bb, g.ab + g.bb);

const lineFor = (game, pid) => game.lines.find((l) => l.pid === pid);

/** One player's season to date. */
export function seasonTotals(history, pid) {
  let total = { ...EMPTY_LINE };
  let gp = 0;

  history.forEach((g) => {
    const l = lineFor(g, pid);
    if (!l) return;
    const line = normalizeLine(l);
    if (line.ab || line.bb) gp++;
    total = addLines(total, line);
  });

  return withRates({ ...total, gp });
}

/** Our team's combined season line, plus scoring rate. */
export function teamSeason(history) {
  let total = { ...EMPTY_LINE };
  let runsFor = 0;

  history.forEach((g) => {
    g.lines
      .filter((l) => l.team === 'home')
      .forEach((l) => {
        total = addLines(total, normalizeLine(l));
      });
    runsFor += g.score.us;
  });

  const gp = history.length;
  return { ...withRates({ ...total, gp }), runsFor, runsPerGame: gp ? runsFor / gp : 0 };
}

/** Per-game on-base rate, for the profile trend chart. */
export function onBaseByGame(history, pid) {
  return history
    .map((g) => {
      const l = lineFor(g, pid);
      if (!l) return null;
      const line = normalizeLine(l);
      const denom = line.ab + line.bb;
      return { id: g.id, label: g.label, obp: denom ? (line.h + line.bb) / denom : 0 };
    })
    .filter(Boolean);
}
