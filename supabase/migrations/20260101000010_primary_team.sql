-- Which team is "mine".
--
-- A user ends up managing several teams — their own, plus one per opponent an
-- import created. On a device that has never seen this account, something has
-- to say which one the app opens to, and guessing (earliest created? most
-- players?) is the kind of heuristic that quietly picks the wrong team.
--
-- It is recorded on the profile instead, set the first time a team is created
-- or imported, and changeable deliberately.

alter table public.profiles
  add column if not exists primary_team_id uuid references public.teams (id) on delete set null;

comment on column public.profiles.primary_team_id is
  'The team this user scores for. Set on first team creation or import; every device resolves to the same one.';

create or replace function public.set_primary_team(team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  target_id uuid := team_id;
begin
  if uid is null then
    raise exception 'must be signed in';
  end if;

  -- Only a team you actually belong to.
  if not exists (
    select 1 from public.memberships m
    where m.user_id = uid and m.team_id = target_id
  ) then
    raise exception 'not a member of that team';
  end if;

  update public.profiles set primary_team_id = target_id where id = uid;
end;
$$;

-- Set it automatically on the first team, without overriding a later choice.
create or replace function public.claim_primary_team(uid uuid, team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set primary_team_id = team_id
  where id = uid and primary_team_id is null;
end;
$$;

-- Hook the claim into both creation paths.
create or replace function public.create_team_with_manager(team_name text, league uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then
    raise exception 'must be signed in to create a team';
  end if;

  insert into public.teams (name, league_id, created_by)
  values (team_name, league, uid)
  returning id into new_id;

  insert into public.memberships (user_id, team_id, role)
  values (uid, new_id, 'team_manager');

  perform public.claim_primary_team(uid, new_id);

  return new_id;
end;
$$;

-- import_season claims it too. Wrapping rather than restating the whole body:
-- the import logic lives in one place and stays there.
create or replace function public.import_season_and_claim(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_team uuid;
begin
  new_team := public.import_season(payload);
  perform public.claim_primary_team(uid, new_team);
  return new_team;
end;
$$;

comment on function public.import_season_and_claim is
  'import_season, plus recording the new team as the caller primary team if they had none.';
