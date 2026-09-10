// Supabase-backed adapter for the season repository.
//
// Shape note, deliberately chosen for this phase:
//
// The repository contract was drawn around localStorage, where saving the whole
// season on every state change is free. Over a network it is not. This adapter
// therefore debounces and writes the season as a diffed upsert rather than a
// blob, which is honest for roster/team/history edits — they are rare and
// coarse.
//
// It is NOT how live scoring will work. A game in progress produces an event
// every few seconds from possibly several phones at once, and that goes through
// the append-only game_events log (phase 3), not through here. Season writes and
// play-by-play writes are different problems and get different paths.
//
// localStorage stays underneath as the offline cache: every successful load is
// mirrored locally, so a scorer who opens the app with no signal still sees
// their season.

import { rowsToSeason, seasonToRows } from './seasonMapping.js';
import { createOfflineQueue } from './offlineQueue.js';
import { verifyGame } from './seasonSync.js';

const SAVE_DEBOUNCE_MS = 1200;
const SYNCED_GAMES_KEY = 'score-tracker:syncedGames';

// A per-game marker rather than a timestamp: clocks differ between devices,
// and "everything after time T" is the wrong question once there is more than
// one phone. Games finalised before this existed are simply absent from the
// set and are never uploaded automatically.
function readSyncedGames() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SYNCED_GAMES_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function markGameSynced(id) {
  try {
    const all = readSyncedGames();
    all.add(id);
    localStorage.setItem(SYNCED_GAMES_KEY, JSON.stringify([...all]));
  } catch {
    /* best effort: the game is written either way */
  }
}

/**
 * @param {object} client   a supabase-js client
 * @param {object} options
 * @param {() => string|null} options.getTeamId  which team this device scores for
 * @param {object} [options.cache]  a local repository used as the offline mirror
 */
export function createSupabaseRepository(client, { getTeamId, cache = null, queue = null } = {}) {
  let saveTimer = null;
  let lastError = null;

  // Writes go through a durable queue so that losing signal mid-edit does not
  // lose the edit. The queue replays in order when the connection returns.
  const writes = queue || createOfflineQueue();

  const handlers = {
    season: async (payload) => {
      await writeSeason(payload);
    },
    // A finalized game is an append, not a snapshot. It is enqueued without a
    // coalesceKey so a later season save can never supersede it.
    game: async (record) => {
      await writeGame(record);
    },
  };

  async function flushQueue() {
    const result = await writes.flush(handlers);
    lastError = writes.parked().length ? new Error('Some changes could not be saved') : null;
    return result;
  }

  if (typeof window !== 'undefined' && window.addEventListener) {
    // Coming back online is the moment the queue matters.
    window.addEventListener('online', () => {
      flushQueue().catch(() => {});
    });
  }

  async function fetchSeason(teamId) {
    // One round trip per entity rather than a join, so a failure is
    // attributable and a partial read is never silently treated as a season.
    const [team, players, opponentTeams, games] = await Promise.all([
      client.from('teams').select('*').eq('id', teamId).maybeSingle(),
      client.from('players').select('*').eq('team_id', teamId).order('sort_order'),
      // Deliberately not "every team except mine": row-level security decides
      // what is visible, and asking for everything would sweep in every team
      // of every public league. Scoped to teams this user actually belongs to,
      // then our own is filtered out below.
      client
        .from('teams')
        .select('*, players(*), memberships!inner(user_id)')
        .neq('id', teamId),
      client.from('games').select('*').or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`),
    ]);

    for (const r of [team, players, opponentTeams, games]) {
      if (r.error) throw r.error;
    }
    if (!team.data) return null;

    const gameIds = (games.data || []).map((g) => g.id);
    let gameLines = [];
    if (gameIds.length) {
      const lines = await client.from('game_lines').select('*').in('game_id', gameIds);
      if (lines.error) throw lines.error;
      gameLines = lines.data || [];
    }

    return rowsToSeason(
      {
        team: team.data,
        players: players.data || [],
        opponentTeams: opponentTeams.data || [],
        games: games.data || [],
        gameLines,
      },
      {},
    );
  }

  async function writeSeason(state) {
    const teamId = getTeamId();
    if (!teamId) return;

    // One call, one transaction. Doing this as separate statements left the
    // team renamed but the roster stale when the second one failed.
    const { error } = await client.rpc('save_season', {
      p_team_id: teamId,
      payload: {
        myTeam: state.myTeam,
        roster: state.roster,
      },
    });
    if (error) throw error;
  }


  /**
   * Write one finalized game, then read it back and check the figures the app
   * would show. A row count would not notice the result arriving inverted,
   * which has happened.
   */
  async function writeGame(record) {
    const teamId = getTeamId();
    if (!teamId) return;

    const { error } = await client.rpc('save_game', { p_team_id: teamId, payload: record });
    if (error) throw error;

    const season = await fetchSeason(teamId);
    const readBack = (season && season.history ? season.history : []).find((g) => g.id === record.id);
    const verdict = verifyGame(record, readBack);

    if (!verdict.ok) {
      // Not marked synced: the device copy stays authoritative and the queue
      // parks this where it can be seen.
      const err = new Error(
        `the game read back differently from the account (${verdict.differences.join('; ')})`,
      );
      err.permanent = true;
      throw err;
    }

    markGameSynced(record.id);
  }

  return {
    /** Persist one finalized game. Only ever called on finalization. */
    saveGame(record) {
      if (!record || !record.id) return;
      // No coalesceKey: every finalized game must be replayed on its own.
      writes.enqueue({ kind: 'game', payload: record });
      flushQueue().catch(() => {});
    },

    /** Which games this device has confirmed are in the account. */
    syncedGames: () => readSyncedGames(),

    // The local mirror reads synchronously, so the first paint shows the last
    // known season instead of a blank screen while the network load runs.
    // useGame replaces it with the authoritative copy when that arrives.
    loadSync() {
      return cache && cache.loadSync ? cache.loadSync() : null;
    },

    async load() {
      const teamId = getTeamId();
      if (!teamId) return cache ? cache.loadSync?.() ?? null : null;
      try {
        const season = await fetchSeason(teamId);
        lastError = null;
        if (!season) return cache ? cache.loadSync?.() ?? null : null;

        // The backend holds the SEASON — team, roster, opponents, history. It
        // does not hold this device's own state: which sport is selected, the
        // batting order, the bench, anything mid-game. Returning the season
        // slice alone would replace the whole app state with a fragment and
        // leave, for example, no sport selected at all.
        const base = (cache && cache.loadSync && cache.loadSync()) || {};
        const merged = { ...base, ...season };

        // Mirror locally so the next cold start works with no signal.
        if (cache) cache.save({ ...merged, __mirroredAt: Date.now() });
        return merged;
      } catch (err) {
        lastError = err;
        // Offline or unreachable: fall back to the local mirror rather than
        // presenting an empty season, which would look like data loss.
        return cache ? cache.loadSync?.() ?? null : null;
      }
    },

    save(state) {
      if (cache) cache.save(state); // local mirror is always written first
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const teamId = getTeamId();
        if (!teamId) return;
        // Coalesced per team: a later whole-season snapshot wholly contains an
        // earlier one, so replaying both would be waste, not safety. Event-log
        // appends are never coalesced.
        writes.enqueue({ kind: 'season', payload: state, coalesceKey: teamId });
        flushQueue().catch(() => {});
      }, SAVE_DEBOUNCE_MS);
    },

    /** Push anything queued while offline. Safe to call at any time. */
    flush: flushQueue,

    /** Writes that failed permanently and are waiting to be dealt with. */
    pendingWrites: () => writes.size(),
    parkedWrites: () => writes.parked(),
    retryParked: () => {
      writes.retryParked();
      return flushQueue();
    },

    async getPreserved() {
      return cache ? cache.getPreserved() : null;
    },

    clearPreserved() {
      if (cache) cache.clearPreserved();
    },

    /** Diagnostics for the UI: whether the last backend call failed. */
    getLastError() {
      return lastError;
    },
  };
}
