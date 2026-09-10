import { useState } from 'react';
import { C, btn } from '../theme.js';
import { Sheet } from './ui.jsx';
import { ROLE_BLURB, ROLE_LABEL, inviteErrorMessage, normalize } from '../data/invites.js';

// Redeeming an invite.
//
// Two things this must not do, both of which follow the rule that local data is
// never touched without being asked:
//
//   * It shows what the code grants BEFORE accepting it. A single-use code is
//     spent the moment it is redeemed, so "find out by trying" is not an option
//     that can be taken back.
//   * If this device already holds a season, joining someone else's team does
//     NOT switch to it. The membership is granted, the season on this phone is
//     left exactly as it is, and the person is told plainly which is which.
//     Switching between two seasons is phase 4's job, and doing it implicitly
//     here would mean an invite could quietly replace what is on the screen.

const line = { fontSize: 12.5, color: C.muted, fontWeight: 600, lineHeight: 1.45 };

export default function JoinTeamSheet({ hasLocalSeason, onPeek, onAccept, onClose }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [joined, setJoined] = useState(null);

  const look = async () => {
    setBusy(true);
    setError(null);
    const result = await onPeek(code);
    setBusy(false);
    if (result.error) {
      setError(inviteErrorMessage(result.error));
      return;
    }
    if (!result.invite) {
      setError("That code isn't right. Check it and try again.");
      return;
    }
    if (!result.invite.usable) {
      setError('That code has already been used or has expired. Ask for a new one.');
      return;
    }
    setPreview(result.invite);
  };

  const join = async () => {
    setBusy(true);
    setError(null);
    const result = await onAccept(code);
    setBusy(false);
    if (result.error) {
      setError(inviteErrorMessage(result.error));
      return;
    }
    setJoined(result);
  };

  return (
    <Sheet onClose={busy ? () => {} : onClose} sheetStyle={{ background: '#fff', color: C.ink, padding: '22px 20px 30px' }}>
      <div style={{ fontSize: 19, fontWeight: 800 }}>{joined ? "You're in" : 'Join a team'}</div>

      {!preview && !joined && (
        <>
          <div style={{ ...line, marginTop: 4 }}>Enter the code a team manager gave you.</div>
          <input
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="BQ7K-2M9X-RT"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            style={{
              width: '100%',
              marginTop: 12,
              boxSizing: 'border-box',
              border: `1.5px solid ${C.stroke}`,
              borderRadius: 13,
              padding: '14px 12px',
              minHeight: 50,
              fontSize: 20,
              fontWeight: 800,
              letterSpacing: '.1em',
              textAlign: 'center',
              color: C.ink,
            }}
          />
          {error && <div style={errorBlock}>{error}</div>}
          <button onClick={look} disabled={busy || normalize(code).length < 6} style={primary}>
            {busy ? 'Checking…' : 'Continue'}
          </button>
          <button onClick={onClose} disabled={busy} style={quiet}>
            Cancel
          </button>
        </>
      )}

      {preview && !joined && (
        <>
          <div style={{ ...line, marginTop: 4 }}>This code adds you to:</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 8, overflowWrap: 'anywhere' }}>
            {preview.team_name || 'A team'}
          </div>
          <div style={{ ...line, marginTop: 4 }}>
            as <strong>{ROLE_LABEL[preview.role] || preview.role}</strong> — {ROLE_BLURB[preview.role] || ''}
          </div>

          {hasLocalSeason && (
            <div
              style={{
                marginTop: 14,
                background: '#FFF1D6',
                border: `1px solid ${C.amberLine}`,
                borderRadius: 12,
                padding: '10px 12px',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>Your own season stays as it is</div>
              <div style={{ ...line, marginTop: 2 }}>
                This phone is already showing a season. Joining does not replace it and does not change
                anything on it — you will be on both. Choosing which one to score is coming later.
              </div>
            </div>
          )}

          {error && <div style={errorBlock}>{error}</div>}

          <button onClick={join} disabled={busy} style={primary}>
            {busy ? 'Joining…' : `Join as ${ROLE_LABEL[preview.role] || preview.role}`}
          </button>
          <button onClick={() => { setPreview(null); setError(null); }} disabled={busy} style={quiet}>
            Back
          </button>
        </>
      )}

      {joined && (
        <>
          <div style={{ ...line, marginTop: 4 }}>
            You joined <strong>{joined.teamName || 'the team'}</strong> as{' '}
            <strong>{ROLE_LABEL[joined.role] || joined.role}</strong>.
          </div>
          <div style={{ ...line, marginTop: 8 }}>
            {joined.switched
              ? 'This phone is now showing that team.'
              : 'The season on this phone has not changed. Nothing was moved, replaced or removed.'}
          </div>
          <button onClick={onClose} style={primary}>
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
