import { C, btn, tnum } from '../theme.js';
import { Sheet } from '../components/ui.jsx';
import EntryTab from './live/EntryTab.jsx';
import BookTab from './live/BookTab.jsx';
import LineupTab from './live/LineupTab.jsx';
import StatsTab from './live/StatsTab.jsx';

/** Scoreboard: away score, inning + outs, home score, then the tab strip. */
function Scoreboard({ v, actions }) {
  return (
    <div
      style={{
        background: `linear-gradient(180deg,#0A2540,${C.deep})`,
        padding: '58px 16px 0',
        borderBottom: '1px solid rgba(255,255,255,.07)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '.06em',
          color: C.mist,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 99,
              background: C.coral,
              animation: 'pulse 1.4s infinite',
            }}
          />
          LIVE · {v.sportName} · {v.trackLabel}
        </span>
        <button
          onClick={actions.askFinalize}
          style={{
            background: 'none',
            border: '1px solid rgba(255,255,255,.25)',
            color: '#fff',
            borderRadius: 99,
            padding: '4px 10px',
            fontSize: 11,
            fontWeight: 700,
            ...btn,
          }}
        >
          Game completed
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          marginTop: 8,
          gap: 8,
        }}
      >
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: v.awayLabelColor }}>{v.opponentUpper}</div>
          <div style={{ fontSize: 36, fontWeight: 800, lineHeight: 1, marginTop: 2, ...tnum }}>
            {v.score.away}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.cyan }}>
            {v.halfArrow} {v.inningLabel}
          </div>
          <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginTop: 6 }}>
            {v.outDots.map((d, i) => (
              <span
                key={i}
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 99,
                  background: d.bg,
                  border: '1.5px solid rgba(255,255,255,.35)',
                }}
              />
            ))}
          </div>
          <div
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              color: C.muted,
              marginTop: 3,
              letterSpacing: '.08em',
            }}
          >
            OUTS
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: v.homeLabelColor }}>{v.myTeamUpper}</div>
          <div style={{ fontSize: 36, fontWeight: 800, lineHeight: 1, marginTop: 2, ...tnum }}>
            {v.score.home}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginTop: 12 }}>
        {v.liveTabs.map((t) => (
          <button
            key={t.label}
            onClick={t.onTap}
            style={{
              flex: 1,
              background: 'none',
              border: 'none',
              borderBottom: `2.5px solid ${t.line}`,
              color: t.fg,
              padding: '8px 0 9px',
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: '.08em',
              ...btn,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const TABS = {
  entry: EntryTab,
  book: BookTab,
  lineup: LineupTab,
  stats: StatsTab,
};

export default function LiveGame({ v, actions }) {
  const Tab = TABS[v.liveTab];

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: C.deep,
        color: '#fff',
      }}
    >
      <Scoreboard v={v} actions={actions} />
      <Tab v={v} actions={actions} />

      {/* Fielding position picker */}
      {v.posMenuOpen && (
        <Sheet
          onClose={actions.closePosMenu}
          zIndex={45}
          sheetStyle={{ background: C.panel, padding: '18px 16px 30px' }}
        >
          <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>
            Position — {v.posMenuName}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3,1fr)',
              gap: 8,
              marginTop: 12,
            }}
          >
            {v.posOptions.map((o) => (
              <button
                key={o.label}
                onClick={o.onTap}
                style={{
                  background: o.bg,
                  border: `1.5px solid ${o.bd}`,
                  color: o.fg,
                  borderRadius: 12,
                  padding: '13px 0',
                  fontSize: 14,
                  fontWeight: 800,
                  ...btn,
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {/* Finalize confirmation */}
      {v.confirmFinal && (
        <Sheet
          onClose={actions.cancelFinalize}
          sheetStyle={{ background: '#fff', color: C.ink, padding: '22px 20px 30px' }}
        >
          <div style={{ fontSize: 19, fontWeight: 800 }}>{v.finalHeading}</div>
          <div style={{ fontSize: 12, color: C.fog, fontWeight: 600, marginTop: 2 }}>
            7 innings, mercy rule, or called early — confirming ends the game.
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 10, ...tnum }}>{v.finalLine}</div>
          <div style={{ fontSize: 13, color: C.muted, fontWeight: 600, marginTop: 4 }}>
            Standings and player stats update. The scorebook is kept for review.
          </div>
          <button
            onClick={actions.doFinalize}
            style={{
              width: '100%',
              marginTop: 16,
              background: C.coral,
              border: 'none',
              color: '#fff',
              borderRadius: 14,
              padding: 15,
              fontSize: 16,
              fontWeight: 800,
              ...btn,
            }}
          >
            Finalize &amp; update standings
          </button>
          <button
            onClick={actions.cancelFinalize}
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
            Keep scoring
          </button>
        </Sheet>
      )}
    </div>
  );
}
