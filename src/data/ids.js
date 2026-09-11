// Player id construction, kept dependency-free so both the seed data and the
// engine can use it without a circular import.
//
// Ids are namespaced because the opposition has no roster entry: "h7" is
// roster id 7, "a3" is the 4th slot in the opponent's order.
export const homePid = (rosterId) => `h${rosterId}`;
export const awayPid = (slot) => `a${slot}`;
export const isHomePid = (pid) => typeof pid === 'string' && pid[0] === 'h';

/** "Dirt Merchants" -> "DM". Used on the compact schedule cards. */
export const teamAbbrev = (name) =>
  name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase();

// A rostered opponent, so their stats can accumulate across games:
// "o:rc:3" is player 3 on team "rc".
export const oppPid = (teamId, playerId) => `o:${teamId}:${playerId}`;
export const isOppPid = (pid) => typeof pid === 'string' && pid.startsWith('o:');

/** An unnamed opponent batter — slot only, so their stats never accumulate. */
export const isAnonPid = (pid) => typeof pid === 'string' && pid[0] === 'a';

export function parseOppPid(pid) {
  const [, teamId, playerId] = pid.split(':');
  return { teamId, playerId: Number(playerId) };
}

/** Ids for new roster entries / teams, unique against what already exists. */
export function nextId(existing) {
  return existing.reduce((max, x) => Math.max(max, Number(x.id) || 0), -1) + 1;
}

// ---------------------------------------------------------------------------
// Event-log identity
//
// Every appended event carries an id minted on the device that entered it, and
// the server treats a repeat of that id as the same event rather than a second
// one. This is the same discipline save_game uses for a whole game, applied to
// each play: the write queue retries after a timeout that may actually have
// succeeded, and a double-counted run is worse than a failed write.
// ---------------------------------------------------------------------------

const DEVICE_KEY = 'score-tracker:deviceId';
let cachedDeviceId = null;
let counter = 0;

/** A stable id for this phone, so two phones never mint the same event id. */
export function deviceId() {
  if (cachedDeviceId) return cachedDeviceId;
  try {
    const stored = localStorage.getItem(DEVICE_KEY);
    if (stored) {
      cachedDeviceId = stored;
      return stored;
    }
  } catch {
    /* storage unavailable — fall through to a session-only id */
  }
  const made = `d${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  cachedDeviceId = made;
  try {
    localStorage.setItem(DEVICE_KEY, made);
  } catch {
    /* private mode: the id lasts as long as the tab, which is still unique */
  }
  return made;
}

/**
 * A fresh event id. The timestamp keeps ids unique across reloads (the
 * in-memory counter restarts); the counter keeps them unique within a
 * millisecond.
 */
export function newEventId() {
  return `${deviceId()}-${Date.now().toString(36)}-${(counter += 1)}`;
}

/** Testing seam: forget the cached device id. */
export function resetDeviceId() {
  cachedDeviceId = null;
  counter = 0;
}

export const slugId = (name, existing) => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'team';
  let id = base;
  let n = 2;
  while (existing.some((t) => t.id === id)) id = `${base}-${n++}`;
  return id;
};
