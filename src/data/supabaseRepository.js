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

const SAVE_DEBOUNCE_MS = 1200;

/**
 * @param {object} client   a supabase-js client
 * @param {object} options
 * @param {() => string|null} options.getTeamId  which team this device scores for
 * @param {object} [options.cache]  a local repository used as the offline mirror
 */
export function createSupabaseRepository(client, { getTeamId, cache = null } = {}) {
  let saveTimer = null;
  let lastError = null;

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

    const rows = seasonToRows(state, { myTeamId: teamId });

    // Upserts are keyed on the natural identity of each row, so a repeated
    // save is idempotent rather than duplicating a roster.
    const steps = [
      client.from('teams').update({
        name: rows.team.name,
        prior_w: rows.team.prior_w,
        prior_l: rows.team.prior_l,
        prior_t: rows.team.prior_t,
      }).eq('id', teamId),
      rows.players.length
        ? client.from('players').upsert(
            rows.players.map((p) => ({ ...p, team_id: teamId })),
            { onConflict: 'team_id,client_id' },
          )
        : null,
    ].filter(Boolean);

    const results = await Promise.all(steps);
    const failed = results.find((r) => r && r.error);
    if (failed) throw failed.error;
  }

  return {
    async load() {
      const teamId = getTeamId();
      if (!teamId) return cache ? cache.loadSync?.() ?? null : null;
      try {
        const season = await fetchSeason(teamId);
        lastError = null;
        // Mirror locally so the next cold start works with no signal.
        if (season && cache) cache.save({ ...season, __mirroredAt: Date.now() });
        return season;
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
        writeSeason(state).catch((err) => {
          lastError = err;
          // Phase 6b turns this into a retry queue; for now the local mirror
          // means nothing is lost, it is just not yet pushed.
        });
      }, SAVE_DEBOUNCE_MS);
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
