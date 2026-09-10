// The persistence contract every adapter must satisfy. useGame.js only ever
// talks to an object shaped like this — it does not know, or care, whether
// "storage" means localStorage or a network round trip to Supabase.
//
// Every method is async-friendly on purpose. The local adapter happens to
// resolve immediately, because localStorage is synchronous under the hood,
// but a network-backed adapter genuinely awaits a request. Callers must
// never assume a call has settled just because it *can* settle instantly —
// always go through the returned promise, never read a side-channel value.
//
// Contract:
//
//  - load() -> Promise<state | null>
//      Resolves to the most recently saved season, migrated to the current
//      shape, or null if there is nothing stored (or nothing readable).
//      Never rejects — an adapter that can't reach its backing store
//      resolves to null rather than throwing, so a caller can always fall
//      back to a blank season without a try/catch of its own.
//
//  - save(state) -> void
//      Fire-and-forget. Persists the durable slice of `state` (an adapter
//      is responsible for stripping its own transient/UI-only fields
//      before writing). Best-effort: must never throw, and must never
//      leave a rejected promise for the caller to handle — a failed save
//      should not interrupt play.
//
//  - getPreserved() -> Promise<string | null>
//      Raw text of a save that could not be read on a previous load, if
//      the adapter keeps one around for manual recovery. Resolves to null
//      if there isn't one. Never rejects.
//
//  - clearPreserved() -> void
//      Discard whatever getPreserved() would otherwise resolve to.
//
// A conforming adapter is a plain object with these four methods — no
// class, no shared base — so a Supabase adapter can be a handful of
// functions closing over a client instance, matching this same shape.

/**
 * @typedef {Object} Repository
 * @property {() => Promise<object|null>} load
 * @property {(state: object) => void} save
 * @property {() => Promise<string|null>} getPreserved
 * @property {() => void} clearPreserved
 */

export {};

/**
 * OPTIONAL: `loadSync()`
 *
 * An adapter whose storage is synchronous (localStorage) may also expose
 * `loadSync(): state | null`. When present it is used to seed the very first
 * render, which avoids a visible flash of the blank/setup UI before an async
 * load resolves — a microtask `setState` is not guaranteed to be flushed
 * before the browser paints.
 *
 * Adapters without it (anything network-backed) are loaded asynchronously and
 * should be paired with a loading state in the UI.
 */
