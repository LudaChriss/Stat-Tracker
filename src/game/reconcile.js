// Does the box score about to be written match the log it came from?
//
// On one phone this is a tautology — the state IS the replay, so the record
// built from it cannot disagree with itself. The check earns its place the
// moment there are two phones: the record is built from what THIS phone had,
// and the log is what the account actually holds. If a play landed somewhere
// else in between, the two differ, and the difference is a run or a hit that
// would otherwise vanish from the season without anyone being told.
//
// It also, quietly, pins the fold: a replay bug that made the incremental
// state drift from a whole-log replay would show up here as a refusal to
// finalise rather than as a box score nobody ever checked.

const STAT_KEYS = ['ab', 'h', 'r', 'rbi', 'bb', 'k', 'd', 't', 'hr'];

const byPid = (lines) => {
  const map = new Map();
  for (const l of lines || []) map.set(l.pid, l);
  return map;
};

/**
 * Compare the record this device is about to write with the one the account's
 * own log produces.
 *
 * Deliberately compares the figures a person would SEE — the score, the result
 * and every player's line. A count of lines would not notice a run moving from
 * one player to another, and a checksum would not be able to say what changed.
 *
 * @returns {{ok: boolean, differences: string[]}}
 */
export function reconcileBoxScore(mine, fromLog) {
  if (!mine) return { ok: false, differences: ['there is no box score to write'] };
  if (!fromLog) {
    return {
      ok: false,
      differences: ['the account has no playable log for this game, so the box score could not be checked'],
    };
  }

  const differences = [];

  if (mine.score.us !== fromLog.score.us || mine.score.them !== fromLog.score.them) {
    differences.push(
      `the score on this phone is ${mine.score.us}–${mine.score.them}, but the plays add up to ${fromLog.score.us}–${fromLog.score.them}`,
    );
  }
  if (mine.result !== fromLog.result) {
    differences.push(`this phone says ${mine.result}, the plays say ${fromLog.result}`);
  }

  const ours = byPid(mine.lines);
  const theirs = byPid(fromLog.lines);

  for (const [pid, line] of ours) {
    const other = theirs.get(pid);
    if (!other) {
      differences.push(`${line.name} has a line here that the plays do not account for`);
      continue;
    }
    const changed = STAT_KEYS.filter((k) => (line[k] || 0) !== (other[k] || 0));
    if (changed.length) {
      differences.push(
        `${line.name}: ${changed
          .map((k) => `${k.toUpperCase()} ${line[k] || 0} here, ${other[k] || 0} in the plays`)
          .join(', ')}`,
      );
    }
  }
  for (const [pid, line] of theirs) {
    if (!ours.has(pid)) {
      differences.push(`${line.name} appears in the plays but has no line on this phone`);
    }
  }

  // Long lists help nobody read the sheet this ends up on.
  const shown = differences.slice(0, 6);
  if (differences.length > shown.length) {
    shown.push(`…and ${differences.length - shown.length} more`);
  }

  return { ok: differences.length === 0, differences: shown };
}
