import { useState } from 'react';
import { C, FONT, btn } from '../theme.js';
import { Sheet } from './ui.jsx';

const primary = {
  width: '100%',
  border: 'none',
  color: '#fff',
  borderRadius: 14,
  padding: 15,
  fontSize: 16,
  fontWeight: 800,
  ...btn,
};

const quiet = {
  width: '100%',
  marginTop: 8,
  background: 'none',
  border: 'none',
  color: C.muted,
  padding: 10,
  fontSize: 14,
  fontWeight: 700,
  ...btn,
};

/** Step 1: spell out exactly what is about to be deleted, and offer a backup. */
export function ResetConfirmSheet({ v, actions }) {
  return (
    <Sheet
      onClose={actions.closeReset}
      sheetStyle={{ background: '#fff', color: C.ink, padding: '22px 20px 30px' }}
    >
      <div style={{ fontSize: 19, fontWeight: 800 }}>Start a fresh season?</div>
      <div style={{ fontSize: 13, color: C.muted, fontWeight: 600, marginTop: 4 }}>
        This permanently deletes everything currently in the app. It cannot be undone.
      </div>

      <div
        style={{
          background: '#FFF8E8',
          border: `1.5px solid ${C.amberLine}`,
          borderRadius: 13,
          padding: '12px 14px',
          marginTop: 14,
        }}
      >
        {v.resetSummary.map((row) => (
          <div
            key={row.label}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 13.5,
              fontWeight: 700,
              padding: '3px 0',
              color: '#6B4E00',
            }}
          >
            <span>{row.label}</span>
            <span>{row.count}</span>
          </div>
        ))}
      </div>

      <button
        onClick={actions.exportSeason}
        style={{
          ...primary,
          marginTop: 14,
          background: '#fff',
          color: C.header,
          border: `1.5px solid ${C.stroke}`,
        }}
      >
        ⤓ Export a backup first
      </button>
      <div style={{ fontSize: 11.5, color: C.fog, fontWeight: 600, marginTop: 6, textAlign: 'center' }}>
        Saves a JSON file of everything above
      </div>

      <button onClick={actions.confirmReset} style={{ ...primary, marginTop: 14, background: '#B4441F' }}>
        Delete everything and start fresh
      </button>
      <button onClick={actions.closeReset} style={quiet}>
        Cancel
      </button>
    </Sheet>
  );
}

/**
 * Ask for a team name. Used for first-run setup, for step 2 of the reset, and
 * for renaming later.
 */
export function NameSheet({
  title = "What's your team called?",
  subtitle = 'You can change this later, and add your players next.',
  cta = 'Create my season',
  initial = '',
  onSubmit,
  onClose,
}) {
  const [name, setName] = useState(initial);

  return (
    <Sheet
      onClose={onClose}
      sheetStyle={{ background: '#fff', color: C.ink, padding: '22px 20px 30px' }}
    >
      <div style={{ fontSize: 19, fontWeight: 800 }}>{title}</div>
      <div style={{ fontSize: 13, color: C.muted, fontWeight: 600, marginTop: 4 }}>{subtitle}</div>

      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Team name"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) onSubmit(name);
        }}
        style={{
          width: '100%',
          marginTop: 16,
          border: `1.5px solid ${C.line}`,
          borderRadius: 12,
          padding: '14px',
          fontSize: 16,
          fontWeight: 700,
          color: C.ink,
          fontFamily: FONT,
        }}
      />

      <button
        onClick={() => onSubmit(name)}
        disabled={!name.trim()}
        style={{ ...primary, marginTop: 16, background: C.coral, opacity: name.trim() ? 1 : 0.4 }}
      >
        {cta}
      </button>
      {onClose && (
        <button onClick={onClose} style={quiet}>
          Cancel
        </button>
      )}
    </Sheet>
  );
}
