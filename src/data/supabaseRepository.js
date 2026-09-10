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
import { planBackfill } from './backfill.js';

const SAVE_DEBOUNCE_MS = 1200;

/**
 * The account's history, plus any game that exists only on this device.
 *
 * The account used to replace history wholesale, which quietly erased a game
 * the account had not been told about yet — from the running state AND from the
 * local mirror written straight afterwards. A game finalised while the write was
 * still queued disappeared from the phone on the next reload, which is
 * indistinguishable from data loss even though the queue would have replayed it
 * later.
 *
 * Matching is on the game's client id, which is the same key `save_game` is
 * idempotent on, so a game the account already has is taken from the account
 * and never duplicated. A local game with no id cannot collide with anything
 * and is kept rather than dropped.
 *
 * Device-only games go on the end: history is read newest-last, and a game the
 * account has not seen is by definition one that was just finalised.
 */
export function mergeHistory(local, remote) {
  const fromAccount = remote || [];
  const known = new Set(fromAccount.map((g) => g && g.id).filter(Boolean));
  const deviceOnly = (local || []).filter((g) => g && !known.has(g.id));
  return deviceOnly.length ? [...fromAccount, ...deviceOnly] : fromAccount;
}
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

  /**
   * One game as the app would show it. `writeGame` used to verify by fetching
   * the entire season — five queries plus every box-score line — after every
   * single write, which a backfill would repeat once per game.
   *
   * `rowsToSeason` needs only the games and their lines to build history;
   * `myTeamId` is what decides which side of the row is us.
   */
  async function fetchGame(teamId, clientId) {
    const games = await client
      .from('games')
      .select('*')
      .eq('client_id', clientId)
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`);
    if (games.error) throw games.error;

    const row = (games.data || [])[0];
    if (!row) return null;

    const lines = await client.from('game_lines').select('*').eq('game_id', row.id);
    if (lines.error) throw lines.error;

    const season = rowsToSeason({ games: [row], gameLines: lines.data || [] }, { myTeamId: teamId });
    return (season.history || [])[0] || null;
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

    const readBack = await fetchGame(teamId, record.id);
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

  /**
   * Why a bulk send cannot start right now, or null if it can.
   *
   * Both refusals are deliberate. The queue is strictly ordered and stops at
   * the first failure; a foreground backfill writing directly would jump ahead
   * of writes that are already waiting. And a backfill is a deliberate action
   * with a summary at the end — quietly queueing a dozen games for later is not
   * what someone who tapped this button asked for.
   */
  function backfillBlockedBecause() {
    if (!getTeamId()) return 'this device is not signed in to an account yet';
    if (writes.list().length || writes.parked().length) {
      return 'there are still changes waiting to sync — reconnect and let those finish first';
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return 'there is no connection right now';
    }
    return null;
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

    /**
     * What a bulk send would do, worked out before anything is written.
     *
     * The local half is pure (`planBackfill`); the one query here exists only
     * to label each candidate "new" or "already there", so the summary can say
     * which writes create a row and which update one in place.
     */
    async backfillPlan(history) {
      const teamId = getTeamId();
      const synced = readSyncedGames();

      let remoteIds = null;
      if (teamId) {
        const games = await client
          .from('games')
          .select('client_id')
          .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`);
        // A failed lookup only costs the create/update label, so it is not
        // worth failing the whole pre-flight over.
        if (!games.error) remoteIds = new Set((games.data || []).map((g) => g.client_id).filter(Boolean));
      }

      return { ...planBackfill(history, synced, remoteIds), blockedBecause: backfillBlockedBecause() };
    },

    /**
     * Send past games, one at a time, in order, stopping at the first failure.
     *
     * Deliberately NOT through the write queue. The queue is fire-and-forget,
     * which is right for a game finalised at the field and wrong here: this is
     * a foreground action whose whole point is to say exactly how far it got
     * and exactly what stopped it. Every game that succeeds is marked synced as
     * it goes, so stopping is never ambiguous and re-running resumes.
     */
    async backfillGames(candidates, { onProgress } = {}) {
      const teamId = getTeamId();
      const blocked = backfillBlockedBecause();
      if (blocked) return { ok: false, sent: [], stoppedAt: null, error: blocked, refusedToStart: true };

      const records = (candidates || []).map((c) => (c && c.game ? c.game : c));
      const sent = [];

      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        if (onProgress) onProgress({ done: i, total: records.length, current: record });

        try {
          const { error } = await client.rpc('save_game', { p_team_id: teamId, payload: record });
          if (error) throw error;

          const readBack = await fetchGame(teamId, record.id);
          const verdict = verifyGame(record, readBack);
          if (!verdict.ok) {
            throw new Error(`it read back differently from the account (${verdict.differences.join('; ')})`);
          }

          markGameSynced(record.id);
          sent.push(record.id);
        } catch (err) {
          // Stop dead. Everything before this is sent and marked; everything
          // after is untouched and still on the device.
          return {
            ok: false,
            sent,
            stoppedAt: record,
            error: (err && err.message) || String(err),
            remaining: records.length - i,
          };
        }
      }

      if (onProgress) onProgress({ done: records.length, total: records.length, current: null });
      return { ok: true, sent, stoppedAt: null, error: null };
    },

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
        // History is merged rather than replaced: the account is authoritative
        // for every game it knows about, and silent about the ones it does not.
        const merged = { ...base, ...season, history: mergeHistory(base.history, season.history) };

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
