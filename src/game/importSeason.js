// Reading a season back in from an exported file.
//
// Deliberately tolerant about shape: a backup is worth nothing if it won't
// load. Three inputs are accepted — a file from Export, a raw storage payload
// (what the crash screen downloads), and a bare state object — and anything
// missing falls back to a sane default rather than rejecting the file.

import { migrateGame } from './storage.js';

const isArr = Array.isArray;

function normalizeTeam(t, i) {
  return {
    id: t.id || `team-${i}`,
    name: String(t.name || `Team ${i + 1}`),
    priorW: Number(t.priorW) || 0,
    priorL: Number(t.priorL) || 0,
    players: isArr(t.players)
      ? t.players.map((p, j) => ({
          id: p.id != null ? p.id : j,
          name: String(p.name || `Player ${j + 1}`),
          num: p.num == null ? null : Number(p.num),
          pos: p.pos || 'P',
          c: p.c || '#3D5A73',
        }))
      : [],
  };
}

function normalizePlayer(p, i) {
  return {
    id: p.id != null ? p.id : i,
    name: String(p.name || `Player ${i + 1}`),
    num: p.num == null ? null : Number(p.num),
    pos: p.pos || 'P',
    c: p.c || '#0E7490',
  };
}

/**
 * Parse an exported file. Returns `{ ok, error, season, summary }` — never
 * throws, so a bad file is a message rather than a crash.
 */
export function parseSeasonFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't valid JSON." };
  }
  if (!data || typeof data !== 'object') {
    return { ok: false, error: "That file doesn't contain season data." };
  }

  // Unwrap a raw storage payload, or the crash screen's recovery dump.
  const src = data.state && typeof data.state === 'object' ? data.state : data;

  const looksRight = src.roster || src.teams || src.history || src.myTeam;
  if (!looksRight) {
    return { ok: false, error: "That file doesn't look like a season backup." };
  }

  const teams = (isArr(src.teams) ? src.teams : []).map(normalizeTeam);
  const roster = (isArr(src.roster) ? src.roster : []).map(normalizePlayer);
  const history = (isArr(src.history) ? src.history : []).map((g) => migrateGame(g, teams));

  const season = {
    myTeam: {
      name: String((src.myTeam && src.myTeam.name) || ''),
      priorW: Number(src.myTeam && src.myTeam.priorW) || 0,
      priorL: Number(src.myTeam && src.myTeam.priorL) || 0,
      priorT: Number(src.myTeam && src.myTeam.priorT) || 0,
    },
    roster,
    teams,
    history,
  };

  if (!roster.length && !teams.length && !history.length) {
    return { ok: false, error: 'That backup is empty — there is nothing to restore.' };
  }

  return {
    ok: true,
    season,
    summary: {
      teamName: season.myTeam.name || 'Unnamed team',
      players: roster.length,
      teams: teams.length,
      games: history.length,
      exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt.slice(0, 10) : null,
    },
  };
}

/**
 * Replace the current season with an imported one. The batting order is
 * rebuilt from the imported roster, and any game in progress is discarded —
 * restoring a backup mid-game would leave the two inconsistent.
 */
export function applySeason(state, season) {
  const ids = season.roster.map((p) => p.id);
  return {
    ...state,
    myTeam: season.myTeam,
    roster: season.roster,
    teams: season.teams,
    history: season.history,
    opponentId: season.teams.length ? season.teams[0].id : null,
    lineup: ids.slice(0, 9),
    bench: ids.slice(9),
    posOverride: {},
    gameActive: false,
    gameFinal: false,
    gameStats: {},
    events: [],
    undoStack: [],
    tape: [],
    lastPlay: null,
    bases: [null, null, null],
    score: { home: 0, away: 0 },
    outs: 0,
    inning: 1,
    half: 'top',
    kiHome: 0,
    kiAway: 0,
    importPreview: null,
    importError: null,
    screen: 'team',
  };
}
