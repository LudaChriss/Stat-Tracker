import { C, btn } from '../theme.js';
import { RoundButton } from '../components/ui.jsx';

export default function ScanCamera({ v, actions }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: C.deep, color: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '60px 16px 14px' }}>
        <RoundButton onClick={actions.goTeam} style={{ background: 'rgba(255,255,255,.12)', color: '#fff' }}>
          ‹
        </RoundButton>
        <div style={{ fontSize: 17, fontWeight: 800 }}>{v.scanTitle}</div>
      </div>

      {/* Viewfinder */}
      <div
        style={{
          flex: 1,
          margin: '6px 16px',
          position: 'relative',
          borderRadius: 18,
          overflow: 'hidden',
          background: 'linear-gradient(155deg,#1B3A52,#0D2438)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 18,
            border: '2px dashed rgba(255,255,255,.35)',
            borderRadius: 12,
          }}
        />
        {/* the sheet of paper */}
        <div
          style={{
            position: 'absolute',
            left: '14%',
            right: '14%',
            top: '16%',
            bottom: '14%',
            background: '#F6F2E8',
            borderRadius: 4,
            transform: 'rotate(-2deg)',
            boxShadow: '0 12px 30px rgba(0,0,0,.4)',
            padding: 12,
          }}
        >
          <div style={{ height: 9, background: C.header, borderRadius: 2, width: '55%', opacity: 0.85 }} />
          <div
            style={{
              marginTop: 10,
              display: 'grid',
              gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
              gap: 4,
            }}
          >
            {v.paperCells.map((c, i) => (
              <div key={i} style={{ height: 7, background: '#B9C6CF', borderRadius: 2, opacity: c.o }} />
            ))}
          </div>
          <div
            style={{
              marginTop: 12,
              height: 7,
              background: '#B9C6CF',
              borderRadius: 2,
              width: '40%',
              opacity: 0.6,
            }}
          />
        </div>
        <div
          style={{
            position: 'absolute',
            left: '8%',
            right: '8%',
            height: 2,
            background: `linear-gradient(90deg,transparent,${C.cyan},transparent)`,
            animation: 'scanline 2.6s ease-in-out infinite',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            left: 0,
            right: 0,
            textAlign: 'center',
            fontSize: 12,
            fontWeight: 700,
            color: C.frost,
          }}
        >
          Line the sheet up inside the frame
        </div>
      </div>

      <div style={{ padding: '18px 0 26px', display: 'grid', placeItems: 'center' }}>
        <button
          onClick={actions.capture}
          aria-label="Capture"
          style={{
            width: 70,
            height: 70,
            borderRadius: 99,
            background: '#fff',
            border: '5px solid rgba(255,255,255,.35)',
            ...btn,
          }}
        />
      </div>
    </div>
  );
}
