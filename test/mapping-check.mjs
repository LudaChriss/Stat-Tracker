// Exercises src/data/seasonMapping.js — the pure client-state <-> DB-row
// translation for slice 1d. Everything here is plain data in, plain data
// out: no localStorage, no network, no supabase client.
//
// Object key order is not meaningful data (nothing in this app or in
// Postgres cares about JS property insertion order), so `eq` compares a
// key-sorted JSON serialization rather than raw JSON.stringify — that way
// the round-trip checks assert on *values*, not on which of several
// equally-valid key orderings a given fixture literal happened to use.

import { seasonToRows, rowsToSeason } from '../src/data/seasonMapping.js';
import { homePid, awayPid, oppPid } from '../src/data/ids.js';
import { INITIAL_STATE } from '../src/data/league.js';
import { SEEDED } from './fixtures-history.js';

let fail = 0;

function canon(x) {
  if (Array.isArray(x)) return x.map(canon);
  if (x && typeof x === 'object') {
    return Object.keys(x)
      .sort()
      .reduce((o, k) => {
        o[k] = canon(x[k]);
        return o;
      }, {});
  }
  return x;
}

const eq = (l, got, want) => {
  const g = JSON.stringify(canon(got));
  const w = JSON.stringify(canon(want));
  const ok = g === w;
  if (!ok) {
    fail++;
    console.log(`FAIL ${l}\n  got  ${g}\n  want ${w}`);
  } else {
    console.log('ok   ' + l);
  }
};

// ---------------------------------------------------------------------------
// 1. Full round trip of the seeded demo season.
//
// SEEDED()'s myTeam literal omits priorT entirely (it replaces
// INITIAL_STATE.myTeam wholesale rather than spreading it), but the
// authoritative client shape always carries one — normalize it the same way
// a real caller reading INITIAL_STATE-shaped state would, then round-trip
// *that*.
// ---------------------------------------------------------------------------

const seededRaw = SEEDED(INITIAL_STATE);
const seeded = { ...seededRaw, myTeam: { ...seededRaw.myTeam, priorT: seededRaw.myTeam.priorT || 0 } };

const MY_TEAM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const seededRows = seasonToRows(seeded, { myTeamId: MY_TEAM_ID, leagueId: null });
const seededBack = rowsToSeason(seededRows, { myTeamId: seededRows.team.id });

eq('seeded: myTeam round-trips exactly', seededBack.myTeam, seeded.myTeam);
eq('seeded: roster round-trips exactly', seededBack.roster, seeded.roster);
eq('seeded: teams round-trips exactly', seededBack.teams, seeded.teams);
eq('seeded: history round-trips exactly', seededBack.history, seeded.history);

// The seed data includes both a home game and an away game (the-ringers) —
// make sure the away one specifically survived, not just averaged out.
const awayGame = seeded.history.find((g) => g.home === false);
const awayGameBack = seededBack.history.find((g) => g.id === awayGame.id);
eq('seeded: away game keeps home=false', awayGameBack.home, false);
eq('seeded: away game score keeps us/them straight', awayGameBack.score, awayGame.score);

// ---------------------------------------------------------------------------
// 2. Empty season.
// ---------------------------------------------------------------------------

const EMPTY_TEAM_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const emptyRows = seasonToRows(INITIAL_STATE, { myTeamId: EMPTY_TEAM_ID });
eq('empty season: no player rows', emptyRows.players, []);
eq('empty season: no opponent team rows', emptyRows.opponentTeams, []);
eq('empty season: no game rows', emptyRows.games, []);
eq('empty season: no game_lines rows', emptyRows.gameLines, []);

const emptyBack = rowsToSeason(emptyRows, { myTeamId: emptyRows.team.id });
eq('empty season: myTeam round-trips', emptyBack.myTeam, INITIAL_STATE.myTeam);
eq('empty season: roster/teams/history round-trip empty', [emptyBack.roster, emptyBack.teams, emptyBack.history], [[], [], []]);

// Nothing fetched at all (e.g. a first-ever load) must not throw either.
let threw = false;
let blank;
try {
  blank = rowsToSeason({});
} catch {
  threw = true;
}
eq('rowsToSeason({}) does not throw', threw, false);
eq('rowsToSeason({}) yields a blank myTeam', blank.myTeam, { name: '', priorW: 0, priorL: 0, priorT: 0 });
eq('rowsToSeason({}) yields empty roster/teams/history', [blank.roster, blank.teams, blank.history], [[], [], []]);

// ---------------------------------------------------------------------------
// 3. Box-score stats, including extra-base hits and strikeouts.
// ---------------------------------------------------------------------------

const statState = {
  myTeam: { name: 'Testers', priorW: 0, priorL: 0, priorT: 0 },
  roster: [{ id: 0, name: 'Xan Diaz', num: 12, pos: 'SS', c: '#abcdef' }],
  teams: [],
  history: [
    {
      id: 'g-stats-1',
      opponentId: 'nobody',
      opponent: 'Nobody FC',
      home: true,
      date: '2026-06-01',
      label: 'Jun 1',
      score: { us: 10, them: 2 },
      result: 'W',
      sport: 'softball',
      innings: 7,
      lines: [
        { pid: homePid(0), name: 'Xan Diaz', team: 'home', ab: 5, h: 3, r: 2, rbi: 4, bb: 1, k: 1, d: 1, t: 1, hr: 1 },
      ],
    },
  ],
};

const statRows = seasonToRows(statState, { myTeamId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' });
const statBack = rowsToSeason(statRows, { myTeamId: statRows.team.id });
const statLine = statBack.history[0].lines[0];

eq('stats: at-bats survive', statLine.ab, 5);
eq('stats: hits survive', statLine.h, 3);
eq('stats: runs survive', statLine.r, 2);
eq('stats: rbi survive', statLine.rbi, 4);
eq('stats: walks survive', statLine.bb, 1);
eq('stats: strikeouts survive', statLine.k, 1);
eq('stats: doubles survive', statLine.d, 1);
eq('stats: triples survive', statLine.t, 1);
eq('stats: home runs survive', statLine.hr, 1);
eq('stats: full line round-trips exactly', statLine, statState.history[0].lines[0]);

// ---------------------------------------------------------------------------
// 4. pid strings survive for all three namespaces.
// ---------------------------------------------------------------------------

const pidState = {
  myTeam: { name: 'Namespace FC', priorW: 0, priorL: 0, priorT: 0 },
  roster: [
    { id: 0, name: 'Alice Home', num: 1, pos: 'C', c: '#111111' },
    { id: 1, name: 'Bob Home', num: 2, pos: 'P', c: '#222222' },
  ],
  teams: [
    {
      id: 'ringers',
      name: 'The Ringers',
      priorW: 1,
      priorL: 2,
      players: [{ id: 0, name: 'Sam Otter', num: 9, pos: 'P', c: '#333333' }],
    },
  ],
  history: [
    {
      id: 'g-pid-1',
      opponentId: 'ringers',
      opponent: 'The Ringers',
      home: true,
      date: '2026-05-01',
      label: 'May 1',
      score: { us: 5, them: 3 },
      result: 'W',
      sport: 'kickball',
      innings: 7,
      lines: [
        { pid: homePid(0), name: 'Alice Home', team: 'home', ab: 4, h: 2, r: 1, rbi: 1, bb: 0, k: 0, d: 1, t: 0, hr: 0 },
        { pid: oppPid('ringers', 0), name: 'Sam Otter', team: 'away', ab: 3, h: 1, r: 0, rbi: 0, bb: 0, k: 1, d: 0, t: 0, hr: 0 },
        { pid: awayPid(2), name: 'Batter 3', team: 'away', ab: 2, h: 0, r: 0, rbi: 0, bb: 1, k: 1, d: 0, t: 0, hr: 0 },
      ],
    },
  ],
};

const pidRows = seasonToRows(pidState, { myTeamId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' });
const pidBack = rowsToSeason(pidRows, { myTeamId: pidRows.team.id });
const pids = pidBack.history[0].lines.map((l) => l.pid);

eq('pid: home namespace survives', pids[0], 'h0');
eq('pid: rostered-opponent namespace survives', pids[1], 'o:ringers:0');
eq('pid: anonymous-away namespace survives', pids[2], 'a2');
eq('pid: all three lines round-trip exactly', pidBack.history[0].lines, pidState.history[0].lines);

// The anonymous line still links to the opponent's team_id (it has no
// individual roster row).
const anonLineRow = pidRows.gameLines.find((l) => l.client_pid === 'a2');
eq('pid: anonymous line keeps opponent team_id FK', anonLineRow.team_id, pidRows.opponentTeams[0].id);
eq('pid: anonymous line has no player_id FK', anonLineRow.player_id, null);

// ---------------------------------------------------------------------------
// 5. Name snapshots are never re-derived from the current roster.
// ---------------------------------------------------------------------------

const nameState = {
  myTeam: { name: 'Renamers', priorW: 0, priorL: 0, priorT: 0 },
  // Current roster: player 0 has since been renamed.
  roster: [{ id: 0, name: 'Alice New Name', num: 1, pos: 'C', c: '#111111' }],
  teams: [],
  history: [
    {
      id: 'g-name-1',
      opponentId: 'x',
      opponent: 'X',
      home: true,
      date: '2026-04-01',
      label: 'Apr 1',
      score: { us: 1, them: 0 },
      result: 'W',
      sport: 'kickball',
      innings: 7,
      lines: [{ pid: homePid(0), name: 'Alice Old Name', team: 'home', ab: 1, h: 1, r: 1, rbi: 0, bb: 0, k: 0, d: 0, t: 0, hr: 0 }],
    },
  ],
};

const nameRows = seasonToRows(nameState, { myTeamId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' });
const nameBack = rowsToSeason(nameRows, { myTeamId: nameRows.team.id });

eq('name: roster shows the current (renamed) name', nameBack.roster[0].name, 'Alice New Name');
eq('name: history line keeps the name as it was at game time', nameBack.history[0].lines[0].name, 'Alice Old Name');

// A player removed from the roster entirely: the line's pid/name must still
// come back exactly, even though there is no roster row left to derive them
// from (the player_id FK legitimately resolves to null, like a real
// ON DELETE SET NULL would leave it).
const removedState = {
  myTeam: { name: 'Removers', priorW: 0, priorL: 0, priorT: 0 },
  roster: [],
  teams: [],
  history: [
    {
      id: 'g-removed-1',
      opponentId: 'x',
      opponent: 'X',
      home: true,
      date: '2026-03-01',
      label: 'Mar 1',
      score: { us: 2, them: 1 },
      result: 'W',
      sport: 'kickball',
      innings: 7,
      lines: [{ pid: homePid(9), name: 'Gone Guy', team: 'home', ab: 2, h: 1, r: 1, rbi: 1, bb: 0, k: 0, d: 0, t: 0, hr: 0 }],
    },
  ],
};

const removedRows = seasonToRows(removedState, { myTeamId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' });
eq('name: removed player leaves a null player_id FK', removedRows.gameLines[0].player_id, null);

const removedBack = rowsToSeason(removedRows, { myTeamId: removedRows.team.id });
eq('name: removed player pid still reconstructs', removedBack.history[0].lines[0].pid, 'h9');
eq('name: removed player name snapshot still reconstructs', removedBack.history[0].lines[0].name, 'Gone Guy');

// ---------------------------------------------------------------------------
// 6. Manual record offsets (priorW/priorL/priorT) survive.
// ---------------------------------------------------------------------------

const recordState = {
  myTeam: { name: 'Offsets FC', priorW: 7, priorL: 3, priorT: 2 },
  roster: [],
  teams: [],
  history: [],
};

const recordRows = seasonToRows(recordState, { myTeamId: '11111111-1111-4111-8111-111111111111' });
eq('record: prior_w column set', recordRows.team.prior_w, 7);
eq('record: prior_l column set', recordRows.team.prior_l, 3);
eq('record: prior_t column set', recordRows.team.prior_t, 2);

const recordBack = rowsToSeason(recordRows, { myTeamId: recordRows.team.id });
eq('record: manual record offsets round-trip exactly', recordBack.myTeam, recordState.myTeam);

// ---------------------------------------------------------------------------
// 7. A game with no opponent lines (opponent stats not tracked) round-trips
// as such, not as an empty-but-present opponent.
// ---------------------------------------------------------------------------

const noOppLinesState = {
  myTeam: { name: 'Solo FC', priorW: 0, priorL: 0, priorT: 0 },
  roster: [{ id: 0, name: 'Solo Player', num: 1, pos: 'P', c: '#000000' }],
  teams: [{ id: 'shadow', name: 'Shadow Team', priorW: 0, priorL: 0, players: [] }],
  history: [
    {
      id: 'g-noaway-1',
      opponentId: 'shadow',
      opponent: 'Shadow Team',
      home: true,
      date: '2026-02-01',
      label: 'Feb 1',
      score: { us: 4, them: 0 },
      result: 'W',
      sport: 'kickball',
      innings: 7,
      lines: [{ pid: homePid(0), name: 'Solo Player', team: 'home', ab: 3, h: 2, r: 2, rbi: 2, bb: 0, k: 0, d: 0, t: 0, hr: 0 }],
    },
  ],
};

const noOppRows = seasonToRows(noOppLinesState, { myTeamId: '22222222-2222-4222-8222-222222222222' });
eq('no-away-lines: no away game_lines rows were created', noOppRows.gameLines.filter((l) => l.home_away === 'away').length, 0);

const noOppBack = rowsToSeason(noOppRows, { myTeamId: noOppRows.team.id });
eq('no-away-lines: reconstructed game has no away lines', noOppBack.history[0].lines.filter((l) => l.team === 'away').length, 0);
eq('no-away-lines: reconstructed game keeps only the tracked line', noOppBack.history[0].lines.length, 1);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
