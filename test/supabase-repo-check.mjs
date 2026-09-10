// The Supabase adapter's behaviour when the network misbehaves, proven against
// a fake client so it needs no database.
//
// The property that matters: a backend that is unreachable must never look like
// an empty season. Presenting "no data" to someone whose phone lost signal at a
// field is indistinguishable from data loss, and they would reasonably start
// re-entering a roster that already exists.

import { createSupabaseRepository, mergeHistory } from '../src/data/supabaseRepository.js';
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

// --- a backend load must not replace the whole app state with a fragment ---
// Regression: load() returned only { myTeam, roster, teams, history }. useGame
// set that as the entire state, so sport/lineup/bench vanished and the live
// screen crashed reading TEMPLATES[undefined].
{
  const seasonRows = {
    team: { id: 't9', name: 'Merged FC', prior_w: 0, prior_l: 0, prior_t: 0, client_id: null },
  };
  const client = {
    from(table) {
      const chain = {
        select: () => chain, eq: () => chain, neq: () => chain, or: () => chain,
        in: () => chain, order: () => chain,
        maybeSingle: () => Promise.resolve({ data: seasonRows.team, error: null }),
        then: (res) => res({ data: [], error: null }),
      };
      return chain;
    },
  };
  const localState = { sport: 'softball', lineup: [1, 2, 3], bench: [4], screen: 'team', myTeam: { name: 'Old' } };
  const cache = {
    loadSync: () => localState,
    save: () => {},
    getPreserved: async () => null,
    clearPreserved: () => {},
  };
  const repo = createSupabaseRepository(client, { getTeamId: () => 't9', cache });
  const loaded = await repo.load();
  eq('the season is taken from the backend', loaded.myTeam.name, 'Merged FC');
  eq('the selected sport is kept', loaded.sport, 'softball');
  eq('the batting order is kept', loaded.lineup, [1, 2, 3]);
  eq('the bench is kept', loaded.bench, [4]);
}

// --- merging history: the account is authoritative only for what it knows ----
// History used to be replaced wholesale, which erased a game finalised while
// its write was still queued — gone from the running state, and gone from the
// local mirror written straight afterwards.
{
  const a = { id: 'a', result: 'W' };
  const b = { id: 'b' };
  const c = { id: 'c' };

  eq('nothing local, the account wins', mergeHistory([], [a, b]).map((g) => g.id), ['a', 'b']);
  eq('nothing from the account, the device is kept', mergeHistory([a], []).map((g) => g.id), ['a']);
  eq('overlapping games are not duplicated', mergeHistory([a, b], [a, b]).map((g) => g.id), ['a', 'b']);
  eq('a game only this device has is appended', mergeHistory([a, c], [a, b]).map((g) => g.id), ['a', 'b', 'c']);
  eq('and it goes last, because it is the newest', mergeHistory([c], [a, b]).map((g) => g.id).pop(), 'c');

  // The account's copy of a shared game wins: it is the one that has been
  // verified on write, and the device's may be a stale mirror.
  const stale = { id: 'a', result: 'L' };
  eq('a game both have is taken from the account', mergeHistory([stale], [a])[0].result, 'W');
  eq('and only once', mergeHistory([stale], [a]).length, 1);

  eq('a local game with no id is kept rather than dropped',
    mergeHistory([{ label: 'no id' }], [a]).length, 2);
  eq('undefined either side is safe', mergeHistory(undefined, undefined), []);
  eq('nulls inside the local list do not throw', mergeHistory([null, c], [a]).map((g) => g && g.id), ['a', 'c']);
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
