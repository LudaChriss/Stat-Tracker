// Exercise the offline write queue against a stub localStorage: durability
// across "reloads", strict ordering under failure, the transient/permanent
// split, coalescing (and its refusal to coalesce un-keyed entries or parked
// ones), and that a throwing localStorage never breaks the queue.
let store = {};
let mode = 'ok';
globalThis.localStorage = {
  getItem(k) { if (mode === 'throw') throw new Error('SecurityError'); return k in store ? store[k] : null; },
  setItem(k, v) { if (mode === 'throw' || mode === 'quota') throw new Error(mode === 'quota' ? 'QuotaExceededError' : 'SecurityError'); store[k] = v; },
  removeItem(k) { delete store[k]; },
};

const { createOfflineQueue, classifyError } = await import('../src/data/offlineQueue.js');

let fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log('ok   ' + label);
};

const reset = () => { store = {}; mode = 'ok'; };

// --- durability: a fresh queue instance over the same storage sees the same entries ---
{
  reset();
  const q1 = createOfflineQueue({ storageKey: 'q:durable' });
  q1.enqueue({ kind: 'event', payload: { a: 1 } });
  q1.enqueue({ kind: 'event', payload: { a: 2 } });

  // Simulate a reload: nothing but the stub storage carries over.
  const q2 = createOfflineQueue({ storageKey: 'q:durable' });
  eq('reload sees both entries', q2.list().map((e) => e.payload), [{ a: 1 }, { a: 2 }]);
  eq('reload preserves seq order', q2.list().map((e) => e.seq), [1, 2]);
}

// --- empty-safe ---
{
  reset();
  const q = createOfflineQueue({ storageKey: 'q:empty' });
  eq('list on empty queue', q.list(), []);
  eq('parked on empty queue', q.parked(), []);
  eq('size on empty queue', q.size(), 0);
  let threw = false;
  let result;
  try { result = await q.flush({ event: async () => {} }); } catch { threw = true; }
  eq('flush on empty queue does not throw', threw, false);
  eq('flush on empty queue is a no-op', result,
    { applied: [], failed: null, remaining: 0, heldForOtherAccounts: 0 });
}

// --- strict ordering: a failure in the middle blocks everything after it ---
{
  reset();
  const q = createOfflineQueue({ storageKey: 'q:order' });
  q.enqueue({ kind: 'event', payload: 'A' });
  q.enqueue({ kind: 'event', payload: 'B' });
  q.enqueue({ kind: 'event', payload: 'C' });

  const seen = [];
  const netError = () => { const e = new Error('fetch failed'); return e; }; // transient by default
  const res = await q.flush({
    event: async (payload) => {
      if (payload === 'B') throw netError();
      seen.push(payload);
    },
  });

  eq('A applied before the failure', seen, ['A']);
  eq('C never attempted', seen.includes('C'), false);
  eq('flush reports the failing entry', res.failed && res.failed.kind, 'event');
  eq('B and C both remain pending, in order', q.list().map((e) => e.payload), ['B', 'C']);
}

// --- transient failure: stays pending, attempts incremented ---
{
  reset();
  const q = createOfflineQueue({ storageKey: 'q:transient' });
  const entry = q.enqueue({ kind: 'event', payload: 'X' });
  eq('starts at zero attempts', entry.attempts, 0);

  await q.flush({ event: async () => { throw new Error('network error'); } });
  let back = q.list()[0];
  eq('still pending after a transient failure', q.list().map((e) => e.id), [entry.id]);
  eq('attempts incremented once', back.attempts, 1);
  eq('nothing parked', q.parked(), []);

  await q.flush({ event: async () => { throw new Error('network error'); } });
  back = q.list()[0];
  eq('attempts incremented again on a second failed flush', back.attempts, 2);
}

// --- permanent failure: parked with its error, never deleted ---
{
  reset();
  const q = createOfflineQueue({ storageKey: 'q:permanent' });
  const entry = q.enqueue({ kind: 'event', payload: 'bad-row' });

  const boom = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
  await q.flush({ event: async () => { throw boom; } });

  eq('removed from pending', q.list(), []);
  const p = q.parked();
  eq('exactly one parked entry', p.length, 1);
  eq('parked entry is the same entry', p[0].id, entry.id);
  eq('parked entry carries its payload', p[0].payload, 'bad-row');
  eq('parked entry records the error', p[0].error && p[0].error.code, '23505');
}

// --- a parked entry is not retried by a later flush until retryParked() ---
{
  reset();
  const q = createOfflineQueue({ storageKey: 'q:parked-retry' });
  q.enqueue({ kind: 'event', payload: 'perm' });
  q.enqueue({ kind: 'event', payload: 'after' });

  const forbidden = Object.assign(new Error('permission denied'), { status: 403 });
  await q.flush({ event: async (p) => { if (p === 'perm') throw forbidden; } });
  eq('perm parked, after left pending behind it', [q.parked().length, q.list().map((e) => e.payload)], [1, ['after']]);

  // A follow-up flush should proceed to "after" (parked entry is no longer
  // in the way) without ever re-invoking the handler for "perm".
  const calls = [];
  await q.flush({ event: async (p) => { calls.push(p); } });
  eq('later flush skips the parked entry and applies the next one', calls, ['after']);
  eq('parked entry untouched by that flush', q.parked().map((e) => e.payload), ['perm']);

  q.retryParked();
  eq('retryParked moves it back to pending', q.list().map((e) => e.payload), ['perm']);
  eq('parked is now empty', q.parked(), []);

  const calls2 = [];
  await q.flush({ event: async (p) => { calls2.push(p); } });
  eq('a flush after retryParked actually retries it', calls2, ['perm']);
}

// --- coalescing: same kind + coalesceKey replaces the older pending entry ---
{
  reset();
  const q = createOfflineQueue({ storageKey: 'q:coalesce' });
  q.enqueue({ kind: 'snapshot', payload: { season: 'v1' }, coalesceKey: 'season' });
  q.enqueue({ kind: 'event', payload: 'unrelated' });
  const latest = q.enqueue({ kind: 'snapshot', payload: { season: 'v2' }, coalesceKey: 'season' });

  const entries = q.list();
  eq('older snapshot replaced, queue does not grow', entries.length, 2);
  eq('unrelated entry untouched', entries.some((e) => e.payload === 'unrelated'), true);
  const snap = entries.find((e) => e.kind === 'snapshot');
  eq('only the latest snapshot value survives', snap.payload, { season: 'v2' });
  eq('the surviving entry is the newly enqueued one', snap.id, latest.id);
}

// --- coalescing never touches parked entries ---
{
  reset();
  const q = createOfflineQueue({ storageKey: 'q:coalesce-parked' });
  q.enqueue({ kind: 'snapshot', payload: { v: 1 }, coalesceKey: 'season' });
  const boom = Object.assign(new Error('permission denied'), { status: 403 });
  await q.flush({ snapshot: async () => { throw boom; } });
  eq('first snapshot is parked', q.parked().length, 1);

  q.enqueue({ kind: 'snapshot', payload: { v: 2 }, coalesceKey: 'season' });
  eq('parked snapshot is not replaced by the new pending one', q.parked()[0].payload, { v: 1 });
  eq('the new snapshot is pending, both entries now exist', [q.list().length, q.parked().length], [1, 1]);
}

// --- entries without a coalesceKey are never coalesced, even if identical ---
{
  reset();
  const q = createOfflineQueue({ storageKey: 'q:no-coalesce' });
  q.enqueue({ kind: 'event', payload: { same: true } });
  q.enqueue({ kind: 'event', payload: { same: true } });
  q.enqueue({ kind: 'event', payload: { same: true } });
  eq('every entry without a coalesceKey is kept', q.list().length, 3);
  eq('seqs are all distinct', new Set(q.list().map((e) => e.seq)).size, 3);
}

// --- idempotency: ids are stable and unique ---
{
  reset();
  const q = createOfflineQueue({ storageKey: 'q:ids' });
  const a = q.enqueue({ kind: 'event', payload: 1 });
  const b = q.enqueue({ kind: 'event', payload: 2 });
  eq('ids are distinct', a.id === b.id, false);
  eq('ids are stable across reload', createOfflineQueue({ storageKey: 'q:ids' }).list().map((e) => e.id), [a.id, b.id]);
}

// --- classifyError, the default rules ---
{
  eq('5xx is transient', classifyError({ status: 502 }), 'transient');
  eq('408 is transient', classifyError({ status: 408 }), 'transient');
  eq('429 is transient', classifyError({ status: 429 }), 'transient');
  eq('other 4xx is permanent', classifyError({ status: 400 }), 'permanent');
  eq('404 is permanent', classifyError({ status: 404 }), 'permanent');
  eq('postgres unique violation is permanent', classifyError({ code: '23505' }), 'permanent');
  eq('permission denied message is permanent', classifyError(new Error('permission denied')), 'permanent');
  eq('a bare fetch rejection is transient', classifyError(new TypeError('Failed to fetch')), 'transient');
  eq('network error message is transient', classifyError(new Error('network error')), 'transient');
  eq('unrecognized error defaults transient (safe to retry)', classifyError(new Error('whatever')), 'transient');
}

// --- classifyError is overridable per-queue ---
{
  reset();
  const q = createOfflineQueue({
    storageKey: 'q:custom-classify',
    classifyError: (err) => (err && err.alwaysPermanent ? 'permanent' : 'transient'),
  });
  q.enqueue({ kind: 'event', payload: 'p' });
  await q.flush({ event: async () => { throw { alwaysPermanent: true }; } });
  eq('custom classifier routes to parked', [q.list().length, q.parked().length], [0, 1]);
}

// --- clear() empties both pending and parked ---
{
  reset();
  const q = createOfflineQueue({ storageKey: 'q:clear' });
  q.enqueue({ kind: 'event', payload: 1 });
  const boom = Object.assign(new Error('permission denied'), { status: 403 });
  q.enqueue({ kind: 'event', payload: 2 });
  await q.flush({ event: async (p) => { if (p === 1) throw boom; } });
  eq('one parked before clear', q.parked().length, 1);
  q.clear();
  eq('clear empties pending', q.list(), []);
  eq('clear empties parked', q.parked(), []);
}

// --- a throwing localStorage never throws out of enqueue/flush/list ---
{
  reset();
  const q = createOfflineQueue({ storageKey: 'q:throwing' });
  q.enqueue({ kind: 'event', payload: 'seed' });

  mode = 'throw';
  let threw = false;
  let entry;
  try { entry = q.enqueue({ kind: 'event', payload: 'while-broken' }); } catch { threw = true; }
  eq('enqueue survives a throwing localStorage', threw, false);
  eq('enqueue still returns an entry', !!(entry && entry.id), true);

  threw = false;
  let listed;
  try { listed = q.list(); } catch { threw = true; }
  eq('list survives a throwing localStorage', threw, false);
  eq('list returns an array even when reads throw', Array.isArray(listed), true);

  threw = false;
  try { await q.flush({ event: async () => {} }); } catch { threw = true; }
  eq('flush survives a throwing localStorage', threw, false);

  mode = 'quota';
  threw = false;
  try { q.enqueue({ kind: 'event', payload: 'quota' }); } catch { threw = true; }
  eq('enqueue survives a quota error', threw, false);

  mode = 'ok';
  // Because storage was unreadable/unwritable during the calls above, the
  // durable record may not reflect every attempted write — that's the same
  // best-effort contract storage.js makes. What matters is nothing threw,
  // and the queue keeps working once storage is healthy again.
  let stillWorks = true;
  try { q.enqueue({ kind: 'event', payload: 'recovered' }); } catch { stillWorks = false; }
  eq('queue is usable again once storage recovers', stillWorks, true);
}

// --- a write made DURING a flush is not erased by it ---------------------------
//
// Handlers await the network. Live scoring appends a play every few seconds and
// each append asks the queue to drain, so "something was enqueued while a flush
// was in flight" is now the normal case rather than a corner.
//
// The bug this pins: a flush that wrote back the list it started with silently
// erased anything added in the meantime. No error, no parked entry — the play
// or the finished game was simply gone.
{
  reset();
  const q = createOfflineQueue({ storageKey: 'q:concurrent' });
  q.enqueue({ kind: 'slow', payload: 'first' });

  let release;
  const inFlight = new Promise((r) => { release = r; });
  const seen = [];

  const flushing = q.flush({
    slow: async (p) => { seen.push(p); await inFlight; },
  });

  // The handler is awaiting. This is the play entered while the last one was
  // still being sent.
  await Promise.resolve();
  q.enqueue({ kind: 'slow', payload: 'entered mid-flush' });

  release();
  await flushing;

  eq('the entry being sent was applied', seen, ['first']);
  eq('the one enqueued mid-flush survived', q.list().map((e) => e.payload), ['entered mid-flush']);
  eq('and nothing was parked', q.parked().length, 0);
}

// --- two flushes at once do not fight over the list ----------------------------
{
  reset();
  const q = createOfflineQueue({ storageKey: 'q:overlap' });
  q.enqueue({ kind: 'a', payload: 1 });
  q.enqueue({ kind: 'a', payload: 2 });

  const applied = [];
  const handlers = { a: async (p) => { await new Promise((r) => setTimeout(r, 5)); applied.push(p); } };

  const [one, two] = await Promise.all([q.flush(handlers), q.flush(handlers)]);

  eq('every entry was applied exactly once', applied.sort(), [1, 2]);
  eq('the queue is empty afterwards', q.list(), []);
  eq('the first flush reported what it applied', one.applied.length + two.applied.length, 2);
}

// --- a failure during an overlapping flush still blocks, and keeps its place ----
{
  reset();
  const q = createOfflineQueue({ storageKey: 'q:overlap-fail' });
  q.enqueue({ kind: 'a', payload: 'blocked' });
  q.enqueue({ kind: 'a', payload: 'behind it' });

  const handlers = {
    a: async (p) => {
      await new Promise((r) => setTimeout(r, 5));
      if (p === 'blocked') throw new Error('network unreachable');
    },
  };

  await Promise.all([q.flush(handlers), q.flush(handlers)]);

  eq('the blocked entry is still pending', q.list().map((e) => e.payload), ['blocked', 'behind it']);
  eq('and the one behind it never ran ahead', q.list()[0].payload, 'blocked');
  eq('nothing was parked for a network error', q.parked().length, 0);
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
