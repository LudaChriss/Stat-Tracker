// The backend half of live shared scoring: the games row a log hangs off, the
// appends, the read-back, and the realtime subscription that tells a second
// phone something happened.
//
// Kept out of supabaseRepository.js because it is a different kind of write.
// A season is a snapshot that supersedes the last one and is debounced and
// coalesced accordingly. A play is a fact: it is appended, never coalesced,
// never superseded, and it has to be in the account within seconds rather than
// whenever the debounce fires.
//
// Nothing here decides game state. It moves events and hands them back in the
// server's order; game/events.js is what folds them.

import { now } from '../game/clock.js';
import { UNDOABLE } from '../game/events.js';
import { isStale, toMs } from '../game/liveness.js';

const GAME_ID_KEY = 'score-tracker:liveGameIds';

// How many live games a team's offer looks through. More than one because a
// game nobody finished can sit in front of the one that is actually being
// scored; not unbounded because a list that long is a problem to fix, not to
// page through.
const LIVE_LOOKUP_LIMIT = 10;

/**
 * How recently each game's log moved, and whether anything was ever scored in
 * it — without reading the logs.
 *
 * Two small reads per game: its newest event, and a count of its plays. A game
 * in progress on a league screen or behind a join offer is one or two games,
 * not dozens, and a whole log can be hundreds of rows. Row-level security
 * decides what is readable; a game whose events cannot be read comes back with
 * nulls, which is never called stale.
 *
 * @returns {Promise<Object<string, {lastSeq: number, lastEventAt: number|null, plays: number}>>}
 */
export async function readActivity(client, gameIds) {
  const out = {};
  await Promise.all(
    (gameIds || []).map(async (id) => {
      const [newest, plays] = await Promise.all([
        client.from('game_events').select('seq, created_at').eq('game_id', id).order('seq', { ascending: false }).limit(1),
        client.from('game_events').select('id', { count: 'exact', head: true }).eq('game_id', id).in('kind', [...UNDOABLE]),
      ]);
      const row = !newest.error && newest.data ? newest.data[0] : null;
      out[id] = {
        lastSeq: row ? Number(row.seq) : 0,
        lastEventAt: row ? toMs(row.created_at) : null,
        plays: plays.error ? null : plays.count || 0,
      };
    }),
  );
  return out;
}

/** Remember which backend game a client-side game id resolved to. */
function readIds() {
  try {
    const raw = localStorage.getItem(GAME_ID_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function rememberId(clientId, gameId) {
  try {
    const all = readIds();
    all[clientId] = gameId;
    localStorage.setItem(GAME_ID_KEY, JSON.stringify(all));
  } catch {
    /* best effort: the id is re-resolved by calling start_live_game again,
       which is idempotent, so forgetting it costs one round trip */
  }
}

/** A game_events row as the replay wants it. */
export function toEvent(row) {
  return {
    id: row.id,
    seq: row.seq == null ? null : Number(row.seq),
    kind: row.kind,
    payload: row.payload || {},
    actor: row.actor || null,
    at: row.created_at || null,
    clientEventId: row.client_event_id || null,
  };
}

/**
 * @param {object} client  a supabase-js client
 * @param {object} options
 * @param {() => string|null} options.getTeamId
 */
export function createLiveGames(client, { getTeamId }) {
  // clientId -> backend uuid, for this session. Backed by localStorage so a
  // reload mid-game does not have to re-resolve every game.
  const resolved = new Map(Object.entries(readIds()));

  /**
   * The backend id for a game, creating the row if this is the first event.
   *
   * `start_live_game` is idempotent across authors, so a second scorer's phone
   * calling this lands on the same game rather than starting a private copy.
   */
  async function ensureGame(descriptor) {
    if (!descriptor || !descriptor.clientId) {
      throw new Error('cannot record a play for a game with no id');
    }
    const known = resolved.get(descriptor.clientId);
    if (known) return known;

    const teamId = getTeamId();
    if (!teamId) throw new Error('this device is not signed in to an account yet');

    const { data, error } = await client.rpc('start_live_game', {
      p_team_id: teamId,
      payload: descriptor,
    });
    if (error) throw error;
    if (!data) throw new Error('the account did not return a game to score');

    resolved.set(descriptor.clientId, data);
    rememberId(descriptor.clientId, data);
    return data;
  }

  /**
   * Append one event, now. Called by the write queue's handler, so a failure
   * here is what parks or retries the entry — never swallowed.
   *
   * Returns the server's own answer: the sequence number it assigned, which is
   * the position this play holds for every phone watching.
   */
  async function appendNow({ game, event }) {
    const gameId = await ensureGame(game);
    const { data, error } = await client.rpc('append_game_event', {
      p_game_id: gameId,
      p_client_event_id: event.clientEventId,
      p_kind: event.kind,
      p_payload: event.payload || {},
    });
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    return {
      gameId,
      clientEventId: event.clientEventId,
      seq: row && row.event_seq != null ? Number(row.event_seq) : null,
      id: row ? row.event_id : null,
      at: row ? row.event_created_at : null,
    };
  }

  /** Everything the account has for this game, in server order. */
  async function fetchEvents(gameId, sinceSeq = 0) {
    let q = client.from('game_events').select('*').eq('game_id', gameId).order('seq');
    if (sinceSeq) q = q.gt('seq', sinceSeq);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map(toEvent);
  }

  /**
   * A game still being played that this account can see, for the team it is
   * looking at. This is how a second phone finds the first one's game.
   *
   * Row-level security decides visibility; this asks only for what it is
   * allowed to have.
   */
  async function findLiveGame(teamId) {
    const id = teamId || getTeamId();
    if (!id) return null;
    const { data, error } = await client
      .from('games')
      .select('*')
      .eq('status', 'live')
      .or(`home_team_id.eq.${id},away_team_id.eq.${id}`)
      .order('scheduled_at', { ascending: false })
      .limit(LIVE_LOOKUP_LIMIT);
    if (error) throw error;
    const rows = data || [];
    if (!rows.length) return null;

    // A game somebody walked away from must not hide the one being scored now.
    // The freshest live game wins; a stopped one is only offered when there is
    // nothing else, and is offered AS stopped.
    const activity = await readActivity(client, rows.map((r) => r.id));
    const at = (r) => {
      const a = activity[r.id] || {};
      return a.lastEventAt != null ? a.lastEventAt : toMs(r.updated_at);
    };
    const clock = now();
    const ranked = rows
      .map((r) => ({ r, at: at(r) }))
      .sort((x, y) => (isStale(x.at, clock) - isStale(y.at, clock)) || ((y.at || 0) - (x.at || 0)));
    const row = ranked[0].r;
    const act = activity[row.id] || {};
    resolved.set(row.client_id, row.id);
    rememberId(row.client_id, row.id);
    return {
      gameId: row.id,
      clientId: row.client_id,
      opponentClientId: row.client_opponent_id,
      // The other side's real team id, so a phone joining a league game
      // finalises it against the same team the first phone did rather than
      // against a slug of its own.
      opponentTeamId: row.home_team_id === id ? row.away_team_id : row.home_team_id,
      sport: row.sport,
      label: row.label,
      date: row.scheduled_at,
      home: row.home_team_id === id,
      // What the offer needs to tell a game being scored from one that stopped,
      // and what abandoning it has to say it saw.
      lastActivityAt: ranked[0].at,
      lastSeq: act.lastSeq || 0,
      plays: act.plays == null ? null : act.plays,
    };
  }

  /**
   * End a game that has stopped, on behalf of whoever walked away from it.
   *
   * Not queued: it is a decision about a game this phone is looking at now,
   * against what it saw. If it cannot reach the account, the person is told and
   * the game is left as it was. `seenSeq` is the last play this phone knew of;
   * the account refuses if anything arrived after it.
   */
  async function abandonGame(gameId, seenSeq) {
    const { error } = await client.rpc('abandon_live_game', { p_game_id: gameId, p_seen_seq: seenSeq || 0 });
    if (error) throw error;
  }

  /**
   * Tell me when a play lands, from any phone.
   *
   * The caller is expected to treat this as a nudge rather than as the whole
   * truth: realtime is a live connection over a mobile network and can drop a
   * message or the whole socket without saying so. Everything it delivers is
   * also readable with fetchEvents, which is what the poll alongside it does.
   */
  function subscribe(gameId, onEvent, onStatus) {
    const channel = client
      .channel(`live-game:${gameId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'game_events', filter: `game_id=eq.${gameId}` },
        (message) => {
          try {
            onEvent(toEvent(message.new));
          } catch {
            /* a broken listener must not tear down the channel */
          }
        },
      )
      .subscribe((status) => {
        if (onStatus) onStatus(status);
      });

    return () => {
      try {
        client.removeChannel(channel);
      } catch {
        /* already gone */
      }
    };
  }

  /** Mark a live game abandoned. The events stay; the tombstone is the point. */
  async function cancelGame(gameId) {
    const { error } = await client.rpc('cancel_live_game', { p_game_id: gameId });
    if (error) throw error;
  }

  /** What the account says a game is: scheduled, live, final or cancelled. */
  async function gameStatus(gameId) {
    const { data, error } = await client.from('games').select('status').eq('id', gameId).maybeSingle();
    if (error) throw error;
    return data ? data.status : null;
  }

  /** The backend id for a client-side game id, if this device knows it. */
  function knownId(clientId) {
    return resolved.get(clientId) || null;
  }

  return { ensureGame, appendNow, fetchEvents, findLiveGame, subscribe, cancelGame, abandonGame, gameStatus, knownId };
}
