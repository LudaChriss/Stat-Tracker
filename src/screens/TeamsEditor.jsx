import { C, btn, tnum } from '../theme.js';
import { Card, RoundButton } from '../components/ui.jsx';
import { TeamFormSheet } from '../components/FormSheet.jsx';

/** The list of opposing teams. A team needs only a name. */
export default function TeamsEditor({ v, actions }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          padding: 'var(--hdr-top) 16px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: '#fff',
          borderBottom: `1px solid ${C.hair2}`,
        }}
      >
        <RoundButton onClick={actions.goRoster} style={{ background: C.bg, color: C.header }}>
          ‹
        </RoundButton>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Opposing teams</div>
          <div style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>
            Name is all you need — add players only if you want their stats
          </div>
        </div>
      </div>

      <div style={{ padding: '14px 16px 8px' }}>
        <button
          onClick={actions.openTeamEditor(null)}
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
          + Add team
        </button>
      </div>

      <div style={{ padding: '8px 16px 24px' }}>
        {v.teamCount === 0 ? (
          <Card style={{ padding: '28px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>No opposing teams yet</div>
            <div style={{ fontSize: 12.5, color: C.muted, fontWeight: 600, marginTop: 5 }}>
              Add the teams in your league. You can add one mid-season any time.
            </div>
          </Card>
        ) : (
          <Card style={{ overflow: 'hidden' }}>
            {v.teamRows.map((t) => (
              <div
                key={t.id}
                onClick={t.onOpen}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 14px',
                  borderTop: `1px solid ${C.hair}`,
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 9,
                    background: C.header,
                    color: '#fff',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 12,
                    fontWeight: 800,
                    flex: '0 0 auto',
                  }}
                >
                  {t.abbrev}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 700, fontSize: 14.5 }}>{t.name}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: C.muted, fontWeight: 600 }}>
                    {t.sub}
                  </span>
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: C.slate, ...tnum }}>{t.record}</span>
                <span style={{ color: C.edge, fontSize: 15, marginLeft: 4 }}>›</span>
              </div>
            ))}
          </Card>
        )}
      </div>

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
