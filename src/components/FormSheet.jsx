import { useState } from 'react';
import { C, FONT, btn } from '../theme.js';
import { Sheet } from './ui.jsx';
import { POSITIONS } from '../data/league.js';

const field = {
  width: '100%',
  border: `1.5px solid ${C.line}`,
  borderRadius: 12,
  padding: '13px 14px',
  fontSize: 16, // 16px keeps iOS from zooming the page on focus
  fontWeight: 700,
  color: C.ink,
  background: '#fff',
  fontFamily: FONT,
};

const label = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '.06em',
  color: C.muted,
  marginBottom: 6,
  textTransform: 'uppercase',
};

const primary = {
  width: '100%',
  background: C.coral,
  border: 'none',
  color: '#fff',
  borderRadius: 14,
  padding: 15,
  fontSize: 16,
  fontWeight: 800,
  ...btn,
};

const danger = {
  width: '100%',
  marginTop: 8,
  background: 'none',
  border: `1.5px solid ${C.line}`,
  color: '#B4441F',
  borderRadius: 14,
  padding: 13,
  fontSize: 14,
  fontWeight: 800,
  ...btn,
};

/** Add or edit one player, on our roster or an opposing team's. */
export function PlayerFormSheet({ editor, player, onSave, onRemove, onClose }) {
  const [name, setName] = useState(player ? player.name : '');
  const [num, setNum] = useState(player && player.num != null ? String(player.num) : '');
  const [pos, setPos] = useState(player ? player.pos : POSITIONS[0]);
  const isNew = editor.id == null;

  const save = () =>
    onSave({
      teamId: editor.teamId,
      id: editor.id,
      name,
      num: num === '' ? null : Number(num),
      pos,
    });

  return (
    <Sheet onClose={onClose} sheetStyle={{ background: '#fff', color: C.ink, padding: '20px 16px 30px' }}>
      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 14 }}>
        {isNew ? 'Add player' : 'Edit player'}
      </div>

      <div style={label}>Name</div>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Player name"
        style={field}
      />

      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <div style={{ width: 96 }}>
          <div style={label}>Number</div>
          <input
            value={num}
            onChange={(e) => setNum(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
            inputMode="numeric"
            placeholder="—"
            style={field}
          />
        </div>
        <div style={{ flex: 1 }}>
          <div style={label}>Position</div>
          <select value={pos} onChange={(e) => setPos(e.target.value)} style={field}>
            {POSITIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button
        onClick={save}
        disabled={!name.trim()}
        style={{ ...primary, marginTop: 18, opacity: name.trim() ? 1 : 0.4 }}
      >
        {isNew ? 'Add player' : 'Save changes'}
      </button>
      {!isNew && (
        <button onClick={onRemove} style={danger}>
          Remove from team
        </button>
      )}
      <button
        onClick={onClose}
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
        Cancel
      </button>
    </Sheet>
  );
}

/** Add or edit an opposing team. Only the name is required. */
export function TeamFormSheet({ editor, team, onSave, onRemove, onClose }) {
  const [name, setName] = useState(team ? team.name : '');
  const [priorW, setPriorW] = useState(team ? String(team.priorW || 0) : '0');
  const [priorL, setPriorL] = useState(team ? String(team.priorL || 0) : '0');
  const isNew = editor.id == null;
  const digits = (v) => v.replace(/[^0-9]/g, '').slice(0, 2);

  return (
    <Sheet onClose={onClose} sheetStyle={{ background: '#fff', color: C.ink, padding: '20px 16px 30px' }}>
      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 14 }}>
        {isNew ? 'Add team' : 'Edit team'}
      </div>

      <div style={label}>Team name</div>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Team name"
        style={field}
      />

      <div style={{ ...label, marginTop: 14 }}>Record before you started tracking</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input value={priorW} onChange={(e) => setPriorW(digits(e.target.value))} inputMode="numeric" style={{ ...field, textAlign: 'center' }} />
        <span style={{ fontWeight: 800, color: C.muted }}>W</span>
        <input value={priorL} onChange={(e) => setPriorL(digits(e.target.value))} inputMode="numeric" style={{ ...field, textAlign: 'center' }} />
        <span style={{ fontWeight: 800, color: C.muted }}>L</span>
      </div>
      <div style={{ fontSize: 11.5, color: C.fog, fontWeight: 600, marginTop: 6 }}>
        Leave at 0 unless the season was already underway. Games you score in the
        app are added on top.
      </div>

      <button
        onClick={() =>
          onSave({ id: editor.id, name, priorW: Number(priorW) || 0, priorL: Number(priorL) || 0 })
        }
        disabled={!name.trim()}
        style={{ ...primary, marginTop: 18, opacity: name.trim() ? 1 : 0.4 }}
      >
        {isNew ? 'Add team' : 'Save changes'}
      </button>
      {!isNew && (
        <button onClick={onRemove} style={danger}>
          Delete team
        </button>
      )}
      <button
        onClick={onClose}
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
        Cancel
      </button>
    </Sheet>
  );
}
