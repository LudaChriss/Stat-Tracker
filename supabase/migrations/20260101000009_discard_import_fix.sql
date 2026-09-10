-- Two defects in discard_import, both found by testing it as a real user:
--
--  * The parameter `team_id` collided with memberships.team_id inside the
--    membership check, so every call failed with "column reference is
--    ambiguous" — including the legitimate ones. The parameter name is kept
--    (it is the RPC's public signature) but is copied into a local immediately
--    and never referenced inside a query again.
--
--  * It staged the batch in a temporary table. With search_path pinned to ''
--    — which every SECURITY DEFINER function here does, to avoid the
--    privilege-escalation route — an unqualified temp table does not resolve.
--    An array needs no schema.

create or replace function public.discard_import(team_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  target_id uuid := team_id;   -- read once; never referenced in a query below
  target record;
  batch uuid;
  ids uuid[];
  removed int := 0;
begin
  if uid is null then
    raise exception 'must be signed in';
  end if;

  select t.* into target from public.teams t where t.id = target_id;
  if not found then
    raise exception 'no such team';
  end if;

  if target.created_by is distinct from uid then
    raise exception 'only the creator can discard an imported team';
  end if;
  if target.source is distinct from 'import' then
    raise exception 'only imported teams can be discarded';
  end if;

  batch := target.import_batch;

  -- An import creates the caller's team plus one per opponent; they go together
  -- or the opponents and the games between them are orphaned.
  if batch is null then
    ids := array[target_id];
  else
    select array_agg(t.id) into ids
    from public.teams t
    where t.import_batch = batch
      and t.created_by = uid
      and t.source = 'import';
  end if;

  -- Once anyone else has joined, this is shared data rather than a private
  -- import to undo.
  if exists (
    select 1
    from public.memberships m
    where m.team_id = any(ids)
      and m.user_id <> uid
  ) then
    raise exception 'cannot discard: another member has joined this team';
  end if;

  delete from public.game_lines gl
  using public.games g
  where gl.game_id = g.id
    and (g.home_team_id = any(ids) or g.away_team_id = any(ids));

  delete from public.games g
  where g.home_team_id = any(ids) or g.away_team_id = any(ids);

  delete from public.players p where p.team_id = any(ids);
  delete from public.memberships m where m.team_id = any(ids);

  delete from public.teams t where t.id = any(ids);
  get diagnostics removed = row_count;

  return removed;
end;
$$;

comment on function public.discard_import is
  'Remove an import that failed verification. Only teams the caller created by import, with no other members, and only as a whole batch.';
