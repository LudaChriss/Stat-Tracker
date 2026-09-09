import { C } from '../theme.js';

export default function Toast({ message }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 16,
        right: 16,
        bottom: 92,
        zIndex: 50,
        background: C.header,
        color: '#fff',
        borderRadius: 13,
        padding: '12px 16px',
        fontSize: 13,
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        animation: 'popIn .22s ease-out',
        boxShadow: '0 10px 26px rgba(8,30,48,.35)',
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: 99,
          background: C.amber,
          animation: 'pulse 1.2s infinite',
        }}
      />
      {message}
    </div>
  );
}
