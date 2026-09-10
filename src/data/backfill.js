// Sending games that were finalized before the app could write them anywhere.
//
// `save_game` fires on finalization. Games already in the history when that
// shipped were never offered to it, so they exist on the device and nowhere
// else. This works out which of them can be sent, and — just as importantly —
// which cannot and why.
//
// Nothing here touches the network or the database. It is the pre-flight: the
// same four refusals `save_game` enforces, applied locally, so a bulk write
// reports its problems BEFORE it starts rather than stopping at game seven of
// twelve. The wording is deliberately close to the database's own messages;
// when the two disagree, the database is right and this is the bug.

/**
 * The reasons a finished game cannot be sent. Each mirrors a `raise exception`
 * in 20260101000013_save_game.sql.
 */
export const REASONS = {
  NO_ID: 'no-id',
  NO_LINES: 'no-lines',
  NO_SCORE: 'no-score',
  RESULT_DISAGREES: 'result-disagrees',
};

/** What the result must be, given the score. A level game is a tie. */
export function expectedResult(us, them) {
  if (us > them) return 'W';
  if (us < them) return 'L';
  return 'T';
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Can this game be sent as it stands?
 *
 * @returns {{ok: true} | {ok: false, reason: string, detail: string}}
 */
export function inspectGame(game) {
  if (!game || !game.id) {
    return { ok: false, reason: REASONS.NO_ID, detail: 'the game has no id, so it cannot be matched up' };
  }

  const lines = Array.isArray(game.lines) ? game.lines : [];
  if (lines.length === 0) {
    return {
      ok: false,
      reason: REASONS.NO_LINES,
      detail: 'no box score was recorded, so there is nothing to send but the result',
    };
  }

  const us = num(game.score && game.score.us);
  const them = num(game.score && game.score.them);
  if (us === null || them === null) {
    return { ok: false, reason: REASONS.NO_SCORE, detail: 'the final score is missing' };
  }

  const want = expectedResult(us, them);
  if (!game.result) {
    return { ok: false, reason: REASONS.NO_SCORE, detail: 'the game has no result' };
  }
  if (game.result !== want) {
    return {
      ok: false,
      reason: REASONS.RESULT_DISAGREES,
      detail: `recorded as ${verdict(game.result)} but the score was ${us}–${them}, which is ${verdict(want)}`,
    };
  }

  return { ok: true };
}

const verdict = (r) => ({ W: 'a win', L: 'a loss', T: 'a tie' }[r] || String(r));

/** How a game should be named on screen. */
export function gameTitle(game) {
  const when = game.label || game.date || '';
  const who = game.opponent || 'Unknown opponent';
  const score = game.score ? `${game.score.us}–${game.score.them}` : '';
  return [when, `vs ${who}`, score].filter(Boolean).join(' · ');
}

/**
 * Split the local history into what can be sent, what cannot, and what has
 * already gone.
 *
 * `syncedIds` is the per-game marker this device keeps — not a timestamp.
 * Clocks differ between devices and "everything after time T" is the wrong
 * question once there is more than one phone.
 *
 * `remoteIds`, when given, only labels each candidate: a game the account
 * already has will be updated in place rather than created, because `save_game`
 * is idempotent on (created_by, client_id). It never changes what gets sent —
 * the marker decides that — but it removes the ambiguity of not knowing which
 * writes are new.
 */
export function planBackfill(history, syncedIds, remoteIds = null) {
  const synced = syncedIds instanceof Set ? syncedIds : new Set(syncedIds || []);
  const remote = remoteIds instanceof Set ? remoteIds : remoteIds ? new Set(remoteIds) : null;

  const sendable = [];
  const blocked = [];
  let alreadySent = 0;

  for (const game of history || []) {
    if (game && game.id && synced.has(game.id)) {
      alreadySent++;
      continue;
    }

    const verdictOfGame = inspectGame(game);
    if (verdictOfGame.ok) {
      sendable.push({
        game,
        title: gameTitle(game),
        // Purely informational; both take the same code path.
        action: remote ? (remote.has(game.id) ? 'update' : 'create') : 'send',
      });
    } else {
      blocked.push({
        id: game && game.id ? game.id : null,
        title: gameTitle(game || {}),
        reason: verdictOfGame.reason,
        detail: verdictOfGame.detail,
      });
    }
  }

  return {
    sendable,
    blocked,
    alreadySent,
    total: (history || []).length,
    // The plain-language summary the sheet shows before anything is written.
    nothingToDo: sendable.length === 0 && blocked.length === 0,
  };
}

/**
 * A count of the two legacy shapes that cannot be sent, for reporting only.
 *
 * These are a local data bug, not a backfill problem: a game recorded as a win
 * when the sides were level is wrong in the standings on the phone today,
 * whether or not it is ever sent anywhere. Repairing them is a separate,
 * deliberate step — this only counts them.
 */
export function legacyResultReport(history) {
  let tieStoredAsDecision = 0;
  let zeroZeroWithDecision = 0;
  let missingScore = 0;

  for (const game of history || []) {
    const us = num(game && game.score && game.score.us);
    const them = num(game && game.score && game.score.them);
    if (us === null || them === null) {
      missingScore++;
      continue;
    }
    if (us === them && game.result && game.result !== 'T') {
      tieStoredAsDecision++;
      if (us === 0) zeroZeroWithDecision++;
    }
  }

  return { tieStoredAsDecision, zeroZeroWithDecision, missingScore };
}
