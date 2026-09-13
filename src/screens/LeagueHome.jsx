import { C, FONT, btn, tnum } from '../theme.js';
import { Avatar, Card, Section, Sheet } from '../components/ui.jsx';

const HEADER_GRID = '22px minmax(0, 1fr) 34px 34px 46px';

export default function LeagueHome({ v, actions }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          background: `linear-gradient(160deg,${C.header},${C.teal})`,
          padding: 'var(--hdr-top) 20px 20px',
          color: '#fff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          {/* Allowed to shrink, and the name to wrap: a long one-word team name
              otherwise pushes the two buttons off the right edge of a 375px
              phone. Found by the viewport audit, run on a real signed-in team. */}
          <div style={{ minWidth: 0, flex: '1 1 auto' }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                color: C.frost,
              }}
            >
              {v.leagueEyebrow}
            </div>
            <div style={{ fontSize: 'clamp(19px, 5.6vw, 23px)', fontWeight: 800, letterSpacing: '-.01em', overflowWrap: 'anywhere' }}>
              {v.leagueTitle}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
            <button
              onClick={actions.goLeagues}
              style={{
                display: 'flex',
                alignItems: 'center',
                background: 'rgba(255,255,255,.14)',
                border: '1px solid rgba(255,255,255,.25)',
                color: '#fff',
                borderRadius: 99,
                padding: '0 12px',
                minHeight: 44,
                fontSize: 12,
                fontWeight: 700,
                whiteSpace: 'nowrap',
                ...btn,
              }}
            >
              Leagues
            </button>
            <button
              onClick={actions.goRoster}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'rgba(255,255,255,.14)',
                border: '1px solid rgba(255,255,255,.25)',
                color: '#fff',
                borderRadius: 99,
                padding: '0 14px',
                minHeight: 44,
                fontSize: 12,
                fontWeight: 700,
                ...btn,
              }}
            >
              Manage
            </button>
          </div>
        </div>

        {v.notSynced && (
          <div
            style={{
              marginTop: 10,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              background: 'rgba(255,255,255,.12)',
              borderRadius: 99,
              padding: '5px 12px',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 99,
                background: C.amber,
                animation: 'pulse 1.2s infinite',
              }}
            />
            Saved locally · syncing…
          </div>
        )}
      </div>

      {/* This week */}
      {v.schedule.length > 0 && (
      <div style={{ padding: '16px 16px 8px' }}>
        <Section>Games</Section>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
          {v.schedule.map((g) => (
            <div
              key={g.key}
              onClick={g.onTap}
              style={{
                flex: '0 0 auto',
                minWidth: 128,
                background: '#fff',
                border: `1px solid ${C.line}`,
                borderRadius: 14,
                padding: '10px 12px',
                cursor: g.onTap ? 'pointer' : 'default',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 11,
                  fontWeight: 700,
                  color: g.tagColor,
                }}
              >
                {g.tag}
              </div>
              <div style={{ fontSize: 14, fontWeight: 800, marginTop: 3, ...tnum }}>{g.line}</div>
              <div style={{ fontSize: 11.5, color: C.muted, fontWeight: 600, marginTop: 2 }}>{g.sub}</div>
            </div>
          ))}
        </div>
      </div>
      )}

      {/* Standings */}
      <div style={{ padding: '8px 16px' }}>
        <Section>Standings</Section>
        <Card style={{ overflow: 'hidden' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: HEADER_GRID,
              padding: '10px 14px 8px',
              fontSize: 11,
              fontWeight: 700,
              color: C.muted,
              letterSpacing: '.05em',
            }}
          >
            <span />
            <span>TEAM</span>
            <span style={{ textAlign: 'center' }}>W</span>
            <span style={{ textAlign: 'center' }}>L</span>
            <span style={{ textAlign: 'right' }}>PCT</span>
          </div>
          {v.standings.map((t) => (
            <div
              key={t.name}
              onClick={t.onTap}
              style={{
                display: 'grid',
                gridTemplateColumns: HEADER_GRID,
                alignItems: 'center',
                padding: '11px 14px',
                borderTop: `1px solid ${C.hair}`,
                fontSize: 14,
                background: t.bg,
                cursor: 'pointer',
              }}
            >
              <span style={{ fontWeight: 700, color: C.fog, fontSize: 12 }}>{t.rank}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: t.wt }}>
                {t.name}
                {t.you && (
                  <span
                    style={{
                      fontSize: 9.5,
                      fontWeight: 800,
                      color: C.teal,
                      background: '#DDF1F4',
                      borderRadius: 5,
                      padding: '2px 5px',
                    }}
                  >
                    YOU
                  </span>
                )}
              </span>
              <span style={{ textAlign: 'center', fontWeight: 800, ...tnum }}>{t.w}</span>
              <span style={{ textAlign: 'center', fontWeight: 600, color: C.muted, ...tnum }}>{t.l}</span>
              <span style={{ textAlign: 'right', fontWeight: 600, color: C.muted, ...tnum }}>{t.pct}</span>
            </div>
          ))}
        </Card>
        {v.hasManualRecord && (
          <div style={{ fontSize: 11, color: C.fog, fontWeight: 600, margin: '6px 2px 0' }}>
            Includes {v.manualGames} {v.manualGames === 1 ? 'game' : 'games'} entered
            manually, with no box score.
          </div>
        )}
      </div>

      {/* Stat leaders */}
      <div style={{ padding: '12px 16px 20px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            marginBottom: 8,
          }}
        >
          <Section style={{ marginBottom: 0 }}>Stat leaders</Section>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: C.teal }}>Runs ▾</div>
        </div>
        <Card style={{ padding: '6px 0' }}>
          {v.leaders.map((p) => (
            <div
              key={p.name}
              onClick={p.onTap}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 14px',
                cursor: 'pointer',
              }}
            >
              <Avatar ini={p.ini} c={p.c} size={30} fs={12} />
              <span style={{ flex: 1, fontWeight: 700, fontSize: 13.5 }}>
                {p.name}
                <span style={{ color: C.fog, fontWeight: 600, fontSize: 12 }}> · {p.team}</span>
              </span>
              <span style={{ fontSize: 19, fontWeight: 800, color: C.header, ...tnum }}>{p.val}</span>
            </div>
          ))}
        </Card>
      </div>

      {v.stoppedGame && <StoppedGameSheet v={v} actions={actions} />}
    </div>
  );
}

/**
 * A game still live in the account that nobody has scored for a while.
 *
 * Two ways out, and neither is the default. Abandoning ends it for everyone and
 * keeps every play; resuming picks it up exactly where it stopped, for the rain
 * delay that outlasted the cutoff. Abandoning is offered only to a manager or a
 * scorer — the account refuses anyone else, and a button that only ever fails
 * is worse than none.
 */
function StoppedGameSheet({ v, actions }) {
  const g = v.stoppedGame;
  const mayAbandon = ['team_manager', 'team_scorer'].includes(v.account && v.account.role);
  const plays = g.plays == null ? null : g.plays;
  return (
    <Sheet
      onClose={actions.closeStoppedGame}
      sheetStyle={{ background: '#fff', color: C.ink, padding: '22px 20px 30px' }}
    >
      <div style={{ fontSize: 19, fontWeight: 800 }}>This game has stopped</div>
      <div style={{ fontSize: 13, color: C.muted, fontWeight: 600, marginTop: 4, lineHeight: 1.45 }}>
        It is still open in the account, but nobody has entered a play for {g.idle} — the last one
        was {g.lastAt}.
        {plays != null && ` ${plays} ${plays === 1 ? 'play was' : 'plays were'} entered before that.`}
      </div>
      {mayAbandon ? (
        <>
          <div style={{ fontSize: 12.5, color: C.muted, fontWeight: 600, marginTop: 10, lineHeight: 1.45 }}>
            Abandoning ends it on every phone. Every play stays in the account, but it is not a result:
            it goes into no history, no stats and no standings.
          </div>
          <button
            onClick={actions.abandonStoppedGame}
            disabled={g.busy}
            style={{
              width: '100%',
              marginTop: 16,
              background: '#B4441F',
              border: 'none',
              color: '#fff',
              borderRadius: 14,
              padding: 15,
              minHeight: 48,
              fontSize: 16,
              fontWeight: 800,
              ...btn,
            }}
          >
            {g.busy ? 'Abandoning…' : 'Abandon it'}
          </button>
        </>
      ) : (
        <div style={{ fontSize: 12.5, color: C.muted, fontWeight: 600, marginTop: 10, lineHeight: 1.45 }}>
          A manager or scorer on the team can abandon it.
        </div>
      )}
      <button
        onClick={() => {
          actions.closeStoppedGame();
          actions.joinLiveGame();
        }}
        style={{
          width: '100%',
          marginTop: 8,
          background: '#fff',
          border: `1.5px solid ${C.stroke}`,
          color: C.ink,
          borderRadius: 14,
          padding: 13,
          minHeight: 48,
          fontSize: 15,
          fontWeight: 800,
          ...btn,
        }}
      >
        Resume scoring it
      </button>
      <button
        onClick={actions.closeStoppedGame}
        style={{
          width: '100%',
          marginTop: 4,
          background: 'none',
          border: 'none',
          color: C.muted,
          padding: 10,
          minHeight: 44,
          fontSize: 14,
          fontWeight: 700,
          ...btn,
        }}
      >
        Not now
      </button>
    </Sheet>
  );
}
