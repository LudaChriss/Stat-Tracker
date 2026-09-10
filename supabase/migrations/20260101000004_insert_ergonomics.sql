-- Make the insert paths work without every caller knowing the schema's secrets.
--
-- Two traps found by probing the policies with a real signed-in user rather
-- than a service-role client:
--
-- 1. The insert policies require created_by = auth.uid(), but created_by had no
--    default. Any client that did not explicitly set it was rejected with a
--    bare "violates row-level security policy" — which reads like a permissions
--    bug, not a missing field. Defaulting the column makes the policy hold
--    naturally and keeps it impossible to forge someone else's authorship.
--
-- 2. games required both team name snapshots up front. Keeping the names as
--    they were at the time of the game is right — that is how history survives
--    a rename — but deriving them is the database's job, not the caller's.

alter table public.leagues alter column created_by set default auth.uid();
alter table public.teams   alter column created_by set default auth.uid();
alter table public.games   alter column created_by set default auth.uid();
alter table public.invites alter column created_by set default auth.uid();

alter table public.games alter column scheduled_at set default now();

create or replace function public.fill_game_team_snapshots()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- BEFORE-row triggers run ahead of the NOT NULL check, so filling them here
  -- satisfies the constraint while leaving them explicitly settable.
  if new.home_team_name_snapshot is null then
    select t.name into new.home_team_name_snapshot
    from public.teams t where t.id = new.home_team_id;
  end if;

  if new.away_team_name_snapshot is null then
    select t.name into new.away_team_name_snapshot
    from public.teams t where t.id = new.away_team_id;
  end if;

  return new;
end;
$$;

drop trigger if exists games_fill_snapshots on public.games;
create trigger games_fill_snapshots
  before insert on public.games
  for each row execute function public.fill_game_team_snapshots();
