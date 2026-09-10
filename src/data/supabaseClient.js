// Supabase client bootstrap.
//
// The app must run with no backend configured at all — that is the local-only
// mode everything was built in, and it stays a first-class path. So this module
// reports whether Supabase is configured and hands back null when it isn't;
// callers pick an adapter accordingly rather than crashing on a missing key.

import { createClient } from '@supabase/supabase-js';

/**
 * Read a build-time env var. Vite exposes them on import.meta.env in the
 * browser; the node test suites read the same names from process.env.
 */
function readEnv(name) {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[name]) {
      return import.meta.env[name];
    }
  } catch {
    /* import.meta unavailable (CJS) — fall through */
  }
  if (typeof process !== 'undefined' && process.env && process.env[name]) {
    return process.env[name];
  }
  return undefined;
}

export const SUPABASE_URL = readEnv('VITE_SUPABASE_URL');
export const SUPABASE_ANON_KEY = readEnv('VITE_SUPABASE_ANON_KEY');

/** Whether a backend is configured. False means run purely on local storage. */
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let client = null;

/** The shared client, or null when no backend is configured. */
export function getSupabase() {
  if (!isSupabaseConfigured) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // The magic-link callback arrives as a URL fragment.
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

/** Testing seam: build a client against an explicit URL/key pair. */
export function createSupabaseClient(url, key, options) {
  return createClient(url, key, options);
}
