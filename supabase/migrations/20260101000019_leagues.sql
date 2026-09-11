-- Slice 4a: a league is something you can create, join a team to, and schedule.
--
-- Everything a league IS has existed since 1a: the table, the visibility
-- column, league_admin memberships, and every policy that reads
-- `league_is_readable`. What has never existed is a way to get a team into one,
-- or to put a fixture on a calendar. This is that.
--
-- Four things, and one hole closed.
--
-- 1. create_league_invite — a code that grants a LEAGUE role.
--
--    A NEW function rather than a parameter on create_invite. Adding even a
--    defaulted argument to an existing function creates a second overload
--    rather than replacing it, which is how _012 silently left an unguarded
--    save_season live for a day. create_invite is not touched at all here.
--
-- 2. peek_invite — says which league, as well as which team.
--
--    Its return type changes, so it is DROPPED and recreated at the same
--    signature. That is a replacement, not an overload: `select proname from
--    pg_proc where proname = 'peek_invite'` still returns exactly one row.
--
-- 3. join_league — a team manager redeems a league code and brings their team
--    in, in one transaction.
--
-- 4. schedule_game — a league admin puts a fixture on the calendar.
--
-- AND THE HOLE. `teams_update_manager_or_admin` lets a team's manager write any
-- column, `league_id` included, with no check on the league they are writing.
-- Anyone managing a team could attach it to any public league and appear in
-- that league's standings uninvited. A BEFORE trigger now requires that you
-- hold SOME membership on a league before you can put a team into it — which is
-- exactly what redeeming its code gives you. Taking a team back out stays
-- freely available to its manager: leaving is not something to need permission
-- for.

-- -----------------------------------------------------------------------------
-- A team may only enter a league its manager has been let into.
-- -----------------------------------------------------------------------------
create or replace function public.guard_team_league_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- service_role and the migration/seed paths have no auth.uid(); they already
  -- bypass row-level security, so this must not be stricter than RLS is.
  if auth.uid() is null then
    return new;
  end if;

  -- Leaving a league, or not touching the column, is always fine.
  if new.league_id is null or new.league_id is not distinct from old.league_id then
    return new;
  end if;

  if not public.is_league_member(new.league_id) then
    raise exception
      'refusing to put this team into a league you have not been invited to — redeem the league''s code first';
  end if;

  return new;
end;
$$;

comment on function public.guard_team_league_change() is
  'Trigger (UPDATE): a team can only be moved into a league the caller already holds a membership on. Leaving a league is unrestricted. service_role is exempt, matching RLS.';

-- Two triggers rather than one branching on TG_OP: an INSERT has no OLD row to
-- compare against, and a function that has to ask which it is ends up saying
-- neither thing clearly.
create or replace function public.guard_team_league_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or new.league_id is null then
    return new;
  end if;
  if not public.is_league_member(new.league_id) then
    raise exception
      'refusing to create this team inside a league you have not been invited to — redeem the league''s code first';
  end if;
  return new;
end;
$$;

comment on function public.guard_team_league_insert() is
  'Trigger (INSERT): a team can only be created inside a league the caller already holds a membership on. service_role is exempt, matching RLS.';

drop trigger if exists teams_guard_league_insert on public.teams;
drop trigger if exists teams_guard_league_update on public.teams;

create trigger teams_guard_league_insert
  before insert on public.teams
  for each row execute function public.guard_team_league_insert();

create trigger teams_guard_league_update
  before update on public.teams
  for each row execute function public.guard_team_league_change();

-- -----------------------------------------------------------------------------
-- create_league_invite
-- -----------------------------------------------------------------------------
create or replace function public.create_league_invite(
  p_league_id uuid,
  p_role text,
  p_days int default 7
)
returns public.invites
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_days int;
  v_code text;
  v_invite public.invites;
  attempts int := 0;
begin
  if uid is null then
    raise exception 'must be signed in';
  end if;

  if not public.is_league_admin(p_league_id) then
    raise exception 'not allowed to invite people to this league';
  end if;

  -- A league invite grants a role on a LEAGUE. team_manager and team_scorer
  -- are roles on a team; a league-scoped row claiming one would be a row
  -- asserting something untrue, waiting for a query that trusts it. Refused
  -- by name rather than quietly downgraded -- the same rule create_invite
  -- applies in the other direction.
  if p_role not in ('league_admin', 'viewer') then
    raise exception 'a league invite can grant league_admin or viewer, not %', p_role;
  end if;

  v_days := least(greatest(coalesce(p_days, 7), 1), 30);

  loop
    attempts := attempts + 1;
    v_code := public.new_invite_code();
    begin
      insert into public.invites (code, league_id, role, expires_at, created_by)
      values (v_code, p_league_id, p_role, now() + make_interval(days => v_days), uid)
      returning * into v_invite;
      exit;
    exception when unique_violation then
      if attempts >= 5 then
        raise exception 'could not generate a unique invite code';
      end if;
    end;
  end loop;

  return v_invite;
end;
$$;

comment on function public.create_league_invite(uuid, text, int) is
  'Mint a single-use, expiring invite granting a LEAGUE role. Only a league admin may call it; the code, the expiry (1-30 days) and the allowed roles (league_admin, viewer) are decided here, not by the caller.';

-- -----------------------------------------------------------------------------
-- peek_invite -- now says which league, as well as which team.
--
-- Dropped and recreated because the return type changes. Same signature, so
-- this REPLACES the function rather than sitting beside it.
-- -----------------------------------------------------------------------------
drop function if exists public.peek_invite(text);

create function public.peek_invite(invite_code text)
returns table (
  team_id uuid,
  team_name text,
  league_id uuid,
  league_name text,
  role text,
  expires_at timestamptz,
  usable boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.team_id,
    t.name,
    i.league_id,
    l.name,
    i.role,
    i.expires_at,
    (i.used_at is null and i.expires_at > now()) as usable
  from public.invites i
  left join public.teams t on t.id = i.team_id
  left join public.leagues l on l.id = i.league_id
  where i.code = invite_code;
$$;

comment on function public.peek_invite(text) is
  'What a code would grant: the team or the league it is scoped to, its name, the role, the expiry, and whether it is still usable. Readable by anyone holding the code, which is the only way to see an invite you do not manage.';

-- -----------------------------------------------------------------------------
-- join_league -- redeem a league code and bring a team in, in one transaction.
--
-- Two things that must not half-happen. Accepting the code without placing the
-- team leaves someone a member of a league their team is not in, with no
-- obvious way to finish the job; placing the team without the membership is
-- refused by the trigger above. Doing both in one function makes the pair
-- atomic.
--
-- p_team_id is optional: a league admin joining as an admin, or a spectator
-- joining as a viewer, has no team to bring.
-- -----------------------------------------------------------------------------
create or replace function public.join_league(p_code text, p_team_id uuid default null)
returns table (league_id uuid, league_name text, role text, team_joined boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_invite public.invites;
  v_membership public.memberships;
  v_existing public.memberships;
  v_league public.leagues;
  v_role text;
  v_placed boolean := false;
begin
  if uid is null then
    raise exception 'must be signed in';
  end if;

  -- Read the invite first, so "that code is for a team" is answered before
  -- anything is granted rather than after.
  -- Every column reference below is qualified. The OUT parameters of this
  -- function are named league_id and role, which collide with columns on
  -- invites, memberships and teams; an unqualified reference is not a runtime
  -- risk, it is a hard error.
  select i.* into v_invite from public.invites i where i.code = p_code;
  if not found then
    raise exception 'invalid invite code';
  end if;
  if v_invite.league_id is null then
    raise exception 'that code is for a team, not a league';
  end if;

  -- These two conditions are also checked inside accept_invite, and that
  -- duplication is deliberate rather than drift: the branch below sometimes
  -- does not call accept_invite at all, and a spent or expired code must be
  -- refused on every branch, not only the one that happens to go through it.
  if v_invite.used_at is not null then
    raise exception 'invite code already used';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'invite code expired';
  end if;

  select m.* into v_existing
  from public.memberships m
  where m.user_id = uid and m.league_id = v_invite.league_id;

  if found then
    -- Already in this league. Someone managing two teams brings the second one
    -- in with a fresh code, and accept_invite would refuse that as a duplicate
    -- membership — correctly, since there is nothing left to grant. The code is
    -- deliberately NOT burned: it granted nothing, so it is still somebody
    -- else's way in. This adds no reach either — a league member can already
    -- move a team they manage into that league with a plain update.
    v_role := v_existing.role;
  else
    -- accept_invite does the validation, the row lock and the single-use mark.
    -- Reimplementing those here would be a second place for them to be wrong.
    v_membership := public.accept_invite(p_code);
    v_role := v_membership.role;
  end if;

  select l.* into v_league from public.leagues l where l.id = v_invite.league_id;

  if p_team_id is not null then
    if not public.can_manage_team(p_team_id) then
      raise exception 'you do not manage that team, so it cannot be the one joining';
    end if;
    -- The trigger allows this: the membership is what unlocks it.
    update public.teams t set league_id = v_invite.league_id where t.id = p_team_id;
    v_placed := true;
  end if;

  league_id := v_invite.league_id;
  league_name := v_league.name;
  role := v_role;
  team_joined := v_placed;
  return next;
end;
$$;

comment on function public.join_league(text, uuid) is
  'Redeem a league invite code and, optionally, put a team you manage into that league -- atomically, so nobody ends up a member of a league their team never entered.';

-- -----------------------------------------------------------------------------
-- schedule_game -- a fixture, before anybody has scored anything.
--
-- Idempotent on the client id like every other write here, because the app may
-- retry. Refuses rather than accepts: a fixture between teams that are not both
-- in this league would appear on a schedule nobody can score.
-- -----------------------------------------------------------------------------
create or replace function public.schedule_game(p_league_id uuid, payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_client_id text;
  v_home uuid;
  v_away uuid;
  v_when timestamptz;
  v_existing uuid;
  v_status text;
begin
  if uid is null then
    raise exception 'must be signed in';
  end if;
  if not public.is_league_admin(p_league_id) then
    raise exception 'only a league admin can schedule games in this league';
  end if;

  v_client_id := payload ->> 'clientId';
  if v_client_id is null then
    raise exception 'refusing to schedule a game with no id';
  end if;

  v_home := (payload ->> 'homeTeamId')::uuid;
  v_away := (payload ->> 'awayTeamId')::uuid;

  if v_home is null or v_away is null then
    raise exception 'refusing to schedule a game without both teams';
  end if;
  if v_home = v_away then
    raise exception 'refusing to schedule a team against itself';
  end if;

  if not exists (select 1 from public.teams t where t.id = v_home and t.league_id = p_league_id) then
    raise exception 'refusing to schedule: the home team is not in this league';
  end if;
  if not exists (select 1 from public.teams t where t.id = v_away and t.league_id = p_league_id) then
    raise exception 'refusing to schedule: the away team is not in this league';
  end if;

  v_when := coalesce((payload ->> 'scheduledAt')::timestamptz, now());

  select g.id, g.status into v_existing, v_status
  from public.games g
  where g.client_id = v_client_id and g.league_id = p_league_id;

  if v_existing is not null then
    -- A fixture that has been played is a result, not a plan. Rescheduling it
    -- would rewrite a game somebody scored.
    if v_status <> 'scheduled' then
      raise exception 'refusing to reschedule game % : it is already %', v_client_id, v_status;
    end if;
    update public.games set
      home_team_id = v_home,
      away_team_id = v_away,
      scheduled_at = v_when,
      label = payload ->> 'label',
      sport = coalesce(payload ->> 'sport', sport)
    where id = v_existing;
    return v_existing;
  end if;

  insert into public.games (
    league_id, home_team_id, away_team_id, scheduled_at, label, status, sport, client_id, created_by
  )
  values (
    p_league_id, v_home, v_away, v_when, payload ->> 'label',
    'scheduled', coalesce(payload ->> 'sport', 'kickball'), v_client_id, uid
  )
  returning id into v_existing;

  return v_existing;
end;
$$;

comment on function public.schedule_game(uuid, jsonb) is
  'Put a fixture on a league calendar, idempotently by client id. League admin only. Refuses a team against itself, a team not in the league, and rescheduling a game that has already been played.';

-- A fixture is found by league and date far more often than by anything else.
create index if not exists games_league_scheduled_idx
  on public.games (league_id, scheduled_at);
