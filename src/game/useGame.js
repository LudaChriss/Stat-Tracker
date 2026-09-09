import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { INITIAL_STATE } from '../data/league.js';
import {
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
  const [state, setState] = useState(INITIAL_STATE);

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
        patch({
          confirmFinal: false,
          gameActive: false,
          gameFinal: true,
          screen: 'league',
          liveTab: 'entry',
          synced: false,
        });
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

      // Player profile
      openPlayer: (playerId, playerFrom) => () => patch({ screen: 'player', playerId, playerFrom }),
      toggleStatSet: () => setState((s) => ({ ...s, statSet: (s.statSet + 1) % 2 })),
    };
  }, [patch, toast, markUnsynced]);

  return { state, actions };
}
