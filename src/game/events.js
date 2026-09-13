// The append-only command log for a live game, and the replay that turns it
// back into game state.
//
// WHY A LOG AT ALL
//
// Until this existed, a game in progress lived only in one phone's memory and
// was written once, at finalisation. Lose the phone in the 5th and the game
// never happened. Every play is now its own fact, written as it is entered.
//
// WHY REPLAY RATHER THAN A SHARED MUTABLE STATE
//
// Two phones scoring the same game cannot both own "the state" — one of them
// would have to win, and whatever the loser typed would be gone. A log has no
// such problem: both phones append, the server puts the appends in an order,
// and every phone folds the same ordered list through the same pure functions
// and lands on the same state. Nothing merges and nothing is dropped.
//
// The fold is the existing scoring engine, untouched. `applyOutcome` and
// friends are already `state -> state`, which is the entire reason this is
// cheap: there is one implementation of what a double does, and both the
// button and the replay go through it.
//
// WHAT IS AND IS NOT IN THE LOG
//
// In: everything that changes what the scoreboard and the box score say —
// plays, runner moves, the end of a half, batting-order changes made during
// the game, and the track-both switch (it decides whether the opposition gets
// scorebook entries at all).
//
// Out: anything device-local — which tab is open, which runner is selected,
// the scorebook page offset, fielding-position overrides. Those are not facts
// about the game, and syncing them would make two phones fight over one
// person's screen.

import {
  applyEndHalf,
  applyMoveLineup,
  applyOutcome,
  applyQuick,
  applyQuickRunMinus,
  applyRunnerAction,
} from './logic.js';

/** Every kind the log can carry. Anything else is refused rather than ignored. */
export const KINDS = [
  'start',
  'resume',
  'outcome',
  'quick',
  'quick_run_minus',
  'runner',
  'end_half',
  'lineup_move',
  'lineup_add',
  'lineup_bench',
  'track_mode',
  'undo',
  'cancel',
  'final',
];

/**
 * What "undo" is allowed to reach.
 *
 * Plays only. A batting-order change is not a play, and an undo that silently
 * reshuffled the order while the scorer thought they were taking back a
 * strikeout would be worse than no undo at all. `start`, `final` and `cancel`
 * are not undoable either — those are the shape of the game, not a play in it.
 */
export const UNDOABLE = new Set([
  'outcome',
  'quick',
  'quick_run_minus',
  'runner',
  'end_half',
]);

/**
 * The fields replay owns. Everything else in app state — the roster, the
 * history, which tab is open — is untouched by a remote event landing.
 *
 * `undoStack` is in here only because the engine still maintains it as it
 * folds; undo itself is a log operation now, not a stack pop.
 */
export const LIVE_FIELDS = [
  'sport',
  'opponentId',
  'trackMode',
  'lineup',
  'bench',
  'gameClientId',
  'gameActive',
  'half',
  'inning',
  'outs',
  'bases',
  'score',
  'kiHome',
  'kiAway',
  'undoStack',
  'lastPlay',
  'tape',
  'gameStats',
  'events',
];

/** Pull just the replay-owned slice out of a state object. */
export function liveSlice(s) {
  const out = {};
  for (const k of LIVE_FIELDS) out[k] = s[k];
  return out;
}

/**
 * The state a game begins in, before any play.
 *
 * `season` supplies everything a game is played *with* — the roster, the
 * opposing teams, the history a batter's season line is read from. The start
 * event supplies everything about *this* game, so a second phone that never
 * saw the setup screen lands on exactly the same starting point.
 */
export function startingState(season, start) {
  const p = start || {};
  return {
    ...season,
    sport: p.sport || season.sport,
    opponentId: p.opponentId !== undefined ? p.opponentId : season.opponentId,
    trackMode: p.trackMode || 'both',
    lineup: [...(p.lineup || [])],
    bench: [...(p.bench || [])],
    gameClientId: p.gameClientId || null,
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
    selRunner: null,
    bookOff: null,
  };
}

const RUNNER_ACTION = { adv: true, out: false, back: 'back' };

/**
 * Fold one event into the state.
 *
 * Returns the state unchanged for an event it does not recognise: a newer
 * phone may know a kind this build does not, and silently ignoring one unknown
 * play is far better than refusing to show the game at all.
 */
function step(s, event, season) {
  const p = event.payload || {};

  // A call that play carried on after did not stand. The account refused the box
  // score it was made with — or it would not have accepted this event at all —
  // so the game is not finalized, whatever the earlier event said.
  if (s && s.finalized && event.kind !== 'final' && event.kind !== 'cancel') {
    s = { ...s, finalized: false };
  }

  switch (event.kind) {
    case 'start':
      return startingState(season, p);
    // A game that was already being played when the log arrived — scored on a
    // phone with no account, or by a build from before any of this existed.
    // Its state so far is the first thing in its log, so it is not lost and a
    // second phone replaying gets it whole.
    case 'resume':
      // Only ever the opening event. A resume after the game has started is a
      // snapshot of one phone's view appended on top of everyone's plays, and
      // folding it would replace the game with that view. Logs written before
      // this was guarded can contain one; it counts for nothing.
      if (s) return s;
      return {
        ...startingState(season, p),
        ...(p.state || {}),
        gameActive: true,
        undoStack: [],
        selRunner: null,
        bookOff: null,
      };
    case 'outcome':
      return applyOutcome(s, p.o || p);
    case 'quick':
      return applyQuick(s, !!p.run);
    case 'quick_run_minus':
      return applyQuickRunMinus(s);
    case 'runner':
      return applyRunnerAction({ ...s, selRunner: p.base }, RUNNER_ACTION[p.action]);
    case 'end_half':
      return applyEndHalf(s);
    case 'lineup_move':
      return applyMoveLineup(s, p.idx, p.dir);
    case 'lineup_add':
      return s.lineup.includes(p.id)
        ? s
        : { ...s, lineup: [...s.lineup, p.id], bench: s.bench.filter((b) => b !== p.id) };
    case 'lineup_bench':
      // Never empty the order completely — there would be nobody to bat.
      return s.lineup.length <= 1 || !s.lineup.includes(p.id)
        ? s
        : {
            ...s,
            lineup: s.lineup.filter((x) => x !== p.id),
            bench: s.bench.includes(p.id) ? s.bench : [...s.bench, p.id],
          };
    case 'track_mode':
      return { ...s, trackMode: p.mode === 'ours' ? 'ours' : 'both' };
    case 'cancel':
      // Also how an abandoned game ends (D18): the same event, saying why. A
      // build that predates abandoning folds it as a cancel, which is correct.
      return { ...s, gameActive: false, cancelled: true, abandoned: p.reason === 'abandoned' };
    case 'final':
      // The game has been CALLED — not finished. The phone that calls it
      // appends this before it checks its box score against the log, and if
      // they disagree nothing is written and the game carries on. So a `final`
      // in the log is a claim, and the game stays active in the fold: whether it
      // ended is the account's row to say, and a phone leaves a game only when
      // that row is final (see useGame). Treating the event as the end took
      // every phone out of a game the account still had open, including the one
      // being told on screen that the game was still live.
      return { ...s, finalized: true };
    default:
      return s;
  }
}

/**
 * Work out which events an undo took back.
 *
 * Undo is an append, never a deletion: the log keeps both the play and the
 * taking-back of it, so the history of the game stays readable and two phones
 * replaying it reach the same answer.
 *
 * An undo names its target where it can — the event id it was looking at when
 * the button was tapped. That matters with more than one scorer: two people
 * both tapping undo on the same strikeout should take back that strikeout
 * once, not take back the strikeout and then the double before it. An undo
 * whose target has already gone (or which never named one) falls back to the
 * last undoable event still standing, which is what a lone scorer means by it.
 *
 * @returns {Array} the events, each with an `undone` flag. Undo events
 *   themselves are marked undone: they contribute no state of their own.
 */
export function resolveUndos(events) {
  const out = (events || []).map((e) => ({ ...e, undone: false }));

  for (let i = 0; i < out.length; i++) {
    if (out[i].kind !== 'undo') continue;
    out[i].undone = true;

    const target = out[i].payload && out[i].payload.target;
    let hit = -1;
    let namedButGone = false;

    if (target) {
      for (let k = i - 1; k >= 0; k--) {
        if (out[k].clientEventId !== target) continue;
        // The named play is here. If it has already been taken back — the
        // other scorer got there first — this undo has nothing left to do.
        // Falling through to "the last play" instead would take back a second,
        // innocent play, which is the exact failure naming the target exists
        // to prevent.
        if (out[k].undone || !UNDOABLE.has(out[k].kind)) namedButGone = true;
        else hit = k;
        break;
      }
      if (hit < 0 && namedButGone) continue;
    }
    if (hit < 0) {
      for (let k = i - 1; k >= 0; k--) {
        if (!out[k].undone && UNDOABLE.has(out[k].kind)) {
          hit = k;
          break;
        }
      }
    }
    if (hit >= 0) out[hit].undone = true;
  }

  return out;
}

/** The event an undo tapped right now would take back, or null. */
export function undoTarget(events) {
  const resolved = resolveUndos(events);
  for (let i = resolved.length - 1; i >= 0; i--) {
    if (!resolved[i].undone && UNDOABLE.has(resolved[i].kind)) return resolved[i];
  }
  return null;
}

/**
 * Fold an ordered log into game state.
 *
 * @param {object} season  state carrying roster / teams / history
 * @param {Array} events   the log, already in the order it is to be applied
 * @returns {object|null}  the state after the last event, or null if the log
 *   never started a game
 */
export function replay(season, events) {
  const resolved = resolveUndos(events);
  let s = null;

  for (const e of resolved) {
    if (e.undone) continue;
    if (s === null) {
      // Everything before the beginning of the game is noise — a log fragment
      // fetched mid-write, say. Waiting for the opening event is what makes a
      // partial read show nothing rather than something wrong.
      if (e.kind !== 'start' && e.kind !== 'resume') continue;
      s = step(null, e, season);
      continue;
    }
    s = step(s, e, season);
  }

  return s;
}

/**
 * A replayer that folds only what is new when it safely can.
 *
 * Replay happens on every tap, and folding a whole game from the first pitch
 * each time is not free: the engine clones the stat map and the scorebook per
 * event, and by the 7th inning that is a couple of hundred clones per tap.
 *
 * The cache is used only when it provably cannot change the answer:
 *
 *   * the log is the cached one with events appended, matched on event id;
 *   * none of the appended events is an undo, because an undo changes whether
 *     an EARLIER event counts, and the cached state already counted it;
 *   * the roster and opposing teams are the same objects they were, because
 *     the engine reads names out of them when it writes a play's description.
 *
 * Anything else falls back to folding the whole log.
 */
export function createReplayer() {
  let ids = [];
  let cached = null;
  let roster = null;
  let teams = null;

  return function fold(season, log) {
    const events = log || [];
    const reusable =
      cached !== null &&
      season.roster === roster &&
      season.teams === teams &&
      events.length >= ids.length &&
      ids.every((id, i) => events[i] && events[i].clientEventId === id) &&
      !events.slice(ids.length).some((e) => e.kind === 'undo');

    let out;
    if (reusable) {
      // `cached` is non-null by the check above, so the game has already
      // started and every appended event has something to fold into.
      out = cached;
      for (let i = ids.length; i < events.length; i++) out = step(out, events[i], season);
    } else {
      out = replay(season, events);
    }

    ids = events.map((e) => e.clientEventId);
    cached = out;
    roster = season.roster;
    teams = season.teams;
    return out;
  };
}

/**
 * Whether the log says this game is over, and how.
 *
 * `final` means the last word in the log is a call. A call is only a claim until
 * the account writes the game — a refused one is followed by more play, and a
 * log whose call was followed by play is `live` again. A cancellation is final
 * in every sense: nothing is accepted after it.
 */
export function logStatus(events) {
  let status = 'none';
  for (const e of events || []) {
    if ((e.kind === 'start' || e.kind === 'resume') && status === 'none') status = 'live';
    else if (e.kind === 'cancel') status = 'cancelled';
    else if (e.kind === 'final') status = 'final';
    else if (status === 'final') status = 'live';
  }
  return status;
}

/**
 * Put the server's log and this device's unsent events into one order.
 *
 * This is the whole concurrency strategy in four lines, so it is worth being
 * exact about what it promises:
 *
 *   * Everything the server has accepted comes first, in the sequence the
 *     server assigned. That order is the same on every phone, which is what
 *     makes them converge.
 *   * This device's own events that have not been accepted yet come after,
 *     in the order they were entered here. A phone that was offline for two
 *     innings replays those innings in its own order, on the end.
 *   * An event that has come back from the server is dropped from the local
 *     tail — it is the same fact, now with a sequence number.
 *
 * Nothing is merged and nothing is reordered on arrival: a play that lands
 * between two of yours stays between them for everyone.
 */
export function mergeLog(serverEvents, localEvents) {
  const accepted = (serverEvents || []).slice().sort((a, b) => a.seq - b.seq);
  const known = new Set(accepted.map((e) => e.clientEventId).filter(Boolean));
  // Kept on the strength of not being in the accepted list, rather than on
  // looking unsent. An event that believes it has a sequence number but is
  // absent from the account is still a play that happened here, and dropping
  // it because of a flag would be exactly the silent loss this avoids.
  const tail = [];
  for (const e of localEvents || []) {
    if (known.has(e.clientEventId)) continue;
    // Defensive: an event id appears at most once in the fold. The local list
    // is append-only with minted ids so it should not repeat, but folding a
    // play twice would put a run on the board that nobody scored, and the
    // check costs nothing.
    known.add(e.clientEventId);
    tail.push(e);
  }
  return [...accepted, ...tail];
}
