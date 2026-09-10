// Authentication.
//
// Sign-in is a 6-digit code typed into the app, never a link. A magic link
// opens in the system browser rather than in the installed PWA, so the session
// lands in a different browsing context and the app itself stays signed out.
// Password is offered as a fallback for people who prefer it.
//
// This module is a thin wrapper: it exists so the screens never touch a
// Supabase client directly, and so signing in can be tested without one.

/**
 * Does this device still hold a session, whatever the server currently thinks?
 *
 * supabase-js keeps it under a key it derives from the project URL. The
 * distinction this answers is the important one: a refresh that fails because
 * the network is down LEAVES the stored session alone, while one the server
 * rejects WIPES it. Both were confirmed against a real auth server.
 */
function hasStoredSession() {
  const looksLikeSession = (k) => /^sb-.*-auth-token/.test(String(k || ''));
  try {
    // The canonical Storage API. Object.keys() also works on a real Storage
    // object but not on a stand-in, and this has to be checkable in a test.
    if (typeof localStorage.length === 'number' && typeof localStorage.key === 'function') {
      for (let i = 0; i < localStorage.length; i++) {
        if (looksLikeSession(localStorage.key(i))) return true;
      }
      return false;
    }
    return Object.keys(localStorage).some(looksLikeSession);
  } catch {
    // Storage unavailable (private mode, blocked site data). Say "no" rather
    // than throwing; the caller degrades to the safest reading anyway.
    return false;
  }
}

/**
 * Why is there no usable session right now?
 *
 *   ok        there is one
 *   none      nobody has ever signed in on this device
 *   offline   we hold a session but could not reach the server to refresh it
 *   revoked   the server rejected the refresh token; this really is signed out
 *
 * The distinction is the whole point of phase 2a. "Cannot refresh right now"
 * is not "signed out", and treating them the same locks someone out of a
 * season that is sitting on their own phone.
 */
export function classifyAuthFailure(error, storedSession) {
  if (!error) return storedSession ? 'offline' : 'none';

  const status = typeof error.status === 'number' ? error.status : undefined;
  const code = String(error.code || '');
  const name = String(error.name || '');
  const message = String(error.message || error);

  // A network failure surfaces as status 0 / AuthRetryableFetchError.
  if (status === 0 || /retryable/i.test(name) || /failed to fetch|network|offline/i.test(message)) {
    return 'offline';
  }
  if (/refresh_token_not_found|refresh_token_already_used|invalid.*refresh/i.test(code + ' ' + message)) {
    return 'revoked';
  }
  if (status === 400 || status === 401 || status === 403) return 'revoked';

  // Something unrecognised. If a session is still on the device, lean towards
  // keeping the person in rather than throwing them out on an error we do not
  // understand — the cost of guessing wrong that way is a stale banner, and
  // the cost of guessing wrong the other way is a lost season.
  return storedSession ? 'offline' : 'none';
}

/**
 * @param {object} client a supabase-js client, or null when no backend is
 *   configured — in which case every call reports that plainly rather than
 *   throwing, and the app carries on locally.
 */
export function createAuth(client) {
  const noBackend = { error: { message: 'No backend is configured on this build.' } };

  return {
    isAvailable: !!client,

    async getSession() {
      if (!client) return null;
      const { data } = await client.auth.getSession();
      return data ? data.session : null;
    },

    /**
     * The session AND, when there isn't one, why not. The app needs the reason:
     * it decides between "sign in" and "we'll sync when you're back".
     */
    async getSessionDetailed() {
      if (!client) return { session: null, reason: 'none' };
      const { data, error } = await client.auth.getSession();
      const session = data ? data.session : null;
      if (session) return { session, reason: 'ok' };
      return { session: null, reason: classifyAuthFailure(error, hasStoredSession()) };
    },

    /** Whether a session is still stored here, regardless of the server. */
    hasStoredSession,

    /** Fires on sign-in, sign-out and token refresh. Returns an unsubscribe. */
    onChange(callback) {
      if (!client) return () => {};
      const { data } = client.auth.onAuthStateChange((event, session) => callback(session, event));
      return () => {
        try {
          data.subscription.unsubscribe();
        } catch {
          /* already gone */
        }
      };
    },

    /** Email a 6-digit code. Creates the account if it does not exist yet. */
    async sendCode(email) {
      if (!client) return noBackend;
      const { error } = await client.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: true },
      });
      return { error: error || null };
    },

    async verifyCode(email, token) {
      if (!client) return noBackend;
      const { data, error } = await client.auth.verifyOtp({
        email: email.trim(),
        token: String(token).trim(),
        type: 'email',
      });
      return { session: data ? data.session : null, error: error || null };
    },

    async signInWithPassword(email, password) {
      if (!client) return noBackend;
      const { data, error } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      return { session: data ? data.session : null, error: error || null };
    },

    async signOut() {
      if (!client) return noBackend;
      const { error } = await client.auth.signOut();
      return { error: error || null };
    },
  };
}

/** Turn an auth failure into something worth showing a person. */
export function authErrorMessage(error) {
  if (!error) return null;
  const raw = String(error.message || error);

  if (/invalid.*(token|otp)|expired/i.test(raw)) {
    return 'That code is wrong or has expired. Ask for a new one.';
  }
  if (/invalid login credentials/i.test(raw)) {
    return 'That email and password do not match.';
  }
  if (/rate limit|too many/i.test(raw)) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  if (/network|fetch|offline/i.test(raw)) {
    return 'Could not reach the server. Check your connection.';
  }
  return raw;
}
