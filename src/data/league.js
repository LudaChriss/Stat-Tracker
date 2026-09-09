import { SEED_HISTORY } from './history.js';

// Sport templates drive the entry buttons, the stat columns and the scoring
// rules. Adding a sport here is enough to make the live screen rebuild itself.
export const TEMPLATES = {
  kickball: {
    name: 'Kickball',
    groups: [
      {
        label: 'ON BASE',
        tone: 'teal',
        outcomes: [
          { k: '1B', label: 'Single', type: 'hit', n: 1 },
          { k: '2B', label: 'Double', type: 'hit', n: 2 },
          { k: '3B', label: 'Triple', type: 'hit', n: 3 },
          { k: 'HR', label: 'Home run', type: 'hit', n: 4 },
        ],
      },
      {
        label: 'OUTS',
        tone: 'slate',
        outcomes: [
          { k: 'F8', label: 'Fly out', type: 'out', mode: 'fly' },
          { k: 'FO', label: 'Force out', type: 'out', mode: 'force' },
          { k: 'TO', label: 'Tag out', type: 'out', mode: 'fly' },
          { k: 'K', label: 'Strikeout', type: 'out', mode: 'fly' },
        ],
      },
      {
        label: 'OTHER',
        tone: 'line',
        outcomes: [
          { k: 'BB', label: 'Walk', type: 'walk' },
          { k: 'E', label: 'Reached on error', type: 'hit', n: 1 },
        ],
      },
    ],
  },
  softball: {
    name: 'Softball',
    groups: [
      {
        label: 'ON BASE',
        tone: 'teal',
        outcomes: [
          { k: '1B', label: 'Single', type: 'hit', n: 1 },
          { k: '2B', label: 'Double', type: 'hit', n: 2 },
          { k: '3B', label: 'Triple', type: 'hit', n: 3 },
          { k: 'HR', label: 'Home run', type: 'hit', n: 4 },
          { k: 'B1', label: 'Bunt single', type: 'hit', n: 1 },
        ],
      },
      {
        label: 'OUTS',
        tone: 'slate',
        outcomes: [
          { k: 'G3', label: 'Ground out', type: 'out', mode: 'fly' },
          { k: 'F8', label: 'Fly out', type: 'out', mode: 'fly' },
          { k: 'L6', label: 'Line out', type: 'out', mode: 'fly' },
          { k: 'K', label: 'Strikeout', type: 'out', mode: 'fly' },
        ],
      },
      {
        label: 'OTHER',
        tone: 'line',
        outcomes: [
          { k: 'BB', label: 'Walk', type: 'walk' },
          { k: 'HBP', label: 'Hit by pitch', type: 'walk' },
          { k: 'SF', label: 'Sac fly', type: 'out', mode: 'sac' },
        ],
      },
    ],
  },
};

export const POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'LCF', 'RCF', 'RF'];

export const ROSTER = [
  { id: 0, name: 'Maya Ortiz',     num: 7,  pos: 'C',   avg: '.520', obp: '.581', slg: '.667', ops: '1.248', r: 14, rbi: 9,  bb: 6, k: 2, c: '#0E7490' },
  { id: 1, name: 'Deon Wallace',   num: 23, pos: 'P',   avg: '.483', obp: '.531', slg: '.724', ops: '1.255', r: 11, rbi: 15, bb: 4, k: 3, c: '#123D63' },
  { id: 2, name: 'Priya Shah',     num: 4,  pos: 'SS',  avg: '.455', obp: '.538', slg: '.545', ops: '1.083', r: 16, rbi: 7,  bb: 8, k: 1, c: '#FF6B4A' },
  { id: 3, name: 'Cole Bennett',   num: 11, pos: '1B',  avg: '.441', obp: '.472', slg: '.618', ops: '1.090', r: 9,  rbi: 12, bb: 3, k: 4, c: '#3D5A73' },
  { id: 4, name: 'Ana Fuentes',    num: 9,  pos: 'LF',  avg: '.430', obp: '.489', slg: '.535', ops: '1.024', r: 12, rbi: 8,  bb: 5, k: 2, c: '#0E7490' },
  { id: 5, name: 'Jordan Lee',     num: 2,  pos: '2B',  avg: '.412', obp: '.444', slg: '.500', ops: '.944',  r: 8,  rbi: 6,  bb: 2, k: 5, c: '#123D63' },
  { id: 6, name: 'Sam Whitfield',  num: 30, pos: 'LCF', avg: '.398', obp: '.430', slg: '.494', ops: '.924',  r: 7,  rbi: 10, bb: 3, k: 6, c: '#FF6B4A' },
  { id: 7, name: 'Tess Nakamura',  num: 5,  pos: '3B',  avg: '.371', obp: '.412', slg: '.429', ops: '.841',  r: 6,  rbi: 5,  bb: 4, k: 3, c: '#3D5A73' },
  { id: 8, name: 'Ray Delgado',    num: 17, pos: 'RCF', avg: '.344', obp: '.375', slg: '.406', ops: '.781',  r: 5,  rbi: 4,  bb: 2, k: 7, c: '#0E7490' },
  { id: 9, name: 'Nia Thompson',   num: 21, pos: 'RF',  avg: '.318', obp: '.360', slg: '.386', ops: '.746',  r: 4,  rbi: 3,  bb: 2, k: 5, c: '#123D63' },
];

export const AWAY_NAMES = [
  'R. Chen', 'D. Okafor', 'S. Patel', 'J. Kim', 'T. Alvarez',
  'M. Ross', 'L. Nguyen', 'A. Brooks', 'C. Diaz',
];

export const HOME_TEAM = 'Grass Stains';
export const AWAY_TEAM = 'Rubber Chickens';

/**
 * Records from before the app started keeping the book. Standings are the sum
 * of this and the tallied game history — nothing is ever overwritten.
 *
 * These values are the design's opening table minus the results in
 * SEED_HISTORY, so a fresh install still shows Grass Stains at 7-2.
 */
export const SEASON_BASELINE = [
  { name: HOME_TEAM, w: 4, l: 1 },
  { name: AWAY_TEAM, w: 6, l: 2 },
  { name: 'Dirt Merchants', w: 5, l: 3 },
  { name: 'Sunday Scaries', w: 3, l: 5 },
  { name: 'The Ringers', w: 1, l: 7 },
];

/** Everyone we can be scheduled against. */
export const OPPONENTS = SEASON_BASELINE.map((t) => t.name).filter((n) => n !== HOME_TEAM);

export const INITIAL_STATE = {
  screen: 'league',
  sport: 'kickball',
  opponent: AWAY_TEAM,
  history: SEED_HISTORY,
  gameActive: false,
  gameFinal: false,
  liveTab: 'entry',
  trackMode: 'both',
  statsTeam: 'home',
  statSet: 0,
  half: 'top',
  inning: 1,
  outs: 0,
  bases: [null, null, null],
  score: { home: 0, away: 0 },
  kiHome: 0,
  kiAway: 0,
  lineup: [0, 1, 2, 3, 4, 5, 6, 7],
  bench: [8, 9],
  posOverride: {},
  gameStats: {},
  events: [],
  bookOff: null,
  posMenu: null,
  opponentPicker: false,
  undoStack: [],
  lastPlay: null,
  tape: [],
  selRunner: null,
  playerId: 0,
  playerFrom: 'team',
  scanType: 'scorecard',
  confirmFinal: false,
  synced: true,
  toast: null,
};
