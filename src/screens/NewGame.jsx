import { C, btn } from '../theme.js';
import { Card, RoundButton, Section, Sheet } from '../components/ui.jsx';

/** One of the two-up selectable option cards (sport template / tracking mode). */
function PickCard({ title, sub, border, onClick, titleSize = 15 }) {
  return (
    <div
      onClick={onClick}
      style={{
        flex: 1,
        background: '#fff',
        border: `2px solid ${border}`,
        borderRadius: 14,
        padding: 12,
        cursor: 'pointer',
      }}
    >
      <div style={{ fontWeight: 800, fontSize: titleSize, color: C.header }}>{title}</div>
      <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function Hint({ children }) {
  return (
    <div style={{ fontSize: 11.5, color: C.fog, fontWeight: 600, marginTop: 8 }}>{children}</div>
  );
}

export default function NewGame({ v, actions }) {
  const detailRow = (label, value, last) => (
    <div
      key={label}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '12px 14px',
        fontSize: 13.5,
        fontWeight: 600,
        borderBottom: last ? 'none' : `1px solid ${C.hair}`,
      }}
    >
      <span style={{ color: C.muted }}>{label}</span>
      <span>{value}</span>
    </div>
  );

  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: 'var(--hdr-top) 16px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <RoundButton
          onClick={actions.goTeam}
          style={{ background: '#fff', border: `1px solid ${C.line}`, color: C.header }}
        >
          ‹
        </RoundButton>
        <div style={{ fontSize: 20, fontWeight: 800 }}>New game</div>
      </div>

      <div>
        <Section>Sport template</Section>
        <div style={{ display: 'flex', gap: 8 }}>
          <PickCard
            title="Kickball"
            sub="At-bat · 10 outcomes"
            border={v.kbBorder}
            onClick={actions.setSport('kickball')}
          />
          <PickCard
            title="Softball"
            sub="At-bat · 12 outcomes"
            border={v.sbBorder}
            onClick={actions.setSport('softball')}
          />
        </div>
        <Hint>
          Entry buttons, stats and standings are generated from the template — switch it and the
          scoring screen rebuilds itself.
        </Hint>
      </div>

      <div>
        <Section>Stat tracking</Section>
        <div style={{ display: 'flex', gap: 8 }}>
          <PickCard
            title="Both teams"
            sub="Full stat lines for every player"
            border={v.trBothBorder}
            onClick={actions.setTrackMode('both')}
            titleSize={14}
          />
          <PickCard
            title="Our team only"
            sub="Opponent: score + outs only"
            border={v.trOursBorder}
            onClick={actions.setTrackMode('ours')}
            titleSize={14}
          />
        </div>
        <Hint>
          Not every team keeps stats — "our team only" gives the opponent a two-button quick score.
          Switchable mid-game.
        </Hint>
      </div>

      <div>
        <Section>Opponent</Section>
        <Card
          onClick={actions.openOpponentPicker}
          style={{
            borderRadius: 14,
            padding: '13px 14px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontWeight: 700,
            fontSize: 14.5,
            cursor: 'pointer',
          }}
        >
          {v.hasTeams ? v.opponent : 'No teams yet — tap to add'}
          <span style={{ color: C.fog, fontSize: 12 }}>▾</span>
        </Card>
      </div>

      <div>
        <Section>Details</Section>
        <Card style={{ borderRadius: 14, overflow: 'hidden' }}>
          {detailRow('When', 'Today · 6:30 PM')}
          {detailRow('Field', 'Riverbend Park #2')}
          {detailRow('Scorekeeper', 'You', true)}
        </Card>
      </div>

      <div style={{ flex: 1 }} />

      {v.opponentPickerOpen && (
        <Sheet
          onClose={actions.closeOpponentPicker}
          sheetStyle={{ background: '#fff', color: C.ink, padding: '18px 16px 30px' }}
        >
          <div style={{ fontSize: 17, fontWeight: 800 }}>Opponent</div>
          {!v.hasTeams && (
            <div style={{ fontSize: 13, color: C.muted, fontWeight: 600, marginTop: 8 }}>
              No teams yet. Add the teams in your league to score a game against them.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {v.opponentOptions.map((o) => (
              <button
                key={o.name}
                onClick={o.onTap}
                style={{
                  textAlign: 'left',
                  background: o.current ? '#F4FAFB' : '#fff',
                  border: `1.5px solid ${o.current ? C.teal : C.line}`,
                  color: C.ink,
                  borderRadius: 13,
                  padding: '14px 14px',
                  fontSize: 15,
                  fontWeight: 700,
                  ...btn,
                }}
              >
                {o.name}
                <span style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: C.muted, marginTop: 2 }}>
                  {o.sub}
                </span>
              </button>
            ))}
            <button
              onClick={actions.goTeams}
              style={{
                textAlign: 'left',
                background: 'none',
                border: `1.5px dashed ${C.edge}`,
                color: C.muted,
                borderRadius: 13,
                padding: '14px',
                fontSize: 14,
                fontWeight: 800,
                ...btn,
              }}
            >
              + Add a team
            </button>
          </div>
        </Sheet>
      )}

      {!v.canStartGame && (
        <div
          style={{
            background: '#FFF8E8',
            border: `1.5px solid ${C.amberLine}`,
            borderRadius: 13,
            padding: '12px 14px',
            fontSize: 13,
            fontWeight: 700,
            color: '#6B4E00',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
          }}
        >
          {v.startBlockedReason}
          <button
            onClick={actions.goRoster}
            style={{
              background: '#fff',
              border: `1.5px solid ${C.amberLine}`,
              color: '#6B4E00',
              borderRadius: 10,
              padding: '7px 12px',
              fontSize: 12.5,
              fontWeight: 800,
              flex: '0 0 auto',
              ...btn,
            }}
          >
            Manage
          </button>
        </div>
      )}

      <button
        onClick={actions.startGame}
        disabled={!v.canStartGame}
        style={{
          background: C.coral,
          border: 'none',
          color: '#fff',
          borderRadius: 16,
          padding: 17,
          fontSize: 17,
          fontWeight: 800,
          boxShadow: '0 6px 18px rgba(255,107,74,.35)',
          opacity: v.canStartGame ? 1 : 0.4,
          ...btn,
        }}
      >
        Start game — set lineup
      </button>
    </div>
  );
}
