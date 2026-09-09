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
