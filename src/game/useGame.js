import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { INITIAL_STATE, PLAYER_COLORS } from '../data/league.js';
import { nextId, slugId } from '../data/ids.js';
import { loadState, saveState } from './storage.js';
import {
  buildGameRecord,
  applyMoveLineup,
  applyOutcome,
  applyQuick,
  applyRunnerAction,
  applyUndo,
} from './logic.js';

const TOAST_MS = 2600;
const SYNC_MS = 3200;

/**
 * Owns the whole app state. Every action is expressed as a state -> state
 * function so the scoring engine stays testable and free of React.
 */
export function useGame() {
  // Resume a saved season if there is one; otherwise start fresh.
  const [state, setState] = useState(() => loadState(INITIAL_STATE));

  // Actions are memoised once, so the few that need to *read* current state
  // outside of an updater (to fire a toast, say) go through this ref.
  const stateRef = useRef(state);
  stateRef.current = state;

  // Toast auto-dismiss and the fake "syncing…" window both need timers that
  // survive re-renders and get cleared on unmount.
  const toastTimer = useRef(null);
  const syncTimer = useRef(null);
  useEffect(
    () => () => {
      clearTimeout(toastTimer.current);
      clearTimeout(syncTimer.current);
    },
    [],
  );

  // Persist whenever the durable slice of state changes.
  useEffect(() => {
    saveState(state);
  }, [state]);

  const patch = useCallback((p) => setState((s) => ({ ...s, ...p })), []);

  const toast = useCallback(
    (msg, ms = TOAST_MS) => {
      patch({ toast: msg });
      clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => patch({ toast: null }), ms);
    },
    [patch],
  );

  // Mark unsynced, then let it settle back to synced a moment later.
  const markUnsynced = useCallback(() => {
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => patch({ synced: true }), SYNC_MS);
  }, [patch]);

  const actions = useMemo(() => {
    const go = (screen) => () => patch({ screen, selRunner: null });

    return {
      noop: () => {},
      go,
      goTeam: go('team'),
      goLeague: go('league'),
      goNewGame: go('newgame'),
      goScanCam: go('scanCam'),

      // New game setup
      setSport: (sport) => () => patch({ sport }),
      setOpponent: (opponentId) => () => patch({ opponentId, opponentPicker: false }),
      openOpponentPicker: () => patch({ opponentPicker: true }),
      closeOpponentPicker: () => patch({ opponentPicker: false }),
      setTrackMode: (trackMode) => () => patch({ trackMode }),
      startGame: () =>
        patch({
          screen: 'live',
          liveTab: 'lineup',
          gameActive: true,
          gameFinal: false,
          half: 'top',
          inning: 1,
          outs: 0,
          bases: [null, null, null],
          score: { home: 0, away: 0 },
          kiHome: 0,
          kiAway: 0,
          undoStack: [],
          lastPlay: null,
          tape: [],
          gameStats: {},
          events: [],
          bookOff: null,
        }),

      // Scoring
      record: (o) => setState((s) => applyOutcome(s, o)),
      quick: (isRun) => setState((s) => applyQuick(s, isRun)),
      quickRunMinus: () =>
        setState((s) =>
          s.score.away > 0 ? { ...s, score: { ...s.score, away: s.score.away - 1 } } : s,
        ),
      endTheirHalf: () =>
        setState((s) => ({
          ...s,
          outs: 0,
          bases: [null, null, null],
          half: 'bot',
          selRunner: null,
          lastPlay: { k: '/', detail: 'Side over — Grass Stains up' },
          tape: [...s.tape, '/'].slice(-9),
        })),
      undo: () => setState(applyUndo),

      // Base runners
      selectRunner: (i) =>
        setState((s) => (s.bases[i] ? { ...s, selRunner: s.selRunner === i ? null : i } : s)),
      runnerAction: (adv) => () => setState((s) => applyRunnerAction(s, adv)),
      clearSel: () => patch({ selRunner: null }),

      // Live tabs
      setLiveTab: (liveTab) => () => patch({ liveTab }),
      setStatsTeam: (statsTeam) => () => patch({ statsTeam }),
      trackBothNow: () => {
        patch({ trackMode: 'both' });
        toast('Now tracking both teams');
      },

      // Scorebook paging
      setBookOff: (bookOff) => () => patch({ bookOff }),

      // Lineup
      moveLineup: (idx, dir) => () => setState((s) => applyMoveLineup(s, idx, dir)),
      addFromBench: (id) => () =>
        setState((s) => ({
          ...s,
          lineup: [...s.lineup, id],
          bench: s.bench.filter((b) => b !== id),
        })),
      openPosMenu: (id) => () => patch({ posMenu: id }),
      closePosMenu: () => patch({ posMenu: null }),
      setPos: (pos) => () =>
        setState((s) => ({
          ...s,
          posOverride: { ...s.posOverride, [s.posMenu]: pos },
          posMenu: null,
        })),

      // Finalizing
      askFinalize: () => patch({ confirmFinal: true }),
      cancelFinalize: () => patch({ confirmFinal: false }),
      doFinalize: () => {
        // Freeze the box score before the live state is torn down. Built out
        // here rather than inside the updater so the updater stays pure.
        const record = buildGameRecord(stateRef.current);
        setState((s) => ({
          ...s,
          history: [...s.history, record],
          confirmFinal: false,
          gameActive: false,
          gameFinal: true,
          screen: 'league',
          liveTab: 'entry',
          synced: false,
        }));
        toast('Game finalized · standings updated', 3000);
        markUnsynced();
      },

      // Scanning
      scan: (scanType) => () => patch({ screen: 'scanCam', scanType }),
      capture: go('scanReview'),
      confirmScan: () => {
        patch({ screen: 'team', synced: false });
        toast(
          stateRef.current.scanType === 'scorecard'
            ? 'Scorecard imported · saved locally, syncing'
            : '4 games added · saved locally, syncing',
        );
        markUnsynced();
      },

      // ---- Roster & team editing ------------------------------------------
      // teamId null means our own roster; otherwise an opposing team's.
      openPlayerEditor: (teamId, id) => () => patch({ playerEditor: { teamId, id } }),
      closePlayerEditor: () => patch({ playerEditor: null }),

      savePlayer: ({ teamId, id, name, num, pos }) =>
        setState((s) => {
          const trimmed = name.trim();
          if (!trimmed) return s;

          if (teamId == null) {
            if (id == null) {
              const newId = nextId(s.roster);
              const player = {
                id: newId,
                name: trimmed,
                num,
                pos,
                c: PLAYER_COLORS[s.roster.length % PLAYER_COLORS.length],
              };
              // New players start on the bench, not silently in the order.
              return { ...s, roster: [...s.roster, player], bench: [...s.bench, newId], playerEditor: null };
            }
            return {
              ...s,
              roster: s.roster.map((p) => (p.id === id ? { ...p, name: trimmed, num, pos } : p)),
              playerEditor: null,
            };
          }

          return {
            ...s,
            teams: s.teams.map((t) => {
              if (t.id !== teamId) return t;
              if (id == null) {
                const newId = nextId(t.players);
                return {
                  ...t,
                  players: [
                    ...t.players,
                    {
                      id: newId,
                      name: trimmed,
                      num,
                      pos,
                      c: PLAYER_COLORS[t.players.length % PLAYER_COLORS.length],
                    },
                  ],
                };
              }
              return {
                ...t,
                players: t.players.map((p) => (p.id === id ? { ...p, name: trimmed, num, pos } : p)),
              };
            }),
            playerEditor: null,
          };
        }),

      removePlayer: (teamId, id) => () =>
        setState((s) => {
          if (teamId != null) {
            return {
              ...s,
              teams: s.teams.map((t) =>
                t.id === teamId ? { ...t, players: t.players.filter((p) => p.id !== id) } : t,
              ),
              playerEditor: null,
            };
          }
          // Drop them from the order and the bench too, or the lineup would
          // point at a player who no longer exists. Past games keep their
          // name, so history is unaffected.
          const posOverride = { ...s.posOverride };
          delete posOverride[id];
          return {
            ...s,
            roster: s.roster.filter((p) => p.id !== id),
            lineup: s.lineup.filter((x) => x !== id),
            bench: s.bench.filter((x) => x !== id),
            posOverride,
            playerEditor: null,
          };
        }),

      // Move a player between the batting order and the bench.
      benchPlayer: (id) => () =>
        setState((s) => ({
          ...s,
          lineup: s.lineup.filter((x) => x !== id),
          bench: s.bench.includes(id) ? s.bench : [...s.bench, id],
        })),

      openTeamEditor: (id) => () => patch({ teamEditor: { id } }),
      closeTeamEditor: () => patch({ teamEditor: null }),

      saveTeam: ({ id, name, priorW, priorL }) =>
        setState((s) => {
          const trimmed = name.trim();
          if (!trimmed) return s;
          if (id == null) {
            const team = {
              id: slugId(trimmed, s.teams),
              name: trimmed,
              priorW: priorW || 0,
              priorL: priorL || 0,
              players: [],
            };
            return {
              ...s,
              teams: [...s.teams, team],
              // First team added becomes the default opponent.
              opponentId: s.teams.length ? s.opponentId : team.id,
              teamEditor: null,
            };
          }
          return {
            ...s,
            teams: s.teams.map((t) =>
              t.id === id ? { ...t, name: trimmed, priorW: priorW || 0, priorL: priorL || 0 } : t,
            ),
            teamEditor: null,
          };
        }),

      removeTeam: (id) => () =>
        setState((s) => {
          const teams = s.teams.filter((t) => t.id !== id);
          return {
            ...s,
            teams,
            // Past games keep the team's name, so the history stays readable.
            opponentId: s.opponentId === id ? (teams[0] ? teams[0].id : null) : s.opponentId,
            teamEditor: null,
            screen: s.screen === 'teamDetail' ? 'teams' : s.screen,
          };
        }),

      renameMyTeam: (name) =>
        setState((s) => (name.trim() ? { ...s, myTeam: { ...s.myTeam, name: name.trim() } } : s)),

      goRoster: go('roster'),
      goTeams: go('teams'),
      openTeamDetail: (id) => () => patch({ screen: 'teamDetail', editTeamId: id }),

      // Player profile
      openPlayer: (playerId, playerFrom) => () => patch({ screen: 'player', playerId, playerFrom }),
      toggleStatSet: () => setState((s) => ({ ...s, statSet: (s.statSet + 1) % 2 })),
    };
  }, [patch, toast, markUnsynced]);

  return { state, actions };
}
