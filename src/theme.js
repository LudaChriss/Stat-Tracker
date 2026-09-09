// Palette lifted from the design. Names describe role, not hue, so screens read
// as light/dark rather than as a pile of hex codes.
export const C = {
  // Light surfaces
  bg: '#EEF4F8',
  card: '#fff',
  line: '#D7E3EC',
  hair: '#EDF3F7',
  hair2: '#E2ECF3',
  ink: '#0B2A42',

  // Brand
  header: '#123D63',
  teal: '#0E7490',
  cyan: '#2DE1FC',
  coral: '#FF6B4A',
  amber: '#FFB020',
  amberLine: '#F0B429',

  // Text
  slate: '#3D5A73',
  muted: '#5A7A90',
  mist: '#7FA8BD',
  pale: '#9FC3D6',
  fog: '#8AA5B8',
  frost: '#9FD6DE',
  ice: '#C5E4E9',
  chalk: '#C9DEEA',
  edge: '#B9CBD8',
  stroke: '#C6D8E4',

  // Dark surfaces (live game / scan camera)
  deep: '#081E30',
  panel: '#0E2A40',
  panelHi: '#10314A',
};

export const tnum = { fontVariantNumeric: 'tabular-nums' };

export const FONT = "'Manrope', sans-serif";

// Buttons need the family restated — they don't inherit it.
export const btn = { fontFamily: FONT, cursor: 'pointer' };
