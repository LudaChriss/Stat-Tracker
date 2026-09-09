import { C, btn, tnum } from '../theme.js';
import { Avatar, Card, RoundButton, Section } from '../components/ui.jsx';

export default function PlayerProfile({ v }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          background: `linear-gradient(160deg,${C.header},${C.teal})`,
          padding: '60px 16px 18px',
          color: '#fff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <RoundButton onClick={v.goBackFromPlayer} style={{ background: 'rgba(255,255,255,.14)', color: '#fff' }}>
            ‹
          </RoundButton>
          <span style={{ flex: 1 }} />
          <button
            style={{
              background: 'rgba(255,255,255,.14)',
              border: 'none',
              borderRadius: 99,
              padding: '7px 14px',
              fontSize: 12,
              fontWeight: 800,
              color: '#fff',
              ...btn,
            }}
          >
            Share ↗
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginTop: 10 }}>
          <Avatar
            ini={v.prof.ini}
            c={v.prof.c}
            size={58}
            fs={22}
            style={{ border: '2.5px solid rgba(255,255,255,.5)' }}
          />
          <span>
            <span style={{ display: 'block', fontSize: 22, fontWeight: 800 }}>{v.prof.name}</span>
            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: C.ice }}>
              #{v.prof.num} · {v.prof.pos} · Grass Stains
            </span>
          </span>
        </div>
      </div>

      {/* Season stat tiles */}
      <div style={{ padding: '14px 16px 4px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 7 }}>
          {v.profStats.map((s) => (
            <Card key={s.k} style={{ borderRadius: 13, padding: '10px 6px', textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: C.header, ...tnum }}>{s.v}</div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  color: C.muted,
                  letterSpacing: '.06em',
                  marginTop: 2,
                }}
              >
                {s.k}
              </div>
            </Card>
          ))}
        </div>
        <div
          style={{
            fontSize: 11,
            color: C.fog,
            fontWeight: 700,
            marginTop: 6,
            textAlign: 'center',
          }}
        >
          SEASON · KICKBALL · career: .488 AVG / .942 OPS / 61 R
        </div>
      </div>

      {/* On-base trend */}
      <div style={{ padding: '12px 16px 4px' }}>
        <Section>On-base % by week</Section>
        <Card style={{ padding: '14px 14px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 74 }}>
            {v.trend.map((b, i) => (
              <div
                key={i}
                style={{ flex: 1, borderRadius: '5px 5px 2px 2px', background: b.c, height: b.h }}
              />
            ))}
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 10,
              fontWeight: 700,
              color: C.fog,
              marginTop: 6,
            }}
          >
            <span>WK 1</span>
            <span>WK 9</span>
          </div>
        </Card>
      </div>

      {/* Game log */}
      <div style={{ padding: '12px 16px 22px' }}>
        <Section>Game log</Section>
        <Card style={{ padding: '4px 0' }}>
          {v.gameLog.map((g) => (
            <div
              key={g.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                borderTop: `1px solid ${C.hair}`,
              }}
            >
              <span style={{ fontSize: 11.5, fontWeight: 700, color: C.fog, minWidth: 46, ...tnum }}>
                {g.date}
              </span>
              <span style={{ flex: 1, fontWeight: 700, fontSize: 13 }}>{g.opp}</span>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: C.header, ...tnum }}>{g.line}</span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
