// localStorage persistence. The app is offline-first by design — a finalized
// game and the standings it moved must survive a refresh.
//
// Everything here is best-effort: Safari private mode, disabled site data and
// quota exhaustion all throw on access, and none of them should take the app
// down. A failed load falls back to a fresh season; a failed save is dropped.

const KEY = 'score-tracker:state';
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
  confirmFinal: false,
  selRunner: null,
  synced: true,
};

const RESUMABLE_SCREENS = ['league', 'team', 'newgame', 'live', 'player', 'roster', 'teams', 'teamDetail'];

/**
 * Don't resume onto a screen that makes no sense cold: the scan flow is
 * mid-capture state, and the live screen is meaningless with no game running.
 */
function resumableScreen(s) {
  if (s.screen === 'live' && !s.gameActive) return 'league';
  return RESUMABLE_SCREENS.includes(s.screen) ? s.screen : 'team';
}

export function loadState(fallback) {
  let raw;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return fallback; // storage unavailable — run without persistence
  }
  if (!raw) return fallback;

  try {
    const saved = JSON.parse(raw);
    // A version bump means the shape changed; start clean rather than merging
    // a stale schema into the current one.
    if (!saved || saved.version !== VERSION || !saved.state) return fallback;

    const merged = { ...fallback, ...saved.state, ...TRANSIENT };
    return { ...merged, screen: resumableScreen(merged) };
  } catch {
    return fallback; // corrupt payload
  }
}

let lastWritten = null;

export function saveState(state) {
  const { toast, posMenu, opponentPicker, playerEditor, teamEditor, confirmFinal, selRunner, ...durable } =
    state;
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
