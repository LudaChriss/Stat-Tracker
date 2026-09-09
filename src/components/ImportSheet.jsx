import { C, btn } from '../theme.js';
import { Sheet } from './ui.jsx';

const row = (label, value, tone) => (
  <div
    key={label}
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: 13.5,
      fontWeight: 700,
      padding: '3px 0',
      color: tone,
    }}
  >
    <span>{label}</span>
    <span>{value}</span>
  </div>
);

/** Confirm a restore, spelling out both what arrives and what it replaces. */
export default function ImportSheet({ v, actions }) {
  const { summary } = v.importPreview;

  return (
    <Sheet
      onClose={actions.cancelImport}
      sheetStyle={{ background: '#fff', color: C.ink, padding: '22px 20px 30px' }}
    >
      <div style={{ fontSize: 19, fontWeight: 800 }}>Restore this backup?</div>
      <div style={{ fontSize: 13, color: C.muted, fontWeight: 600, marginTop: 4 }}>
        {summary.exportedAt ? `Exported ${summary.exportedAt}. ` : ''}
        This replaces everything currently in the app.
      </div>

      <div
        style={{
          background: '#F4FAFB',
          border: `1.5px solid ${C.teal}`,
          borderRadius: 13,
          padding: '12px 14px',
          marginTop: 14,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '.06em',
            color: C.teal,
            marginBottom: 4,
          }}
        >
          IN THIS FILE
        </div>
        {row('Team', summary.teamName, C.ink)}
        {row('Players', summary.players, C.ink)}
        {row('Opposing teams', summary.teams, C.ink)}
        {row('Recorded games', summary.games, C.ink)}
      </div>

      <div
        style={{
          background: '#FFF8E8',
          border: `1.5px solid ${C.amberLine}`,
          borderRadius: 13,
          padding: '12px 14px',
          marginTop: 10,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '.06em',
            color: '#6B4E00',
            marginBottom: 4,
          }}
        >
          REPLACES WHAT'S HERE NOW
        </div>
        {v.resetSummary.map((r) => row(r.label, r.count, '#6B4E00'))}
      </div>

      <button
        onClick={actions.confirmImport}
        style={{
          width: '100%',
          marginTop: 16,
          background: C.coral,
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
        Restore this backup
      </button>
      <button
        onClick={actions.cancelImport}
        style={{
          width: '100%',
          marginTop: 8,
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
        Cancel
      </button>
    </Sheet>
  );
}
