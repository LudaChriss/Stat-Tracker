// Games already played this season, before the app was keeping the book.
//
// These seed the seasons's history so the standings, the team's game list and
// the player game logs all have something real to derive from on a fresh
// install. Maya Ortiz's lines match the figures shown in the source design.
//
// Every line is internally consistent: the runs across a team's lines sum to
// that team's score in the game.

import { homePid } from '../src/data/ids.js';

// d/t/hr break the hit total down so slugging can be derived; k is strikeouts.
const line = (id, name, ab, h, r, rbi, bb = 0, { d = 0, t = 0, hr = 0, k = 0 } = {}) => ({
  pid: homePid(id),
  name,
  team: 'home',
  ab,
  h,
  r,
  rbi,
  bb,
  d,
  t,
  hr,
  k,
});

export const SEED_HISTORY = [
  {
    id: 'g-seed-0809',
    date: '2026-08-09',
    label: 'Aug 9',
    opponentId: 'rubber-chickens',
    opponent: 'Rubber Chickens',
    home: true,
    score: { us: 8, them: 7 },
    result: 'W',
    sport: 'kickball',
    innings: 7,
    lines: [
      line(0, 'Maya Ortiz', 4, 2, 1, 0, 0, { d: 1 }),
      line(1, 'Deon Wallace', 4, 2, 1, 2, 0, { hr: 1 }),
      line(2, 'Priya Shah', 4, 2, 2, 1, 0, { d: 1 }),
      line(3, 'Cole Bennett', 4, 1, 1, 2),
      line(4, 'Ana Fuentes', 4, 2, 1, 1),
      line(5, 'Jordan Lee', 3, 1, 1, 1),
      line(6, 'Sam Whitfield', 3, 1, 1, 1),
      line(7, 'Tess Nakamura', 3, 0, 0, 0),
    ],
  },
  {
    id: 'g-seed-0816',
    date: '2026-08-16',
    label: 'Aug 16',
    opponentId: 'sunday-scaries',
    opponent: 'Sunday Scaries',
    home: true,
    score: { us: 11, them: 6 },
    result: 'W',
    sport: 'kickball',
    innings: 7,
    lines: [
      line(0, 'Maya Ortiz', 3, 2, 2, 2, 0, { d: 1 }),
      line(1, 'Deon Wallace', 4, 3, 2, 3, 0, { d: 1, hr: 1 }),
      line(2, 'Priya Shah', 4, 2, 2, 1),
      line(3, 'Cole Bennett', 4, 2, 1, 2),
      line(4, 'Ana Fuentes', 4, 2, 1, 1),
      line(5, 'Jordan Lee', 3, 1, 1, 1),
      line(6, 'Sam Whitfield', 3, 1, 1, 0),
      line(7, 'Tess Nakamura', 3, 1, 1, 1),
    ],
  },
  {
    id: 'g-seed-0823',
    date: '2026-08-23',
    label: 'Aug 23',
    opponentId: 'the-ringers',
    opponent: 'The Ringers',
    home: false,
    score: { us: 3, them: 5 },
    result: 'L',
    sport: 'kickball',
    innings: 7,
    lines: [
      line(0, 'Maya Ortiz', 3, 1, 0, 1),
      line(1, 'Deon Wallace', 3, 1, 1, 0),
      line(2, 'Priya Shah', 3, 1, 1, 1),
      line(3, 'Cole Bennett', 3, 0, 0, 0, 0, { k: 1 }),
      line(4, 'Ana Fuentes', 3, 1, 1, 0),
      line(5, 'Jordan Lee', 3, 0, 0, 0, 0, { k: 2 }),
      line(6, 'Sam Whitfield', 2, 0, 0, 0, 1),
      line(7, 'Tess Nakamura', 2, 1, 0, 1),
    ],
  },
  {
    id: 'g-seed-0830',
    date: '2026-08-30',
    label: 'Aug 30',
    opponentId: 'dirt-merchants',
    opponent: 'Dirt Merchants',
    home: true,
    score: { us: 9, them: 4 },
    result: 'W',
    sport: 'kickball',
    innings: 7,
    lines: [
      line(0, 'Maya Ortiz', 4, 3, 2, 1, 0, { d: 1, hr: 1 }),
      line(1, 'Deon Wallace', 4, 2, 1, 2),
      line(2, 'Priya Shah', 4, 2, 2, 1),
      line(3, 'Cole Bennett', 4, 1, 0, 2),
      line(4, 'Ana Fuentes', 3, 1, 1, 1, 1),
      line(5, 'Jordan Lee', 3, 1, 1, 0),
      line(6, 'Sam Whitfield', 3, 1, 1, 1),
      line(7, 'Tess Nakamura', 3, 0, 1, 1),
    ],
  },
];

// ---------------------------------------------------------------------------
// Test fixtures only. The app itself ships with no data — this is the demo
// season the suites exercise the engine against.
// ---------------------------------------------------------------------------

export const HOME_TEAM = 'Grass Stains';

export const FIXTURE_ROSTER = [
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

export const FIXTURE_TEAMS = [
  { id: 'rubber-chickens', name: 'Rubber Chickens', priorW: 6, priorL: 2, players: [] },
  { id: 'dirt-merchants', name: 'Dirt Merchants', priorW: 5, priorL: 3, players: [] },
  { id: 'sunday-scaries', name: 'Sunday Scaries', priorW: 3, priorL: 5, players: [] },
  { id: 'the-ringers', name: 'The Ringers', priorW: 1, priorL: 7, players: [] },
];

/** Wrap the app's blank INITIAL_STATE in the demo season. */
export const SEEDED = (blank) => ({
  ...blank,
  myTeam: { name: HOME_TEAM, priorW: 4, priorL: 1, priorT: 0 },
  roster: FIXTURE_ROSTER,
  teams: FIXTURE_TEAMS,
  opponentId: 'rubber-chickens',
  history: SEED_HISTORY,
  lineup: [0, 1, 2, 3, 4, 5, 6, 7],
  bench: [8, 9],
});
