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

    /** Fires on sign-in, sign-out and token refresh. Returns an unsubscribe. */
    onChange(callback) {
      if (!client) return () => {};
      const { data } = client.auth.onAuthStateChange((_event, session) => callback(session));
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
