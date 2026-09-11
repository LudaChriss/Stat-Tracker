// Pure, dependency-free translation between the client's in-memory season
// state (the shape described by INITIAL_STATE in ./league.js) and the row
// shapes of the Supabase schema (supabase/migrations/20260101000000_initial_schema.sql).
//
// No network code and no @supabase/supabase-js import, on purpose: this
// file only ever transforms plain objects, so the whole thing is testable
// with nothing but node (see test/mapping-check.mjs).
//
// ---------------------------------------------------------------------------
// ID translation
//
// The client keys roster players by small integers and opposing teams by
// human string slugs (see ./ids.js); the database keys everything by uuid.
// Two things bridge the two sides:
//
//  1. `client_id` (on players/teams rows) and `client_pid` (on game_lines
//     rows) -- extra fields this module attaches to the plain row objects
//     it returns, carrying the *original* client-side id verbatim. They
//     are NOT schema columns -- the migration has no such column -- so a
//     real write path (elsewhere, talking to Supabase) must strip them
//     before an insert/upsert.
//
//     The alternative sketched in the slice brief was a separate id-map
//     object threaded independently alongside the rows. That was rejected
//     here: a second object is one more thing a caller can lose, cache
//     past its expiry, or apply against the wrong season. More importantly
//     it can't survive the case this schema explicitly designs for --
//     player_id/team_id foreign keys going null after a roster edit or a
//     deleted opponent (ON DELETE SET NULL, see the players/game_lines
//     table comments) -- because a map keyed by "the uuid the FK used to
//     point to" is useless once that FK is gone. Carrying the client id on
//     the row itself keeps it inseparable from the row it describes, so a
//     pid like 'h3' or 'o:rc:2' reconstructs exactly even for a game whose
//     roster has since been edited into a different shape.
//
//  2. `games.client_id` / `games.client_opponent_id` -- same idea, for the
//     history record's own id (never a valid uuid -- e.g. 'g-seed-0809' or
//     'g-1699999999999') and for `opponentId`, so a game against a
//     since-deleted opponent team still round-trips losslessly.
//
// The uuid-*shaped* `id` values this module invents for new team/player/
// game/game_line rows (see `fakeUuid` below) are generated deterministically
// from the client id -- no crypto import, no randomness, same input always
// produces the same output. That is what keeps this module pure and lets a
// round trip through just these two functions be exercised with no database
// and no server round trip. A real insert is free to ignore them and use
// whatever id Postgres actually assigns; nothing in `rowsToSeason` assumes
// these particular strings survived a real write -- it only ever reads back
// whatever `id` ends up on the row.
//
// ---------------------------------------------------------------------------
// Box-score line ↔ game_lines row
//
// A client box-score line's `team` field ('home' | 'away') always means
// "our lineup" vs "the opponent's lineup" (see game/logic.js buildGameRecord
// -- our lineup is unconditionally tagged 'home', the opponent's
// unconditionally 'away', regardless of which physical team the history
// record's own `home` flag says we were).
//
// game_lines.home_away means something different: which side of THE GAME the
// line belongs to. The two coincide for a home game and invert for an away
// one, so this module converts between them in both directions.
//
// Mapping the client's string straight onto the column is tempting — it makes
// the transform trivially bijective — but it is wrong twice over: it disagrees
// with the server-side importer, which writes the column correctly, and it
// makes a game unreadable from the opponent's side, which multi-team views
// need. A round trip that only has to agree with itself will not catch it.
// ---------------------------------------------------------------------------

import { isHomePid, isOppPid, parseOppPid } from './ids.js';

// -- deterministic fake uuid -------------------------------------------------

function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A valid-shaped (but not random, not RFC-unique) uuid, deterministic in `seed`. */
function fakeUuid(namespace, seed) {
  const key = `${namespace}:${seed}`;
  const hex = [0, 1, 2, 3].map((i) => hash32(`${key}#${i}`).toString(16).padStart(8, '0')).join('');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}` +
    `-8${hex.slice(16, 19)}-${hex.slice(19, 31)}`
  );
}

const sortByOrder = (arr) => [...arr].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

// ---------------------------------------------------------------------------
// seasonToRows
// ---------------------------------------------------------------------------

/**
 * The same result seen from the other dugout. A tie is a tie either way.
 *
 * Needed because a game row records its result from the HOME team's point of
 * view — a game belongs to two teams, so "W" has to mean something absolute —
 * while the client records it from its own.
 */
const flipResult = (r) => (r === 'W' ? 'L' : r === 'L' ? 'W' : r);

/**
 * Flatten a client season slice into the row shapes the `teams` / `players` /
 * `games` / `game_lines` tables expect.
 *
 * @param {object} state - a season state (or slice of one): { myTeam, roster, teams, history }.
 * @param {{myTeamId?: string, leagueId?: string|null}} opts
 *   `myTeamId` is the uuid of the caller's own `teams` row -- the client
 *   state has no id of its own for "my team", so the caller (who owns the
 *   actual persisted row) must supply it. If omitted, one is synthesized
 *   deterministically, which is only meant to keep this function usable
 *   stand-alone (e.g. in tests) -- a real caller creating a brand new team
 *   should mint a real uuid itself and pass it in.
 */
export function seasonToRows(state, { myTeamId, leagueId = null } = {}) {
  const s = state || {};

  const myTeam = s.myTeam || { name: '', priorW: 0, priorL: 0, priorT: 0 };
  const roster = s.roster || [];
  const oppTeams = s.teams || [];
  const history = s.history || [];

  const resolvedMyTeamId = myTeamId || fakeUuid('team', '__me__');

  const team = {
    id: resolvedMyTeamId,
    league_id: leagueId,
    name: myTeam.name,
    prior_w: myTeam.priorW || 0,
    prior_l: myTeam.priorL || 0,
    prior_t: myTeam.priorT || 0,
  };

  const players = [];
  const playerUuidByClientId = new Map(); // home roster: int id -> uuid

  roster.forEach((p, i) => {
    const id = fakeUuid('player', `home:${p.id}`);
    playerUuidByClientId.set(p.id, id);
    players.push({
      id,
      team_id: resolvedMyTeamId,
      name: p.name,
      number: p.num,
      position: p.pos,
      color: p.c,
      sort_order: i,
      client_id: p.id,
    });
  });

  const teamUuidByClientId = new Map(); // opponent slug -> uuid
  const oppPlayerUuidByKey = new Map(); // "slug:int" -> uuid

  const opponentTeams = oppTeams.map((t) => {
    const id = fakeUuid('team', t.id);
    teamUuidByClientId.set(t.id, id);

    (t.players || []).forEach((p, i) => {
      const pid = fakeUuid('player', `${t.id}:${p.id}`);
      oppPlayerUuidByKey.set(`${t.id}:${p.id}`, pid);
      players.push({
        id: pid,
        team_id: id,
        name: p.name,
        number: p.num,
        position: p.pos,
        color: p.c,
        sort_order: i,
        client_id: p.id,
      });
    });

    return {
      id,
      league_id: leagueId,
      name: t.name,
      prior_w: t.priorW || 0,
      prior_l: t.priorL || 0,
      // Opposing teams carry no priorT on the client (see rowsToSeason) --
      // the column still needs a value, so it defaults to 0.
      prior_t: t.priorT || 0,
      client_id: t.id,
    };
  });

  const games = [];
  const gameLines = [];

  history.forEach((h) => {
    const weAreHome = !!h.home;
    const oppUuid = teamUuidByClientId.get(h.opponentId) ?? null;
    const gameId = fakeUuid('game', h.id);

    games.push({
      id: gameId,
      league_id: leagueId,
      home_team_id: weAreHome ? resolvedMyTeamId : oppUuid,
      away_team_id: weAreHome ? oppUuid : resolvedMyTeamId,
      home_team_name_snapshot: weAreHome ? myTeam.name : h.opponent,
      away_team_name_snapshot: weAreHome ? h.opponent : myTeam.name,
      label: h.label,
      scheduled_at: `${h.date}T00:00:00.000Z`,
      status: 'final',
      sport: h.sport,
      innings: h.innings,
      home_score: weAreHome ? h.score.us : h.score.them,
      away_score: weAreHome ? h.score.them : h.score.us,
      // The row records the result from the HOME team's point of view, because
      // a game belongs to two teams and "W" has to mean something absolute.
      // The client records it from its own, so an away game flips.
      result: weAreHome ? h.result : flipResult(h.result),
      // Extra, non-column fields -- see the file header.
      client_id: h.id,
      client_opponent_id: h.opponentId,
    });

    (h.lines || []).forEach((l) => {
      let teamId = null;
      let playerId = null;

      if (isHomePid(l.pid)) {
        teamId = resolvedMyTeamId;
        playerId = playerUuidByClientId.get(Number(l.pid.slice(1))) ?? null;
      } else if (isOppPid(l.pid)) {
        const { teamId: slug, playerId: pnum } = parseOppPid(l.pid);
        teamId = teamUuidByClientId.get(slug) ?? null;
        playerId = oppPlayerUuidByKey.get(`${slug}:${pnum}`) ?? null;
      } else {
        // Anonymous away batter ('a<slot>') -- belongs to the opponent as
        // a team, but there is no individual roster row for them.
        teamId = oppUuid;
      }

      gameLines.push({
        id: fakeUuid('line', `${h.id}:${l.pid}`),
        game_id: gameId,
        team_id: teamId,
        player_id: playerId,
        name_snapshot: l.name,
        // The client's `team` means OUR side vs theirs; the column means the
        // game's home side. On an away game our own players are the away team,
        // and copying the field through would file them as the home side —
        // which the server-side importer, writing the same column correctly,
        // would then disagree with.
        home_away: (l.team === 'home') === weAreHome ? 'home' : 'away',
        ab: l.ab || 0,
        h: l.h || 0,
        r: l.r || 0,
        rbi: l.rbi || 0,
        bb: l.bb || 0,
        k: l.k || 0,
        d: l.d || 0,
        t: l.t || 0,
        hr: l.hr || 0,
        // Extra, non-column field -- see the file header.
        client_pid: l.pid,
      });
    });
  });

  return { team, players, opponentTeams, games, gameLines };
}

// ---------------------------------------------------------------------------
// rowsToSeason
// ---------------------------------------------------------------------------

/**
 * Rebuild the client season slice from DB rows.
 *
 * @param {{team?: object, players?: object[], opponentTeams?: object[], games?: object[], gameLines?: object[]}} rows
 * @param {{myTeamId?: string, myTeam?: object}} defaults
 *   Fallbacks used when `rows.team` is absent (e.g. a brand new/empty
 *   season). `defaults.myTeamId` lets a caller identify "my team" even when
 *   the `team` row itself wasn't fetched.
 * @returns {{myTeam: object, roster: object[], teams: object[], history: object[]}}
 *   suitable for spreading over INITIAL_STATE.
 */
export function rowsToSeason(rows, defaults = {}) {
  const { team, players = [], opponentTeams = [], games = [], gameLines = [] } = rows || {};

  const myTeamId = (team && team.id) || defaults.myTeamId || null;

  const myTeam = team
    ? { name: team.name, priorW: team.prior_w, priorL: team.prior_l, priorT: team.prior_t }
    : defaults.myTeam || { name: '', priorW: 0, priorL: 0, priorT: 0 };

  const playersByTeam = new Map();
  players.forEach((p) => {
    if (!playersByTeam.has(p.team_id)) playersByTeam.set(p.team_id, []);
    playersByTeam.get(p.team_id).push(p);
  });

  const toClientPlayer = (p) => ({ id: p.client_id, name: p.name, num: p.number, pos: p.position, c: p.color });

  const myPlayers = myTeamId ? sortByOrder(playersByTeam.get(myTeamId) || []) : [];
  const roster = myPlayers.map(toClientPlayer);

  // The batting order, if the account has one.
  //
  // Omitted entirely — not returned empty — when no player carries a place.
  // A season saved before the order was shared has none, and an absent order
  // is not an empty one: returning [] would spread over whatever order the
  // phone already had and leave nobody batting. The caller spreads this object
  // over its own state, so a missing key is the only way to say "no opinion".
  const ordered = myPlayers.filter((p) => p.lineup_order != null);
  const lineupSlice = {};
  if (ordered.length) {
    lineupSlice.lineup = ordered
      .slice()
      .sort((a, b) => a.lineup_order - b.lineup_order)
      .map((p) => p.client_id);
    lineupSlice.bench = myPlayers
      .filter((p) => p.lineup_order == null || p.on_bench)
      .map((p) => p.client_id)
      .filter((id) => !lineupSlice.lineup.includes(id));
  }

  const teams = opponentTeams.map((t) => ({
    id: t.client_id,
    name: t.name,
    priorW: t.prior_w,
    priorL: t.prior_l,
    // No priorT here -- opposing teams never carried one on the client
    // side (see seasonToRows); re-adding it would break the round trip.
    players: sortByOrder(playersByTeam.get(t.id) || []).map(toClientPlayer),
  }));

  const linesByGame = new Map();
  gameLines.forEach((gl) => {
    if (!linesByGame.has(gl.game_id)) linesByGame.set(gl.game_id, []);
    linesByGame.get(gl.game_id).push(gl);
  });

  // History is finished games only. Since slice 3a a games row exists from the
  // first pitch, so an unfiltered map would file a game that is still being
  // played -- and one that was cancelled -- as a completed 0-0 result and move
  // the standings with it. A row with no status at all is treated as final:
  // that is every row written before this column mattered.
  const finished = games.filter((g) => !g.status || g.status === 'final');

  const history = finished.map((g) => {
    const home = myTeamId != null && g.home_team_id === myTeamId;
    const opponent = home ? g.away_team_name_snapshot : g.home_team_name_snapshot;
    const score = home ? { us: g.home_score, them: g.away_score } : { us: g.away_score, them: g.home_score };

    const lines = (linesByGame.get(g.id) || []).map((gl) => ({
      pid: gl.client_pid,
      name: gl.name_snapshot,
      // home_away is relative to the GAME; the client's `team` is relative to
      // US. On an away game our own players carry home_away 'away', and
      // copying it straight through would file them as the opposition.
      team: (gl.home_away === 'home') === home ? 'home' : 'away',
      ab: gl.ab,
      h: gl.h,
      r: gl.r,
      rbi: gl.rbi,
      bb: gl.bb,
      k: gl.k,
      d: gl.d,
      t: gl.t,
      hr: gl.hr,
    }));

    return {
      id: g.client_id,
      opponentId: g.client_opponent_id,
      opponent,
      home,
      date: g.scheduled_at.slice(0, 10),
      label: g.label,
      score,
      // Back from the home team's point of view to ours.
      result: home ? g.result : flipResult(g.result),
      sport: g.sport,
      innings: g.innings,
      lines,
    };
  });

  return { myTeam, roster, teams, history, ...lineupSlice };
}
