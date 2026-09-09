import { C, FONT, tnum } from '../theme.js';

/** Small uppercase section heading used across the light screens. */
export function Section({ children, style }) {
  return (
    <div
      style={{
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '.08em',
        textTransform: 'uppercase',
        color: C.muted,
        marginBottom: 8,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** White rounded panel on the light screens. */
export function Card({ children, style, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 16, ...style }}
    >
      {children}
    </div>
  );
}

/** Dark rounded panel on the live-game screens. */
export function DarkCard({ children, style }) {
  return (
    <div
      style={{
        background: C.panel,
        border: '1px solid rgba(255,255,255,.1)',
        borderRadius: 16,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Avatar({ ini, c, size = 30, fs, style, onClick }) {
  return (
    <span
      onClick={onClick}
      style={{
        width: size,
        height: size,
        borderRadius: 99,
        background: c,
        color: '#fff',
        display: 'grid',
        placeItems: 'center',
        fontSize: fs ?? Math.round(size * 0.4),
        fontWeight: 800,
        flex: '0 0 auto',
        ...style,
      }}
    >
      {ini}
    </span>
  );
}

/** Circular back / nav chevron button. */
export function RoundButton({ children, onClick, style }) {
  return (
    <button
      onClick={onClick}
      style={{
        borderRadius: 99,
        width: 42,
        height: 42,
        fontSize: 17,
        border: 'none',
        fontFamily: FONT,
        cursor: 'pointer',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/** Bottom sheet with a scrim. Clicking the scrim closes it. */
export function Sheet({ onClose, children, zIndex = 40, sheetStyle }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(4,14,24,.6)',
        display: 'flex',
        alignItems: 'flex-end',
        zIndex,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          borderRadius: '22px 22px 0 0',
          width: '100%',
          animation: 'popIn .2s ease-out',
          ...sheetStyle,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** Numeric cell style shared by the stat tables. */
export const numCell = { ...tnum, textAlign: 'center' };
