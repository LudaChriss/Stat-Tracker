// Guards the mapping against the real database column set.
//
// Regression: seasonMapping originally carried the client-side identifiers on
// row objects as extra fields that were NOT columns. Every in-memory round-trip
// test passed, but a real insert drops unknown fields — and reading the season
// back produced null roster ids and null box-score pids, detaching every
// historical stat line from the player it belonged to.
//
// This suite reads the actual columns out of the migrations and round-trips
// through only those, so the mapping can never again depend on fields the
// database will not keep.

import { readFileSync, readdirSync } from 'node:fs';
import { seasonToRows, rowsToSeason } from '../src/data/seasonMapping.js';
import { INITIAL_STATE } from '../src/data/league.js';
import { SEEDED } from './fixtures-history.js';

let fail = 0;
const eq = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`FAIL ${l}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log('ok   ' + l);
};

// --- real columns, straight from the migrations -----------------------------
const dir = new URL('../supabase/migrations/', import.meta.url).pathname;
const sql = readdirSync(dir).sort().map((f) => readFileSync(dir + f, 'utf8')).join('\n');

const columnsOf = (table) => {
  const created = new RegExp(`create table public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i').exec(sql);
  const cols = created ? [...created[1].matchAll(/^\s{2}([a-z_]+)\s+/gm)].map((m) => m[1]) : [];
  // later ALTER ... ADD COLUMN statements count too
  for (const m of sql.matchAll(new RegExp(`alter table public\\.${table} add column (?:if not exists )?([a-z_]+)`, 'gi'))) {
    cols.push(m[1]);
  }
  return cols;
};

const COLS = {
  players: columnsOf('players'),
  teams: columnsOf('teams'),
  games: columnsOf('games'),
  game_lines: columnsOf('game_lines'),
};

eq('migrations parsed: players has columns', COLS.players.length > 5, true);
eq('migrations parsed: game_lines has columns', COLS.game_lines.length > 8, true);

const season = SEEDED(INITIAL_STATE);
const rows = seasonToRows(season, { myTeamId: 'team-uuid-1' });

// --- every emitted field must be a real column -------------------------------
const extras = (table, row) => Object.keys(row).filter((k) => k !== 'players' && !COLS[table].includes(k));
eq('players rows contain only real columns', extras('players', rows.players[0]), []);
eq('teams rows contain only real columns', extras('teams', rows.opponentTeams[0]), []);
eq('games rows contain only real columns', extras('games', rows.games[0]), []);
eq('game_lines rows contain only real columns', extras('game_lines', rows.gameLines[0]), []);

// --- round trip through ONLY the real columns --------------------------------
const keep = (table, list) =>
  list.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => COLS[table].includes(k))));

const throughDb = {
  team: rows.team,
  players: keep('players', rows.players),
  opponentTeams: rows.opponentTeams.map((t) => ({
    ...Object.fromEntries(Object.entries(t).filter(([k]) => COLS.teams.includes(k))),
    players: keep('players', t.players || []),
  })),
  games: keep('games', rows.games),
  gameLines: keep('game_lines', rows.gameLines),
};

const back = rowsToSeason(throughDb, INITIAL_STATE);

eq('roster ids survive the database', back.roster.map((p) => p.id), season.roster.map((p) => p.id));
eq('roster names survive', back.roster.map((p) => p.name), season.roster.map((p) => p.name));
eq('opponent team slugs survive', back.teams.map((t) => t.id), season.teams.map((t) => t.id));
eq('game count survives', back.history.length, season.history.length);
eq('game ids survive', back.history.map((g) => g.id), season.history.map((g) => g.id));
eq('opponent ids survive', back.history.map((g) => g.opponentId), season.history.map((g) => g.opponentId));

// The pids are the load-bearing part: stats, standings and box scores key off them.
for (let i = 0; i < season.history.length; i++) {
  eq(`game ${i + 1}: box-score pids survive`,
     back.history[i].lines.map((l) => l.pid),
     season.history[i].lines.map((l) => l.pid));
}
eq('no null pids anywhere', back.history.flatMap((g) => g.lines).filter((l) => l.pid == null).length, 0);

// Stats derived from the restored season must match the original exactly.
const { seasonTotals } = await import('../src/game/stats.js');
const { tallyStandings } = await import('../src/game/standings.js');
for (const pid of ['h0', 'h1', 'h2']) {
  eq(`derived season stats match for ${pid}`,
     seasonTotals(back.history, pid).avg,
     seasonTotals(season.history, pid).avg);
}
const rebuilt = { ...season, ...back };
eq('standings match after a database round trip',
   tallyStandings(rebuilt).map((t) => [t.name, t.w, t.l]),
   tallyStandings(season).map((t) => [t.name, t.w, t.l]));

// Manual record offsets are part of the team row, not derived.
eq('manual record offsets survive', back.myTeam, season.myTeam);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
