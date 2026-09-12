import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { INITIAL_STATE, PLAYER_COLORS } from '../data/league.js';
import { newEventId, nextId, slugId } from '../data/ids.js';
import { createLocalRepository } from '../data/localRepository.js';
import { saveSeasonFile } from './export.js';
import { applySeason, parseSeasonFile } from './importSeason.js';
import { requestPersistence } from './storage.js';
import { buildGameRecord, applyMoveLineup, opponentTeam } from './logic.js';
import { createReplayer, liveSlice, logStatus, mergeLog, replay, undoTarget } from './events.js';
import { reconcileBoxScore } from './reconcile.js';

const TOAST_MS = 2600;
const SYNC_MS = 3200;

// How often to ask the account for plays we have not been told about. This is
// the safety net under the realtime subscription, not the primary path — see
// the effect that uses it.
const LIVE_POLL_MS = 6000;

// How often to check whether someone else has a game going, while this phone
// is not in one. Rare on purpose: it is a question about the next few minutes,
// not the next few seconds.
const JOINABLE_POLL_MS = 15000;

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

  // ---- The live event log --------------------------------------------------
  //
  // Live game state is no longer mutated in place. Every play is appended to a
  // log and the state is folded back out of it, which is what lets a second
  // phone's play land in the middle of yours without anything being lost.
  //
  // Two lists, deliberately kept apart:
  //
  //   gameLog     what THIS device entered, in the order it entered it
  //   serverLog   what the account accepted, in the order IT assigned
  //
  // `mergeLog` puts the accepted ones first, in server order, and this
  // device's not-yet-accepted ones after, in its own order. With no backend at
  // all the server list stays empty and the fold is simply the local order,
  // which is how a game scored on a phone with no account still works.
  const foldRef = useRef(null);
  if (!foldRef.current) foldRef.current = createReplayer();

  /** Re-derive the live slice of state from the log. */
  const withLog = useCallback((s, next) => {
    const gameLog = next.gameLog === undefined ? s.gameLog : next.gameLog;
    const serverLog = next.serverLog === undefined ? s.serverLog : next.serverLog;
    const derived = foldRef.current(s, mergeLog(serverLog, gameLog));
    if (!derived) return { ...s, gameLog, serverLog };

    const out = { ...s, ...liveSlice(derived), gameLog, serverLog };
    // A selected runner is this phone's UI, but it points at a base. If the
    // bases moved — by our own play or by someone else's — the selection now
    // means something different from what was tapped, so drop it.
    if (s.selRunner != null && String(s.bases) !== String(out.bases)) out.selRunner = null;
    // The end of the 7th asks whether the game is over. Ask once: replaying
    // the log recomputes that flag every time, and a sheet that reopens after
    // being dismissed is worse than no prompt.
    if (derived.confirmFinal && !s.finalPrompted) {
      out.confirmFinal = true;
      out.finalPrompted = true;
    }

    // The game ended somewhere else. The log says so — a cancel or a final
    // event from the other phone — and this phone has to stop being in it,
    // rather than sitting on a live screen for a game that is over.
    if (s.gameActive && (derived.cancelled || derived.finalized)) {
      out.liveEnded = derived.cancelled ? 'cancelled' : 'final';
      out.screen = s.screen === 'live' ? 'league' : s.screen;
      out.liveTab = 'entry';
      out.confirmFinal = false;
      out.confirmCancelGame = false;
      out.selRunner = null;
      out.gameLog = [];
      out.serverLog = [];
      out.gameClientId = null;
      out.gameStartedAt = null;
      out.gameOpponentTeamId = null;
      out.gameHome = true;
      out.gameFixture = null;
      out.liveGameId = null;
      out.liveConnected = false;
      out.finalPrompted = false;
    }
    return out;
  }, []);

  /** What the backend needs to know about this game to hold its log. */
  const describeGame = useCallback((s) => {
    if (!s.gameClientId) return null;
    const when = s.gameStartedAt ? new Date(s.gameStartedAt) : new Date();
    return {
      clientId: s.gameClientId,
      opponentId: s.opponentId,
      opponent: opponentTeam(s).name,
      // Naming the opposition by its real id is what makes a game a LEAGUE
      // game rather than a game against a name typed into this phone. Null for
      // everything scored the way it always has been, and the server falls
      // back to the slug exactly as before.
      opponentTeamId: s.gameOpponentTeamId || null,
      sport: s.sport,
      home: s.gameHome !== false,
      label: when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      date: when.toISOString(),
    };
  }, []);

  /**
   * Record one thing that happened. Appends locally and nothing else — the
   * sending is one effect below, so there is a single answer to "has this
   * reached the account", whether it was entered a second ago or three innings
   * ago on a phone with no signal.
   */
  const emit = useCallback(
    (kind, payload) => {
      const event = {
        clientEventId: newEventId(),
        kind,
        payload: payload || {},
        seq: null,
        at: Date.now(),
      };
      setState((s) => withLog(s, { gameLog: [...s.gameLog, event] }));
      return event;
    },
    [withLog],
  );

  /**
   * Fold events the account has accepted into the authoritative list.
   *
   * Matched on the entering device's own event id, so a play of ours coming
   * back — over realtime, from a poll, or as the answer to the write that sent
   * it — is recognised as the same fact rather than counted twice.
   */
  const acceptServerEvents = useCallback(
    (incoming) => {
      if (!incoming || !incoming.length) return;
      setState((s) => {
        const byKey = new Map(
          s.serverLog.map((e) => [e.clientEventId || `id:${e.id}`, e]),
        );
        let changed = false;
        for (const e of incoming) {
          const key = e.clientEventId || `id:${e.id}`;
          if (byKey.has(key)) continue;
          byKey.set(key, e);
          changed = true;
        }
        if (!changed) return s;
        const serverLog = [...byKey.values()].sort((a, b) => a.seq - b.seq);
        return withLog(s, { serverLog });
      });
    },
    [withLog],
  );

  /**
   * A game that was already being played when a log became possible.
   *
   * Three ways to get here, all of them real: a game in progress on a build
   * from before any of this existed; a game restored from a save made
   * mid-innings; a game started while signed out. In each case the plays so
   * far are not in any log, and without this the phone would sit on a live
   * game that no longer responds to a tap.
   *
   * The answer is one `resume` event carrying the game exactly as it stands.
   * It is the first thing in the log, so nothing already scored is lost and a
   * second phone joining replays the whole game rather than the rest of it.
   */
  useEffect(() => {
    if (!hydrated) return;
    const s = stateRef.current;
    if (!s.gameActive || (s.gameLog && s.gameLog.length)) return;

    const startedAt = s.gameStartedAt || Date.now();
    const clientId = s.gameClientId || `g-${startedAt}`;
    const event = {
      clientEventId: newEventId(),
      kind: 'resume',
      seq: null,
      at: startedAt,
      payload: { gameClientId: clientId, state: { ...liveSlice(s), gameClientId: clientId, undoStack: [] } },
    };
    setState((cur) =>
      withLog(
        { ...cur, gameClientId: clientId, gameStartedAt: startedAt },
        { gameLog: [event], serverLog: cur.serverLog || [] },
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  /**
   * Send everything in the log that the account has not got.
   *
   * One place, deliberately. A play entered a second ago and a play entered
   * three innings ago on a phone with no signal are the same problem, and so
   * is a game that was being scored before anyone signed in. They all reach
   * the account by this route, in the order they were entered, through the
   * same durable queue as every other write — with no coalesce key, because
   * two plays are two facts and the later one must never stand in for the
   * earlier one.
   */
  useEffect(() => {
    if (!repository.appendEvent || !state.gameActive || !state.gameLog.length) return;
    const descriptor = describeGame(state);
    if (!descriptor) return;

    const accounted = new Set(state.serverLog.map((e) => e.clientEventId));
    if (repository.queuedEventIds) {
      for (const id of repository.queuedEventIds()) accounted.add(id);
    }
    for (const event of state.gameLog) {
      if (accounted.has(event.clientEventId)) continue;
      repository.appendEvent(descriptor, event);
    }
  }, [repository, state, describeGame]);

  // A play of ours is accepted: the server has told us where it sits. Move it
  // out of the local tail and into the authoritative list at that position,
  // without waiting for realtime to echo it back.
  useEffect(() => {
    if (!repository.onEventAck) return undefined;
    return repository.onEventAck((ack) => {
      setState((s) => {
        const mine = s.gameLog.find((e) => e.clientEventId === ack.clientEventId);
        if (!mine || ack.seq == null) return s;
        // The first accepted play is also how this device learns which game in
        // the account its log belongs to — which is what it then watches.
        const withId = ack.gameId && !s.liveGameId ? { ...s, liveGameId: ack.gameId } : s;
        if (withId.serverLog.some((e) => e.clientEventId === ack.clientEventId)) return withId;
        const serverLog = [...withId.serverLog, { ...mine, seq: ack.seq, id: ack.id }].sort(
          (a, b) => a.seq - b.seq,
        );
        return withLog(withId, { serverLog });
      });
    });
  }, [repository, withLog]);

  /**
   * Watch the game.
   *
   * Two mechanisms, on purpose. Realtime is what makes another phone's play
   * appear in a second; the poll beside it is what makes it appear at all. A
   * live socket over a mobile network drops messages and whole connections
   * without reporting either, and a play that was genuinely written staying
   * invisible for the rest of the game is not a failure mode worth accepting
   * to save a request every few seconds.
   *
   * The poll asks only for what is newer than the highest sequence already
   * held, so catching up after a tunnel costs one round trip.
   */
  useEffect(() => {
    const gameId = state.liveGameId;
    if (!gameId || !state.gameActive || !repository.fetchEvents) return undefined;

    let stopped = false;
    const catchUp = async () => {
      const since = stateRef.current.serverLog.reduce((m, e) => Math.max(m, e.seq || 0), 0);
      try {
        const events = await repository.fetchEvents(gameId, since);
        if (!stopped && events.length) acceptServerEvents(events);
      } catch {
        // No signal. The next poll tries again; nothing here is authoritative
        // enough for a failure to be worth reporting.
      }
    };

    catchUp();
    const timer = setInterval(catchUp, LIVE_POLL_MS);

    let unsubscribe = null;
    if (repository.subscribeLive) {
      unsubscribe = repository.subscribeLive(
        gameId,
        (event) => {
          if (!stopped) acceptServerEvents([event]);
        },
        (status) => {
          if (!stopped) patch({ liveConnected: status === 'SUBSCRIBED' });
        },
      );
    }

    return () => {
      stopped = true;
      clearInterval(timer);
      if (unsubscribe) unsubscribe();
    };
  }, [state.liveGameId, state.gameActive, repository, acceptServerEvents, patch]);

  /**
   * The game ended on the other phone.
   *
   * Say so — a screen that simply empties is indistinguishable from the app
   * losing the game — and then ask the account for the season again, so a game
   * that was finalised elsewhere appears in the history here rather than on the
   * next cold start.
   */
  useEffect(() => {
    if (!state.liveEnded) return;
    const how = state.liveEnded;
    patch({ liveEnded: null });
    toast(
      how === 'cancelled'
        ? 'That game was cancelled on another phone'
        : 'That game was finalized on another phone',
      3600,
    );
    if (how !== 'final') return;
    repository
      .load()
      .then((loaded) => {
        // Only the history: the rest of this device's state is its own.
        if (loaded && loaded.history) {
          setState((cur) => ({ ...cur, history: loaded.history }));
        }
      })
      .catch(() => {
        /* the next launch will pick it up */
      });
  }, [state.liveEnded, repository, patch, toast]);

  /**
   * Is somebody else already scoring a game for this team?
   *
   * Asked while this phone is NOT in a game, so it can offer to join rather
   * than start a second one alongside it. Deliberately an offer and never an
   * automatic switch: landing someone in a game they did not open is the kind
   * of surprise that gets plays entered against the wrong game.
   */
  useEffect(() => {
    if (!repository.findLiveGame) return undefined;
    if (state.gameActive) {
      if (state.joinable) patch({ joinable: null });
      return undefined;
    }

    let stopped = false;
    const look = async () => {
      try {
        const found = await repository.findLiveGame();
        if (stopped) return;
        setState((s) => (s.gameActive ? s : { ...s, joinable: found || null }));
      } catch {
        /* unreachable account: keep whatever was last known */
      }
    };
    look();
    const timer = setInterval(look, JOINABLE_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository, state.gameActive]);

  const actions = useMemo(() => {
    const go = (screen) => () => patch({ screen, selRunner: null });

    return {
      noop: () => {},
      go,
      goTeam: go('team'),
      goLeague: go('league'),
      // The leagues screen — several teams, one table. Not the season home,
      // which is confusingly also called "league"; that one is this team's own
      // standings and is what `goLeague` opens.
      goLeagues: go('leagues'),
      goNewGame: go('newgame'),
      goScanCam: go('scanCam'),

      // New game setup
      setSport: (sport) => () => patch({ sport }),
      setOpponent: (opponentId) => () => patch({ opponentId, opponentPicker: false }),
      openOpponentPicker: () => patch({ opponentPicker: true }),
      closeOpponentPicker: () => patch({ opponentPicker: false }),
      setTrackMode: (trackMode) => () => patch({ trackMode }),
      /**
       * Start a game. The first event in the log, and the only one that says
       * what the game IS — which sport, which opponent, which batting order,
       * whether the opposition is being tracked. A second phone that never saw
       * this screen replays from here and lands on the same starting point.
       *
       * The game's id is minted now rather than at finalisation, because the
       * log needs something to hang off from the first pitch. It is the same
       * id the finished record carries, which is what lets the box score be
       * reconciled against the log it came from.
       */
      startGame: () => {
        const startedAt = Date.now();
        const clientId = `g-${startedAt}`;
        const s = stateRef.current;
        const event = {
          clientEventId: newEventId(),
          kind: 'start',
          seq: null,
          at: startedAt,
          payload: {
            gameClientId: clientId,
            sport: s.sport,
            opponentId: s.opponentId,
            trackMode: s.trackMode,
            lineup: s.lineup,
            bench: s.bench,
          },
        };

        setState((cur) =>
          withLog(
            {
              ...cur,
              screen: 'live',
              liveTab: 'lineup',
              gameFinal: false,
              gameClientId: clientId,
              gameStartedAt: startedAt,
              // An ordinary game is against whoever the picker says, at home,
              // and belongs to no fixture. Cleared explicitly so a game started
              // right after a league fixture cannot inherit its identity.
              gameOpponentTeamId: null,
              gameHome: true,
              gameFixture: null,
              liveGameId: null,
              liveConnected: false,
              finalPrompted: false,
              liveMismatch: null,
              joinable: null,
              bookOff: null,
              selRunner: null,
            },
            { gameLog: [event], serverLog: [] },
          ),
        );
      },

      /**
       * Pick up a game someone else is already scoring.
       *
       * Nothing is merged and nothing local is kept: this device has no log
       * for this game, so it takes the account's whole log and folds it. What
       * it lands on is exactly what the other phone is looking at, because it
       * is the same list of events in the same order.
       */
      joinLiveGame: async () => {
        const found = stateRef.current.joinable;
        if (!found || !repository.fetchEvents) return;

        let events;
        try {
          events = await repository.fetchEvents(found.gameId, 0);
        } catch {
          toast('Could not reach that game — try again in a moment', 3200);
          return;
        }
        if (!events.length) {
          toast('That game has not been scored yet');
          return;
        }
        // The offer is refreshed on a timer, so it can be a few seconds out of
        // date — long enough for the game to have been finished or thrown away
        // on the other phone. Joining it then would drop someone into a game
        // that is already over.
        const status = logStatus(events);
        if (status !== 'live') {
          patch({ joinable: null });
          toast(status === 'cancelled' ? 'That game was cancelled' : 'That game has finished', 3000);
          return;
        }

        setState((cur) =>
          withLog(
            {
              ...cur,
              screen: 'live',
              liveTab: 'entry',
              gameFinal: false,
              gameClientId: found.clientId,
              gameStartedAt: Date.parse(found.date) || Date.now(),
              gameOpponentTeamId: found.opponentTeamId || null,
              gameHome: found.home !== false,
              gameFixture: null,
              liveGameId: found.gameId,
              liveConnected: false,
              finalPrompted: false,
              liveMismatch: null,
              joinable: null,
              bookOff: null,
              selRunner: null,
            },
            { gameLog: [], serverLog: events },
          ),
        );
        toast('Joined the game in progress', 3000);
      },

      /**
       * Score a fixture the league put on the calendar.
       *
       * The whole point of this action is two identifiers. The game takes the
       * FIXTURE's client id, so `start_live_game` and `save_game` find the row
       * that is already on the schedule and finish it rather than making a
       * second game beside it. And the opposition is named by its real TEAM ID,
       * so the result lands on that team's record and in the league's table —
       * rather than against a team invented from a slug typed into this phone,
       * which is where every league game went until now.
       *
       * The opposing team is also adopted into this device's list of teams, so
       * the scorebook, the batting order and the box score work exactly as they
       * do for any other game. Nothing about scoring changes; only who the game
       * turns out to have been against.
       */
      startFixture: ({ fixture, opponent, home }) => {
        if (!fixture || !opponent) return;
        const s = stateRef.current;
        const startedAt = Date.parse(fixture.scheduled_at) || Date.now();

        // A slug for this device's own model of the opposition. Reused if this
        // team has been played before, so their roster and their accumulated
        // stats stay attached to them.
        const existing = s.teams.find((t) => t.teamId === opponent.id);
        const slug = existing ? existing.id : slugId(opponent.name, s.teams);
        const teams = existing
          ? s.teams.map((t) => (t.teamId === opponent.id ? { ...t, name: opponent.name } : t))
          : [...s.teams, { id: slug, teamId: opponent.id, name: opponent.name, priorW: 0, priorL: 0, players: [] }];

        const event = {
          clientEventId: newEventId(),
          kind: 'start',
          seq: null,
          at: startedAt,
          payload: {
            gameClientId: fixture.client_id,
            // Which of the fixture's two teams is doing the scoring. Nothing
            // replays it; it is what lets the league screen say who has the
            // game in progress without reading anybody's profile.
            teamId: home !== false ? fixture.home_team_id : fixture.away_team_id,
            sport: fixture.sport || s.sport,
            opponentId: slug,
            trackMode: s.trackMode,
            lineup: s.lineup,
            bench: s.bench,
          },
        };

        setState((cur) =>
          withLog(
            {
              ...cur,
              teams,
              screen: 'live',
              liveTab: 'lineup',
              gameFinal: false,
              sport: fixture.sport || cur.sport,
              gameClientId: fixture.client_id,
              gameStartedAt: startedAt,
              gameOpponentTeamId: opponent.id,
              gameHome: home !== false,
              gameFixture: fixture.id,
              liveGameId: null,
              liveConnected: false,
              finalPrompted: false,
              liveMismatch: null,
              joinable: null,
              bookOff: null,
              selRunner: null,
            },
            { gameLog: [event], serverLog: [] },
          ),
        );
        toast(`Scoring ${opponent.name}`, 3000);
      },

      // Scoring — each of these is one event, appended and sent.
      record: (o) => emit('outcome', { o }),
      quick: (isRun) => emit('quick', { run: !!isRun }),
      quickRunMinus: () => emit('quick_run_minus', {}),
      endTheirHalf: () => emit('end_half', {}),

      /**
       * Take back the last play — whoever entered it.
       *
       * An undo is an append, not a deletion: the log keeps the play and the
       * taking-back of it, so every phone replaying reaches the same state and
       * nothing is ever removed from the record.
       *
       * It names the play it is taking back, which matters with two scorers:
       * both tapping undo on the same strikeout takes back that strikeout
       * once, rather than that strikeout and then the double before it.
       */
      undo: () => {
        const s = stateRef.current;
        const target = undoTarget(mergeLog(s.serverLog, s.gameLog));
        if (!target) return;
        emit('undo', { target: target.clientEventId });
      },

      // Base runners
      selectRunner: (i) =>
        setState((s) => (s.bases[i] ? { ...s, selRunner: s.selRunner === i ? null : i } : s)),
      // Which runner is selected is this phone's business; where the runner
      // ends up is everybody's, so the event names the base rather than
      // relying on a selection the other phone cannot see.
      runnerAction: (adv) => () => {
        const base = stateRef.current.selRunner;
        if (base == null || !stateRef.current.bases[base]) return;
        emit('runner', { base, action: adv === 'back' ? 'back' : adv ? 'adv' : 'out' });
        patch({ selRunner: null });
      },
      clearSel: () => patch({ selRunner: null }),

      // Live tabs
      setLiveTab: (liveTab) => () => patch({ liveTab }),
      setStatsTeam: (statsTeam) => () => patch({ statsTeam }),
      // Whether the opposition gets scorebook entries is a fact about the
      // game, not a preference on this phone: flip it here and the other
      // scorer's book has to start filling in too.
      trackBothNow: () => {
        if (stateRef.current.gameActive) emit('track_mode', { mode: 'both' });
        else patch({ trackMode: 'both' });
        toast('Now tracking both teams');
      },

      // Scorebook paging
      setBookOff: (bookOff) => () => patch({ bookOff }),

      // Lineup.
      //
      // Outside a game this is season editing and stays local. During a game
      // the batting order decides who is up next, so a change to it has to
      // reach the other phone or the two would disagree about whose turn it
      // is — and then disagree about whose stat line a play belongs to.
      moveLineup: (idx, dir) => () => {
        if (stateRef.current.gameActive) emit('lineup_move', { idx, dir });
        else setState((s) => applyMoveLineup(s, idx, dir));
      },
      addFromBench: (id) => () => {
        if (stateRef.current.gameActive) {
          emit('lineup_add', { id });
          return;
        }
        setState((s) => ({
          ...s,
          lineup: [...s.lineup, id],
          bench: s.bench.filter((b) => b !== id),
        }));
      },
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
       * Throw the in-progress game away.
       *
       * Nothing is written to history, so standings and season stats are
       * untouched. What IS written, when the game reached an account, is a
       * cancel event and a tombstone on the row — the log is not deleted and
       * the game does not silently disappear from the other scorer's phone. It
       * stops being live, says so, and stays readable.
       */
      cancelGame: () => {
        const s = stateRef.current;
        const descriptor = describeGame(s);
        if (descriptor && repository.appendEvent) {
          repository.appendEvent(descriptor, {
            clientEventId: newEventId(),
            kind: 'cancel',
            payload: {},
            seq: null,
            at: Date.now(),
          });
          // Queued after the event, so the log records the cancellation before
          // the game stops accepting appends. The queue's strict ordering is
          // what guarantees that — not a timer.
          if (repository.cancelLive) repository.cancelLive(descriptor);
        }
        setState((cur) => ({
          ...cur,
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
          gameClientId: null,
          gameStartedAt: null,
          gameOpponentTeamId: null,
          gameHome: true,
          gameFixture: null,
          gameLog: [],
          serverLog: [],
          liveGameId: null,
          liveConnected: false,
          finalPrompted: false,
          liveMismatch: null,
        }));
      },

      // Finalizing
      askFinalize: () => patch({ confirmFinal: true }),
      cancelFinalize: () => patch({ confirmFinal: false }),
      dismissMismatch: () => patch({ liveMismatch: null }),

      /**
       * Call the game.
       *
       * For a game that never reached an account — scored on a phone with no
       * backend, or with no signal from the first pitch — this is exactly what
       * it has always been: freeze the box score, put it in the history, hand
       * it to the repository. Nothing below changes that path.
       *
       * For a shared game there is one more step, and it is the point of the
       * slice: the box score about to be written must equal a replay of the
       * account's own log, or the game is not finalised and the reason is put
       * on screen. The order matters —
       *
       *   1. drain the queue, so every play this phone holds is up;
       *   2. append the event that CALLS the game, and wait for it;
       *   3. read the whole log back and replay it;
       *   4. compare, on the figures a person would see.
       *
       * Appending before reading is what makes step 4 sound: anything entered
       * on another phone before the call is in the log by then, so it is either
       * accounted for or named as a difference. Anything entered after the call
       * is refused by save_game, which will not write a box score the log has
       * moved on from.
       */
      doFinalize: async () => {
        const s = stateRef.current;
        // Freeze the box score before the live state is torn down. Built out
        // here rather than inside the updater so the updater stays pure.
        const record = buildGameRecord(s);

        if (s.liveGameId && repository.fetchEvents && repository.appendEventNow) {
          const descriptor = describeGame(s);
          try {
            if (repository.flushNow) await repository.flushNow();

            const stuck = repository.queuedEventIds ? repository.queuedEventIds().size : 0;
            if (stuck) {
              patch({
                confirmFinal: false,
                liveMismatch: [
                  `${stuck} ${stuck === 1 ? 'play has' : 'plays have'} not reached the account yet. ` +
                    'They have not been lost — finish the game once they go through.',
                ],
              });
              return;
            }

            await repository.appendEventNow(descriptor, {
              clientEventId: newEventId(),
              kind: 'final',
              payload: {},
              seq: null,
              at: Date.now(),
            });

            const events = await repository.fetchEvents(s.liveGameId, 0);
            const fromLog = replay(s, events);
            const logRecord = fromLog
              ? buildGameRecord({ ...fromLog, gameStartedAt: s.gameStartedAt })
              : null;

            const verdict = reconcileBoxScore(record, logRecord);
            if (!verdict.ok) {
              patch({ confirmFinal: false, liveMismatch: verdict.differences });
              return;
            }
          } catch {
            // The account could not be reached. A game is never held hostage to
            // that: fall through to the path a phone with no signal takes, and
            // put the call itself in the queue so the log records it in order.
            if (descriptor && repository.appendEvent) {
              repository.appendEvent(descriptor, {
                clientEventId: newEventId(),
                kind: 'final',
                payload: {},
                seq: null,
                at: Date.now(),
              });
            }
          }
        }

        setState((cur) => ({
          ...cur,
          history: [...cur.history, record],
          confirmFinal: false,
          gameActive: false,
          gameFinal: true,
          screen: 'league',
          liveTab: 'entry',
          synced: false,
          // The log belongs to the game that just ended. It has been sent (or
          // is queued); the device keeps the finished record, not the plays.
          gameLog: [],
          serverLog: [],
          gameClientId: null,
          gameStartedAt: null,
          gameOpponentTeamId: null,
          gameHome: true,
          gameFixture: null,
          liveGameId: null,
          liveConnected: false,
          finalPrompted: false,
          liveMismatch: null,
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
      benchPlayer: (id) => () => {
        if (stateRef.current.gameActive) {
          emit('lineup_bench', { id });
          patch({ posMenu: null });
          return;
        }
        setState((s) => {
          // Never empty the order completely — there would be nobody to bat.
          if (s.lineup.length <= 1 || !s.lineup.includes(id)) return { ...s, posMenu: null };
          return {
            ...s,
            lineup: s.lineup.filter((x) => x !== id),
            bench: s.bench.includes(id) ? s.bench : [...s.bench, id],
            posMenu: null,
          };
        });
      },

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

      // ---- Sending past games to the account -------------------------------
      // Games finalised before the app could write them anywhere exist only on
      // this device. This is the one path that sends them, and it is never
      // automatic: it runs when someone taps it, and it says exactly how far it
      // got.
      /** Whether this device's adapter can send games at all. */
      hasBackfill: () => !!repository.backfillGames,

      openBackfill: async () => {
        if (!repository.backfillPlan) return;
        patch({ backfill: { phase: 'loading' } });
        try {
          const plan = await repository.backfillPlan(stateRef.current.history);
          patch({ backfill: { phase: 'preflight', ...plan } });
        } catch (err) {
          patch({
            backfill: { phase: 'preflight', sendable: [], blocked: [], alreadySent: 0,
              blockedBecause: (err && err.message) || 'the account could not be reached' },
          });
        }
      },

      closeBackfill: () => patch({ backfill: null }),

      runBackfill: async () => {
        const current = stateRef.current.backfill;
        if (!current || !repository.backfillGames) return;
        const candidates = current.sendable || [];
        if (!candidates.length) return;

        patch({
          backfill: { ...current, phase: 'running', progress: { done: 0, total: candidates.length } },
        });

        const result = await repository.backfillGames(candidates, {
          onProgress: (progress) =>
            setState((s) => (s.backfill ? { ...s, backfill: { ...s.backfill, progress } } : s)),
        });

        setState((s) =>
          s.backfill
            ? { ...s, backfill: { ...s.backfill, phase: result.ok ? 'done' : 'stopped', result } }
            : s,
        );

        if (result.ok) {
          toast(
            candidates.length === 1
              ? 'Sent 1 past game to your account'
              : `Sent ${candidates.length} past games to your account`,
            3200,
          );
        }
      },

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
          gameClientId: null,
          gameStartedAt: null,
          gameOpponentTeamId: null,
          gameHome: true,
          gameFixture: null,
          gameLog: [],
          serverLog: [],
          liveGameId: null,
          liveConnected: false,
          finalPrompted: false,
          liveMismatch: null,
          joinable: null,
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
  }, [patch, toast, markUnsynced, emit, withLog, describeGame, repository]);

  return { state, actions };
}
