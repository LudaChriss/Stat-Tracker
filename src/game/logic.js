// Pure scoring engine. Every function takes the current state and returns the
// next state, so the React layer never has to reason about mutation order and
// the undo stack can just hold snapshots.

import { ROSTER, AWAY_NAMES, AWAY_TEAM } from '../data/league.js';

const BASE_NAMES = ['1st', '2nd', '3rd'];
const UNDO_DEPTH = 25;

const clone = (v) => JSON.parse(JSON.stringify(v));

export const initials = (n) =>
  n.split(' ').map((w) => w[0]).join('').replace('.', '').slice(0, 2).toUpperCase();

export function ordinal(n) {
  const suffix = ['th', 'st', 'nd', 'rd'][n % 10 > 3 || (n > 10 && n < 14) ? 0 : n % 10];
  return `${n}${suffix} inning`;
}

// Fields the undo stack restores. Lineup / roster edits are deliberately not
// undoable — only the play-by-play is.
function snapshot(s) {
  return clone({
    half: s.half,
    inning: s.inning,
    outs: s.outs,
    bases: s.bases,
    score: s.score,
    kiHome: s.kiHome,
    kiAway: s.kiAway,
    lastPlay: s.lastPlay,
    tape: s.tape,
    gameStats: s.gameStats,
    events: s.events,
  });
}

const pushUndo = (s) => [...s.undoStack, snapshot(s)].slice(-UNDO_DEPTH);

export function currentKicker(s) {
  if (s.half === 'bot') {
    const p = ROSTER[s.lineup[s.kiHome % s.lineup.length]];
    return {
      ...p,
      ini: initials(p.name),
      line: `${p.avg} AVG · ${p.obp} OBP · ${p.ops} OPS`,
      slot: (s.kiHome % s.lineup.length) + 1,
      of: s.lineup.length,
    };
  }
  const i = s.kiAway % AWAY_NAMES.length;
  const name = AWAY_NAMES[i];
  return { name, c: '#5A7A90', ini: initials(name), line: AWAY_TEAM, slot: i + 1, of: AWAY_NAMES.length };
}

const EMPTY_LINE = { ab: 0, h: 0, r: 0, rbi: 0, bb: 0 };

export function statLine(gameStats, name) {
  return gameStats[name] || EMPTY_LINE;
}

// Fetch-or-create a mutable stat line inside a cloned gameStats map.
function lineFor(obj, name) {
  if (!obj[name]) obj[name] = { ...EMPTY_LINE };
  return obj[name];
}

// Shared "3 outs ends the half" tail. Returns the patch with inning/half rolled
// forward, and flags the game for finalizing once the 7th is done.
// `suffix` and `markTape` differ between a plate appearance and a runner out.
function retireSide(s, patch, outs, { symbol, detail, suffix, markTape }) {
  if (outs < 3) return patch;

  patch.outs = 0;
  patch.bases = [null, null, null];
  patch.half = s.half === 'top' ? 'bot' : 'top';

  if (s.half === 'bot') {
    patch.inning = s.inning + 1;
    if (s.inning >= 7) {
      patch.inning = 7;
      patch.half = 'bot';
      patch.confirmFinal = true;
      patch.lastPlay = { k: symbol, detail: 'End of the 7th — game over' };
      return patch;
    }
  }
  patch.lastPlay = { k: symbol, detail: `${detail}${suffix}` };
  if (markTape) patch.tape = [...patch.tape, '/'];
  return patch;
}

/** Record a plate-appearance outcome for whoever is up. */
export function applyOutcome(s, o) {
  if (!s.gameActive) return s;

  const undoStack = pushUndo(s);
  const bases = [...s.bases];
  let outs = s.outs;
  let runs = 0;

  const gameStats = clone(s.gameStats);
  const events = clone(s.events);
  const kicker = currentKicker(s);
  const me = lineFor(gameStats, kicker.name);
  const scorers = [];
  let detail = '';

  if (o.type === 'hit') {
    me.ab++;
    if (o.k !== 'E') me.h++;

    // Runners advance by the value of the hit, from the lead runner back.
    for (let i = 2; i >= 0; i--) {
      if (!bases[i]) continue;
      const target = i + o.n;
      if (target >= 3) {
        runs++;
        scorers.push(bases[i]);
      } else {
        bases[target] = bases[i];
      }
      bases[i] = null;
    }

    if (o.n >= 4) {
      runs++;
      scorers.push(kicker.name);
      detail = `${kicker.name} scores`;
    } else {
      bases[o.n - 1] = kicker.name;
      detail = `${kicker.name} to ${BASE_NAMES[o.n - 1]}`;
    }
    if (runs) detail += ` · ${runs}${runs > 1 ? ' runs score' : ' run scores'}`;
    me.rbi += o.k === 'E' ? 0 : runs;
  } else if (o.type === 'walk') {
    me.bb++;
    // Only forced runners move.
    if (bases[0]) {
      if (bases[1]) {
        if (bases[2]) {
          runs++;
          scorers.push(bases[2]);
          me.rbi++;
        }
        bases[2] = bases[1];
      }
      bases[1] = bases[0];
    }
    bases[0] = kicker.name;
    detail = `${kicker.name} to 1st${runs ? ' · run forced in' : ''}`;
  } else {
    me.ab++;
    outs++;
    if (o.mode === 'force' && bases[0]) {
      detail = `${bases[0]} forced at 2nd, ${kicker.name} safe at 1st`;
      bases[0] = kicker.name;
    } else if (o.mode === 'sac' && bases[2] && outs < 3) {
      runs++;
      scorers.push(bases[2]);
      me.rbi++;
      detail = `${kicker.name} out · ${bases[2]} scores`;
      bases[2] = null;
    } else {
      detail = `${kicker.name} out`;
    }
  }

  // The opponent only gets scorebook entries when we're tracking both teams.
  if (s.half === 'bot' || s.trackMode === 'both') {
    events.push({
      name: kicker.name,
      inning: s.inning,
      half: s.half,
      sym: o.k,
      scored: o.type === 'hit' && o.n >= 4,
    });
  }

  // Credit the run, and mark that player's most recent scorebook cell as scored.
  scorers.forEach((n) => {
    lineFor(gameStats, n).r++;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].name === n) {
        events[i].scored = true;
        break;
      }
    }
  });

  const score = { ...s.score };
  if (runs) {
    if (s.half === 'top') score.away += runs;
    else score.home += runs;
  }

  let patch = {
    undoStack,
    bases,
    outs,
    score,
    gameStats,
    events,
    lastPlay: { k: o.k, detail },
    tape: [...s.tape, o.k].slice(-9),
    selRunner: null,
  };
  if (s.half === 'bot') patch.kiHome = s.kiHome + 1;
  else patch.kiAway = s.kiAway + 1;

  patch = retireSide(s, patch, outs, {
    symbol: o.k,
    detail,
    suffix: ' · 3 outs, side retired',
    markTape: true,
  });
  return { ...s, ...patch };
}

/** Two-button opponent scoring, used when trackMode is "our team only". */
export function applyQuick(s, isRun) {
  const undoStack = pushUndo(s);

  if (isRun) {
    return {
      ...s,
      undoStack,
      score: { ...s.score, away: s.score.away + 1 },
      lastPlay: { k: 'R', detail: `${AWAY_TEAM} run scored` },
      tape: [...s.tape, 'R'].slice(-9),
    };
  }

  const outs = s.outs + 1;
  const patch = {
    undoStack,
    outs,
    lastPlay: { k: 'OUT', detail: `${AWAY_TEAM} out` },
    tape: [...s.tape, 'O'].slice(-9),
  };
  if (outs >= 3) {
    patch.outs = 0;
    patch.bases = [null, null, null];
    patch.half = 'bot';
    patch.lastPlay = { k: 'OUT', detail: '3 outs — Grass Stains up' };
    patch.tape = [...patch.tape, '/'];
  }
  return { ...s, ...patch };
}

/**
 * Move the selected runner. `adv` is true to advance a base, false for an out
 * on the bases, or 'back' to walk a runner back (e.g. a mis-tap).
 */
export function applyRunnerAction(s, adv) {
  const i = s.selRunner;
  if (i == null || !s.bases[i]) return s;

  const undoStack = pushUndo(s);
  const bases = [...s.bases];
  let outs = s.outs;
  const score = { ...s.score };
  const name = bases[i];
  const gameStats = clone(s.gameStats);
  const events = clone(s.events);
  let detail;

  if (adv === 'back') {
    if (i === 0 || bases[i - 1]) return s;
    bases[i - 1] = name;
    bases[i] = null;
    return {
      ...s,
      undoStack,
      bases,
      selRunner: null,
      lastPlay: { k: '‹', detail: `${name} back to ${BASE_NAMES[i - 1]}` },
    };
  }

  if (adv) {
    const target = i + 1;
    if (target >= 3) {
      if (s.half === 'top') score.away++;
      else score.home++;
      lineFor(gameStats, name).r++;
      for (let j = events.length - 1; j >= 0; j--) {
        if (events[j].name === name) {
          events[j].scored = true;
          break;
        }
      }
      detail = `${name} scores`;
    } else {
      bases[target] = name;
      detail = `${name} to ${BASE_NAMES[target]}`;
    }
    bases[i] = null;
  } else {
    bases[i] = null;
    outs++;
    detail = `${name} out on the bases`;
  }

  let patch = {
    undoStack,
    bases,
    outs,
    score,
    gameStats,
    events,
    selRunner: null,
    lastPlay: { k: adv ? '›' : 'OUT', detail },
  };
  patch = retireSide(s, patch, outs, {
    symbol: 'OUT',
    detail,
    suffix: ' · side retired',
    markTape: false,
  });
  return { ...s, ...patch };
}

export function applyUndo(s) {
  if (!s.undoStack.length) return s;
  const prev = s.undoStack[s.undoStack.length - 1];
  return { ...s, ...prev, undoStack: s.undoStack.slice(0, -1), selRunner: null };
}

export function applyMoveLineup(s, idx, dir) {
  const lineup = [...s.lineup];
  const j = idx + dir;
  if (j < 0 || j >= lineup.length) return s;
  [lineup[idx], lineup[j]] = [lineup[j], lineup[idx]];
  return { ...s, lineup };
}

/**
 * Format a 0..1 rate the way a scorebook does: leading-dot to three places,
 * except a perfect rate, which is written out as 1.000.
 */
export function rateString(numerator, denominator) {
  if (!denominator) return '—';
  const milli = Math.round((1000 * numerator) / denominator);
  return milli >= 1000 ? '1.000' : `.${milli.toString().padStart(3, '0')}`;
}

/** On-base percentage for an in-progress game line. */
export function obpString(g) {
  return rateString(g.h + g.bb, g.ab + g.bb);
}
