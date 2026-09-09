import { C, btn, tnum } from '../theme.js';
import { Card, RoundButton } from '../components/ui.jsx';

const STAT_GRID = '1fr 44px 44px 44px 44px';

const numInput = {
  width: 38,
  justifySelf: 'center',
  textAlign: 'center',
  borderRadius: 8,
  padding: '6px 0',
  fontSize: 13.5,
  fontWeight: 800,
  color: C.ink,
  ...tnum,
};

/** The OCR'd scorecard grid — low-confidence cells get an amber dot. */
function ParsedBook({ cells }) {
  return (
    <div style={{ background: C.header, borderRadius: 16, padding: '12px 10px 10px', overflowX: 'auto' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '76px repeat(5,1fr)',
          gap: 2,
          alignItems: 'center',
          minWidth: 310,
        }}
      >
        <span
          style={{ fontSize: 9, fontWeight: 800, color: C.mist, letterSpacing: '.06em', paddingLeft: 4 }}
        >
          BATTER
        </span>
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} style={{ textAlign: 'center', fontSize: 9, fontWeight: 800, color: C.mist }}>
            {n}
          </span>
        ))}

        {cells.map((c, i) =>
          c.isName ? (
            <span
              key={i}
              style={{
                fontSize: 10.5,
                fontWeight: 800,
                color: '#fff',
                paddingLeft: 4,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {c.label}
              <span style={{ display: 'block', fontSize: 8.5, fontWeight: 700, color: C.mist }}>
                {c.sub}
              </span>
            </span>
          ) : (
            <div
              key={i}
              style={{ position: 'relative', height: 38, display: 'grid', placeItems: 'center', cursor: 'pointer' }}
            >
              <div
                style={{
                  position: 'absolute',
                  width: 22,
                  height: 22,
                  transform: 'rotate(45deg)',
                  border: `1.5px solid ${c.bd}`,
                  background: c.fill,
                  borderRadius: 3,
                }}
              />
              <span style={{ position: 'relative', fontSize: 8.5, fontWeight: 800, color: c.fg, ...tnum }}>
                {c.sym}
              </span>
              {c.low && (
                <span
                  style={{
                    position: 'absolute',
                    top: 1,
                    right: 3,
                    width: 6,
                    height: 6,
                    borderRadius: 99,
                    background: C.amber,
                  }}
                />
              )}
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function Label({ children }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: '.06em',
        color: C.muted,
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

export default function ScanReview({ v, actions }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          padding: '60px 16px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: '#fff',
          borderBottom: `1px solid ${C.hair2}`,
        }}
      >
        <RoundButton onClick={actions.goTeam} style={{ background: C.bg, color: C.header }}>
          ‹
        </RoundButton>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{v.reviewTitle}</div>
          <div style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>Nothing saves until you confirm</div>
        </div>
      </div>

      {/* OCR pipeline breadcrumbs */}
      <div
        style={{
          padding: '12px 16px 0',
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        {v.ocrSteps.map((st, i) => (
          <span key={st.label} style={{ display: 'contents' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                background: st.bg,
                border: `1px solid ${st.bd}`,
                color: st.fg,
                borderRadius: 99,
                padding: '4px 10px',
                fontSize: 10.5,
                fontWeight: 800,
              }}
            >
              {st.label}
            </span>
            {st.arrow && <span style={{ color: C.edge, fontSize: 10, fontWeight: 800 }}>›</span>}
          </span>
        ))}
      </div>

      {v.isScorecardScan ? (
        <>
          <div style={{ padding: '12px 16px 0' }}>
            <Label>PARSED SCOREBOOK · TAP A CELL TO CORRECT</Label>
            <ParsedBook cells={v.bookCells} />
            <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 10, fontWeight: 700, color: C.fog }}>
              <span>
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    background: C.teal,
                    transform: 'rotate(45deg)',
                    marginRight: 4,
                  }}
                />
                Scored
              </span>
              <span>
                <span
                  style={{
                    display: 'inline-block',
                    width: 7,
                    height: 7,
                    borderRadius: 99,
                    background: C.amber,
                    marginRight: 4,
                  }}
                />
                Low confidence — check
              </span>
            </div>
          </div>

          <div style={{ padding: '12px 16px 8px' }}>
            <Label>STAT LINES DERIVED FROM SYMBOLS</Label>
            <Card style={{ overflow: 'hidden' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: STAT_GRID,
                  padding: '10px 14px 8px',
                  fontSize: 10.5,
                  fontWeight: 800,
                  color: C.muted,
                  letterSpacing: '.05em',
                }}
              >
                <span>PLAYER</span>
                <span style={{ textAlign: 'center' }}>AB</span>
                <span style={{ textAlign: 'center' }}>H</span>
                <span style={{ textAlign: 'center' }}>R</span>
                <span style={{ textAlign: 'center' }}>RBI</span>
              </div>
              {v.scanRows.map((r) => (
                <div
                  key={r.name}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: STAT_GRID,
                    alignItems: 'center',
                    gap: 2,
                    padding: '7px 14px',
                    borderTop: `1px solid ${C.hair}`,
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: 13.5 }}>{r.name}</span>
                  <input
                    defaultValue={r.ab}
                    aria-label={`${r.name} at bats`}
                    style={{ ...numInput, border: `1.5px solid ${r.abBd}`, background: r.abBg }}
                  />
                  <input
                    defaultValue={r.h}
                    aria-label={`${r.name} hits`}
                    style={{ ...numInput, border: `1.5px solid ${r.hBd}`, background: r.hBg }}
                  />
                  <input
                    defaultValue={r.r}
                    aria-label={`${r.name} runs`}
                    style={{ ...numInput, border: `1.5px solid ${C.line}`, background: '#fff' }}
                  />
                  <input
                    defaultValue={r.rbi}
                    aria-label={`${r.name} runs batted in`}
                    style={{ ...numInput, border: `1.5px solid ${C.line}`, background: '#fff' }}
                  />
                </div>
              ))}
            </Card>
          </div>

          <div style={{ padding: '0 16px 8px' }}>
            <Label>MAPS TO GAME</Label>
            <div
              style={{
                background: '#fff',
                border: `1.5px solid ${C.teal}`,
                borderRadius: 14,
                padding: '12px 14px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>
                <span style={{ display: 'block', fontWeight: 800, fontSize: 14 }}>vs Dirt Merchants</span>
                <span style={{ display: 'block', fontSize: 11.5, color: C.muted, fontWeight: 600 }}>
                  Aug 30 · Riverbend Park #2 · matched on date + roster
                </span>
              </span>
              <span style={{ color: C.fog, fontSize: 12 }}>▾</span>
            </div>
          </div>
        </>
      ) : (
        <div style={{ padding: '12px 16px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {v.schedRows.map((g) => (
            <div
              key={g.opp}
              style={{
                background: '#fff',
                border: `1.5px solid ${g.bd}`,
                borderRadius: 14,
                padding: '11px 14px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 800, fontSize: 14.5 }}>vs {g.opp}</span>
                {g.low && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      color: '#8A6100',
                      background: '#FFF1D6',
                      borderRadius: 5,
                      padding: '2px 6px',
                    }}
                  >
                    CHECK
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12.5, color: C.muted, fontWeight: 600, marginTop: 3, ...tnum }}>
                {g.when} · {g.where}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ flex: 1 }} />

      <div
        style={{
          padding: '12px 16px 22px',
          display: 'flex',
          gap: 8,
          background: '#fff',
          borderTop: `1px solid ${C.hair2}`,
        }}
      >
        <button
          onClick={actions.goScanCam}
          style={{
            flex: 1,
            background: '#fff',
            border: `1.5px solid ${C.stroke}`,
            color: C.header,
            borderRadius: 13,
            padding: 14,
            fontSize: 14,
            fontWeight: 800,
            ...btn,
          }}
        >
          Retake
        </button>
        <button
          onClick={actions.confirmScan}
          style={{
            flex: 2,
            background: C.coral,
            border: 'none',
            color: '#fff',
            borderRadius: 13,
            padding: 14,
            fontSize: 14,
            fontWeight: 800,
            ...btn,
          }}
        >
          Confirm import
        </button>
      </div>
    </div>
  );
}
