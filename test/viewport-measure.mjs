// The responsive audit's yardstick, shared.
//
// viewports.mjs runs it over every screen that can be restored from storage.
// Some states cannot be — a league screen needs a signed-in account and a
// network round trip, and a game in progress on it needs another phone scoring
// — so the browser harnesses that reach those states run the SAME measurement
// on them, rather than a second opinion about what "fits" means.
//
// Not a suite: no `check` in the name, so `npm test` does not pick it up.

export const VIEWPORTS = [
  ['iPhone SE',        375, 667, 2],
  ['iPhone 13 mini',   375, 812, 3],
  ['iPhone 15',        393, 852, 3],
  ['iPhone 15 Pro Max',430, 932, 3],
];

// Evaluated in the page. Returns horizontal overflow, the first few elements
// sticking past an edge, and every control under the 44px tap guidance.
export const MEASURE = `(() => {
  const de = document.documentElement;
  const vw = window.innerWidth;
  const overflow = Math.max(de.scrollWidth, document.body.scrollWidth) - vw;
  // Anything sticking past either edge. Descendants of a deliberately
  // scrollable strip are excluded — those are meant to run off-screen.
  const inScroller = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ov = getComputedStyle(p).overflowX;
      if (ov === 'auto' || ov === 'scroll') return true;
    }
    return false;
  };
  const wide = [...document.querySelectorAll('*')].filter(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const ov = getComputedStyle(el).overflowX;
    if (ov === 'auto' || ov === 'scroll') return false;
    if (inScroller(el)) return false;
    return r.right > vw + 1 || r.left < -1;
  }).slice(0, 4).map(el => {
    const r = el.getBoundingClientRect();
    return (el.tagName + ' "' + (el.textContent||'').replace(/\s+/g,' ').trim().slice(0,18) + '" w=' + Math.round(r.width) + ' L=' + Math.round(r.left) + ' R=' + Math.round(r.right));
  });
  // Interactive controls smaller than the 44px iOS guidance.
  const small = [...document.querySelectorAll('button,[role=button],input')].filter(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && (r.width < 40 || r.height < 40);
  }).map(el => (el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,14) + ' ' + Math.round(el.getBoundingClientRect().width) + 'x' + Math.round(el.getBoundingClientRect().height));
  return { overflow, wide, smallCount: small.length, small };
})()`;

// What MEASURE cannot see. A screen that scrolls vertically sets overflow-y,
// and CSS then computes its overflow-x to `auto` as well — so MEASURE treats
// the whole screen as a sideways scroller and ignores everything in it, and a
// card running off the edge inside it is clipped rather than widening the page.
//
// This asks the container itself: is there more content sideways than it shows?
// A strip that is MEANT to scroll sideways says so in its own style, and text
// cut off on purpose says so with an ellipsis; neither is counted.
export const CLIPPED = `(() => [...document.querySelectorAll('*')].filter(el => {
  const cs = getComputedStyle(el);
  if (!['auto', 'scroll', 'hidden', 'clip'].includes(cs.overflowX)) return false;
  const own = el.style.overflowX || el.style.overflow;
  if (own === 'auto' || own === 'scroll') return false;
  if (cs.textOverflow === 'ellipsis') return false;
  return el.scrollWidth > el.clientWidth + 1;
}).slice(0, 4).map(el => el.tagName + ' "' + (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 24)
  + '" scroll=' + el.scrollWidth + ' client=' + el.clientWidth))()`;
