import { useEffect, useState } from 'react';
import { C, btn } from '../theme.js';
import { Sheet } from './ui.jsx';
import { ROLE_LABEL } from '../data/invites.js';

// Looking at a different team.
//
// Until now, joining a second team granted the membership and changed nothing:
// the phone kept showing the season it already had, because switching between
// two seasons was phase 4's job. This is that job.
//
// Two rules it follows, both of them the same rule the rest of the app follows:
//
//   * NOTHING LOCAL IS DELETED. Switching repoints the app at another team's
//     season; it does not remove the one that was there. The mirror is stamped
//     with the team it belongs to, so the new team simply has no mirror yet —
//     the app waits for the account rather than painting the previous team's
//     roster under the new team's name.
//
//   * THE CHOICE IS RECORDED ON THE ACCOUNT, not on the phone, because it is
//     what decides which season loads on the next launch — on any phone.
//
// Anything unsent is a reason to warn, not to refuse. Refusing would trap
// somebody with no signal on a team they are done with.

const line = { fontSize: 12.5, color: C.muted, fontWeight: 600, lineHeight: 1.45 };

export default function TeamSwitcher({ currentTeamId, unsent, onList, onSwitch, onClose }) {
  const [teams, setTeams] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    onList().then((result) => {
      if (cancelled) return;
      if (result.error) setError('Could not read your teams. Check your connection.');
      setTeams(result.teams || []);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = async (id) => {
    setBusy(true);
    setError(null);
    const result = await onSwitch(id);
    setBusy(false);
    if (result && result.error) {
      setError(result.error.message || 'That did not work. Try again.');
      return;
    }
    onClose();
  };

  const waiting = (unsent && (unsent.pending || 0) + (unsent.parked || 0)) || 0;

  return (
    <Sheet
      onClose={busy ? () => {} : onClose}
      sheetStyle={{ background: '#fff', color: C.ink, padding: '22px 20px 30px' }}
    >
      <div style={{ fontSize: 19, fontWeight: 800 }}>Your teams</div>
      <div style={{ ...line, marginTop: 4 }}>
        Switching changes which season this phone is showing. Nothing is deleted, on this phone or
        in your account.
      </div>

      {waiting > 0 && (
        <div
          style={{
            marginTop: 14,
            background: '#FFF1D6',
            border: `1px solid ${C.amberLine}`,
            borderRadius: 12,
            padding: '10px 12px',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 800 }}>
            {waiting} {waiting === 1 ? 'change has' : 'changes have'} not reached your account yet
          </div>
          <div style={{ ...line, marginTop: 2 }}>
            They are queued against the team they belong to and will go through when the signal is
            back. Switching does not lose them.
          </div>
        </div>
      )}

      {teams === null && <div style={{ ...line, marginTop: 14 }}>Looking…</div>}

      {teams && !teams.length && (
        <div style={{ ...line, marginTop: 14 }}>
          You are only on one team. Join another with a code and it will show up here.
        </div>
      )}

      {(teams || []).map((t) => {
        const current = t.id === currentTeamId;
        return (
          <button
            key={t.id}
            onClick={current || busy ? undefined : () => pick(t.id)}
            disabled={current || busy}
            style={{
              width: '100%',
              textAlign: 'left',
              marginTop: 10,
              background: current ? '#DDF1F4' : '#fff',
              border: `1.5px solid ${current ? C.teal : C.stroke}`,
              borderRadius: 13,
              padding: '12px 13px',
              minHeight: 56,
              cursor: current ? 'default' : 'pointer',
              ...btn,
            }}
          >
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 15,
                fontWeight: 800,
                color: C.ink,
              }}
            >
              <span style={{ flex: 1, overflowWrap: 'anywhere' }}>{t.name}</span>
              {current && (
                <span
                  style={{
                    fontSize: 9.5,
                    fontWeight: 800,
                    color: C.teal,
                    background: '#fff',
                    borderRadius: 5,
                    padding: '3px 6px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  SHOWING
                </span>
              )}
            </span>
            <span style={{ display: 'block', ...line, marginTop: 2 }}>
              {ROLE_LABEL[t.role] || t.role}
            </span>
          </button>
        );
      })}

      {error && (
        <div
          style={{
            marginTop: 12,
            background: '#FFECE6',
            border: `1px solid ${C.coral}`,
            borderRadius: 11,
            padding: '9px 11px',
            fontSize: 12.5,
            fontWeight: 600,
            lineHeight: 1.45,
          }}
        >
          {error}
        </div>
      )}

      <button
        onClick={onClose}
        disabled={busy}
        style={{
          width: '100%',
          marginTop: 16,
          background: 'none',
          border: 'none',
          color: C.muted,
          padding: 12,
          minHeight: 44,
          fontSize: 14,
          fontWeight: 700,
          ...btn,
        }}
      >
        {busy ? 'Switching…' : 'Close'}
      </button>
    </Sheet>
  );
}
