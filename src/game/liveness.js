// When a live game has stopped being a live game.
//
// A `live` row is only a promise that somebody is scoring. The log is the
// evidence: every play is an append with the server's timestamp on it. A game
// whose log has not moved for long enough is treated as stopped — not offered
// to join as though it were being scored right now, not listed as in progress,
// and offered to the people who can score it to abandon.
//
// Nothing here changes the game. A stopped game is still `live` in the account
// until somebody abandons it, and the moment another play lands it is fresh
// again. That is what makes a cutoff safe to be wrong about.

import { UNDOABLE } from './events.js';

/**
 * How long a log can go without an append before its game is treated as stopped.
 *
 * Three hours. D20 argues it; the short version. A rec game is an hour to an
 * hour and a half. The longest a game legitimately goes quiet is a weather
 * delay, and a lightning hold restarts its thirty minutes with every strike —
 * an hour-plus stop is ordinary and two hours happens. Past that, a rec league's
 * field booking is gone and the game is called. So nothing still going can reach
 * three hours of silence, while a game abandoned at 7pm is out of everybody's
 * way by the time they look at their phones the next morning.
 *
 * The one number. Every place that asks "is this game stale" reads it from here.
 */
export const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

/** A timestamp in milliseconds, from whatever shape it arrived in. */
export function toMs(at) {
  if (at == null || at === '') return null;
  if (typeof at === 'number') return Number.isFinite(at) ? at : null;
  const ms = at instanceof Date ? at.getTime() : Date.parse(at);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The last time anything reached this log, in milliseconds.
 *
 * `fallback` is for a live row whose log is empty — the game was started and
 * the first append never arrived — so there is still something to measure
 * from. With neither, the answer is null and the game is never called stale:
 * not knowing is not evidence of anything.
 */
export function lastActivityAt(events, fallback = null) {
  let latest = null;
  for (const e of events || []) {
    const ms = toMs(e && (e.at !== undefined ? e.at : e.created_at));
    if (ms != null && (latest == null || ms > latest)) latest = ms;
  }
  return latest != null ? latest : toMs(fallback);
}

/** Whether a game last touched at `lastAt` counts as stopped at `now`. */
export function isStale(lastAt, now) {
  const at = toMs(lastAt);
  if (at == null || now == null) return false;
  return now - at > STALE_AFTER_MS;
}

/** The highest sequence number the account has given this log. 0 for none. */
export function lastSeq(events) {
  let max = 0;
  for (const e of events || []) {
    const seq = e && e.seq != null ? Number(e.seq) : null;
    if (seq != null && seq > max) max = seq;
  }
  return max;
}

/**
 * The last sequence number this phone holds WITHOUT a gap before it.
 *
 * The account numbers a game's events 1, 2, 3… with no holes — every append
 * takes max + 1 under a per-game lock. Realtime can drop messages (that is why
 * there is a poll at all), so a phone can hold 1–200 and 270 while 201–269 were
 * lost on the way. Asking the account for "everything after the highest I hold"
 * would ask for everything after 270, forever, and the phone would sit on a game
 * missing seventy plays without anyone being told. Asking from the end of the
 * unbroken run fetches the hole and what follows it; anything already held comes
 * back again and is dropped as a duplicate.
 */
export function contiguousSeq(events) {
  const seen = new Set();
  for (const e of events || []) {
    if (e && e.seq != null) seen.add(Number(e.seq));
  }
  let n = 0;
  while (seen.has(n + 1)) n++;
  return n;
}

/**
 * How many plays were entered. Undone ones count: something was entered, and
 * "nothing was ever scored in this game" should mean exactly that.
 */
export function countPlays(events) {
  return (events || []).filter((e) => e && UNDOABLE.has(e.kind)).length;
}

/** "45 min", "3 hr 10 min", "2 days" — for a sentence, not a clock. */
export function idleLabel(ms) {
  const minutes = Math.max(0, Math.floor((Number(ms) || 0) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes - hours * 60;
    return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
  }
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day' : `${days} days`;
}

/** Whether a log's cancellation was an abandonment rather than a scorer's cancel. */
export function wasAbandoned(events) {
  const list = events || [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i] && list[i].kind === 'cancel') return !!(list[i].payload && list[i].payload.reason === 'abandoned');
  }
  return false;
}
