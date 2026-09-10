// The Supabase adapter's behaviour when the network misbehaves, proven against
// a fake client so it needs no database.
//
// The property that matters: a backend that is unreachable must never look like
// an empty season. Presenting "no data" to someone whose phone lost signal at a
// field is indistinguishable from data loss, and they would reasonably start
// re-entering a roster that already exists.

import { createSupabaseRepository } from '../src/data/supabaseRepository.js';
import { INITIAL_STATE } from '../src/data/league.js';
import { SEEDED } from './fixtures-history.js';

let fail = 0;
const eq = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`FAIL ${l}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log('ok   ' + l);
};

const season = SEEDED(INITIAL_STATE);

// A cache stand-in with the local adapter's shape.
function fakeCache(initial = null) {
  let held = initial;
  return {
    loadSync: () => held,
    save: (s) => { held = s; },
    getPreserved: async () => null,
    clearPreserved: () => {},
    peek: () => held,
  };
}

// A client that always fails, as if offline.
const offlineClient = {
  from() {
    const err = { error: { message: 'network' }, data: null };
    const chain = {
      select: () => chain, eq: () => chain, neq: () => chain, or: () => chain,
      in: () => chain, order: () => chain, update: () => chain, upsert: () => chain,
      maybeSingle: () => Promise.resolve(err),
      then: (res) => res(err),
    };
    return chain;
  },
};

// --- offline load falls back to the mirror, not to emptiness -----------------
{
  const cache = fakeCache(season);
  const repo = createSupabaseRepository(offlineClient, { getTeamId: () => 'team-1', cache });
  const loaded = await repo.load();
  eq('offline load returns the cached season', loaded && loaded.roster.length, season.roster.length);
  eq('offline load is not an empty season', loaded && loaded.history.length > 0, true);
  eq('the failure is recorded for the UI', !!repo.getLastError(), true);
}

// --- with no cache and no backend, report nothing rather than invent one -----
{
  const repo = createSupabaseRepository(offlineClient, { getTeamId: () => 'team-1', cache: null });
  eq('no cache and offline yields null', await repo.load(), null);
}

// --- no team selected yet ----------------------------------------------------
{
  const cache = fakeCache(season);
  const repo = createSupabaseRepository(offlineClient, { getTeamId: () => null, cache });
  const loaded = await repo.load();
  eq('with no team chosen it still shows the local season', loaded && loaded.roster.length, season.roster.length);
}

// --- saving writes the local mirror immediately, before any network ----------
{
  const cache = fakeCache(null);
  const repo = createSupabaseRepository(offlineClient, { getTeamId: () => 'team-1', cache });
  repo.save({ ...season, myTeam: { ...season.myTeam, name: 'Edited' } });
  eq('local mirror is written synchronously', cache.peek().myTeam.name, 'Edited');
  eq('a failing backend does not throw out of save', true, true);
  await new Promise((r) => setTimeout(r, 1500)); // let the debounced push fail
  eq('the season is still in the mirror after a failed push', cache.peek().myTeam.name, 'Edited');
}

// --- a successful load mirrors for the next cold start -----------------------
{
  const rows = {
    team: { id: 't1', name: 'Cached FC', prior_w: 1, prior_l: 2, prior_t: 0, client_id: null },
    players: [], opponentTeams: [], games: [], gameLines: [],
  };
  const okClient = {
    from(table) {
      const chain = {
        select: () => chain, eq: () => chain, neq: () => chain, or: () => chain,
        in: () => chain, order: () => chain,
        maybeSingle: () => Promise.resolve({ data: rows.team, error: null }),
        then: (res) => res({ data: table === 'teams' ? [] : [], error: null }),
      };
      return chain;
    },
  };
  const cache = fakeCache(null);
  const repo = createSupabaseRepository(okClient, { getTeamId: () => 't1', cache });
  const loaded = await repo.load();
  eq('a successful load returns the team', loaded && loaded.myTeam.name, 'Cached FC');
  eq('and mirrors it locally', cache.peek() && cache.peek().myTeam.name, 'Cached FC');
  eq('no error recorded on success', repo.getLastError(), null);
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
