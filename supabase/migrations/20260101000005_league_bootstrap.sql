-- Creating a league must also make you its administrator.
--
-- Teams already worked this way (create_team_with_manager). Leagues did not:
-- a plain insert left a league whose creator was not a member of it, so they
-- could not update it, could not invite anyone, and — if it was private —
-- could not even read it back. The insert appeared to fail outright, because
-- PostgREST's RETURNING clause is filtered by the SELECT policy.
--
-- The direct insert policy is removed so that state is unreachable, matching
-- how teams are created.

drop policy if exists leagues_insert_authenticated on public.leagues;

create or replace function public.create_league_with_admin(
  league_name text,
  league_sport text default 'kickball',
  league_visibility text default 'public'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'must be signed in to create a league';
  end if;

  if league_visibility not in ('public', 'private') then
    raise exception 'visibility must be public or private';
  end if;

  insert into public.leagues (name, sport, visibility, created_by)
  values (league_name, league_sport, league_visibility, uid)
  returning id into new_id;

  insert into public.memberships (user_id, league_id, role)
  values (uid, new_id, 'league_admin');

  return new_id;
end;
$$;

comment on function public.create_league_with_admin is
  'The only way to create a league. Atomically makes the creator its league_admin, so a league can never exist without an administrator.';
