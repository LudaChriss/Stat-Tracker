import { useState } from 'react';
import { C, btn } from '../theme.js';
import { Sheet } from './ui.jsx';
import { INVITABLE_ROLES, ROLE_BLURB, ROLE_LABEL, formatCode, inviteErrorMessage } from '../data/invites.js';

// A manager handing someone a way in.
//
// The role is chosen before the code exists, because the code IS the role — an
// invite cannot be re-pointed afterwards, and a single-use code that grants
// more than intended is not something you can take back once it is sent.

const line = { fontSize: 12.5, color: C.muted, fontWeight: 600, lineHeight: 1.45 };

export default function InviteSheet({ teamName, onCreate, onClose }) {
  const [role, setRole] = useState('team_scorer');
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setBusy(true);
    setError(null);
    const result = await onCreate(role);
    setBusy(false);
    if (result.error) setError(inviteErrorMessage(result.error));
    else setInvite(result.invite);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatCode(invite.code));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked; the code is on screen to read out either way.
      setCopied(false);
    }
  };

  const expires = invite ? new Date(invite.expires_at) : null;

  return (
    <Sheet onClose={busy ? () => {} : onClose} sheetStyle={{ background: '#fff', color: C.ink, padding: '22px 20px 30px' }}>
      <div style={{ fontSize: 19, fontWeight: 800 }}>{invite ? 'Share this code' : 'Invite someone'}</div>

      {!invite && (
        <>
          <div style={{ ...line, marginTop: 4 }}>
            They will join {teamName || 'your team'} with the role you pick here.
          </div>

          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {INVITABLE_ROLES.map((r) => {
              const chosen = r === role;
              return (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  style={{
                    textAlign: 'left',
                    background: chosen ? '#EAF4FA' : '#fff',
                    border: `1.5px solid ${chosen ? C.header : C.stroke}`,
                    borderRadius: 13,
                    padding: '12px 14px',
                    minHeight: 48,
                    ...btn,
                  }}
                >
                  <div style={{ fontSize: 15, fontWeight: 800, color: C.ink }}>{ROLE_LABEL[r]}</div>
                  <div style={{ fontSize: 12, color: C.muted, fontWeight: 600, marginTop: 2, lineHeight: 1.4 }}>
                    {ROLE_BLURB[r]}
                  </div>
                </button>
              );
            })}
          </div>

          {error && <div style={errorBlock}>{error}</div>}

          <button onClick={generate} disabled={busy} style={primary}>
            {busy ? 'Creating…' : 'Create invite code'}
          </button>
          <button onClick={onClose} disabled={busy} style={quiet}>
            Cancel
          </button>
        </>
      )}

      {invite && (
        <>
          <div style={{ ...line, marginTop: 4 }}>
            They enter this in the app under Manage roster → Join a team. It works once, for one person.
          </div>

          <div
            style={{
              marginTop: 14,
              background: '#EAF4FA',
              border: `1.5px solid ${C.stroke}`,
              borderRadius: 14,
              padding: '16px 12px',
              textAlign: 'center',
              fontSize: 26,
              fontWeight: 800,
              letterSpacing: '.12em',
              color: C.ink,
              overflowWrap: 'anywhere',
            }}
          >
            {formatCode(invite.code)}
          </div>

          <div style={{ ...line, marginTop: 8 }}>
            Joining as <strong>{ROLE_LABEL[invite.role] || invite.role}</strong>
            {expires ? ` · expires ${expires.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
          </div>

          <button onClick={copy} style={primary}>
            {copied ? 'Copied' : 'Copy code'}
          </button>
          <button onClick={onClose} style={quiet}>
            Done
          </button>
        </>
      )}
    </Sheet>
  );
}

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

const errorBlock = {
  marginTop: 12,
  background: '#FFECE6',
  border: `1px solid ${C.coral}`,
  borderRadius: 11,
  padding: '9px 11px',
  fontSize: 12.5,
  color: C.ink,
  fontWeight: 600,
  lineHeight: 1.45,
};
