-- Stop save_season from wiping a roster.
--
-- It deleted every player absent from the incoming payload — which is how
-- removing a player on the phone removes them in the account — but it accepted
-- an empty payload without complaint and deleted everyone. Any save carrying
-- blank or half-loaded app state emptied the roster, and the team name survived
-- because that is a separate update. That is exactly the symptom seen: a team
-- with a name and no players.
--
-- Confirmed against a real database before this fix:
--     players after import              : 10
--     save_season with an EMPTY roster   : accepted
--     players after that save            : 0
--
-- The rule now: deleting the last player is never something a routine save is
-- allowed to do by accident. Clearing a roster deliberately is still possible,
-- but the caller has to say so.
--
-- This is the database half. The client half — never saving state that has not
-- finished loading — is fixed alongside it. Either alone would have prevented
-- this; both are cheap.

-- Adding a defaulted parameter creates a SECOND overload rather than replacing
-- the old function, which then makes "comment on function save_season"
-- ambiguous and aborts the migration — leaving the unguarded version live. Drop
-- the old signature explicitly.
drop function if exists public.save_season(uuid, jsonb);

create or replace function public.save_season(
  p_team_id uuid,
  payload jsonb,
  allow_empty_roster boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  player jsonb;
  keep int[] := '{}';
  incoming int;
  existing int;
begin
  if not public.can_manage_team(p_team_id) then
    raise exception 'not allowed to edit this team';
  end if;

  incoming := jsonb_array_length(coalesce(payload -> 'roster', '[]'::jsonb));
  select count(*) into existing from public.players p where p.team_id = p_team_id;

  -- The catastrophic case, refused loudly rather than applied quietly. The
  -- write is rejected, the queue parks it, and the app can say so — far better
  -- than a silent success that leaves no roster behind.
  if incoming = 0 and existing > 0 and not allow_empty_roster then
    raise exception
      'refusing to remove all % players from this team: the save carried an empty roster. Pass allow_empty_roster to do this deliberately.',
      existing;
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

comment on function public.save_season(uuid, jsonb, boolean) is
  'Apply a season snapshot to a team in one transaction. Refuses to empty a non-empty roster unless allow_empty_roster is set. Authorisation is still checked; definer is only for atomicity.';
