// Pure scoring engine. Every function takes the current state and returns the
// next state, so the React layer never has to reason about mutation order and
// the undo stack can just hold snapshots.

import { ANON_LINEUP_SIZE } from '../data/league.js';
import { awayPid, homePid, isAnonPid, isHomePid, isOppPid, oppPid, parseOppPid } from '../data/ids.js';
import { EMPTY_LINE, obpString, rateString, seasonTotals } from './stats.js';

const BASE_NAMES = ['1st', '2nd', '3rd'];
const UNDO_DEPTH = 25;

const clone = (v) => JSON.parse(JSON.stringify(v));

// ---------------------------------------------------------------------------
// Player identity
//
// Stats, base runners and scorebook entries are all keyed by a player id, not
// by name — two players sharing a name must not share a stat line. Ids are
// namespaced because the opposition has no roster entry: "h7" is roster id 7,
// "a3" is the 4th slot in the opponent's order.
// ---------------------------------------------------------------------------

export { awayPid, homePid, isAnonPid, isHomePid, isOppPid, oppPid };

/** Look a rostered player up by id. Ids are authoritative, not array order. */
export const playerById = (s, id) => s.roster.find((p) => p.id === id);

export const teamById = (s, id) => s.teams.find((t) => t.id === id);

/** The team we're playing, or a stub if it has been deleted since. */
export function opponentTeam(s) {
  return teamById(s, s.opponentId) || { id: s.opponentId, name: 'Opponent', players: [] };
}

/**
 * The opponent's batting order. A team with no roster entered gets anonymous
 * slots, whose stats deliberately do not accumulate across games — slot 1 is a
 * different person every week.
 */
export function awayLineup(s) {
  const team = opponentTeam(s);
  if (team.players && team.players.length) {
    return team.players.map((p) => ({
      pid: oppPid(team.id, p.id),
      name: p.name,
      c: p.c,
    }));
  }
  return Array.from({ length: ANON_LINEUP_SIZE }, (_, i) => ({
    pid: awayPid(i),
    name: `Batter ${i + 1}`,
    c: '#5A7A90',
  }));
}

/** Display name for a player id, for detail lines and the runner controls. */
export function playerName(s, pid) {
  if (!pid) return '';
  if (isHomePid(pid)) {
    const p = playerById(s, Number(pid.slice(1)));
    return p ? p.name : '—';
  }
  if (isOppPid(pid)) {
    const { teamId, playerId } = parseOppPid(pid);
    const team = teamById(s, teamId);
    const p = team && team.players.find((x) => x.id === playerId);
    return p ? p.name : '—';
  }
  return `Batter ${Number(pid.slice(1)) + 1}`;
}

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

/** Whoever is at the plate, with the id the stat map is keyed by. */
const NO_BATTER = { pid: null, name: '—', c: '#5A7A90', ini: '·', line: '', slot: 1, of: 0 };

export function currentKicker(s) {
  if (s.half === 'bot') {
    // A season that has just been reset has nobody in the order yet.
    if (!s.lineup.length) return NO_BATTER;
    const p = playerById(s, s.lineup[s.kiHome % s.lineup.length]);
    if (!p) return NO_BATTER;
    return {
      ...p,
      pid: homePid(p.id),
      ini: initials(p.name),
      line: seasonLine(s.history, homePid(p.id)),
      slot: (s.kiHome % s.lineup.length) + 1,
      of: s.lineup.length,
    };
  }
  const order = awayLineup(s);
  const i = s.kiAway % order.length;
  const batter = order[i];
  return {
    pid: batter.pid,
    name: batter.name,
    c: batter.c,
    ini: initials(batter.name),
    line: opponentTeam(s).name,
    slot: i + 1,
    of: order.length,
  };
}

/** Read a player's line for this game. Returns zeroes if they haven't batted. */
export function statLine(gameStats, pid) {
  return gameStats[pid] || EMPTY_LINE;
}

// Fetch-or-create a mutable stat line inside a cloned gameStats map.
function lineFor(obj, pid) {
  if (!obj[pid]) obj[pid] = { ...EMPTY_LINE };
  return obj[pid];
}

// Mark a scorer's most recent scorebook cell as having come around.
function markScored(events, pid) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].pid === pid) {
      events[i].scored = true;
      return;
    }
  }
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
  // Nobody at the plate — nothing to record against.
  if (!currentKicker(s).pid) return s;

  const undoStack = pushUndo(s);
  const bases = [...s.bases];
  let outs = s.outs;
  let runs = 0;

  const gameStats = clone(s.gameStats);
  const events = clone(s.events);
  const kicker = currentKicker(s);
  const me = lineFor(gameStats, kicker.pid);
  const scorers = [];
  let detail = '';

  if (o.type === 'hit') {
    me.ab++;
    if (o.k !== 'E') {
      me.h++;
      if (o.n === 2) me.d++;
      else if (o.n === 3) me.t++;
      else if (o.n >= 4) me.hr++;
    }

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
      scorers.push(kicker.pid);
      detail = `${kicker.name} scores`;
    } else {
      bases[o.n - 1] = kicker.pid;
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
    bases[0] = kicker.pid;
    detail = `${kicker.name} to 1st${runs ? ' · run forced in' : ''}`;
  } else {
    outs++;
    if (o.k === 'K') me.k++;

    let sacrificed = false;
    if (o.mode === 'force' && bases[0]) {
      detail = `${playerName(s, bases[0])} forced at 2nd, ${kicker.name} safe at 1st`;
      bases[0] = kicker.pid;
    } else if (o.mode === 'sac' && bases[2] && outs < 3) {
      runs++;
      scorers.push(bases[2]);
      me.rbi++;
      sacrificed = true;
      detail = `${kicker.name} out · ${playerName(s, bases[2])} scores`;
      bases[2] = null;
    } else {
      detail = `${kicker.name} out`;
    }
    // A sacrifice that actually brings a run in is not charged as an at-bat.
    // A "sac fly" with nobody on third is just a fly out, and is.
    if (!sacrificed) me.ab++;
  }

  // The opponent only gets scorebook entries when we're tracking both teams.
  if (s.half === 'bot' || s.trackMode === 'both') {
    events.push({
      pid: kicker.pid,
      inning: s.inning,
      half: s.half,
      sym: o.k,
      scored: o.type === 'hit' && o.n >= 4,
    });
  }

  scorers.forEach((pid) => {
    lineFor(gameStats, pid).r++;
    markScored(events, pid);
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
      lastPlay: { k: 'R', detail: `${opponentTeam(s).name} run scored` },
      tape: [...s.tape, 'R'].slice(-9),
    };
  }

  const outs = s.outs + 1;
  const patch = {
    undoStack,
    outs,
    lastPlay: { k: 'OUT', detail: `${opponentTeam(s).name} out` },
    tape: [...s.tape, 'O'].slice(-9),
  };
  if (outs >= 3) {
    patch.outs = 0;
    patch.bases = [null, null, null];
    patch.half = 'bot';
    patch.lastPlay = { k: 'OUT', detail: `3 outs — ${s.myTeam.name} up` };
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
  const pid = bases[i];
  const name = playerName(s, pid);
  const gameStats = clone(s.gameStats);
  const events = clone(s.events);
  let detail;

  if (adv === 'back') {
    if (i === 0 || bases[i - 1]) return s;
    bases[i - 1] = pid;
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
      lineFor(gameStats, pid).r++;
      markScored(events, pid);
      detail = `${name} scores`;
    } else {
      bases[target] = pid;
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

export { obpString, rateString };

/** "AVG · OBP · OPS" summary shown under the batter at the plate. */
export function seasonLine(history, pid) {
  const t = seasonTotals(history, pid);
  return `${t.avg} AVG · ${t.obp} OBP · ${t.ops} OPS`;
}

/**
 * Freeze a finished game into a history record.
 *
 * Player names are captured at write time so that later roster edits — a
 * rename, a removal — can never rewrite what happened in a past game. The
 * record carries full per-player lines, so it doubles as the box score.
 */
export function buildGameRecord(s, { date = new Date() } = {}) {
  const homeLines = s.lineup.map((id) => {
    const p = playerById(s, id);
    const pid = homePid(p.id);
    return { pid, name: p.name, team: 'home', ...statLine(s.gameStats, pid) };
  });

  // Opponent lines only exist when the game was set to track both teams.
  const awayLines = awayLineup(s)
    .map(({ pid, name }) => ({ pid, name, team: 'away', ...statLine(s.gameStats, pid) }))
    .filter((l) => l.ab || l.bb);

  const us = s.score.home;
  const them = s.score.away;

  return {
    id: `g-${date.getTime()}`,
    date: date.toISOString().slice(0, 10),
    label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    opponentId: s.opponentId,
    opponent: opponentTeam(s).name,
    home: true,
    score: { us, them },
    // A game called level is a tie, not a win — the design's `>=` treated it
    // as a win, which would misreport the standings.
    result: us > them ? 'W' : us < them ? 'L' : 'T',
    sport: s.sport,
    innings: s.inning,
    lines: [...homeLines, ...awayLines],
  };
}
