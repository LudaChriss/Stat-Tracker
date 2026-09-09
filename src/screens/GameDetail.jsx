import { C, btn, tnum } from '../theme.js';
import { Card, RoundButton, Section, Sheet } from '../components/ui.jsx';

const GRID = 'minmax(0, 1fr) 30px 26px 26px 32px 44px';

function BoxScore({ title, lines, totals }) {
  if (!lines.length) return null;
  return (
    <div style={{ padding: '12px 16px 4px' }}>
      <Section>{title}</Section>
      <Card style={{ overflow: 'hidden' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: GRID,
            padding: '10px 14px 7px',
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
          <span style={{ textAlign: 'right' }}>OB%</span>
        </div>
        {lines.map((l) => (
          <div
            key={l.pid}
            style={{
              display: 'grid',
              gridTemplateColumns: GRID,
              alignItems: 'center',
              padding: '8px 14px',
              borderTop: `1px solid ${C.hair}`,
            }}
          >
            <span
              style={{
                fontWeight: 700,
                fontSize: 13,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {l.name}
              {l.extra && (
                <span style={{ color: C.teal, fontWeight: 800, fontSize: 10.5 }}> {l.extra}</span>
              )}
            </span>
            <span style={{ textAlign: 'center', fontWeight: 700, fontSize: 13, color: C.slate, ...tnum }}>{l.ab}</span>
            <span style={{ textAlign: 'center', fontWeight: 800, fontSize: 13, ...tnum }}>{l.h}</span>
            <span style={{ textAlign: 'center', fontWeight: 700, fontSize: 13, color: C.slate, ...tnum }}>{l.r}</span>
            <span style={{ textAlign: 'center', fontWeight: 700, fontSize: 13, color: C.slate, ...tnum }}>{l.rbi}</span>
            <span style={{ textAlign: 'right', fontWeight: 800, fontSize: 13, color: C.teal, ...tnum }}>{l.obp}</span>
          </div>
        ))}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: GRID,
            alignItems: 'center',
            padding: '9px 14px',
            borderTop: `1.5px solid ${C.line}`,
            background: '#F4FAFB',
          }}
        >
          <span style={{ fontWeight: 800, fontSize: 12, color: C.muted, letterSpacing: '.05em' }}>TOTALS</span>
          <span style={{ textAlign: 'center', fontWeight: 800, fontSize: 13, ...tnum }}>{totals.ab}</span>
          <span style={{ textAlign: 'center', fontWeight: 800, fontSize: 13, ...tnum }}>{totals.h}</span>
          <span style={{ textAlign: 'center', fontWeight: 800, fontSize: 13, ...tnum }}>{totals.r}</span>
          <span style={{ textAlign: 'center', fontWeight: 800, fontSize: 13, ...tnum }}>{totals.rbi}</span>
          <span style={{ textAlign: 'right', fontWeight: 800, fontSize: 13, color: C.teal, ...tnum }}>{totals.obp}</span>
        </div>
      </Card>
    </div>
  );
}

/** One past game: final score plus the full box score as recorded. */
export default function GameDetail({ v, actions }) {
  const g = v.gameDetail;

  if (!g) {
    return (
      <div style={{ flex: 1, padding: '70px 16px' }}>
        <RoundButton onClick={actions.goBackFromGame} style={{ background: '#fff', border: `1px solid ${C.line}`, color: C.header }}>
          ‹
        </RoundButton>
        <div style={{ marginTop: 16, fontSize: 15, fontWeight: 800 }}>That game is no longer available</div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          background: `linear-gradient(160deg,${C.header},${C.teal})`,
          padding: 'var(--hdr-top) 16px 20px',
          color: '#fff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <RoundButton onClick={actions.goBackFromGame} style={{ background: 'rgba(255,255,255,.14)', color: '#fff' }}>
            ‹
          </RoundButton>
        </div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            color: C.frost,
            marginTop: 12,
          }}
        >
          {g.dateLabel} · {g.sportLabel}
        </div>
        <div style={{ fontSize: 'clamp(19px, 5.8vw, 24px)', fontWeight: 800, marginTop: 2 }}>
          {g.homeAway} {g.opponent}
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, marginTop: 14 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 800,
              background: g.resultBg,
              color: g.resultFg,
              borderRadius: 8,
              padding: '5px 11px',
            }}
          >
            {g.resultLabel}
          </span>
          <span style={{ fontSize: 'clamp(26px, 8vw, 34px)', fontWeight: 800, lineHeight: 1, ...tnum }}>
            {g.score}
          </span>
          <span style={{ fontSize: 12, fontWeight: 700, color: C.ice, paddingBottom: 4, ...tnum }}>
            {g.inningsLabel}
          </span>
        </div>
      </div>

      <BoxScore title={`${v.myTeamName} box score`} lines={g.homeLines} totals={g.homeTotals} />

      {g.awayLines.length > 0 ? (
        <BoxScore title={`${g.opponent} box score`} lines={g.awayLines} totals={g.awayTotals} />
      ) : (
        <div style={{ padding: '12px 16px 4px' }}>
          <Section>{g.opponent}</Section>
          <Card style={{ padding: '18px 16px' }}>
            <div style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>
              No individual stats were recorded for {g.opponent} in this game —
              only their score.
            </div>
          </Card>
        </div>
      )}

      <div style={{ padding: '14px 16px 26px' }}>
        <button
          onClick={actions.openDeleteGame(g.id)}
          style={{
            width: '100%',
            background: 'none',
            border: `1.5px solid ${C.line}`,
            color: '#B4441F',
            borderRadius: 13,
            padding: 13,
            fontSize: 13.5,
            fontWeight: 800,
            ...btn,
          }}
        >
          Delete this game
        </button>
        <div style={{ fontSize: 11.5, color: C.fog, fontWeight: 600, margin: '6px 2px 0' }}>
          Removes it from the standings and from every player's season totals.
        </div>
      </div>

      {v.confirmDeleteGame && (
        <Sheet
          onClose={actions.cancelDeleteGame}
          sheetStyle={{ background: '#fff', color: C.ink, padding: '22px 20px 30px' }}
        >
          <div style={{ fontSize: 19, fontWeight: 800 }}>Delete this game?</div>
          <div style={{ fontSize: 13, color: C.muted, fontWeight: 600, marginTop: 4 }}>
            {g.homeAway} {g.opponent} · {g.dateLabel} · {g.score}. The standings and
            every player's season totals will be recalculated without it.
          </div>
          <button
            onClick={actions.deleteGame}
            style={{
              width: '100%',
              marginTop: 16,
              background: '#B4441F',
              border: 'none',
              color: '#fff',
              borderRadius: 14,
              padding: 15,
              fontSize: 16,
              fontWeight: 800,
              ...btn,
            }}
          >
            Delete game
          </button>
          <button
            onClick={actions.cancelDeleteGame}
            style={{
              width: '100%',
              marginTop: 8,
              background: 'none',
              border: 'none',
              color: C.muted,
              padding: 10,
              fontSize: 14,
              fontWeight: 700,
              ...btn,
            }}
          >
            Keep it
          </button>
        </Sheet>
      )}
    </div>
  );
}
