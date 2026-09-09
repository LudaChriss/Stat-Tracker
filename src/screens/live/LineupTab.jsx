import { C, btn, tnum } from '../../theme.js';
import { Avatar, DarkCard } from '../../components/ui.jsx';

const arrowBtn = {
  background: 'none',
  border: '1px solid rgba(255,255,255,.18)',
  color: C.pale,
  borderRadius: 9,
  width: 40,
  height: 40,
  fontSize: 13,
  flex: '0 0 auto',
  ...btn,
};

export default function LineupTab({ v, actions }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 20px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 8,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', color: C.muted }}>
          KICKING ORDER · TAP A NAME TO EDIT
        </div>
        <div style={{ fontSize: 11, fontWeight: 800, color: C.cyan }}>{v.lineupCount} IN LINEUP</div>
      </div>

      <DarkCard style={{ padding: '4px 0' }}>
        {v.lineupView.map((p) => (
          <div
            key={p.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 10px',
              borderTop: '1px solid rgba(255,255,255,.06)',
              background: p.bg,
            }}
          >
            <span style={{ width: 20, fontSize: 12, fontWeight: 800, color: C.cyan, ...tnum }}>
              {p.slot}
            </span>
            <Avatar ini={p.ini} c={p.c} size={32} fs={12} onClick={p.openPos} style={{ cursor: 'pointer' }} />
            <span onClick={p.openPos} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                {/* The name gets its own clipping context so the badge beside
                    it is never the thing that gets cut off. */}
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: 13.5,
                    color: '#fff',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    minWidth: 0,
                  }}
                >
                  {p.name}
                </span>
                {p.upNow && (
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 800,
                      color: C.deep,
                      background: C.cyan,
                      borderRadius: 5,
                      padding: '2px 6px',
                      flex: '0 0 auto',
                    }}
                  >
                    {p.upTag}
                  </span>
                )}
              </span>
              <span style={{ display: 'block', fontSize: 10.5, color: C.mist, fontWeight: 700, ...tnum }}>
                {p.stat}
              </span>
            </span>
            <button
              onClick={p.openPos}
              style={{
                background: 'rgba(45,225,252,.12)',
                border: '1px solid rgba(45,225,252,.3)',
                color: C.cyan,
                borderRadius: 9,
                padding: '0 8px',
                fontSize: 11.5,
                fontWeight: 800,
                minWidth: 46,
                height: 40,
                flex: '0 0 auto',
                ...btn,
              }}
            >
              {p.pos} ▾
            </button>
            <button onClick={p.up} style={arrowBtn}>
              ▲
            </button>
            <button onClick={p.down} style={arrowBtn}>
              ▼
            </button>
          </div>
        ))}
      </DarkCard>

      <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, margin: '6px 2px 0' }}>
        Tap the position chip to pick a fielding spot.
      </div>

      {v.hasBench && (
        <>
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '.08em',
              color: C.muted,
              margin: '16px 0 8px',
            }}
          >
            ON TEAM · TAP + TO ADD
          </div>
          <DarkCard style={{ padding: '4px 0' }}>
            {v.benchView.map((p) => (
              <div
                key={p.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '8px 12px',
                  borderTop: '1px solid rgba(255,255,255,.06)',
                }}
              >
                <Avatar ini={p.ini} c={p.c} size={32} fs={12} style={{ opacity: 0.7 }} />
                <span style={{ flex: 1, fontWeight: 700, fontSize: 13.5, color: C.pale }}>{p.name}</span>
                <button
                  onClick={p.add}
                  style={{
                    background: C.teal,
                    border: 'none',
                    color: '#fff',
                    borderRadius: 99,
                    width: 40,
                    height: 40,
                    fontSize: 18,
                    flex: '0 0 auto',
                    fontWeight: 800,
                    ...btn,
                  }}
                >
                  +
                </button>
              </div>
            ))}
          </DarkCard>
        </>
      )}

      <button
        onClick={actions.goRoster}
        style={{
          width: '100%',
          marginTop: 10,
          background: 'none',
          border: '1.5px dashed rgba(255,255,255,.25)',
          color: C.mist,
          borderRadius: 12,
          padding: 11,
          fontSize: 12.5,
          fontWeight: 700,
          ...btn,
        }}
      >
        + Manage roster
      </button>
    </div>
  );
}
