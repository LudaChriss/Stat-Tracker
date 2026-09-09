import { useRef } from 'react';
import { C, btn, tnum } from '../theme.js';
import { Avatar, Card, RoundButton, Section } from '../components/ui.jsx';
import { PlayerFormSheet } from '../components/FormSheet.jsx';
import { NameSheet, ResetConfirmSheet } from '../components/ResetSheets.jsx';
import ImportSheet from '../components/ImportSheet.jsx';

/** Manage our own roster. Season stats come from played games, so removing a
 *  player here never rewrites the games they already appear in. */
export default function RosterEditor({ v, actions }) {
  // A hidden file input is the only way to open the picker from a styled
  // button; the tap has to originate from a real user gesture.
  const fileRef = useRef(null);

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
        <RoundButton onClick={actions.goTeam} style={{ background: C.bg, color: C.header }}>
          ‹
        </RoundButton>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Manage roster</div>
          <div style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>
            {v.myTeamName} · {v.rosterCount} {v.rosterCount === 1 ? 'player' : 'players'}
          </div>
        </div>
        <button
          onClick={actions.openRename}
          style={{
            background: C.bg,
            border: 'none',
            borderRadius: 99,
            padding: '0 15px',
            minHeight: 42,
            fontSize: 12.5,
            fontWeight: 800,
            color: C.header,
            ...btn,
          }}
        >
          Rename
        </button>
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

      <div style={{ padding: '0 16px 28px' }}>
        <Section>Season data</Section>
        <button
          onClick={actions.exportSeason}
          style={{
            width: '100%',
            background: '#fff',
            border: `1.5px solid ${C.stroke}`,
            color: C.header,
            borderRadius: 13,
            padding: 14,
            fontSize: 14.5,
            fontWeight: 800,
            ...btn,
          }}
        >
          ⤓ Export season as JSON
        </button>
        <div style={{ fontSize: 11.5, color: C.fog, fontWeight: 600, margin: '6px 2px 0' }}>
          Your data lives only in this browser. Export now and then — reinstalling
          the app or clearing site data will take the season with it.
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            actions.importFile(e.target.files && e.target.files[0]);
            e.target.value = ''; // allow re-picking the same file
          }}
        />
        <button
          onClick={() => fileRef.current && fileRef.current.click()}
          style={{
            width: '100%',
            marginTop: 10,
            background: '#fff',
            border: `1.5px solid ${C.stroke}`,
            color: C.header,
            borderRadius: 13,
            padding: 14,
            minHeight: 48,
            fontSize: 14.5,
            fontWeight: 800,
            ...btn,
          }}
        >
          ⤒ Import season data
        </button>
        <div style={{ fontSize: 11.5, color: C.fog, fontWeight: 600, margin: '6px 2px 0' }}>
          Restores a previously exported backup file.
        </div>

        {v.importError && (
          <div
            style={{
              marginTop: 10,
              background: '#FFF1D6',
              border: `1.5px solid ${C.amberLine}`,
              borderRadius: 12,
              padding: '11px 13px',
              fontSize: 12.5,
              fontWeight: 700,
              color: '#8A6100',
            }}
          >
            {v.importError}
          </div>
        )}

        {v.hasPreserved && (
          <div
            style={{
              marginTop: 10,
              background: '#FFF8E8',
              border: `1.5px solid ${C.amberLine}`,
              borderRadius: 12,
              padding: '12px 13px',
            }}
          >
            <div style={{ fontSize: 12.5, fontWeight: 800, color: '#6B4E00' }}>
              An earlier save couldn't be read
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: '#8A6100', marginTop: 3 }}>
              It was kept rather than overwritten. You can try restoring it.
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button
                onClick={actions.importPreserved}
                style={{
                  flex: 1,
                  background: '#fff',
                  border: `1.5px solid ${C.amberLine}`,
                  color: '#6B4E00',
                  borderRadius: 11,
                  minHeight: 44,
                  fontSize: 13,
                  fontWeight: 800,
                  ...btn,
                }}
              >
                Restore it
              </button>
              <button
                onClick={actions.dismissPreserved}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#8A6100',
                  minHeight: 44,
                  padding: '0 12px',
                  fontSize: 13,
                  fontWeight: 700,
                  ...btn,
                }}
              >
                Discard
              </button>
            </div>
          </div>
        )}

        <button
          onClick={actions.openReset}
          style={{
            width: '100%',
            marginTop: 14,
            background: 'none',
            border: `1.5px solid ${C.line}`,
            color: '#B4441F',
            borderRadius: 13,
            padding: 13,
            fontSize: 14,
            fontWeight: 800,
            ...btn,
          }}
        >
          Start fresh season
        </button>
      </div>

      {v.importPreview && <ImportSheet v={v} actions={actions} />}
      {v.resetFlow === 'confirm' && <ResetConfirmSheet v={v} actions={actions} />}
      {v.resetFlow === 'name' && (
        <NameSheet onSubmit={actions.startFreshSeason} onClose={actions.closeReset} />
      )}
      {v.resetFlow === 'rename' && (
        <NameSheet
          title="Rename your team"
          subtitle="This is the name shown in the standings."
          cta="Save name"
          initial={v.myTeamName}
          onSubmit={actions.renameMyTeam}
          onClose={actions.closeReset}
        />
      )}

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
