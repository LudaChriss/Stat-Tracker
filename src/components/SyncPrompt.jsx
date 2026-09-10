import { C, FONT, btn, tnum } from '../theme.js';
import { Sheet } from './ui.jsx';

const primary = {
  width: '100%',
  background: C.coral,
  border: 'none',
  color: '#fff',
  borderRadius: 14,
  padding: 15,
  minHeight: 48,
  fontSize: 15.5,
  fontWeight: 800,
  ...btn,
};

const secondary = {
  width: '100%',
  marginTop: 10,
  background: '#fff',
  border: `1.5px solid ${C.stroke}`,
  color: C.header,
  borderRadius: 14,
  padding: 13,
  minHeight: 46,
  fontSize: 14,
  fontWeight: 800,
  ...btn,
};

const quiet = {
  width: '100%',
  marginTop: 8,
  background: 'none',
  border: 'none',
  color: C.muted,
  minHeight: 40,
  padding: 10,
  fontSize: 13.5,
  fontWeight: 700,
  ...btn,
};

const row = (label, value, differs) => (
  <div
    key={label}
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: 12.5,
      fontWeight: 700,
      padding: '3px 0',
    }}
  >
    <span style={{ color: C.muted }}>{label}</span>
    <span style={{ color: differs ? C.coral : C.ink, fontWeight: differs ? 800 : 700, ...tnum }}>
      {value}
    </span>
  </div>
);

/** One "on this phone" / "in your account" summary card. */
function SummaryCard({ title, accent, summary, diff }) {
  return (
    <div
      style={{
        flex: '1 1 140px',
        minWidth: 138,
        background: accent.bg,
        border: `1.5px solid ${accent.border}`,
        borderRadius: 13,
        padding: '12px 13px',
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 800,
          letterSpacing: '.06em',
          textTransform: 'uppercase',
          color: accent.label,
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 14, fontWeight: 800, color: C.ink, marginBottom: 6, wordBreak: 'break-word' }}>
        {summary.team || 'Unnamed team'}
      </div>
      {row('Players', summary.players, diff.players)}
      {row('Opposing teams', summary.teams, diff.teams)}
      {row('Games', summary.games, diff.games)}
    </div>
  );
}

/**
 * Shown when this device's season and the signed-in account's season are
 * both real and don't match — only the person can say which one wins, so we
 * lay out the difference plainly and never guess by merging.
 */
export default function SyncPrompt({ local, remote, busy, onUseBackend, onImportLocalAsSecondTeam, onCancel }) {
  const diff = {
    players: local.players !== remote.players,
    teams: local.teams !== remote.teams,
    games: local.games !== remote.games,
  };

  return (
    <Sheet
      onClose={onCancel}
      sheetStyle={{ background: '#fff', color: C.ink, padding: '22px 20px 26px' }}
    >
      <div style={{ fontSize: 19, fontWeight: 800 }}>This phone and your account don&apos;t match</div>
      <div style={{ fontSize: 13, color: C.muted, fontWeight: 600, marginTop: 4 }}>
        Both this device and your account already have a season, and they&apos;re
        different. Only you can say which one should win.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
        <SummaryCard
          title="On this phone"
          accent={{ bg: '#F4FAFB', border: C.teal, label: C.teal }}
          summary={local}
          diff={diff}
        />
        <SummaryCard
          title="In your account"
          accent={{ bg: '#EEF4F8', border: C.header, label: C.header }}
          summary={remote}
          diff={diff}
        />
      </div>

      <div
        style={{
          background: '#F4FAFB',
          border: `1.5px solid ${C.teal}`,
          borderRadius: 12,
          padding: '11px 13px',
          marginTop: 12,
          fontSize: 12.5,
          fontWeight: 700,
          color: C.teal,
        }}
      >
        Nothing on this phone is deleted either way. It stays on this device and
        stays exportable, whichever you choose.
      </div>

      <button onClick={onUseBackend} disabled={busy} style={{ ...primary, marginTop: 16, opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Switching…' : "Use the account's season"}
      </button>
      <button
        onClick={onImportLocalAsSecondTeam}
        disabled={busy}
        style={{ ...secondary, opacity: busy ? 0.6 : 1 }}
      >
        {busy ? 'Adding…' : 'Add this phone’s season as a second team'}
      </button>
      <div style={{ fontSize: 11.5, color: C.fog, fontWeight: 600, margin: '6px 2px 0' }}>
        We don&apos;t offer to merge the two — it can silently duplicate a roster
        or double-count games, and there&apos;s no undoing that afterward.
      </div>

      <button onClick={onCancel} style={quiet}>
        Cancel — leave everything as it is
      </button>
    </Sheet>
  );
}
