// Leagues, from the client's side.
//
// The same shape as invites.js and for the same reason: no screen touches a
// Supabase client directly, and every decision that matters — who may mint a
// code, which roles a league code can grant, whether a team is allowed into a
// league at all — is made in the database, not here.
//
// What this module does NOT do is hold the season. A league is a different
// thing from the season on this phone: it has its own teams, its own fixtures,
// and a person can belong to several. Folding it into useGame's state would
// mean the season and the league could disagree about which team you are.

export const LEAGUE_ROLE_LABEL = {
  league_admin: 'Commissioner',
  viewer: 'Follower',
};

export const LEAGUE_ROLE_BLURB = {
  league_admin: 'Runs the league: adds teams, schedules games, invites people.',
  viewer: 'Follows the league. Changes nothing.',
};

/** The roles a league code can grant, in the order a person would consider them. */
export const LEAGUE_INVITABLE_ROLES = ['viewer', 'league_admin'];

export function createLeagues(client, { getUserId = null } = {}) {
  const noBackend = { error: { message: 'No backend is configured on this build.' } };

  return {
    isAvailable: !!client,

    /**
     * The leagues this account belongs to, with the role it holds on each.
     *
     * Read from memberships rather than from leagues: a public league is
     * readable by anybody, so "leagues I can see" is not the same question as
     * "leagues I am in", and only the second one belongs on this screen.
     */
    async mine() {
      if (!client) return { leagues: [], error: null };
      // Scoped to THIS user's rows, explicitly.
      //
      // `memberships_select_own` also admits every membership on a league you
      // administer — which is right, an admin needs to see who is in their
      // league — but it means an unfiltered read returns one row per MEMBER,
      // not one per league. The league then appears once per person in it, with
      // somebody else's role on it. Caught by a duplicate-key warning in a
      // browser harness that requires a silent console.
      let uid = getUserId ? getUserId() : null;
      if (!uid) {
        // Reads what is already on the device; no network round trip.
        const { data: session } = await client.auth.getSession();
        uid = (session && session.session && session.session.user && session.session.user.id) || null;
      }
      // Not knowing who we are is not a reason to answer with somebody else's
      // rows. "Leagues I am in" is unanswerable without an identity, and an
      // empty list is the honest answer.
      if (!uid) return { leagues: [], error: null };

      const { data, error } = await client
        .from('memberships')
        .select('role, league_id, leagues(id, name, sport, visibility)')
        .not('league_id', 'is', null)
        .eq('user_id', uid);
      if (error) return { leagues: [], error };
      const leagues = (data || [])
        .filter((m) => m.leagues)
        .map((m) => ({
          id: m.leagues.id,
          name: m.leagues.name,
          sport: m.leagues.sport,
          visibility: m.leagues.visibility,
          role: m.role,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { leagues, error: null };
    },

    /** Create one. The creator becomes its admin in the same transaction (D7). */
    async create(name, sport = 'kickball') {
      if (!client) return noBackend;
      const { data, error } = await client.rpc('create_league_with_admin', {
        league_name: String(name || '').trim(),
        league_sport: sport,
      });
      return { leagueId: data || null, error: error || null };
    },

    /**
     * One league: its teams and its fixtures.
     *
     * Three round trips rather than a join, for the same reason fetchSeason
     * does it: a failure is attributable, and a partial read is never silently
     * treated as a whole league.
     */
    async detail(leagueId) {
      if (!client) return { error: noBackend.error };
      const [league, teams, games] = await Promise.all([
        client.from('leagues').select('*').eq('id', leagueId).maybeSingle(),
        client.from('teams').select('*').eq('league_id', leagueId).order('name'),
        client.from('games').select('*').eq('league_id', leagueId).order('scheduled_at'),
      ]);
      for (const r of [league, teams, games]) {
        if (r.error) return { error: r.error };
      }
      if (!league.data) return { error: { message: 'That league could not be found.' } };

      // Box-score lines for the games that have actually been played. Asked for
      // separately and only when there are any, because a league with a
      // schedule and no results yet should cost one round trip, not two.
      const finalIds = (games.data || []).filter((g) => g.status === 'final').map((g) => g.id);
      const liveIds = (games.data || []).filter((g) => g.status === 'live').map((g) => g.id);
      let lines = [];
      let starts = [];
      await Promise.all([
        (async () => {
          if (!finalIds.length) return;
          const got = await client.from('game_lines').select('*').in('game_id', finalIds);
          // A failed read of the lines costs the leaders table and nothing else,
          // so it is not worth failing the whole league over.
          if (!got.error) lines = got.data || [];
        })(),
        (async () => {
          // Who is scoring a game in progress: the start event of each, which
          // is readable wherever the game is. Same reasoning as the lines — a
          // failure costs one line of text on a card, not the league.
          if (!liveIds.length) return;
          const got = await client
            .from('game_events')
            .select('game_id, seq, actor, payload')
            .in('game_id', liveIds)
            .eq('kind', 'start')
            .order('seq');
          if (!got.error) starts = got.data || [];
        })(),
      ]);

      return {
        league: league.data,
        teams: teams.data || [],
        games: games.data || [],
        lines,
        scorers: scorersByGame(starts),
        error: null,
      };
    },

    /** Mint a league code. Only a league admin gets past the database. */
    async invite(leagueId, role, days = 7) {
      if (!client) return noBackend;
      const { data, error } = await client.rpc('create_league_invite', {
        p_league_id: leagueId,
        p_role: role,
        p_days: days,
      });
      return { invite: data || null, error: error || null };
    },

    /** Redeem a league code, optionally bringing a team in with it. */
    async join(code, teamId = null) {
      if (!client) return noBackend;
      const { data, error } = await client.rpc('join_league', {
        p_code: normalizeCode(code),
        p_team_id: teamId,
      });
      const row = Array.isArray(data) ? data[0] : data;
      return { joined: row || null, error: error || null };
    },

    /** Put a fixture on the calendar. Idempotent on its client id. */
    async schedule(leagueId, fixture) {
      if (!client) return noBackend;
      const { data, error } = await client.rpc('schedule_game', {
        p_league_id: leagueId,
        payload: fixture,
      });
      return { gameId: data || null, error: error || null };
    },

    /**
     * Put a team you manage into a league you are already a member of.
     *
     * The counterpart of removeTeam, and the way a commissioner enters their
     * OWN team: they are already a member, so there is no code for them to
     * redeem and minting one for themselves would be theatre. The database
     * trigger is what actually decides — a plain update is refused for a
     * league you have not been let into.
     */
    async addTeam(teamId, leagueId) {
      if (!client) return noBackend;
      const { error } = await client.from('teams').update({ league_id: leagueId }).eq('id', teamId);
      return { error: error || null };
    },

    /** Take a team back out. Never needs permission — leaving is not a favour. */
    async removeTeam(teamId) {
      if (!client) return noBackend;
      const { error } = await client.from('teams').update({ league_id: null }).eq('id', teamId);
      return { error: error || null };
    },
  };
}

/**
 * A league's games, in the three lists the league screen shows.
 *
 * Every status that means something to a person has exactly one home. Until
 * 4e a fixture was either on the schedule or played, so two filters covered
 * it; once "Score this game" flipped a fixture to `live`, it fell out of both
 * and could only be found as a join offer on a phone on one of its teams.
 *
 * `cancelled` is in none of them, deliberately: a cancelled game was not
 * played and is no longer planned, and listing it would invite somebody to
 * wait for it.
 */
export function bucketLeagueGames(games) {
  const out = { fixtures: [], inProgress: [], played: [] };
  for (const g of games || []) {
    if (g.status === 'scheduled') out.fixtures.push(g);
    else if (g.status === 'live') out.inProgress.push(g);
    else if (g.status === 'final') out.played.push(g);
  }
  return out;
}

/**
 * The first start event of each game, as `{ [gameId]: { teamId, actor } }`.
 *
 * The first, because a log can in principle hold more than one start and the
 * team that opened the game is the one that has it. Rows may arrive in any
 * order; lowest seq wins.
 */
export function scorersByGame(startRows) {
  const firstSeq = {};
  const out = {};
  for (const r of startRows || []) {
    const seq = r.seq == null ? Infinity : Number(r.seq);
    if (r.game_id in firstSeq && firstSeq[r.game_id] <= seq) continue;
    firstSeq[r.game_id] = seq;
    out[r.game_id] = { teamId: (r.payload && r.payload.teamId) || null, actor: r.actor || null };
  }
  return out;
}

/**
 * The line on an in-progress card that says who has the game.
 *
 * A TEAM, never a person. Profiles are readable only by their owner, and
 * putting a scorer's name in front of every follower of a public league is a
 * decision for a migration and a policy, not for a label. The one person it
 * can name is the one looking at it.
 */
export function scorerLine(scorer, { teams = [], userId = null } = {}) {
  if (scorer && userId && scorer.actor === userId) return 'You’re scoring this';
  const team = scorer && scorer.teamId ? teams.find((t) => t.id === scorer.teamId) : null;
  if (team) return `Scored by ${team.name}`;
  // Started before the start event said which side it was, or the read of it
  // failed. Still honest: somebody is scoring it.
  return 'Being scored';
}

/** Codes are shown in caps and typed by hand; be forgiving about how. */
export function normalizeCode(code) {
  return String(code || '').trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/** Turn a league failure into something worth showing a person. */
export function leagueErrorMessage(error) {
  if (!error) return null;
  const raw = String(error.message || error);

  if (/invalid invite code/i.test(raw)) return "That code isn't right. Check it and try again.";
  if (/already used/i.test(raw)) return 'That code has already been used. Ask for a new one.';
  if (/expired/i.test(raw)) return 'That code has expired. Ask for a new one.';
  if (/for a team, not a league/i.test(raw)) return 'That is a team code, not a league code.';
  if (/not been invited/i.test(raw)) return 'You need the league’s code before a team can join it.';
  if (/do not manage that team/i.test(raw)) return 'You can only bring in a team you manage.';
  if (/not allowed to invite people to this league/i.test(raw)) return 'Only a league commissioner can invite people.';
  if (/only a league admin can schedule/i.test(raw)) return 'Only a league commissioner can schedule games.';
  if (/against itself/i.test(raw)) return 'Pick two different teams.';
  if (/not in this league/i.test(raw)) return 'Both teams have to be in this league first.';
  if (/already (final|cancelled|live)/i.test(raw)) return 'That game has already been played, so it cannot be moved.';
  if (/network|fetch|offline/i.test(raw)) return 'Could not reach the server. Check your connection.';
  return raw;
}

/**
 * A fixture as the database wants it. The client id is minted here so a retry
 * moves the same fixture rather than adding a second one — the same discipline
 * every other write in this app uses.
 */
export function buildFixture({ homeTeamId, awayTeamId, scheduledAt, sport, clientId }) {
  const when = scheduledAt ? new Date(scheduledAt) : new Date();
  return {
    clientId: clientId || `fx-${Date.now()}`,
    homeTeamId,
    awayTeamId,
    scheduledAt: when.toISOString(),
    label: when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    sport: sport || 'kickball',
  };
}
