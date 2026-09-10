// Local (localStorage) adapter — see repository.js for the contract this
// satisfies.
//
// Every rule that makes persistence safe — migrating old shapes forward
// instead of discarding them, stripping transient UI before writing,
// preserving an unreadable payload for manual recovery — already lives in
// game/storage.js and is pinned by test/storage-check.mjs. This adapter is
// a thin, Promise-shaped wrapper around that logic; it does not reimplement
// any of it.

import { readState, saveState, getPreserved, clearPreserved } from '../game/storage.js';
import { INITIAL_STATE } from './league.js';

/**
 * @returns {import('./repository.js').Repository}
 */
export function createLocalRepository() {
  return {
    // localStorage is synchronous, so the first render can be seeded directly
    // and the app never flashes the blank/setup UI on launch.
    loadSync() {
      return readState(INITIAL_STATE);
    },

    async load() {
      // readState already reports "nothing to restore" as null, so there is
      // no need to infer it by comparing against the defaults.
      return readState(INITIAL_STATE);
    },

    save(state) {
      saveState(state);
    },

    async getPreserved() {
      return getPreserved();
    },

    clearPreserved() {
      clearPreserved();
    },
  };
}
