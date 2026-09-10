-- Saving a season in one transaction.
--
-- Two problems with doing it as separate client statements:
--
--  1. The players upsert targeted ON CONFLICT (team_id, client_id), but that
--     index was created partial (WHERE client_id IS NOT NULL). Postgres cannot
--     use a partial index for ON CONFLICT unless the statement repeats the same
--     predicate, which PostgREST has no way to express — so every save failed
--     with "no unique or exclusion constraint matching the ON CONFLICT
--     specification". The queue parked it correctly rather than dropping it,
--     which is how it was noticed.
--
--  2. The team update and the roster upsert were separate round trips, so a
--     failure between them left the team renamed and the roster stale. A
--     half-applied save is worse than a failed one.
--
-- Both are fixed by making the whole save one function call, which is one
-- transaction: it applies completely or not at all.

drop index if exists public.players_team_client_id_idx;

-- Not partial, so ON CONFLICT can use it. Null client_ids do not conflict with
-- each other in a unique index, which is the behaviour we want for players who
-- have no client-side id.
create unique index if not exists players_team_client_id_key
  on public.players (team_id, client_id);

create or replace function public.save_season(p_team_id uuid, payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  player jsonb;
  keep int[] := '{}';
begin
  -- Authorisation is NOT bypassed just because this runs as definer.
  if not public.can_manage_team(p_team_id) then
    raise exception 'not allowed to edit this team';
  end if;

  update public.teams
  set name = coalesce(nullif(payload -> 'myTeam' ->> 'name', ''), name),
      prior_w = coalesce((payload -> 'myTeam' ->> 'priorW')::int, prior_w),
      prior_l = coalesce((payload -> 'myTeam' ->> 'priorL')::int, prior_l),
      prior_t = coalesce((payload -> 'myTeam' ->> 'priorT')::int, prior_t)
  where id = p_team_id;

  for player in select * from jsonb_array_elements(coalesce(payload -> 'roster', '[]'::jsonb))
  loop
    keep := keep || (player ->> 'id')::int;

    insert into public.players (team_id, name, number, position, color, client_id, sort_order)
    values (
      p_team_id,
      coalesce(player ->> 'name', 'Player'),
      nullif(player ->> 'num', 'null')::int,
      coalesce(player ->> 'pos', 'P'),
      coalesce(player ->> 'c', '#0E7490'),
      (player ->> 'id')::int,
      coalesce((player ->> 'sortOrder')::int, (player ->> 'id')::int, 0)
    )
    on conflict (team_id, client_id) do update
      set name = excluded.name,
          number = excluded.number,
          position = excluded.position,
          color = excluded.color,
          sort_order = excluded.sort_order;
  end loop;

  -- A player removed on the device is removed here too. Their box-score lines
  -- survive: those carry a name snapshot precisely so history outlives a roster
  -- change, and player_id is nullable for exactly this reason.
  delete from public.players p
  where p.team_id = p_team_id
    and p.client_id is not null
    and not (p.client_id = any(keep));
end;
$$;

comment on function public.save_season is
  'Apply a season snapshot to a team in one transaction. Authorisation is still checked; definer is only for atomicity.';
