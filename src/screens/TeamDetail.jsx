import { C, btn, tnum } from '../theme.js';
import { Avatar, Card, RoundButton, Section } from '../components/ui.jsx';
import { PlayerFormSheet, TeamFormSheet } from '../components/FormSheet.jsx';

/** One opposing team: rename, prior record, and an optional player roster. */
export default function TeamDetail({ v, actions }) {
  const team = v.teamDetail;
  if (!team) return null;

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
          <RoundButton onClick={actions.goTeams} style={{ background: 'rgba(255,255,255,.14)', color: '#fff' }}>
            ‹
          </RoundButton>
          <span style={{ flex: 1 }} />
          <button
            onClick={actions.openTeamEditor(team.id)}
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
            Edit
          </button>
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, marginTop: 10 }}>{team.name}</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.ice, marginTop: 2, ...tnum }}>
          {team.record} · {team.playerCount} {team.playerCount === 1 ? 'player' : 'players'} on file
        </div>
      </div>

      <div style={{ padding: '16px 16px 4px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Section style={{ marginBottom: 0 }}>Their roster</Section>
        <button
          onClick={actions.openPlayerEditor(team.id, null)}
          style={{ background: 'none', border: 'none', color: C.teal, fontSize: 12.5, fontWeight: 800, ...btn }}
        >
          + Add player
        </button>
      </div>

      <div style={{ padding: '8px 16px 24px' }}>
        {team.playerCount === 0 ? (
          <Card style={{ padding: '26px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 14.5, fontWeight: 800 }}>No roster entered</div>
            <div style={{ fontSize: 12.5, color: C.muted, fontWeight: 600, marginTop: 5 }}>
              You can still score games against {team.name} — their batters show as
              slots and only the score is tracked. Add players here whenever you
              want their individual stats.
            </div>
          </Card>
        ) : (
          <Card style={{ overflow: 'hidden' }}>
            {team.players.map((p) => (
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

      {v.playerEditor && (
        <PlayerFormSheet
          editor={v.playerEditor}
          player={v.playerEditorTarget}
          onSave={actions.savePlayer}
          onRemove={actions.removePlayer(v.playerEditor.teamId, v.playerEditor.id)}
          onClose={actions.closePlayerEditor}
        />
      )}
      {v.teamEditor && (
        <TeamFormSheet
          editor={v.teamEditor}
          team={v.teamEditorTarget}
          onSave={actions.saveTeam}
          onRemove={actions.removeTeam(v.teamEditor.id)}
          onClose={actions.closeTeamEditor}
        />
      )}
    </div>
  );
}
