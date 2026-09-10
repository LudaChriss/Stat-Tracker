import { C, btn } from '../theme.js';
import { Sheet } from './ui.jsx';

// Sending games that were finalized before this device could write them
// anywhere. Three things this screen has to get right:
//
//  * It says what it will do BEFORE it does it, including which games it
//    cannot send and why. Finding that out at game seven of twelve is the
//    failure this whole flow was designed around.
//  * It never hides a problem. Games that cannot be sent stay listed after the
//    run, exactly as they were listed before it.
//  * It tells you to export first. This is precisely the situation an export
//    protects against.

const line = { fontSize: 12.5, color: C.muted, fontWeight: 600, lineHeight: 1.45 };

function Blocked({ items }) {
  if (!items.length) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: C.header, letterSpacing: '.04em' }}>
        {items.length === 1 ? "1 GAME CAN'T BE SENT" : `${items.length} GAMES CAN'T BE SENT`}
      </div>
      <div style={{ ...line, marginTop: 4 }}>
        These stay on your phone, in your standings and in an export. Nothing is removed.
      </div>
      <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none' }}>
        {items.map((b, i) => (
          <li
            key={b.id || i}
            style={{
              background: '#FFF1D6',
              border: `1px solid ${C.amberLine}`,
              borderRadius: 11,
              padding: '9px 11px',
              marginTop: 6,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>{b.title}</div>
            <div style={{ fontSize: 12, color: C.muted, fontWeight: 600, marginTop: 2 }}>{b.detail}</div>
          </li>
        ))}
      </ul>
    </div>
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

const secondary = {
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

export default function BackfillSheet({ v, actions }) {
  const b = v.backfill;
  if (!b) return null;

  const sendable = b.sendable || [];
  const blocked = b.blocked || [];
  const busy = b.phase === 'running';

  // "Not in your account yet" is only true of some of them. A season that was
  // imported is already up there in full, and telling someone those games are
  // missing would be a lie they might act on.
  const creates = sendable.filter((c) => c.action === 'create').length;
  const updates = sendable.length - creates;

  return (
    <Sheet
      // A run in progress must not be dismissed by tapping the scrim: stopping
      // halfway is the one outcome this flow exists to make unambiguous.
      onClose={busy ? () => {} : actions.closeBackfill}
      sheetStyle={{ background: '#fff', color: C.ink, padding: '22px 20px 30px' }}
    >
      <div style={{ fontSize: 19, fontWeight: 800 }}>Send past games to your account</div>

      {b.phase === 'loading' && <div style={{ ...line, marginTop: 8 }}>Checking your account…</div>}

      {b.phase === 'preflight' && b.blockedBecause && (
        <>
          <div style={{ ...line, marginTop: 8 }}>Not right now — {b.blockedBecause}.</div>
          <div style={{ ...line, marginTop: 8 }}>
            Nothing has been sent and nothing has changed. Try again once that is sorted.
          </div>
          <button onClick={actions.closeBackfill} style={primary}>
            OK
          </button>
        </>
      )}

      {b.phase === 'preflight' && !b.blockedBecause && (
        <>
          {sendable.length === 0 && blocked.length === 0 && (
            <>
              <div style={{ ...line, marginTop: 8 }}>
                Nothing to send — every game on this phone is already in your account.
              </div>
              <button onClick={actions.closeBackfill} style={primary}>
                OK
              </button>
            </>
          )}

          {(sendable.length > 0 || blocked.length > 0) && (
            <>
              <div style={{ ...line, marginTop: 8 }}>
                {sendable.length === 0 && 'No games can be sent as they stand.'}
                {creates > 0 &&
                  `${creates} ${creates === 1 ? 'game' : 'games'} on this phone ${
                    creates === 1 ? 'is' : 'are'
                  } not in your account yet.`}
                {creates > 0 && updates > 0 && ' '}
                {updates > 0 &&
                  (creates > 0
                    ? `${updates} more ${updates === 1 ? 'is' : 'are'} already there and will be checked again.`
                    : `Every game on this phone is already in your account. Sending them again re-checks them — nothing is missing.`)}
                {b.alreadySent > 0 && ` ${b.alreadySent} sent earlier.`}
              </div>

              {sendable.length > 0 && (
                <div
                  style={{
                    marginTop: 12,
                    background: '#EAF4FA',
                    border: `1px solid ${C.stroke}`,
                    borderRadius: 12,
                    padding: '10px 12px',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 800, color: C.header }}>Export first</div>
                  <div style={{ ...line, marginTop: 2 }}>
                    This writes to your account in one go. Take a backup before you start — it is exactly
                    what an export is for.
                  </div>
                </div>
              )}

              <Blocked items={blocked} />

              {sendable.length > 0 && (
                <button onClick={actions.runBackfill} style={primary}>
                  {creates === 0
                    ? sendable.length === 1
                      ? 'Re-check 1 game'
                      : `Re-check ${sendable.length} games`
                    : sendable.length === 1
                      ? 'Send 1 game'
                      : `Send ${sendable.length} games`}
                </button>
              )}
              <button onClick={actions.closeBackfill} style={sendable.length > 0 ? secondary : primary}>
                {sendable.length > 0 ? 'Not now' : 'Close'}
              </button>
            </>
          )}
        </>
      )}

      {busy && (
        <>
          <div style={{ ...line, marginTop: 8 }}>
            Sending game {Math.min((b.progress?.done || 0) + 1, b.progress?.total || sendable.length)} of{' '}
            {b.progress?.total || sendable.length}…
          </div>
          <div
            style={{
              marginTop: 10,
              height: 8,
              borderRadius: 99,
              background: '#E3EEF5',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${Math.round(((b.progress?.done || 0) / Math.max(b.progress?.total || 1, 1)) * 100)}%`,
                background: C.coral,
                transition: 'width .2s',
              }}
            />
          </div>
          <div style={{ ...line, marginTop: 8 }}>Keep this open until it finishes.</div>
        </>
      )}

      {b.phase === 'done' && (
        <>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 10 }}>
            {b.result.sent.length} of {sendable.length} sent
          </div>
          <div style={{ ...line, marginTop: 2 }}>
            {creates > 0
              ? 'They are in your account now, and re-running this will not send them twice.'
              : 'All confirmed against your account. Nothing was duplicated.'}
          </div>
          <Blocked items={blocked} />
          <button onClick={actions.closeBackfill} style={primary}>
            Done
          </button>
        </>
      )}

      {b.phase === 'stopped' && (
        <>
          <div style={{ fontSize: 19, fontWeight: 800, marginTop: 10, color: C.coral }}>
            Stopped after {b.result.sent.length} of {sendable.length}
          </div>
          {b.result.stoppedAt && (
            <div
              style={{
                marginTop: 10,
                background: '#FFECE6',
                border: `1px solid ${C.coral}`,
                borderRadius: 11,
                padding: '9px 11px',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>
                {b.result.stoppedAt.label || b.result.stoppedAt.date} · vs {b.result.stoppedAt.opponent}
              </div>
              <div style={{ fontSize: 12, color: C.muted, fontWeight: 600, marginTop: 2 }}>{b.result.error}</div>
            </div>
          )}
          <div style={{ ...line, marginTop: 10 }}>
            The {b.result.sent.length} before it are in your account. Nothing after it was attempted, and
            nothing on this phone changed. Fixing the problem and running this again picks up from here.
          </div>
          <Blocked items={blocked} />
          <button onClick={actions.closeBackfill} style={primary}>
            Close
          </button>
        </>
      )}
    </Sheet>
  );
}
