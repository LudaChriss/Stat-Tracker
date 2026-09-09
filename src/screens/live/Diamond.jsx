import { C } from '../../theme.js';

// Bases are small by design — the diamond has to read as a diamond. So the
// visual square sits inside a much larger transparent hit area, which is what
// actually gets tapped.
const HIT = 44;
const SIZE = 104;

const hitArea = {
  position: 'absolute',
  width: HIT,
  height: HIT,
  transform: 'translate(-50%, -50%)',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
};

const pip = (base, size) => ({
  width: size,
  height: size,
  transform: 'rotate(45deg)',
  borderRadius: size > 20 ? 6 : 5,
  border: `2px solid ${base.border}`,
  background: base.bg,
  animation: base.anim,
});

/**
 * The base diamond. Each occupied base is tappable to select the runner on it,
 * which reveals the advance / out controls.
 */
export default function Diamond({ b1, b2, b3 }) {
  const bases = [
    { key: 'second', base: b2, left: '50%', top: '15%' },
    { key: 'third', base: b3, left: '15%', top: '50%' },
    { key: 'first', base: b1, left: '85%', top: '50%' },
  ];

  return (
    <div style={{ position: 'relative', width: SIZE, height: SIZE, flex: '0 0 auto' }}>
      {/*
        Infield outline. A square rotated 45deg puts its corners half a
        diagonal from centre, so a 50% square reaches 50% +/- 35.4% — which is
        exactly where the bases below are positioned.
      */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: '50%',
          height: '50%',
          transform: 'translate(-50%,-50%) rotate(45deg)',
          border: '1.5px solid rgba(255,255,255,.22)',
          borderRadius: 8,
        }}
      />

      {bases.map(({ key, base, left, top }) => (
        <div
          key={key}
          onClick={base.tap}
          role="button"
          aria-label={key}
          style={{ ...hitArea, left, top }}
        >
          <div style={pip(base, 23)} />
        </div>
      ))}

      {/* home plate is not a runner position, so it is not interactive */}
      <div style={{ ...hitArea, left: '50%', top: '85%', cursor: 'default' }}>
        <div
          style={{
            width: 19,
            height: 19,
            transform: 'rotate(45deg)',
            borderRadius: 5,
            border: '2px solid rgba(255,255,255,.25)',
            background: C.panel,
          }}
        />
      </div>
    </div>
  );
}
