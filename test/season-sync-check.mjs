// The sync decision is what stands between a user and a lost or duplicated
// season, so every branch is pinned here — especially the two that must resolve
// SILENTLY. A prompt on a fresh reinstall, or on a device already in sync,
// would train someone to click through it, which is how the dangerous case gets
// clicked through too.

import {
  decideSync,
  isEmptySeason,
  seasonFingerprint,
  seasonsMatch,
  summarize,
  verifyMigration,
} from '../src/data/seasonSync.js';
import { INITIAL_STATE } from '../src/data/league.js';
import { SEEDED } from './fixtures-history.js';

let fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    fail++;
    console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  } else console.log('ok   ' + label);
};

const blank = INITIAL_STATE;
const season = SEEDED(INITIAL_STATE);
const clone = (s) => JSON.parse(JSON.stringify(s));

// --- emptiness ---------------------------------------------------------------
eq('a fresh install is empty', isEmptySeason(blank), true);
eq('null is empty', isEmptySeason(null), true);
eq('a seeded season is not empty', isEmptySeason(season), false);
eq('a named team alone is not empty', isEmptySeason({ ...blank, myTeam: { name: 'X' } }), false);

// --- the silent paths --------------------------------------------------------
eq('fresh install, account has a season -> adopt silently',
   decideSync({ local: blank, remote: season, signedIn: true }).action, 'adopt-backend');
eq('nothing anywhere -> adopt silently',
   decideSync({ local: blank, remote: blank, signedIn: true }).action, 'adopt-backend');
eq('device in sync with the account -> adopt silently, no prompt',
   decideSync({ local: season, remote: clone(season), signedIn: true }).action, 'adopt-backend');
eq('local season, empty account -> migrate up',
   decideSync({ local: season, remote: blank, signedIn: true }).action, 'migrate-up');
eq('not signed in -> stay local',
   decideSync({ local: season, remote: season, signedIn: false }).action, 'local-only');

// --- the one path that asks --------------------------------------------------
const extraGame = clone(season);
extraGame.history = extraGame.history.slice(0, 3);
const differing = decideSync({ local: season, remote: extraGame, signedIn: true });
eq('different game counts -> ask', differing.action, 'ask');
eq('the prompt can say what differs (local)', differing.local.games, 4);
eq('the prompt can say what differs (remote)', differing.remote.games, 3);

// Same game count, different figures — the case that looks identical.
const tweaked = clone(season);
tweaked.history[0].lines[0].h += 1;
eq('same game count but different stats -> ask',
   decideSync({ local: season, remote: tweaked, signedIn: true }).action, 'ask');

// --- the fingerprint ignores what the user would not notice ------------------
const reordered = clone(season);
reordered.roster.reverse();
eq('reordering the roster is not a difference', seasonsMatch(season, reordered), true);

const renamed = clone(season);
renamed.myTeam = { ...renamed.myTeam, name: 'Different Name' };
eq('renaming the team IS a difference', seasonsMatch(season, renamed), false);

const differentRecord = clone(season);
differentRecord.myTeam = { ...differentRecord.myTeam, priorW: 99 };
eq('a different manual record IS a difference', seasonsMatch(season, differentRecord), false);

eq('a null season has no fingerprint', seasonFingerprint(null), null);
eq('two empties match', seasonsMatch(blank, clone(blank)), true);

// --- migration verification --------------------------------------------------
eq('an identical read-back verifies', verifyMigration(season, clone(season)).ok, true);
eq('nothing read back fails verification', verifyMigration(season, null).ok, false);
eq('and says why', verifyMigration(season, null).differences.length > 0, true);

const missingGame = clone(season);
missingGame.history.pop();
const v1 = verifyMigration(season, missingGame);
eq('a missing game fails verification', v1.ok, false);
eq('and names the game counts', v1.differences[0].includes('games: 4'), true);

const missingPlayer = clone(season);
missingPlayer.roster.pop();
eq('a missing player fails verification', verifyMigration(season, missingPlayer).ok, false);

// The dangerous one: right shape, wrong figures.
const flipped = clone(season);
const away = flipped.history.find((g) => g.home === false);
away.result = away.result === 'L' ? 'W' : 'L';
const v2 = verifyMigration(season, flipped);
eq('an inverted away result fails verification', v2.ok, false);
eq('and reports the standings that disagree', v2.differences.some((d) => d.includes('-')), true);

// --- summaries ---------------------------------------------------------------
eq('summary counts', summarize(season), {
  team: season.myTeam.name,
  players: season.roster.length,
  teams: season.teams.length,
  games: season.history.length,
});
eq('summary of nothing', summarize(null), { team: '', players: 0, teams: 0, games: 0 });

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
