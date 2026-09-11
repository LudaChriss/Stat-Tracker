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

export function createLeagues(client) {
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
      const { data, error } = await client
        .from('memberships')
        .select('role, league_id, leagues(id, name, sport, visibility)')
        .not('league_id', 'is', null);
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
      return {
        league: league.data,
        teams: teams.data || [],
        games: games.data || [],
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
