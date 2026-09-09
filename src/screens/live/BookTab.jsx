import { C, btn, tnum } from '../../theme.js';
import { DarkCard } from '../../components/ui.jsx';

/** One scorebook diamond — filled when the batter reached and scored. */
function BookCell({ c }) {
  return (
    <div
      style={{
        position: 'relative',
        height: 46,
        display: 'grid',
        placeItems: 'center',
        borderTop: '1px solid rgba(255,255,255,.06)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          width: 26,
          height: 26,
          transform: 'rotate(45deg)',
          border: `1.5px ${c.bs} ${c.bd}`,
          background: c.fill,
          borderRadius: 4,
        }}
      />
      <span style={{ position: 'relative', fontSize: 9, fontWeight: 800, color: c.fg, ...tnum }}>
        {c.sym}
      </span>
    </div>
  );
}

const pager = {
  background: 'none',
  border: '1px solid rgba(255,255,255,.2)',
  color: C.pale,
  borderRadius: 8,
  width: 28,
  height: 28,
  fontSize: 12,
  ...btn,
};

export default function BookTab({ v }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 20px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', color: C.muted }}>
          SCOREBOOK · GRASS STAINS
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={v.bookPrev} style={pager}>
            ‹
          </button>
          <span style={{ fontSize: 11.5, fontWeight: 800, color: C.cyan, ...tnum }}>
            INN {v.bookRange}
          </span>
          <button onClick={v.bookNext} style={pager}>
            ›
          </button>
        </div>
      </div>

      <DarkCard style={{ padding: '10px 8px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 54px 54px 54px', alignItems: 'center' }}>
          <span
            style={{
              fontSize: 9,
              fontWeight: 800,
              color: C.mist,
              letterSpacing: '.06em',
              paddingLeft: 6,
            }}
          >
            BATTER
          </span>
          {v.bookCols.map((c) => (
            <span key={c.n} style={{ textAlign: 'center', fontSize: 9, fontWeight: 800, color: C.mist, ...tnum }}>
              {c.n}
            </span>
          ))}

          {v.bookFlat.map((c, i) =>
            c.isName ? (
              <span
                key={i}
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: '#fff',
                  paddingLeft: 6,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  borderTop: '1px solid rgba(255,255,255,.06)',
                  paddingTop: 6,
                  paddingBottom: 6,
                }}
              >
                <span style={{ color: C.cyan, ...tnum }}>{c.slot}</span> {c.label}
                <span style={{ display: 'block', fontSize: 8.5, fontWeight: 700, color: C.mist }}>
                  {c.sub}
                </span>
              </span>
            ) : (
              <BookCell key={i} c={c} />
            ),
          )}
        </div>
      </DarkCard>

      <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 10, fontWeight: 700, color: C.muted }}>
        <span>
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              background: C.teal,
              transform: 'rotate(45deg)',
              marginRight: 5,
            }}
          />
          Scored
        </span>
        <span>
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              border: '1px dashed rgba(255,255,255,.4)',
              transform: 'rotate(45deg)',
              marginRight: 5,
            }}
          />
          No plate appearance yet
        </span>
      </div>
      <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, marginTop: 6 }}>
        Fills in automatically as outcomes are recorded on the Entry tab.
      </div>
    </div>
  );
}
