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

// Identity only — every rate and counting stat is derived from the game
// history in stats.js, so a player's season line is always the sum of the
// games they actually played.
export const SEED_ROSTER = [
  { id: 0, name: 'Maya Ortiz',    num: 7,  pos: 'C',   c: '#0E7490' },
  { id: 1, name: 'Deon Wallace',  num: 23, pos: 'P',   c: '#123D63' },
  { id: 2, name: 'Priya Shah',    num: 4,  pos: 'SS',  c: '#FF6B4A' },
  { id: 3, name: 'Cole Bennett',  num: 11, pos: '1B',  c: '#3D5A73' },
  { id: 4, name: 'Ana Fuentes',   num: 9,  pos: 'LF',  c: '#0E7490' },
  { id: 5, name: 'Jordan Lee',    num: 2,  pos: '2B',  c: '#123D63' },
  { id: 6, name: 'Sam Whitfield', num: 30, pos: 'LCF', c: '#FF6B4A' },
  { id: 7, name: 'Tess Nakamura', num: 5,  pos: '3B',  c: '#3D5A73' },
  { id: 8, name: 'Ray Delgado',   num: 17, pos: 'RCF', c: '#0E7490' },
  { id: 9, name: 'Nia Thompson',  num: 21, pos: 'RF',  c: '#123D63' },
];


/** Our team. priorW/priorL are games played before the app kept the book. */
export const SEED_MY_TEAM = { name: 'Grass Stains', priorW: 4, priorL: 1 };

/**
 * Opposing teams. A team needs only a name; `players` is optional and stays
 * empty until you care about tracking that team's individual stats.
 */
export const SEED_TEAMS = [
  { id: 'rubber-chickens', name: 'Rubber Chickens', priorW: 6, priorL: 2, players: [] },
  { id: 'dirt-merchants', name: 'Dirt Merchants', priorW: 5, priorL: 3, players: [] },
  { id: 'sunday-scaries', name: 'Sunday Scaries', priorW: 3, priorL: 5, players: [] },
  { id: 'the-ringers', name: 'The Ringers', priorW: 1, priorL: 7, players: [] },
];

/** Assigned round-robin to new players so avatars stay visually distinct. */
export const PLAYER_COLORS = ['#0E7490', '#123D63', '#FF6B4A', '#3D5A73'];

/** Batting slots shown for an opponent with no roster entered. */
export const ANON_LINEUP_SIZE = 9;

export const INITIAL_STATE = {
  screen: 'league',
  sport: 'kickball',
  myTeam: SEED_MY_TEAM,
  roster: SEED_ROSTER,
  teams: SEED_TEAMS,
  opponentId: 'rubber-chickens',
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
  playerEditor: null,
  teamEditor: null,
  editTeamId: null,
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
