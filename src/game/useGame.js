import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { INITIAL_STATE, PLAYER_COLORS } from '../data/league.js';
import { nextId, slugId } from '../data/ids.js';
import { createLocalRepository } from '../data/localRepository.js';
import { saveSeasonFile } from './export.js';
import { applySeason, parseSeasonFile } from './importSeason.js';
import { requestPersistence } from './storage.js';
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

// The default when nothing is injected: this device's own storage. A
// Supabase-backed repository is passed in once someone signs in — which is
// the whole point of the abstraction, and why nothing below this line had to
// change to do it.
const defaultRepository = createLocalRepository();

/**
 * Owns the whole app state. Every action is expressed as a state -> state
 * function so the scoring engine stays testable and free of React.
 */
export function useGame(injectedRepository) {
  const repository = injectedRepository || defaultRepository;
  // Start blank; resume a saved season once the repository resolves. The
  // load is async-friendly (a network adapter will genuinely await it), but
  // the local adapter settles on a microtask, so kicking it off in a layout
  // effect — which runs before the browser paints — means the very first
  // paint already shows the restored season rather than a blank flash.
  //
  // An adapter with synchronous storage seeds the first render directly, so
  // there is no flash of the setup screen before the season appears. Adapters
  // without loadSync (anything network-backed) start blank and hydrate below.
  const seededRef = useRef(null);
  const syncSeed = (repository.loadSync && repository.loadSync()) || null;
  const [state, setState] = useState(() => {
    const seed = syncSeed || INITIAL_STATE;
    seededRef.current = seed;
    return seed;
  });
  // Saving is only safe once we actually HAVE the season — not merely because
  // the adapter offers a synchronous read.
  //
  // This previously asked whether loadSync existed rather than whether it
  // returned anything. On a device with nothing cached — a second phone, a
  // reinstall — that made a blank first render count as hydrated, and the app
  // saved that emptiness over a real season. Waiting for the async load costs
  // nothing here and is the difference between a stale render and data loss.
  const [hydrated, setHydrated] = useState(() => !!syncSeed);

  useLayoutEffect(() => {
    // Always run the async load, even when a synchronous seed was available:
    // for a network-backed adapter the seed is only the local mirror, and the
    // authoritative copy still has to be fetched.
    let cancelled = false;
    repository
      .load()
      .then((loaded) => {
        if (cancelled || !loaded) return;
        // Do not overwrite anything the user has already changed while the
        // load was in flight — only replace the untouched seed.
        setState((current) => (current === seededRef.current ? loaded : current));
      })
      .catch(() => {
        /* best-effort: keep whatever was seeded */
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Persist whenever the durable slice of state changes — but never before
  // the initial load has settled. Saving the blank starting state while a
  // real season is still being restored would overwrite it before it ever
  // loads, which is exactly the "lost the first save" failure this guards
  // against.
  useEffect(() => {
    if (!hydrated) return;
    repository.save(state);
  }, [state, hydrated]);

  // Ask once for eviction protection. Not a guarantee, and it does not
  // survive uninstalling the app — export remains the only real backup.
  useEffect(() => {
    requestPersistence();
  }, []);

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
          lastPlay: { k: '/', detail: `Side over — ${s.myTeam.name} up` },
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

      // Abandoning a game in progress
      askCancelGame: () => patch({ confirmCancelGame: true }),
      dismissCancelGame: () => patch({ confirmCancelGame: false }),

      /**
       * Throw the in-progress game away. Nothing is written to history, so
       * standings and season stats are untouched — it is as if it never
       * started. The batting order is kept so another game can be started
       * straight away.
       */
      cancelGame: () =>
        setState((s) => ({
          ...s,
          screen: 'newgame',
          gameActive: false,
          gameFinal: false,
          liveTab: 'entry',
          half: 'top',
          inning: 1,
          outs: 0,
          bases: [null, null, null],
          score: { home: 0, away: 0 },
          kiHome: 0,
          kiAway: 0,
          gameStats: {},
          events: [],
          undoStack: [],
          tape: [],
          lastPlay: null,
          bookOff: null,
          selRunner: null,
          posMenu: null,
          confirmFinal: false,
          confirmCancelGame: false,
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
        // Push the finished game on its own, separately from the debounced
        // season snapshot: a game is an append and must not be coalesced away.
        if (repository.saveGame) repository.saveGame(record);
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
        setState((s) => {
          // Never empty the order completely — there would be nobody to bat.
          if (s.lineup.length <= 1 || !s.lineup.includes(id)) return { ...s, posMenu: null };
          return {
            ...s,
            lineup: s.lineup.filter((x) => x !== id),
            bench: s.bench.includes(id) ? s.bench : [...s.bench, id],
            posMenu: null,
          };
        }),

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
        setState((s) =>
          name.trim() ? { ...s, myTeam: { ...s.myTeam, name: name.trim() }, resetFlow: null } : s,
        ),

      // ---- Backup & reset --------------------------------------------------
      // Called straight from a tap: browsers block share/download otherwise.
      exportSeason: async () => {
        const result = await saveSeasonFile(stateRef.current);
        if (result === 'shared' || result === 'downloaded') toast('Season data exported');
        else if (result === 'copied') toast('Copied season JSON to the clipboard', 3200);
        else if (result === 'failed') toast('Could not export — try again', 3200);
      },

      // ---- Import ----------------------------------------------------------
      /** Read a chosen backup file and stage it for confirmation. */
      importFile: async (file) => {
        if (!file) return;
        let text;
        try {
          text = await file.text();
        } catch {
          patch({ importError: "That file couldn't be read." });
          return;
        }
        const result = parseSeasonFile(text);
        if (!result.ok) {
          patch({ importError: result.error });
          return;
        }
        patch({ importPreview: { season: result.season, summary: result.summary }, importError: null });
      },

      /** Offer whatever unreadable payload was preserved on a failed load. */
      importPreserved: async () => {
        const raw = await repository.getPreserved();
        if (!raw) return;
        const result = parseSeasonFile(raw);
        if (!result.ok) {
          patch({ importError: `Preserved save could not be read: ${result.error}` });
          return;
        }
        patch({ importPreview: { season: result.season, summary: result.summary }, importError: null });
      },

      dismissPreserved: () => {
        repository.clearPreserved();
        patch({ importError: null });
      },

      cancelImport: () => patch({ importPreview: null, importError: null }),

      confirmImport: () =>
        setState((s) => (s.importPreview ? applySeason(s, s.importPreview.season) : s)),

      openReset: () => patch({ resetFlow: 'confirm' }),
      openRename: () => patch({ resetFlow: 'rename' }),
      openRecordEditor: () => patch({ recordEditor: true }),
      closeRecordEditor: () => patch({ recordEditor: false }),

      /** Manual W/L/T offset for games that were played but never scored here. */
      setManualRecord: ({ priorW, priorL, priorT }) =>
        setState((s) => ({
          ...s,
          myTeam: {
            ...s.myTeam,
            priorW: Math.max(0, Number(priorW) || 0),
            priorL: Math.max(0, Number(priorL) || 0),
            priorT: Math.max(0, Number(priorT) || 0),
          },
          recordEditor: false,
        })),
      closeReset: () => patch({ resetFlow: null }),
      confirmReset: () => patch({ resetFlow: 'name' }),

      /** Wipe everything and start a blank season under a new team name. */
      startFreshSeason: (teamName) =>
        setState((s) => ({
          ...s,
          myTeam: { name: teamName.trim() || 'My Team', priorW: 0, priorL: 0 },
          roster: [],
          teams: [],
          lineup: [],
          bench: [],
          history: [],
          opponentId: null,
          posOverride: {},
          gameStats: {},
          events: [],
          undoStack: [],
          tape: [],
          lastPlay: null,
          bases: [null, null, null],
          score: { home: 0, away: 0 },
          outs: 0,
          inning: 1,
          half: 'top',
          kiHome: 0,
          kiAway: 0,
          gameActive: false,
          gameFinal: false,
          resetFlow: null,
          playerEditor: null,
          teamEditor: null,
          editTeamId: null,
          screen: 'roster',
        })),

      // ---- Past games ------------------------------------------------------
      openGame: (id, from) => () => patch({ screen: 'gameDetail', viewGameId: id, gameFrom: from }),
      goBackFromGame: () =>
        patch({ screen: stateRef.current.gameFrom === 'player' ? 'player' : 'team', viewGameId: null }),
      openDeleteGame: (id) => () => patch({ confirmDeleteGame: id }),
      cancelDeleteGame: () => patch({ confirmDeleteGame: null }),
      deleteGame: () =>
        setState((s) => ({
          ...s,
          history: s.history.filter((g) => g.id !== s.confirmDeleteGame),
          confirmDeleteGame: null,
          viewGameId: null,
          screen: 'team',
        })),

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
