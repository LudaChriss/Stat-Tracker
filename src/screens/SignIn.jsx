import { C, FONT, btn, tnum } from '../theme.js';

const field = {
  width: '100%',
  border: `1.5px solid ${C.line}`,
  borderRadius: 12,
  padding: '13px 14px',
  fontSize: 16, // 16px keeps iOS from zooming the page on focus
  fontWeight: 700,
  color: C.ink,
  background: '#fff',
  fontFamily: FONT,
};

const codeField = {
  ...field,
  fontSize: 28,
  fontWeight: 800,
  textAlign: 'center',
  letterSpacing: '.35em',
  padding: '14px 10px 14px 16px', // extra left padding balances the letter-spacing visually
  ...tnum,
};

const label = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '.06em',
  color: C.muted,
  marginBottom: 6,
  textTransform: 'uppercase',
};

const primary = {
  width: '100%',
  background: C.coral,
  border: 'none',
  color: '#fff',
  borderRadius: 14,
  padding: 15,
  minHeight: 48,
  fontSize: 16,
  fontWeight: 800,
  ...btn,
};

const quiet = {
  width: '100%',
  background: 'none',
  border: 'none',
  color: C.muted,
  minHeight: 40,
  padding: 10,
  fontSize: 13.5,
  fontWeight: 700,
  ...btn,
};

const linkBtn = {
  ...quiet,
  width: 'auto',
  padding: '10px 2px',
  color: C.teal,
};

const errorBlock = {
  background: '#FFF1D6',
  border: `1.5px solid ${C.amberLine}`,
  borderRadius: 12,
  padding: '11px 13px',
  fontSize: 12.5,
  fontWeight: 700,
  color: '#8A6100',
};

const noticeBlock = {
  background: '#F4FAFB',
  border: `1.5px solid ${C.teal}`,
  borderRadius: 12,
  padding: '11px 13px',
  fontSize: 12.5,
  fontWeight: 700,
  color: C.teal,
};

/**
 * Purely presentational sign-in screen. Every action is a prop call — the
 * Supabase calls (and the decision of when to move from 'email' to 'code'
 * step) live in whatever wires this up.
 *
 * Code is the default flow rather than a magic link: a link opens in Safari,
 * not the installed app, so tapping it would leave the app itself signed out.
 */
export default function SignIn({
  mode,
  step,
  email,
  onEmailChange,
  code,
  onCodeChange,
  password,
  onPasswordChange,
  busy,
  error,
  notice,
  onSendCode,
  onVerifyCode,
  onSignInWithPassword,
  onUseCode,
  onUsePassword,
  onBack,
  onDismiss,
}) {
  const codeMode = mode === 'code';
  const codeStep = codeMode && step === 'code';

  const emailField = (
    <div>
      <div style={label}>Email</div>
      <input
        autoFocus
        type="email"
        inputMode="email"
        autoComplete="email"
        value={email}
        onChange={(e) => onEmailChange(e.target.value)}
        placeholder="you@example.com"
        style={field}
      />
    </div>
  );

  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 'var(--hdr-top) 20px 8px' }}>
        {/* Signing in is optional: the season works without it, so there has to
            be a way back to it. */}
        {onDismiss && (
          <button
            onClick={onDismiss}
            style={{
              background: 'none',
              border: 'none',
              color: C.muted,
              padding: '6px 0',
              minHeight: 44,
              fontSize: 14,
              fontWeight: 700,
              ...btn,
            }}
          >
            ‹ Keep using this phone only
          </button>
        )}
        <div style={{ fontSize: 22, fontWeight: 800 }}>Sign in</div>
        <div style={{ fontSize: 13, color: C.muted, fontWeight: 600, marginTop: 4 }}>
          {codeMode
            ? "We'll email a 6-digit code — a tap-through link opens in Safari instead of the app, so a code is what keeps you signed in here."
            : 'Sign in with your email and password.'}
        </div>
      </div>

      <div style={{ padding: '10px 20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {notice && <div style={noticeBlock}>{notice}</div>}
        {error && <div style={errorBlock}>{error}</div>}

        {codeMode && !codeStep && (
          <>
            {emailField}
            <button
              onClick={onSendCode}
              disabled={busy || !email.trim()}
              style={{ ...primary, opacity: busy || !email.trim() ? 0.5 : 1 }}
            >
              {busy ? 'Sending…' : 'Email me a code'}
            </button>
          </>
        )}

        {codeStep && (
          <>
            <div>
              <div style={label}>6-digit code</div>
              <input
                autoFocus
                value={code}
                onChange={(e) => onCodeChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                style={codeField}
              />
            </div>
            <button
              onClick={onVerifyCode}
              disabled={busy || code.length !== 6}
              style={{ ...primary, opacity: busy || code.length !== 6 ? 0.5 : 1 }}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button onClick={onBack} disabled={busy} style={linkBtn}>
                ‹ Change email
              </button>
              <button onClick={onSendCode} disabled={busy} style={linkBtn}>
                Send a new code
              </button>
            </div>
          </>
        )}

        {!codeMode && (
          <>
            {emailField}
            <div>
              <div style={label}>Password</div>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => onPasswordChange(e.target.value)}
                placeholder="••••••••"
                style={field}
              />
            </div>
            <button
              onClick={onSignInWithPassword}
              disabled={busy || !email.trim() || !password.trim()}
              style={{ ...primary, opacity: busy || !email.trim() || !password.trim() ? 0.5 : 1 }}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </>
        )}

        <button onClick={codeMode ? onUsePassword : onUseCode} disabled={busy} style={quiet}>
          {codeMode ? 'Use a password instead' : 'Use an email code instead'}
        </button>
      </div>
    </div>
  );
}
