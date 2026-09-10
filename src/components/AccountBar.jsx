import { C, btn } from '../theme.js';

// A strip across the top when the account is not in a normal state.
//
// It never hides the season behind it. Being signed out, or unable to reach the
// server, is a fact about syncing — not a reason to withhold a season that is
// sitting on the phone. Earlier this app replaced itself with a sign-in screen
// in both cases, which locked someone out of their own data at a field with no
// signal.

const WORDING = {
  stale: {
    background: '#FFF1D6',
    border: C.amberLine,
    title: "Can't reach your account",
    detail: 'Everything is saved on this phone and will sync when you are back online.',
    action: null,
  },
  'signed-out': {
    background: '#EAF4FA',
    border: C.stroke,
    title: 'Not signed in',
    detail: 'This phone is the only copy. Sign in to sync your season to your account.',
    action: 'Sign in',
  },
};

export default function AccountBar({ status, onSignIn }) {
  const wording = WORDING[status];
  if (!wording) return null;

  return (
    <div
      style={{
        background: wording.background,
        borderBottom: `1px solid ${wording.border}`,
        padding: '8px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        // Clears the notch when the app is installed.
        paddingTop: 'max(8px, var(--safe-top, 8px))',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink }}>{wording.title}</div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, lineHeight: 1.35 }}>{wording.detail}</div>
      </div>
      {wording.action && (
        <button
          onClick={onSignIn}
          style={{
            flexShrink: 0,
            background: C.header,
            border: 'none',
            color: '#fff',
            borderRadius: 99,
            padding: '0 14px',
            minHeight: 40,
            fontSize: 13,
            fontWeight: 800,
            ...btn,
          }}
        >
          {wording.action}
        </button>
      )}
    </div>
  );
}
