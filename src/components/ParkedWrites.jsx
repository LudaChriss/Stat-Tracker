import { C, btn } from '../theme.js';

// Writes that failed in a way retrying will not fix, shown rather than hidden.
//
// The rule this screen exists to serve: if something cannot reach the account,
// the person scoring must know. There is deliberately no "dismiss" and no
// "delete" — a parked write that could be swept off the screen would be a
// silent data loss with a confirmation dialog in front of it. The only way one
// leaves this list is by succeeding.
//
// Retrying puts an entry back in its original place in the queue, not at the
// end. A write made before another must still reach the server first.

const KIND = {
  game: { label: 'GAME', tone: '#FFECE6', line: C.coral },
  season: { label: 'TEAM & ROSTER', tone: '#EAF4FA', line: C.stroke },
};

function when(at) {
  if (!at) return '';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function ParkedWrites({ entries, busy, onRetry, onRetryAll, onClose }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 60,
        background: C.bg,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}
    >
      <div style={{ padding: 'var(--hdr-top) 20px 8px' }}>
        <button onClick={onClose} disabled={busy} style={backBtn}>
          ‹ Back
        </button>
        <div style={{ fontSize: 22, fontWeight: 800, color: C.ink }}>Changes that didn’t save</div>
        <div style={{ fontSize: 13, color: C.muted, fontWeight: 600, marginTop: 4, lineHeight: 1.45 }}>
          {entries.length === 1
            ? 'One change could not be sent to your account.'
            : `${entries.length} changes could not be sent to your account.`}{' '}
          They are still on this phone and still in your season — nothing has been lost or removed.
        </div>
      </div>

      <div style={{ padding: '8px 16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {entries.map((e) => {
          const kind = KIND[e.kind] || { label: String(e.kind || '').toUpperCase(), tone: '#EEE', line: C.stroke };
          return (
            <div
              key={e.id}
              style={{
                background: '#fff',
                border: `1.5px solid ${C.stroke}`,
                borderRadius: 14,
                padding: 14,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    background: kind.tone,
                    border: `1px solid ${kind.line}`,
                    borderRadius: 6,
                    padding: '2px 7px',
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: '.06em',
                    color: C.ink,
                  }}
                >
                  {kind.label}
                </span>
                <span style={{ fontSize: 11.5, color: C.fog, fontWeight: 700 }}>{when(e.at)}</span>
                {e.attempts > 0 && (
                  <span style={{ fontSize: 11.5, color: C.fog, fontWeight: 700 }}>
                    · {e.attempts} {e.attempts === 1 ? 'try' : 'tries'}
                  </span>
                )}
              </div>

              <div style={{ fontSize: 15, fontWeight: 800, color: C.ink, marginTop: 6, overflowWrap: 'anywhere' }}>
                {e.title}
              </div>

              {/* The server's own words. Paraphrasing them would lose the one
                  detail that makes the problem fixable. */}
              <div
                style={{
                  marginTop: 8,
                  background: '#FFF1D6',
                  border: `1px solid ${C.amberLine}`,
                  borderRadius: 10,
                  padding: '8px 10px',
                  fontSize: 12,
                  color: C.ink,
                  fontWeight: 600,
                  lineHeight: 1.45,
                  overflowWrap: 'anywhere',
                }}
              >
                {e.error}
              </div>

              <button onClick={() => onRetry(e.id)} disabled={busy} style={retryBtn}>
                {busy ? 'Trying…' : 'Try again'}
              </button>
            </div>
          );
        })}
      </div>

      <div style={{ padding: '0 16px 28px', marginTop: 'auto' }}>
        <button onClick={onRetryAll} disabled={busy || !entries.length} style={retryAllBtn}>
          {busy ? 'Trying…' : entries.length === 1 ? 'Try again' : 'Try all again'}
        </button>
        <div style={{ fontSize: 11.5, color: C.fog, fontWeight: 600, margin: '8px 2px 0', lineHeight: 1.45 }}>
          Retrying keeps these in the order they were made. Nothing here can be deleted — if a change
          cannot be sent, it stays on this list so you know about it.
        </div>
      </div>
    </div>
  );
}

const backBtn = {
  background: 'none',
  border: 'none',
  color: C.muted,
  padding: '6px 0',
  minHeight: 44,
  fontSize: 14,
  fontWeight: 700,
  ...btn,
};

const retryBtn = {
  width: '100%',
  marginTop: 10,
  background: '#fff',
  border: `1.5px solid ${C.stroke}`,
  color: C.header,
  borderRadius: 12,
  padding: 12,
  minHeight: 46,
  fontSize: 14,
  fontWeight: 800,
  ...btn,
};

const retryAllBtn = {
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
