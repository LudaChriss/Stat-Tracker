import { C } from '../../theme.js';

const BASE = {
  position: 'absolute',
  width: 23,
  height: 23,
  borderRadius: 6,
  cursor: 'pointer',
};

/**
 * The base diamond. Each occupied base is tappable to select the runner on it,
 * which reveals the advance / out controls.
 */
export default function Diamond({ b1, b2, b3 }) {
  return (
    <div style={{ position: 'relative', width: 100, height: 100, flex: '0 0 auto' }}>
      {/* infield outline */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: 60,
          height: 60,
          transform: 'translate(-50%,-54%) rotate(45deg)',
          border: '1.5px solid rgba(255,255,255,.22)',
          borderRadius: 8,
        }}
      />
      {/* second */}
      <div
        onClick={b2.tap}
        style={{
          ...BASE,
          left: '50%',
          top: 6,
          transform: 'translateX(-50%) rotate(45deg)',
          border: `2px solid ${b2.border}`,
          background: b2.bg,
          animation: b2.anim,
        }}
      />
      {/* third */}
      <div
        onClick={b3.tap}
        style={{
          ...BASE,
          left: 4,
          top: '50%',
          transform: 'translateY(-70%) rotate(45deg)',
          border: `2px solid ${b3.border}`,
          background: b3.bg,
          animation: b3.anim,
        }}
      />
      {/* first */}
      <div
        onClick={b1.tap}
        style={{
          ...BASE,
          right: 4,
          top: '50%',
          transform: 'translateY(-70%) rotate(45deg)',
          border: `2px solid ${b1.border}`,
          background: b1.bg,
          animation: b1.anim,
        }}
      />
      {/* home */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          bottom: 8,
          transform: 'translateX(-50%) rotate(45deg)',
          width: 19,
          height: 19,
          borderRadius: 5,
          border: '2px solid rgba(255,255,255,.25)',
          background: C.panel,
        }}
      />
    </div>
  );
}
