// Deciding what to do when a device has a local season and an account has one.
//
// The rule this file enforces: nothing that could lose or duplicate a season
// happens without the user choosing it. The two safe cases resolve silently —
// there is nothing to lose — and only a genuine disagreement asks.
//
// Comparison is on DERIVED figures, not rows. Two seasons agree when they show
// the same thing: the same games, the same per-player season lines, the same
// standings. Row-level equality would report a difference for a reordered
// roster or a regenerated id, and prompt the user over nothing.

import { homePid } from './ids.js';
import { seasonTotals } from '../game/stats.js';
import { tallyStandings } from '../game/standings.js';

/** Is there anything here worth keeping? */
export function isEmptySeason(season) {
  if (!season) return true;
  const roster = season.roster || [];
  const teams = season.teams || [];
  const history = season.history || [];
  const named = !!(season.myTeam && season.myTeam.name);
  return !named && roster.length === 0 && teams.length === 0 && history.length === 0;
}

/**
 * A stable summary of what a season actually shows. Any difference the user
 * would notice changes this; nothing they would not, does.
 */
export function seasonFingerprint(season) {
  if (!season) return null;
  const history = season.history || [];
  const roster = season.roster || [];

  const lines = roster
    .map((p) => {
      const t = seasonTotals(history, homePid(p.id));
      return [p.id, t.gp, t.ab, t.h, t.r, t.rbi, t.bb, t.k, t.d, t.t, t.hr].join(':');
    })
    .sort();

  let table = [];
  try {
    table = tallyStandings(season)
      .map((r) => `${r.name}:${r.w}-${r.l}-${r.t}`)
      .sort();
  } catch {
    // A season slice without myTeam/teams cannot produce standings; the game
    // count and stat lines still distinguish it.
    table = [];
  }

  return JSON.stringify({
    team: (season.myTeam && season.myTeam.name) || '',
    games: history.length,
    lines,
    table,
  });
}

export function seasonsMatch(a, b) {
  const fa = seasonFingerprint(a);
  const fb = seasonFingerprint(b);
  return fa !== null && fa === fb;
}

/** Counts for the UI, so a prompt can say what it is actually choosing between. */
export function summarize(season) {
  if (!season) return { team: '', players: 0, teams: 0, games: 0 };
  return {
    team: (season.myTeam && season.myTeam.name) || 'Unnamed team',
    players: (season.roster || []).length,
    teams: (season.teams || []).length,
    games: (season.history || []).length,
  };
}

/**
 * What should happen on sign-in.
 *
 *  local-only     no account yet — keep using this device's season
 *  adopt-backend  nothing local worth keeping, or the two already agree
 *  migrate-up     this device has a season and the account has none
 *  ask            both exist and disagree; only the user can resolve it
 */
export function decideSync({ local, remote, signedIn }) {
  if (!signedIn) {
    return { action: 'local-only', reason: 'not signed in' };
  }

  const localEmpty = isEmptySeason(local);
  const remoteEmpty = isEmptySeason(remote);

  if (localEmpty && remoteEmpty) {
    return { action: 'adopt-backend', reason: 'nothing anywhere yet' };
  }
  if (localEmpty) {
    return { action: 'adopt-backend', reason: 'nothing stored on this device' };
  }
  if (remoteEmpty) {
    return { action: 'migrate-up', reason: 'this device has a season and the account has none' };
  }
  if (seasonsMatch(local, remote)) {
    // Already in sync — the user should never see a prompt for this.
    return { action: 'adopt-backend', reason: 'this device already matches the account' };
  }

  return {
    action: 'ask',
    reason: 'both have a season and they differ',
    local: summarize(local),
    remote: summarize(remote),
  };
}

/**
 * Did a migration land intact?
 *
 * Compares what the app would SHOW from each side. Comparing rows would only
 * prove rows survived — this is the check that caught away-game results coming
 * back inverted.
 */
export function verifyMigration(local, readBack) {
  if (!readBack) {
    return { ok: false, differences: ['nothing could be read back after the import'] };
  }

  const differences = [];
  const l = summarize(local);
  const r = summarize(readBack);

  if (l.games !== r.games) differences.push(`games: ${l.games} here, ${r.games} imported`);
  if (l.players !== r.players) differences.push(`players: ${l.players} here, ${r.players} imported`);
  if (l.teams !== r.teams) differences.push(`opposing teams: ${l.teams} here, ${r.teams} imported`);

  if (!differences.length && !seasonsMatch(local, readBack)) {
    // Same shape, different figures — the dangerous kind, because it looks fine.
    const lt = tallySafe(local);
    const rt = tallySafe(readBack);
    for (const name of Object.keys(lt)) {
      if (lt[name] !== rt[name]) {
        differences.push(`${name}: ${lt[name]} here, ${rt[name] ?? 'missing'} imported`);
      }
    }
    if (!differences.length) differences.push('season statistics do not match after import');
  }

  return { ok: differences.length === 0, differences };
}

function tallySafe(season) {
  try {
    return Object.fromEntries(tallyStandings(season).map((r) => [r.name, `${r.w}-${r.l}-${r.t}`]));
  } catch {
    return {};
  }
}
