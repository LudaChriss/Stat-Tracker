// Games already played this season, before the app was keeping the book.
//
// These seed the seasons's history so the standings, the team's game list and
// the player game logs all have something real to derive from on a fresh
// install. Maya Ortiz's lines match the figures shown in the source design.
//
// Every line is internally consistent: the runs across a team's lines sum to
// that team's score in the game.

import { homePid } from './ids.js';

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
