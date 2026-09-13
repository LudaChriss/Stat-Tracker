// "Now", as a value a render can depend on.
//
// Kept out of useGame's state on purpose: every change to that state is saved,
// and a clock ticking inside it would write the season every minute for no
// reason. This re-renders whatever uses it on a slow timer, and at once when a
// harness moves the clock.

import { useEffect, useState } from 'react';
import { now, onClockChange } from './clock.js';

export function useNow(everyMs = 30000) {
  const [at, setAt] = useState(() => now());
  useEffect(() => {
    const tick = () => setAt(now());
    const timer = setInterval(tick, everyMs);
    const off = onClockChange(tick);
    return () => {
      clearInterval(timer);
      off();
    };
  }, [everyMs]);
  return at;
}
