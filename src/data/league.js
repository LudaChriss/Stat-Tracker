
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

/** Assigned round-robin to new players so avatars stay visually distinct. */
export const PLAYER_COLORS = ['#0E7490', '#123D63', '#FF6B4A', '#3D5A73'];

/** Batting slots shown for an opponent with no roster entered. */
export const ANON_LINEUP_SIZE = 9;

export const INITIAL_STATE = {
  screen: 'league',
  sport: 'kickball',
  // Ships empty. An unnamed team triggers first-run setup.
  myTeam: { name: '', priorW: 0, priorL: 0 },
  roster: [],
  teams: [],
  opponentId: null,
  history: [],
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
  lineup: [],
  bench: [],
  posOverride: {},
  gameStats: {},
  events: [],
  bookOff: null,
  posMenu: null,
  opponentPicker: false,
  playerEditor: null,
  teamEditor: null,
  editTeamId: null,
  resetFlow: null,
  importPreview: null,
  importError: null,
  viewGameId: null,
  gameFrom: 'team',
  confirmDeleteGame: null,
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
