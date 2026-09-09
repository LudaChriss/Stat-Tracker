import { useState } from 'react';
import { C, FONT, btn, tnum } from '../theme.js';
import { Sheet } from './ui.jsx';

const stepper = {
  width: 46,
  height: 46,
  borderRadius: 12,
  border: `1.5px solid ${C.line}`,
  background: '#fff',
  color: C.header,
  fontSize: 20,
  fontWeight: 800,
  ...btn,
};

function Counter({ label, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, fontSize: 14.5, fontWeight: 700 }}>{label}</div>
      <button onClick={() => onChange(Math.max(0, value - 1))} style={stepper} aria-label={`One fewer ${label}`}>
        −
      </button>
      <span
        style={{
          minWidth: 40,
          textAlign: 'center',
          fontSize: 22,
          fontWeight: 800,
          ...tnum,
        }}
      >
        {value}
      </span>
      <button onClick={() => onChange(value + 1)} style={stepper} aria-label={`One more ${label}`}>
        +
      </button>
    </div>
  );
}

/**
 * Manual record offset. This is explicitly *not* game history: it adds to the
 * standings only, carries no box score, and shows up nowhere in the game list.
 */
export default function RecordSheet({ v, actions }) {
  const [w, setW] = useState(v.manualW);
  const [l, setL] = useState(v.manualL);
  const [t, setT] = useState(v.manualT);

  const total = `${v.trackedGames ? v.trackedRecord : '0–0'} + ${w}–${l}${t ? `–${t}` : ''}`;

  return (
    <Sheet
      onClose={actions.closeRecordEditor}
      sheetStyle={{ background: '#fff', color: C.ink, padding: '22px 20px 30px' }}
    >
      <div style={{ fontSize: 19, fontWeight: 800 }}>Games not tracked here</div>
      <div style={{ fontSize: 13, color: C.muted, fontWeight: 600, marginTop: 4 }}>
        For games you played but didn't score in the app. These adjust the
        standings only — they add no box score and won't appear in your game list.
      </div>

      <div
        style={{
          background: '#F4FAFB',
          border: `1px solid ${C.line}`,
          borderRadius: 13,
          padding: '10px 14px',
          marginTop: 14,
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 13,
          fontWeight: 700,
        }}
      >
        <span style={{ color: C.muted }}>
          Tracked games ({v.trackedGames})
        </span>
        <span style={{ ...tnum }}>{v.trackedRecord}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
        <Counter label="Wins" value={w} onChange={setW} />
        <Counter label="Losses" value={l} onChange={setL} />
        <Counter label="Ties" value={t} onChange={setT} />
      </div>

      <div
        style={{
          marginTop: 16,
          padding: '12px 14px',
          background: C.bg,
          borderRadius: 13,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 700, color: C.muted }}>{total}</span>
        <span style={{ fontSize: 20, fontWeight: 800, color: C.header, ...tnum }}>
          {`${v.trackedGames ? Number(v.trackedRecord.split('–')[0]) + w : w}–${
            v.trackedGames ? Number(v.trackedRecord.split('–')[1]) + l : l
          }`}
        </span>
      </div>

      <div style={{ fontSize: 11.5, color: C.fog, fontWeight: 600, marginTop: 8 }}>
        Batting stats can't be adjusted this way — those come from the box
        scores of games actually scored here.
      </div>

      <button
        onClick={() => actions.setManualRecord({ priorW: w, priorL: l, priorT: t })}
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
          fontFamily: FONT,
          ...btn,
        }}
      >
        Save record
      </button>
      <button
        onClick={actions.closeRecordEditor}
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
