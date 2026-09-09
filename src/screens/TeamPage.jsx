import { C, btn, tnum } from '../theme.js';
import { Avatar, Card, Section } from '../components/ui.jsx';

// Text-only buttons still need a finger-sized hit box.
const textBtn = {
  background: 'none',
  border: 'none',
  color: C.teal,
  fontSize: 12,
  fontWeight: 700,
  minHeight: 44,
  padding: '0 8px',
  ...btn,
};

const ROSTER_GRID = 'minmax(0, 1fr) 46px 46px 50px';

export default function TeamPage({ v, actions }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          background: `linear-gradient(160deg,${C.header},${C.teal})`,
          padding: 'var(--hdr-top) 20px 18px',
          color: '#fff',
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            color: C.frost,
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>{v.teamSubtitle}</span>
          <span
            style={{
              background: 'rgba(255,255,255,.14)',
              borderRadius: 6,
              padding: '2px 7px',
              fontSize: 10,
              fontWeight: 800,
            }}
          >
            MANAGER
          </span>
        </div>
        <div style={{ fontSize: 'clamp(20px, 6vw, 24px)', fontWeight: 800, letterSpacing: '-.01em', marginTop: 2 }}>
          {v.myTeamName}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.ice, marginTop: 2, ...tnum }}>
          {v.teamRecord}
        </div>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.frost, marginTop: 2 }}>
          {v.recordBreakdown}
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 12 }}>
          {v.teamAgg.map((a) => (
            <div key={a.k}>
              <div style={{ fontSize: 18, fontWeight: 800, ...tnum }}>{a.v}</div>
              <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.08em', color: C.frost }}>
                {a.k}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Primary actions */}
      <div style={{ padding: '14px 16px 0' }}>
        <button
          onClick={actions.goNewGame}
          style={{
            width: '100%',
            background: C.coral,
            border: 'none',
            color: '#fff',
            borderRadius: 16,
            padding: 16,
            fontSize: 17,
            fontWeight: 800,
            boxShadow: '0 6px 18px rgba(255,107,74,.35)',
            ...btn,
          }}
        >
          New game
        </button>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          {[
            ['⌗ Scan scorecard', actions.scan('scorecard')],
            ['⌗ Scan schedule', actions.scan('schedule')],
          ].map(([label, onTap]) => (
            <button
              key={label}
              onClick={onTap}
              style={{
                flex: 1,
                background: '#fff',
                border: `1.5px solid ${C.stroke}`,
                color: C.header,
                borderRadius: 13,
                padding: 12,
                fontSize: 13.5,
                fontWeight: 700,
                ...btn,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Roster */}
      <div
        style={{
          padding: '10px 16px 4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Section style={{ marginBottom: 0 }}>Roster</Section>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button
            onClick={actions.toggleStatSet}
            style={{ ...textBtn }}
          >
            {v.statSetLabel} ⇄
          </button>
          <button
            onClick={actions.goRoster}
            style={{ ...textBtn }}
          >
            Manage ›
          </button>
        </div>
      </div>

      <div style={{ padding: '0 16px 8px' }}>
        <Card style={{ overflow: 'hidden' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: ROSTER_GRID,
              padding: '10px 14px 7px',
              fontSize: 10.5,
              fontWeight: 800,
              color: C.muted,
              letterSpacing: '.05em',
            }}
          >
            <span>PLAYER</span>
            <span style={{ textAlign: 'center' }}>{v.statCols[0]}</span>
            <span style={{ textAlign: 'center' }}>{v.statCols[1]}</span>
            <span style={{ textAlign: 'right' }}>{v.statCols[2]}</span>
          </div>
          {v.rosterView.map((p) => (
            <div
              key={p.id}
              onClick={p.onTap}
              style={{
                display: 'grid',
                gridTemplateColumns: ROSTER_GRID,
                alignItems: 'center',
                padding: '8px 14px',
                borderTop: `1px solid ${C.hair}`,
                cursor: 'pointer',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                <Avatar ini={p.ini} c={p.c} size={32} fs={12} />
                <span style={{ minWidth: 0 }}>
                  <span
                    style={{
                      display: 'block',
                      fontWeight: 700,
                      fontSize: 13.5,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {p.name}
                  </span>
                  <span style={{ display: 'block', fontSize: 10.5, color: C.muted, fontWeight: 700 }}>
                    #{p.num} · {p.pos}
                  </span>
                </span>
              </span>
              <span style={{ textAlign: 'center', fontWeight: 800, fontSize: 13, ...tnum }}>{p.s1}</span>
              <span style={{ textAlign: 'center', fontWeight: 700, fontSize: 13, color: C.slate, ...tnum }}>
                {p.s2}
              </span>
              <span style={{ textAlign: 'right', fontWeight: 800, fontSize: 13, color: C.teal, ...tnum }}>
                {p.s3}
              </span>
            </div>
          ))}
        </Card>
        <button
          onClick={actions.goRoster}
          style={{
            width: '100%',
            marginTop: 8,
            background: 'none',
            border: `1.5px dashed ${C.edge}`,
            color: C.muted,
            borderRadius: 12,
            padding: 12,
            minHeight: 44,
            fontSize: 12.5,
            fontWeight: 700,
            ...btn,
          }}
        >
          + Add / edit players and teams
        </button>
      </div>

      {/* Games */}
      <div style={{ padding: '8px 16px 20px' }}>
        <Section>Games</Section>
        <Card style={{ padding: '4px 0' }}>
          {v.teamGames.map((g) => (
            <div
              key={g.key}
              onClick={g.onTap}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                borderTop: `1px solid ${C.hair}`,
                cursor: g.onTap ? 'pointer' : 'default',
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 800, color: g.tagColor, minWidth: 44 }}>{g.tag}</span>
              <span style={{ flex: 1, fontWeight: 700, fontSize: 13.5 }}>{g.line}</span>
              <span style={{ fontSize: 12, color: C.muted, fontWeight: 600, ...tnum }}>{g.sub}</span>
              {g.onTap && <span style={{ color: C.edge, fontSize: 14 }}>›</span>}
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
