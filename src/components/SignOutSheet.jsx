import { C, btn } from '../theme.js';
import { Sheet } from './ui.jsx';

// Signing out, and what happens to writes that have not reached the account.
//
// It warns rather than refuses. Refusing would trap someone with no signal into
// staying signed in, which is a worse failure than a warning they can read.
// Either way nothing is dropped: the season stays in local storage and the
// queued writes stay queued, stamped with the account they belong to, waiting
// for it rather than for whoever signs in next.

const primary = {
  width: '100%',
  marginTop: 16,
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

const secondary = {
  width: '100%',
  marginTop: 8,
  background: '#fff',
  border: `1.5px solid ${C.stroke}`,
  color: C.header,
  borderRadius: 14,
  padding: 14,
  minHeight: 48,
  fontSize: 15,
  fontWeight: 800,
  ...btn,
};

const quiet = {
  width: '100%',
  marginTop: 8,
  background: 'none',
  border: 'none',
  color: C.muted,
  padding: 12,
  minHeight: 44,
  fontSize: 14,
  fontWeight: 700,
  ...btn,
};

const line = { fontSize: 12.5, color: C.muted, fontWeight: 600, lineHeight: 1.45 };

export default function SignOutSheet({ email, unsent, busy, onSyncNow, onSignOut, onClose }) {
  const waiting = (unsent && unsent.pending) || 0;
  const parked = (unsent && unsent.parked) || 0;
  const total = waiting + parked;

  return (
    <Sheet onClose={busy ? () => {} : onClose} sheetStyle={{ background: '#fff', color: C.ink, padding: '22px 20px 30px' }}>
      <div style={{ fontSize: 19, fontWeight: 800 }}>Sign out</div>
      {email && <div style={{ ...line, marginTop: 2 }}>Signed in as {email}.</div>}

      <div style={{ ...line, marginTop: 10 }}>
        Your season stays on this phone. Nothing is deleted, and you can still score games and export
        while signed out.
      </div>

      {total > 0 && (
        <div
          style={{
            marginTop: 12,
            background: '#FFF1D6',
            border: `1px solid ${C.amberLine}`,
            borderRadius: 12,
            padding: '10px 12px',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>
            {total === 1 ? '1 change has not reached your account' : `${total} changes have not reached your account`}
          </div>
          <div style={{ ...line, marginTop: 2 }}>
            They are kept on this phone and stay addressed to this account — signing in again sends them.
            Signing into a different account will not pick them up.
          </div>
        </div>
      )}

      {total > 0 && (
        <button onClick={onSyncNow} disabled={busy} style={secondary}>
          {busy ? 'Trying…' : 'Try to sync now'}
        </button>
      )}

      <button onClick={onSignOut} disabled={busy} style={total > 0 ? { ...primary, marginTop: 8 } : primary}>
        {total > 0 ? 'Sign out anyway' : 'Sign out'}
      </button>
      <button onClick={onClose} disabled={busy} style={quiet}>
        Cancel
      </button>
    </Sheet>
  );
}
