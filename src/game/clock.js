// The app's idea of "now", for the one question that depends on it: has a live
// game gone quiet for long enough to be treated as stopped?
//
// Everything else keeps using Date.now() directly. This exists so a browser
// harness can move time forward by three hours without waiting three hours —
// the only honest way to test a cutoff that long — and so pure code can be
// handed a time rather than reading one.
//
// The offset is never persisted. A reload is back to the real clock.

let offsetMs = 0;
const listeners = new Set();

/** Milliseconds since the epoch, as far as this app is concerned. */
export function now() {
  return Date.now() + offsetMs;
}

/** Move the clock forward (or back, with a negative number). */
export function advanceClock(ms) {
  offsetMs += Number(ms) || 0;
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* one broken listener must not stop the others hearing it */
    }
  });
}

/** Back to the real clock. */
export function resetClock() {
  advanceClock(-offsetMs);
}

/** Be told when the clock is moved, so anything showing "how long ago" re-reads it. */
export function onClockChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
