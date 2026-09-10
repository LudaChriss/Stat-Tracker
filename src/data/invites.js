// Invites, from the client's side.
//
// A thin wrapper over three database functions so no screen touches a Supabase
// client directly, and so the flow can be tested without one. All three
// decisions that matter — the code, the expiry, and which roles a team invite
// may grant — are made in the database, not here.

export const ROLE_LABEL = {
  team_manager: 'Manager',
  team_scorer: 'Scorer',
  viewer: 'Viewer',
};

export const ROLE_BLURB = {
  team_manager: 'Runs the roster and the lineup, and can score.',
  team_scorer: 'Can score games and edit box scores. Cannot change the roster.',
  viewer: 'Can see the season. Changes nothing.',
};

/** The roles a team invite can grant, in the order a person would consider them. */
export const INVITABLE_ROLES = ['team_scorer', 'viewer', 'team_manager'];

export function createInvites(client) {
  const noBackend = { error: { message: 'No backend is configured on this build.' } };

  return {
    isAvailable: !!client,

    /** Mint one. Only a manager or the league admin gets past the database. */
    async create(teamId, role, days = 7) {
      if (!client) return noBackend;
      const { data, error } = await client.rpc('create_invite', {
        p_team_id: teamId,
        p_role: role,
        p_days: days,
      });
      return { invite: data || null, error: error || null };
    },

    /**
     * What a code is for, before committing to it. Deliberately readable by
     * anyone holding the code — it is the only way to see an invite you do not
     * manage, and someone should know what they are joining.
     */
    async peek(code) {
      if (!client) return noBackend;
      const { data, error } = await client.rpc('peek_invite', { invite_code: normalize(code) });
      const row = Array.isArray(data) ? data[0] : data;
      return { invite: row || null, error: error || null };
    },

    async accept(code) {
      if (!client) return noBackend;
      const { data, error } = await client.rpc('accept_invite', { invite_code: normalize(code) });
      return { membership: data || null, error: error || null };
    },
  };
}

/** Codes are shown in caps and typed by hand; be forgiving about how. */
export function normalize(code) {
  return String(code || '').trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/** Turn an invite failure into something worth showing a person. */
export function inviteErrorMessage(error) {
  if (!error) return null;
  const raw = String(error.message || error);

  if (/invalid invite code/i.test(raw)) return "That code isn't right. Check it and try again.";
  if (/already used/i.test(raw)) return 'That code has already been used. Ask for a new one.';
  if (/expired/i.test(raw)) return 'That code has expired. Ask for a new one.';
  if (/membership already exists/i.test(raw)) return "You're already on this team.";
  if (/not allowed to invite/i.test(raw)) return 'Only a team manager can invite people.';
  if (/network|fetch|offline/i.test(raw)) return 'Could not reach the server. Check your connection.';
  return raw;
}

/** A code in the shape people read it: BQ7K-2M9X-RT. */
export function formatCode(code) {
  const clean = normalize(code);
  return clean.replace(/(.{4})(?=.)/g, '$1-');
}
