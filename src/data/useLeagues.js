// The league screen's state.
//
// Kept out of useGame on purpose. useGame owns the SEASON — one team, its
// roster, its history, the game in progress. A league is a different thing: it
// has its own teams and its own fixtures, and one account can belong to
// several. Folding the two together would mean the season and the league could
// disagree about which team you are, which is exactly the confusion phase 4 is
// supposed to remove.
//
// Nothing here is loaded until the screen is opened. A league is not needed to
// score a game, and a phone at a field with no signal should not be waiting on
// one.

import { useCallback, useRef, useState } from 'react';
import { buildFixture, createLeagues, leagueErrorMessage } from './leagues.js';

const EMPTY = {
  status: 'idle',      // idle | loading | ready | error
  mine: [],            // leagues this account belongs to
  detail: null,        // the league being looked at, with its teams and fixtures
  error: null,
  busy: false,         // a write is in flight
  code: null,          // a freshly minted invite, shown once
  notice: null,        // something that just happened, worth a line on screen
};

export function useLeagues(client, { getTeamId } = {}) {
  const [state, setState] = useState(EMPTY);
  const apiRef = useRef(null);
  if (!apiRef.current) apiRef.current = createLeagues(client);
  const api = apiRef.current;

  const stateRef = useRef(state);
  stateRef.current = state;

  const patch = useCallback((p) => setState((s) => ({ ...s, ...p })), []);

  /** The leagues this account is in. Cheap, and re-read after anything writes. */
  const refresh = useCallback(async () => {
    if (!api.isAvailable) {
      patch({ status: 'ready', mine: [], error: null });
      return;
    }
    patch({ status: stateRef.current.mine.length ? 'ready' : 'loading', error: null });
    const { leagues, error } = await api.mine();
    if (error) {
      patch({ status: 'error', error: leagueErrorMessage(error) });
      return;
    }
    patch({ status: 'ready', mine: leagues, error: null });
  }, [api, patch]);

  /** Open one. Re-read rather than reused from the list: the list has names only. */
  const open = useCallback(
    async (leagueId) => {
      patch({ busy: true, error: null, code: null, notice: null });
      const result = await api.detail(leagueId);
      if (result.error) {
        patch({ busy: false, error: leagueErrorMessage(result.error) });
        return;
      }
      const mine = stateRef.current.mine.find((l) => l.id === leagueId);
      patch({
        busy: false,
        detail: { ...result, role: mine ? mine.role : null },
        error: null,
      });
    },
    [api, patch],
  );

  const reopen = useCallback(async () => {
    const current = stateRef.current.detail;
    if (current && current.league) await open(current.league.id);
  }, [open]);

  const close = useCallback(() => patch({ detail: null, code: null, notice: null, error: null }), [patch]);

  /** Wrap a write: one busy flag, one error, one refresh, said once. */
  const run = useCallback(
    async (fn, { after = null, notice = null } = {}) => {
      patch({ busy: true, error: null, notice: null, code: null });
      const result = await fn();
      if (result && result.error) {
        patch({ busy: false, error: leagueErrorMessage(result.error) });
        return result;
      }
      if (after) await after(result);
      patch({ busy: false, error: null, notice });
      return result;
    },
    [patch],
  );

  const actions = {
    refresh,
    open,
    close,
    dismissError: () => patch({ error: null }),
    dismissNotice: () => patch({ notice: null, code: null }),

    create: (name, sport) =>
      run(() => api.create(name, sport), {
        after: async (r) => {
          await refresh();
          if (r && r.leagueId) await open(r.leagueId);
        },
      }),

    /** Mint a code. Shown once, on screen, because there is nowhere else it lives. */
    invite: async (role, days) => {
      const detail = stateRef.current.detail;
      if (!detail) return null;
      const result = await run(() => api.invite(detail.league.id, role, days));
      if (result && result.invite) patch({ code: result.invite.code, notice: null });
      return result;
    },

    /** Redeem a code, optionally bringing this device's team in with it. */
    join: (code, bringTeam) =>
      run(() => api.join(code, bringTeam ? (getTeamId ? getTeamId() : null) : null), {
        after: async (r) => {
          await refresh();
          if (r && r.joined) await open(r.joined.league_id);
        },
      }),

    schedule: (fixture) => {
      const detail = stateRef.current.detail;
      if (!detail) return null;
      return run(() => api.schedule(detail.league.id, buildFixture(fixture)), {
        after: reopen,
        notice: 'Fixture added',
      });
    },

    addTeam: (teamId) => {
      const detail = stateRef.current.detail;
      if (!detail || !teamId) return null;
      return run(() => api.addTeam(teamId, detail.league.id), {
        after: reopen,
        notice: 'Your team is in the league',
      });
    },

    removeTeam: (teamId) =>
      run(() => api.removeTeam(teamId), { after: reopen, notice: 'Team removed from the league' }),
  };

  return { ...state, actions, isAvailable: api.isAvailable };
}
