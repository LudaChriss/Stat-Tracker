import { C, btn, tnum } from '../../theme.js';
import { DarkCard } from '../../components/ui.jsx';

const GRID = '1fr 36px 32px 32px 36px 46px';

export default function StatsTab({ v, actions }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 20px' }}>
      {/* Team switcher */}
      <div
        style={{
          display: 'flex',
          background: C.panel,
          border: '1px solid rgba(255,255,255,.1)',
          borderRadius: 11,
          padding: 3,
          marginBottom: 10,
        }}
      >
        <button
          onClick={actions.setStatsTeam('home')}
          style={{
            flex: 1,
            background: v.shBg,
            border: 'none',
            color: v.shFg,
            borderRadius: 9,
            padding: '8px 0',
            fontSize: 12,
            fontWeight: 800,
            ...btn,
          }}
        >
          {v.myTeamUpper}
        </button>
        <button
          onClick={actions.setStatsTeam('away')}
          style={{
            flex: 1,
            background: v.saBg,
            border: 'none',
            color: v.saFg,
            borderRadius: 9,
            padding: '8px 0',
            fontSize: 12,
            fontWeight: 800,
            ...btn,
          }}
        >
          {v.opponentUpper}
        </button>
      </div>

      {v.statsAvailable ? (
        <>
          <DarkCard style={{ overflow: 'hidden' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: GRID,
                padding: '10px 14px 7px',
                fontSize: 10,
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
              <span style={{ textAlign: 'right' }}>OB%</span>
            </div>
            {v.liveStatRows.map((r) => (
              <div
                key={r.key}
                style={{
                  display: 'grid',
                  gridTemplateColumns: GRID,
                  alignItems: 'center',
                  padding: '8px 14px',
                  borderTop: '1px solid rgba(255,255,255,.06)',
                  background: r.bg,
                }}
              >
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: 12.5,
                    color: '#fff',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {r.name}
                  <span style={{ color: C.muted, fontWeight: 800, fontSize: 10 }}> {r.upTag}</span>
                </span>
                <span style={{ textAlign: 'center', fontWeight: 700, fontSize: 12.5, color: C.pale, ...tnum }}>
                  {r.ab}
                </span>
                <span style={{ textAlign: 'center', fontWeight: 800, fontSize: 12.5, color: '#fff', ...tnum }}>
                  {r.h}
                </span>
                <span style={{ textAlign: 'center', fontWeight: 700, fontSize: 12.5, color: C.pale, ...tnum }}>
                  {r.r}
                </span>
                <span style={{ textAlign: 'center', fontWeight: 700, fontSize: 12.5, color: C.pale, ...tnum }}>
                  {r.rbi}
                </span>
                <span style={{ textAlign: 'right', fontWeight: 800, fontSize: 12.5, color: C.cyan, ...tnum }}>
                  {r.obp}
                </span>
              </div>
            ))}
          </DarkCard>
          <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, margin: '8px 2px 0' }}>
            Live — updates with every recorded outcome. ● marks who's up now.
          </div>
        </>
      ) : (
        <DarkCard style={{ padding: '22px 18px', textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>Not tracking {v.opponent}</div>
          <div style={{ fontSize: 12, color: C.mist, fontWeight: 600, marginTop: 5 }}>
            This game is set to "our team only" — the opponent has score and outs, no player stat lines.
          </div>
          <button
            onClick={actions.trackBothNow}
            style={{
              marginTop: 12,
              background: C.teal,
              border: 'none',
              color: '#fff',
              borderRadius: 11,
              padding: '11px 18px',
              fontSize: 13,
              fontWeight: 800,
              ...btn,
            }}
          >
            Start tracking both teams
          </button>
        </DarkCard>
      )}
    </div>
  );
}
