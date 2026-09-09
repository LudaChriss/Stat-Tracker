import { FONT } from '../theme.js';

export default function TabBar({ v }) {
  return (
    <div
      style={{
        display: 'flex',
        background: v.tabBarBg,
        borderTop: `1px solid ${v.tabBarLine}`,
        padding: '8px 8px 6px',
        flex: '0 0 auto',
      }}
    >
      {v.tabs.map((t) => (
        <button
          key={t.label}
          onClick={t.onTap}
          style={{
            flex: 1,
            background: 'none',
            border: 'none',
            padding: '6px 0 4px',
            cursor: 'pointer',
            fontFamily: FONT,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 3,
          }}
        >
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: 7,
              background: t.iconBg,
              display: 'grid',
              placeItems: 'center',
              fontSize: 11,
              fontWeight: 800,
              color: t.iconFg,
            }}
          >
            {t.glyph}
          </span>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: t.fg }}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}
