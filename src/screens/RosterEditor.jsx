import { C, btn, tnum } from '../theme.js';
import { Avatar, Card, RoundButton, Section } from '../components/ui.jsx';
import { PlayerFormSheet } from '../components/FormSheet.jsx';

/** Manage our own roster. Season stats come from played games, so removing a
 *  player here never rewrites the games they already appear in. */
export default function RosterEditor({ v, actions }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          padding: '60px 16px 12px',
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
          <div style={{ fontSize: 18, fontWeight: 800 }}>Manage roster</div>
          <div style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>
            {v.myTeamName} · {v.rosterCount} {v.rosterCount === 1 ? 'player' : 'players'}
          </div>
        </div>
      </div>

      <div style={{ padding: '14px 16px 8px' }}>
        <button
          onClick={actions.openPlayerEditor(null, null)}
          style={{
            width: '100%',
            background: C.coral,
            border: 'none',
            color: '#fff',
            borderRadius: 14,
            padding: 15,
            fontSize: 16,
            fontWeight: 800,
            boxShadow: '0 6px 18px rgba(255,107,74,.35)',
            ...btn,
          }}
        >
          + Add player
        </button>
      </div>

      <div style={{ padding: '8px 16px 20px' }}>
        {v.rosterCount === 0 ? (
          <Card style={{ padding: '28px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>No players yet</div>
            <div style={{ fontSize: 12.5, color: C.muted, fontWeight: 600, marginTop: 5 }}>
              Add your team, then set the batting order when you start a game.
            </div>
          </Card>
        ) : (
          <Card style={{ overflow: 'hidden' }}>
            {v.rosterEditRows.map((p) => (
              <div
                key={p.key}
                onClick={p.onEdit}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 14px',
                  borderTop: `1px solid ${C.hair}`,
                  cursor: 'pointer',
                }}
              >
                <Avatar ini={p.ini} c={p.c} size={34} fs={13} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 700, fontSize: 14.5 }}>{p.name}</span>
                  <span style={{ display: 'block', fontSize: 11, color: C.muted, fontWeight: 700, ...tnum }}>
                    {p.meta}
                  </span>
                </span>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: C.teal, ...tnum }}>{p.season}</span>
                <span style={{ color: C.edge, fontSize: 15, marginLeft: 4 }}>›</span>
              </div>
            ))}
          </Card>
        )}
      </div>

      <div style={{ padding: '0 16px 24px' }}>
        <Section>Opposing teams</Section>
        <Card
          onClick={actions.goTeams}
          style={{
            padding: '14px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'pointer',
          }}
        >
          <span>
            <span style={{ display: 'block', fontWeight: 800, fontSize: 14.5 }}>Manage teams</span>
            <span style={{ display: 'block', fontSize: 11.5, color: C.muted, fontWeight: 600 }}>
              {v.teamCount} {v.teamCount === 1 ? 'team' : 'teams'} · rosters optional
            </span>
          </span>
          <span style={{ color: C.edge, fontSize: 15 }}>›</span>
        </Card>
      </div>

      {v.playerEditor && (
        <PlayerFormSheet
          editor={v.playerEditor}
          player={v.playerEditorTarget}
          onSave={actions.savePlayer}
          onRemove={actions.removePlayer(v.playerEditor.teamId, v.playerEditor.id)}
          onClose={actions.closePlayerEditor}
        />
      )}
    </div>
  );
}
