// A durable, strictly-ordered write queue for syncing local changes to a
// backend that may not be reachable yet — the same offline-first posture as
// game/storage.js, applied to outbound writes instead of the season blob.
//
// Three rules make this safe:
//
//  1. DURABLE. The whole queue (pending + parked) lives in one localStorage
//     entry and is read back verbatim on the next `createOfflineQueue()` —
//     a reload never loses a queued write. Every access is wrapped exactly
//     like storage.js: private mode, disabled site data and quota exhaustion
//     all throw on access, and none of them may take the app down or lose an
//     entry that already made it into memory.
//
//  2. STRICTLY ORDERED. Every entry carries a monotonic `seq` assigned at
//     enqueue time. flush() always processes pending entries in `seq` order
//     and stops at the very first one that does not succeed — including the
//     one that gets classified "permanent" and parked. That entry is then no
//     longer in the pending list, so the *next* flush() call picks up where
//     it left off; but never within the same call, and never out of order.
//     A later write must never reach the server ahead of an earlier one that
//     hasn't yet been resolved one way or the other.
//
//  3. NOTHING IS DROPPED SILENTLY. A handler's rejection is classified as
//     either transient (worth retrying — offline, a network error, a 5xx,
//     429/408) or permanent (retrying can't help — a constraint violation,
//     a permission error, any other 4xx). Transient failures stay pending,
//     with `attempts` incremented, and block the queue exactly where they
//     are. Permanent failures move to `parked` with the error attached and
//     are never deleted; they wait for an explicit retryParked().
//
//  4. ADDRESSED TO AN ACCOUNT. Every entry records the user it was queued for.
//     A write is not a free-floating intention: it names a team inside one
//     account. Replaying it as somebody else would either write to the wrong
//     account or be refused by row-level security and park with a permissions
//     error that looks like data loss. So flush only ever applies entries
//     belonging to the current user; anything else is left untouched and can be
//     reported. Entries queued before this existed carry no owner and are
//     treated as the current user's, which is what they were.
//
// Coalescing is for whole-snapshot writes (e.g. "the season, as of now"),
// where only the latest value matters and re-sending every intermediate
// version would be wasted work. An entry opts in by carrying a
// `coalesceKey`; enqueuing a new entry with the same `kind` + `coalesceKey`
// as an existing *pending* entry replaces it outright — same slot in
// spirit, fresh `seq`, fresh attempts. Entries with no `coalesceKey` (the
// event log, where every entry is a distinct fact) are never coalesced, and
// parked entries are never coalesced away either — a parked failure is not
// quietly discarded just because a newer write of the same kind shows up.

const EMPTY_STATE = () => ({ seq: 0, pending: [], parked: [] });

function safeReadState(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return EMPTY_STATE();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return EMPTY_STATE();
    return {
      seq: typeof parsed.seq === 'number' ? parsed.seq : 0,
      pending: Array.isArray(parsed.pending) ? parsed.pending : [],
      parked: Array.isArray(parsed.parked) ? parsed.parked : [],
    };
  } catch {
    return EMPTY_STATE(); // storage unavailable or corrupt — start empty rather than throw
  }
}

function safeWriteState(storageKey, state) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Quota or private mode — the caller already has the in-memory result;
    // persistence just silently didn't happen, same posture as saveState().
  }
}

/** Turn any thrown value into a plain, JSON-serializable record. */
function serializeError(err) {
  if (err == null) return { message: String(err) };
  if (typeof err === 'string') return { message: err };
  return {
    message: err.message != null ? String(err.message) : String(err),
    name: err.name || undefined,
    status: typeof err.status === 'number' ? err.status : undefined,
    code: err.code != null ? String(err.code) : undefined,
  };
}

/**
 * Decide whether a handler failure is worth retrying as-is ("transient") or
 * will never succeed by simply trying again ("permanent"). Exported (and
 * overridable via `createOfflineQueue({ classifyError })`) so callers with a
 * different backend's error shapes can supply their own, and so the default
 * rules are directly testable.
 *
 * Defaults to "transient" for anything unrecognized: an entry that is
 * wrongly kept pending just gets retried again later, which is safe; an
 * entry that is wrongly parked stops being retried at all, which is not.
 */
export function classifyError(err) {
  if (err == null) return 'transient';

  const status = typeof err.status === 'number' ? err.status
    : typeof err.statusCode === 'number' ? err.statusCode
    : undefined;
  if (typeof status === 'number') {
    if (status === 408 || status === 429) return 'transient';
    if (status >= 500) return 'transient';
    if (status >= 400) return 'permanent';
  }

  // Postgres / PostgREST (Supabase) style codes: class 23 is integrity
  // constraint violation, 42501 is insufficient_privilege.
  const code = err.code != null ? String(err.code) : '';
  if (code.startsWith('23') || code === '42501' || code === 'PGRST301') return 'permanent';

  const message = String(err.message || err || '');
  if (/permission|forbidden|denied|constraint|duplicate|unique/i.test(message)) return 'permanent';
  if (/network|offline|fetch/i.test(message)) return 'transient';

  return 'transient';
}

/**
 * @param {object} [options]
 * @param {string} [options.storageKey]
 * @param {() => number} [options.now]
 * @param {(err: unknown) => 'transient'|'permanent'} [options.classifyError]
 */
export function createOfflineQueue({
  storageKey = 'score-tracker:queue',
  now = () => Date.now(),
  classifyError: classifyOverride,
} = {}) {
  const classify = classifyOverride || classifyError;

  const read = () => safeReadState(storageKey);
  const write = (state) => safeWriteState(storageKey, state);

  function enqueue(op) {
    const state = read();
    const seq = state.seq + 1;
    const coalesceKey = op && op.coalesceKey != null ? op.coalesceKey : null;
    const entry = {
      id: `q${seq}`,
      seq,
      kind: op && op.kind,
      payload: op ? op.payload : undefined,
      coalesceKey,
      // Which account this write is for. Null means "whoever is signed in",
      // which is how entries behaved before this was recorded.
      owner: op && op.owner != null ? op.owner : null,
      status: 'pending',
      attempts: 0,
      lastError: null,
      createdAt: now(),
      updatedAt: now(),
    };

    let pending = state.pending;
    if (coalesceKey != null) {
      // Only a PENDING entry of the same kind+key is superseded — a parked
      // one is a recorded failure, not a stale draft, and stays put. The owner
      // has to match too: one account's snapshot must never stand in for
      // another's, even for the same team id.
      pending = pending.filter(
        (e) => !(e.kind === entry.kind && e.coalesceKey === coalesceKey && sameOwner(e.owner, entry.owner)),
      );
    }
    pending = [...pending, entry];

    write({ seq, pending, parked: state.parked });
    return entry;
  }

  function list() {
    return read().pending.slice().sort((a, b) => a.seq - b.seq);
  }

  function parked() {
    return read().parked.slice().sort((a, b) => a.seq - b.seq);
  }

  function size() {
    return read().pending.length;
  }

  function clear() {
    write(EMPTY_STATE());
  }

  function retryParked() {
    const state = read();
    if (!state.parked.length) return [];
    const revived = state.parked.map((e) => ({
      ...e,
      status: 'pending',
      attempts: 0,
      lastError: null,
      error: undefined,
      updatedAt: now(),
    }));
    const pending = [...state.pending, ...revived].sort((a, b) => a.seq - b.seq);
    write({ seq: state.seq, pending, parked: [] });
    return revived;
  }

  /**
   * Process pending entries in seq order, one at a time, stopping at the
   * first one that does not cleanly succeed. Never throws: a handler
   * rejection is caught and classified, not propagated.
   */
  /** An entry with no owner belongs to whoever is signed in now. */
  function sameOwner(entryOwner, owner) {
    return entryOwner == null || owner == null || entryOwner === owner;
  }

  /**
   * @param {object} handlers   keyed by entry kind
   * @param {object} [options]
   * @param {string} [options.owner]  only apply entries queued for this user
   */
  async function flush(handlers = {}, { owner = null } = {}) {
    const state = read();
    const all = state.pending.slice().sort((a, b) => a.seq - b.seq);
    // Another account's writes are not skipped in the sense of being lost —
    // they stay exactly where they are, in order, waiting for that account.
    const ordered = all.filter((e) => sameOwner(e.owner, owner));
    const held = all.filter((e) => !sameOwner(e.owner, owner));
    const parkedList = state.parked.slice();
    const stillPending = [];
    const applied = [];
    let failed = null;

    for (const entry of ordered) {
      if (failed) {
        stillPending.push(entry); // an earlier entry failed — nothing after it may run
        continue;
      }

      const handler = handlers ? handlers[entry.kind] : undefined;
      if (typeof handler !== 'function') {
        // No handler registered for this kind: can't be applied and can't be
        // classified, so it just blocks here like any other failure rather
        // than being skipped or silently dropped.
        stillPending.push(entry);
        failed = { id: entry.id, kind: entry.kind, reason: 'no-handler' };
        continue;
      }

      try {
        await handler(entry.payload);
        applied.push(entry.id);
      } catch (err) {
        const classification = classify(err);
        if (classification === 'permanent') {
          parkedList.push({
            ...entry,
            status: 'parked',
            error: serializeError(err),
            updatedAt: now(),
          });
        } else {
          stillPending.push({
            ...entry,
            attempts: entry.attempts + 1,
            lastError: serializeError(err),
            updatedAt: now(),
          });
        }
        failed = { id: entry.id, kind: entry.kind, reason: classification };
      }
    }

    write({ seq: state.seq, pending: [...stillPending, ...held].sort((a, b) => a.seq - b.seq), parked: parkedList });

    return { applied, failed, remaining: stillPending.length, heldForOtherAccounts: held.length };
  }

  /** Entries queued for a different account than the one given. */
  function foreign(owner) {
    return read().pending.filter((e) => !sameOwner(e.owner, owner));
  }

  /** Everything still waiting to go, for anyone. */
  function unsent() {
    const state = read();
    return { pending: state.pending.length, parked: state.parked.length };
  }

  return { enqueue, list, parked, flush, retryParked, size, clear, foreign, unsent };
}
