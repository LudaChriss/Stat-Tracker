// localStorage persistence. The app is offline-first by design — a finalized
// game and the standings it moved must survive a refresh.
//
// Two rules here, both learned the hard way:
//
//  1. A saved season is NEVER discarded because its shape looks old. Older
//     payloads are migrated forward. Discarding on a version mismatch meant a
//     routine deploy could silently wipe a real season, because the blank
//     fallback was written straight back over it on the next save.
//  2. If a payload genuinely cannot be read, the raw text is preserved under a
//     separate key before anything overwrites it, so it can still be recovered
//     or exported by hand.
//
// Everything is best-effort besides: Safari private mode, disabled site data
// and quota exhaustion all throw on access, and none of them should take the
// app down.

import { normalizeLine } from './stats.js';

const KEY = 'score-tracker:state';
const PREVIOUS_KEY = 'score-tracker:previous';
const VERSION = 3;

// Ephemeral UI that must never come back from a reload: a toast mid-flight, a
// half-open sheet, a selected runner, or the fake "syncing…" indicator whose
// timer died with the previous page.
const TRANSIENT = {
  toast: null,
  posMenu: null,
  opponentPicker: false,
  playerEditor: null,
  teamEditor: null,
  resetFlow: null,
  recordEditor: false,
  confirmCancelGame: false,
  confirmDeleteGame: null,
  confirmFinal: false,
  selRunner: null,
  importPreview: null,
  importError: null,
  backfill: null,
  synced: true,
};

const RESUMABLE_SCREENS = [
  'league', 'team', 'newgame', 'live', 'player', 'roster', 'teams', 'teamDetail', 'gameDetail',
  'leagues',
];

/**
 * Don't resume onto a screen that makes no sense cold: the scan flow is
 * mid-capture state, and the live screen is meaningless with no game running.
 */
function resumableScreen(s) {
  if (s.screen === 'live' && !s.gameActive) return 'league';
  return RESUMABLE_SCREENS.includes(s.screen) ? s.screen : 'team';
}

const slug = (name) =>
  String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Bring one stored game up to the current record shape. */
export function migrateGame(game, teams) {
  const lines = Array.isArray(game.lines) ? game.lines : [];
  let opponentId = game.opponentId;
  if (!opponentId && game.opponent) {
    // Records written before games carried a team id: match on name.
    const match = (teams || []).find((t) => t.name === game.opponent || t.id === slug(game.opponent));
    opponentId = match ? match.id : slug(game.opponent);
  }
  return {
    ...game,
    opponentId,
    home: game.home !== false,
    score: game.score || { us: 0, them: 0 },
    lines: lines.map((l) => ({ ...normalizeLine(l), pid: l.pid, name: l.name, team: l.team })),
  };
}

/**
 * Merge any previously stored shape onto the current defaults. Unknown or
 * missing fields fall back; nothing is thrown away for being old.
 */
export function migrateState(saved, fallback) {
  const state = saved && saved.state ? saved.state : saved;
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;

  const teams = (Array.isArray(state.teams) ? state.teams : fallback.teams).map((t) => ({
    priorW: 0,
    priorL: 0,
    players: [],
    ...t,
  }));

  const merged = {
    ...fallback,
    ...state,
    myTeam: { name: '', priorW: 0, priorL: 0, priorT: 0, ...(state.myTeam || {}) },
    roster: Array.isArray(state.roster) ? state.roster : fallback.roster,
    teams,
    history: (Array.isArray(state.history) ? state.history : []).map((g) => migrateGame(g, teams)),
    ...TRANSIENT,
  };

  return { ...merged, screen: resumableScreen(merged) };
}

/** Keep an unreadable payload rather than letting the next save bury it. */
function preserve(raw) {
  try {
    if (raw && !localStorage.getItem(PREVIOUS_KEY)) localStorage.setItem(PREVIOUS_KEY, raw);
  } catch {
    /* nothing we can do */
  }
}

/**
 * Read the stored season, or null when there is nothing to restore — because
 * storage is empty, unavailable, or holds something unreadable.
 *
 * This is the honest primitive: callers that need to distinguish "no saved
 * season" from "a saved season that happens to look blank" must use this
 * rather than comparing loadState's result against the fallback by identity.
 */
export function readState(defaults) {
  let raw;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null; // storage unavailable — run without persistence
  }
  if (!raw) return null;

  try {
    const migrated = migrateState(JSON.parse(raw), defaults);
    if (migrated) return migrated;
    preserve(raw);
    return null;
  } catch {
    preserve(raw); // corrupt payload — keep it for manual recovery
    return null;
  }
}

/** As readState, but falls back to the given defaults instead of null. */
export function loadState(fallback) {
  const stored = readState(fallback);
  return stored === null ? fallback : stored;
}

/** Raw text of a save that could not be read, if there is one. */
export function getPreserved() {
  try {
    return localStorage.getItem(PREVIOUS_KEY);
  } catch {
    return null;
  }
}

export function clearPreserved() {
  try {
    localStorage.removeItem(PREVIOUS_KEY);
  } catch {
    /* ignore */
  }
}

let lastWritten = null;

export function saveState(state) {
  const {
    toast, posMenu, opponentPicker, playerEditor, teamEditor, resetFlow,
    confirmDeleteGame, confirmFinal, selRunner, importPreview, importError, recordEditor, confirmCancelGame, ...durable
  } = state;
  const payload = JSON.stringify({ version: VERSION, state: durable });

  // State changes far more often than the durable slice does; skip no-op writes.
  if (payload === lastWritten) return;

  try {
    localStorage.setItem(KEY, payload);
    lastWritten = payload;
  } catch {
    // Quota or private mode — keep playing, just without a saved game.
  }
}

/**
 * Ask the browser to exempt this origin from routine storage eviction. Not a
 * guarantee, and it does not survive uninstalling the app — export is still
 * the only real backup.
 */
export function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      return navigator.storage.persist().catch(() => false);
    }
  } catch {
    /* ignore */
  }
  return Promise.resolve(false);
}
