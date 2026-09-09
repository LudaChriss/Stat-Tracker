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

export const slugId = (name, existing) => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'team';
  let id = base;
  let n = 2;
  while (existing.some((t) => t.id === id)) id = `${base}-${n++}`;
  return id;
};
