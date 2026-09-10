-- =============================================================================
-- Slice 1b: Row Level Security policies.
--
-- Design notes (read before touching this file):
--
-- 1. RECURSION. Any policy on `memberships` that itself queries
--    `memberships` (directly or via a policy on another table that is in
--    turn checked while evaluating a `memberships` policy) will recurse
--    under RLS. We avoid this by funnelling every membership check through
--    SECURITY DEFINER helper functions below. A SECURITY DEFINER function
--    runs as its owner (the migration role, effectively `postgres`), which
--    bypasses RLS on the tables it queries internally -- so it can read
--    `memberships` freely without re-triggering `memberships`' own RLS
--    policies. All such functions are STABLE, take only scalar/array
--    arguments, and set an explicit `search_path` (empty, schema-qualifying
--    every reference) so they cannot be tricked by a hostile search_path
--    into resolving to an attacker-controlled object -- this is the classic
--    SECURITY DEFINER privilege-escalation vector in Postgres.
--
-- 2. PRIVILEGE ESCALATION. There is deliberately NO permissive INSERT (or
--    UPDATE/DELETE) policy on `memberships` for ordinary users. The only way
--    to gain a membership is the SECURITY DEFINER function
--    `public.accept_invite`, which validates an invite row itself and
--    performs the INSERT internally, still running as the elevated owner
--    but under code we control (checks expiry + single-use + role/scope
--    copied verbatim from the invite, never from client input).
--
-- 3. BOOTSTRAP. Creating a team and granting its creator team_manager must
--    happen atomically, or a user could create a team and then be locked
--    out of it (no permissive INSERT policy on memberships to self-grant
--    afterwards). `public.create_team_with_manager` does both in one
--    SECURITY DEFINER transaction.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: is the current user a member of the given team, with one of the
-- given roles? Bypasses RLS on memberships (SECURITY DEFINER) to avoid
-- recursive policy evaluation.
-- -----------------------------------------------------------------------------
create function public.is_team_member(p_team_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.team_id = p_team_id
      and m.user_id = auth.uid()
      and m.role = any(p_roles)
  );
$$;

comment on function public.is_team_member(uuid, text[]) is
  'SECURITY DEFINER: true if auth.uid() holds one of p_roles on p_team_id. Bypasses memberships RLS internally to avoid recursive policy evaluation.';

-- -----------------------------------------------------------------------------
-- Helper: is the current user a league_admin of the given league?
-- -----------------------------------------------------------------------------
create function public.is_league_admin(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.league_id = p_league_id
      and m.user_id = auth.uid()
      and m.role = 'league_admin'
  );
$$;

comment on function public.is_league_admin(uuid) is
  'SECURITY DEFINER: true if auth.uid() is a league_admin of p_league_id. Bypasses memberships RLS.';

-- -----------------------------------------------------------------------------
-- Helper: is the current user *any* member of the given league (any role)?
-- Used for private-league read visibility.
-- -----------------------------------------------------------------------------
create function public.is_league_member(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.league_id = p_league_id
      and m.user_id = auth.uid()
  );
$$;

comment on function public.is_league_member(uuid) is
  'SECURITY DEFINER: true if auth.uid() holds any membership on p_league_id. Bypasses memberships RLS.';

-- -----------------------------------------------------------------------------
-- Helper: does the given league_id (nullable) resolve to a public/readable
-- league, or is the current user a member of it? Centralises the
-- "readable per league visibility" rule used by teams/players/games/
-- game_events/game_lines. A NULL league_id (team/game with no league) is
-- treated as publicly readable -- there is no league to restrict on.
-- -----------------------------------------------------------------------------
create function public.league_is_readable(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_league_id is null
    or exists (
      select 1 from public.leagues l
      where l.id = p_league_id
        and (l.visibility = 'public' or public.is_league_member(p_league_id))
    );
$$;

comment on function public.league_is_readable(uuid) is
  'SECURITY DEFINER: true if p_league_id is NULL, public, or the current user is a member. Central visibility rule reused by teams/players/games/game_events/game_lines.';

-- -----------------------------------------------------------------------------
-- Helper: can the current user manage (update/delete) the given team --
-- a team_manager of that team, or a league_admin of its league.
-- -----------------------------------------------------------------------------
create function public.can_manage_team(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.teams t
    where t.id = p_team_id
      and (
        public.is_team_member(p_team_id, array['team_manager'])
        or (t.league_id is not null and public.is_league_admin(t.league_id))
      )
  );
$$;

comment on function public.can_manage_team(uuid) is
  'SECURITY DEFINER: true if auth.uid() is team_manager of p_team_id or league_admin of its league.';

-- -----------------------------------------------------------------------------
-- Helper: is the given game readable -- per league visibility, or because
-- the current user is a member (any of manager/scorer/viewer) of either
-- participating team. Centralises the rule shared by games/game_events/
-- game_lines SELECT policies so they cannot drift out of sync.
-- -----------------------------------------------------------------------------
create function public.game_is_readable(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.games g
    where g.id = p_game_id
      and (
        public.league_is_readable(g.league_id)
        or (g.home_team_id is not null and public.is_team_member(g.home_team_id, array['team_manager', 'team_scorer', 'viewer']))
        or (g.away_team_id is not null and public.is_team_member(g.away_team_id, array['team_manager', 'team_scorer', 'viewer']))
      )
  );
$$;

comment on function public.game_is_readable(uuid) is
  'SECURITY DEFINER: true if p_game_id is readable per league visibility or team membership. Shared by games/game_events/game_lines SELECT policies.';

-- -----------------------------------------------------------------------------
-- Helper: can the current user score/manage the given game -- a
-- team_manager or team_scorer of either participating team, or a
-- league_admin of the game's league.
-- -----------------------------------------------------------------------------
create function public.can_score_game(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.games g
    where g.id = p_game_id
      and (
        (g.home_team_id is not null
          and public.is_team_member(g.home_team_id, array['team_manager', 'team_scorer']))
        or (g.away_team_id is not null
          and public.is_team_member(g.away_team_id, array['team_manager', 'team_scorer']))
        or (g.league_id is not null and public.is_league_admin(g.league_id))
      )
  );
$$;

comment on function public.can_score_game(uuid) is
  'SECURITY DEFINER: true if auth.uid() is team_manager/team_scorer of either team in p_game_id, or league_admin of its league.';

-- -----------------------------------------------------------------------------
-- Helper: same reach test, but taking team ids directly (used by INSERT
-- policies on games, where the row does not exist yet so p_game_id is
-- unavailable -- we check the proposed home/away team ids instead).
-- -----------------------------------------------------------------------------
create function public.can_score_teams(p_home_team_id uuid, p_away_team_id uuid, p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (p_home_team_id is not null
      and public.is_team_member(p_home_team_id, array['team_manager', 'team_scorer']))
    or (p_away_team_id is not null
      and public.is_team_member(p_away_team_id, array['team_manager', 'team_scorer']))
    or (p_league_id is not null and public.is_league_admin(p_league_id));
$$;

comment on function public.can_score_teams(uuid, uuid, uuid) is
  'SECURITY DEFINER: INSERT-time variant of can_score_game, checked against proposed team/league ids since the game row does not exist yet.';

-- =============================================================================
-- profiles
-- A user reads and updates only their own row. No client INSERT/DELETE
-- policy: profiles are created by a trigger/app flow off auth.users (out of
-- scope for this slice) and service_role can always write regardless.
-- =============================================================================
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

-- =============================================================================
-- leagues
-- =============================================================================
create policy leagues_select_public_or_member on public.leagues
  for select to anon, authenticated
  using (visibility = 'public' or public.is_league_member(id));

create policy leagues_insert_authenticated on public.leagues
  for insert to authenticated
  with check (created_by = auth.uid());

create policy leagues_update_admin on public.leagues
  for update to authenticated
  using (public.is_league_admin(id))
  with check (public.is_league_admin(id));

create policy leagues_delete_admin on public.leagues
  for delete to authenticated
  using (public.is_league_admin(id));

-- =============================================================================
-- teams
-- =============================================================================
create policy teams_select_visible on public.teams
  for select to anon, authenticated
  using (
    public.league_is_readable(league_id)
    or public.is_team_member(id, array['team_manager', 'team_scorer', 'viewer'])
  );

-- Plain team creation (no bootstrap membership) is intentionally NOT exposed
-- here -- use public.create_team_with_manager() so the creator always ends
-- up with a team_manager membership atomically. See that function below.

create policy teams_update_manager_or_admin on public.teams
  for update to authenticated
  using (public.can_manage_team(id))
  with check (public.can_manage_team(id));

create policy teams_delete_manager_or_admin on public.teams
  for delete to authenticated
  using (public.can_manage_team(id));

-- =============================================================================
-- players -- same reach as their parent team.
-- =============================================================================
create policy players_select_visible on public.players
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.teams t
      where t.id = players.team_id
        and (
          public.league_is_readable(t.league_id)
          or public.is_team_member(t.id, array['team_manager', 'team_scorer', 'viewer'])
        )
    )
  );

create policy players_insert_manager_or_admin on public.players
  for insert to authenticated
  with check (public.can_manage_team(team_id));

create policy players_update_manager_or_admin on public.players
  for update to authenticated
  using (public.can_manage_team(team_id))
  with check (public.can_manage_team(team_id));

create policy players_delete_manager_or_admin on public.players
  for delete to authenticated
  using (public.can_manage_team(team_id));

-- =============================================================================
-- games -- readable per league visibility rule; insert/update by a
-- team_manager/team_scorer of either team or a league_admin.
-- =============================================================================
create policy games_select_visible on public.games
  for select to anon, authenticated
  using (
    public.league_is_readable(league_id)
    or (home_team_id is not null and public.is_team_member(home_team_id, array['team_manager', 'team_scorer', 'viewer']))
    or (away_team_id is not null and public.is_team_member(away_team_id, array['team_manager', 'team_scorer', 'viewer']))
  );

create policy games_insert_scorer on public.games
  for insert to authenticated
  with check (public.can_score_teams(home_team_id, away_team_id, league_id));

create policy games_update_scorer on public.games
  for update to authenticated
  using (public.can_score_game(id))
  with check (public.can_score_teams(home_team_id, away_team_id, league_id));

-- No delete policy specified for games; leave un-deletable by ordinary
-- users (history should not disappear). service_role retains full access.

-- =============================================================================
-- game_events -- APPEND ONLY. Select/insert only; deliberately no update or
-- delete policy for anyone (including admins) so the log is immutable at
-- the database layer, not just by convention.
-- =============================================================================
create policy game_events_select_visible on public.game_events
  for select to anon, authenticated
  using (public.game_is_readable(game_id));

create policy game_events_insert_scorer on public.game_events
  for insert to authenticated
  with check (public.can_score_game(game_id));

-- =============================================================================
-- game_lines -- read per visibility; write by the same set that may score.
-- =============================================================================
create policy game_lines_select_visible on public.game_lines
  for select to anon, authenticated
  using (public.game_is_readable(game_id));

create policy game_lines_insert_scorer on public.game_lines
  for insert to authenticated
  with check (public.can_score_game(game_id));

create policy game_lines_update_scorer on public.game_lines
  for update to authenticated
  using (public.can_score_game(game_id))
  with check (public.can_score_game(game_id));

create policy game_lines_delete_scorer on public.game_lines
  for delete to authenticated
  using (public.can_score_game(game_id));

-- =============================================================================
-- memberships
-- Read-only for ordinary users, by design (see file header). NO insert,
-- update, or delete policy for `authenticated`/`anon` -- the only paths to a
-- new membership row are the SECURITY DEFINER functions below, which run as
-- their owner and so are unaffected by (and do not need) a permissive
-- policy here.
-- =============================================================================
create policy memberships_select_own on public.memberships
  for select to authenticated
  using (
    user_id = auth.uid()
    or (team_id is not null and public.is_team_member(team_id, array['team_manager']))
    or (league_id is not null and public.is_league_admin(league_id))
  );

-- =============================================================================
-- invites -- creatable by a team_manager (for their team) or league_admin
-- (for their league). Readable by the same set, so they can manage/share
-- codes; redemption is via accept_invite() and never a direct select of the
-- code by an outsider (anon has no select policy at all).
-- =============================================================================
create policy invites_select_manager_or_admin on public.invites
  for select to authenticated
  using (
    (team_id is not null and public.is_team_member(team_id, array['team_manager']))
    or (league_id is not null and public.is_league_admin(league_id))
  );

create policy invites_insert_manager_or_admin on public.invites
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and (
      (team_id is not null and public.is_team_member(team_id, array['team_manager']))
      or (league_id is not null and public.is_league_admin(league_id))
    )
  );

create policy invites_delete_manager_or_admin on public.invites
  for delete to authenticated
  using (
    (team_id is not null and public.is_team_member(team_id, array['team_manager']))
    or (league_id is not null and public.is_league_admin(league_id))
  );

-- =============================================================================
-- public.accept_invite(invite_code text)
--
-- The ONLY path by which an ordinary authenticated user gains a
-- membership. SECURITY DEFINER so it can insert into `memberships` despite
-- there being no permissive client-facing INSERT policy there. Validates:
--   - the code exists
--   - it has not already been used (used_at is null)
--   - it has not expired (expires_at > now())
-- then inserts a membership copying role/team_id/league_id verbatim from
-- the invite row (never from caller-supplied input) and marks the invite
-- used, atomically in one transaction. Re-running with an already-used or
-- expired code raises an exception and inserts nothing.
-- =============================================================================
create function public.accept_invite(invite_code text)
returns public.memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.invites;
  v_membership public.memberships;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'accept_invite requires an authenticated user';
  end if;

  select * into v_invite
  from public.invites
  where code = invite_code
  for update;

  if not found then
    raise exception 'invalid invite code';
  end if;

  if v_invite.used_at is not null then
    raise exception 'invite code already used';
  end if;

  if v_invite.expires_at <= now() then
    raise exception 'invite code expired';
  end if;

  insert into public.memberships (user_id, team_id, league_id, role)
  values (v_user_id, v_invite.team_id, v_invite.league_id, v_invite.role)
  on conflict do nothing
  returning * into v_membership;

  if v_membership.id is null then
    raise exception 'membership already exists for this user and scope';
  end if;

  update public.invites
  set used_by = v_user_id, used_at = now()
  where id = v_invite.id;

  return v_membership;
end;
$$;

comment on function public.accept_invite(text) is
  'SECURITY DEFINER: the only permitted path to insert a membership for an ordinary user. Validates the invite (exists, unused, unexpired) then inserts the membership and marks the invite used, atomically. explicit search_path prevents search-path hijacking.';

revoke all on function public.accept_invite(text) from public;
grant execute on function public.accept_invite(text) to authenticated;

-- =============================================================================
-- public.create_team_with_manager(team_name text, league uuid default null)
--
-- Atomically creates a team and grants the creator a team_manager
-- membership on it. SECURITY DEFINER because the membership insert would
-- otherwise be refused by RLS (no permissive INSERT policy on
-- memberships), and because doing the two inserts as two separate
-- statements from the client would leave a window where the team exists
-- but the creator has no membership on it (and, per the policies above, no
-- way to grant themselves one after the fact).
-- =============================================================================
create function public.create_team_with_manager(team_name text, league uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_team_id uuid;
begin
  if v_user_id is null then
    raise exception 'create_team_with_manager requires an authenticated user';
  end if;

  insert into public.teams (name, league_id, created_by)
  values (team_name, league, v_user_id)
  returning id into v_team_id;

  insert into public.memberships (user_id, team_id, role)
  values (v_user_id, v_team_id, 'team_manager');

  return v_team_id;
end;
$$;

comment on function public.create_team_with_manager(text, uuid) is
  'SECURITY DEFINER: atomically creates a team and a team_manager membership for its creator. Bypasses the (deliberately absent) client INSERT policy on memberships. explicit search_path prevents search-path hijacking.';

revoke all on function public.create_team_with_manager(text, uuid) from public;
grant execute on function public.create_team_with_manager(text, uuid) to authenticated;
