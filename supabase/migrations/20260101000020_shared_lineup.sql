-- Slice 4b: the batting order stops being one phone's private opinion.
--
-- Since phase 1 the account has held the roster but not the ORDER — which
-- players are in the lineup, in what sequence, and who is on the bench. That
-- was fine while one person scored: the order lived on their phone and nowhere
-- else. With two scorers it is not, and the reason is sharper than tidiness.
--
-- The order decides who is at the plate. Who is at the plate decides whose stat
-- line a play is written to. Two phones disagreeing about the order do not
-- disagree cosmetically — they file the same double against two different
-- players, and neither of them is told.
--
-- Phase 3 covered the live case: the `start` event carries the lineup, so
-- everyone replaying a game agrees within it. What it does not cover is the
-- gap BETWEEN games, which is where the order is actually set. A manager who
-- rearranges the order on Tuesday and hands the phone to a scorer on Thursday
-- is relying on this.
--
-- Two columns, and save_season learns to write them.
--
--   lineup_order  the player's place in the batting order, 1-based.
--                 NULL means they are not in the order at all.
--   on_bench      in the squad, not in the order. Distinct from "removed",
--                 which deletes the row.
--
-- A roster written before these existed has neither, which reads back as
-- "no order recorded" — and the client then keeps whatever order the phone
-- already had, rather than emptying it. An absent order is not an empty one.

alter table public.players
  add column if not exists lineup_order int,
  add column if not exists on_bench boolean not null default false;

comment on column public.players.lineup_order is
  'Place in the batting order, 1-based. NULL means not in the order. Shared, because who is at the plate decides whose stat line a play lands on.';

comment on column public.players.on_bench is
  'In the squad but not in the batting order. Distinct from being removed, which deletes the row.';

-- Reading a team's order is reading its roster, which is already indexed by
-- team; no separate index earns its keep at rec-league roster sizes.

-- -----------------------------------------------------------------------------
-- save_season, fourth version.
--
-- Same signature, deliberately. Every other line is unchanged: the same
-- empty-roster refusal (the _012 guard), the same team update, the same
-- upsert-then-delete, the same authorisation check. The only difference is two
-- more columns on the way through.
--
-- Adding a parameter instead of replacing would create an overload and leave
-- the guarded version sitting beside an unguarded one -- exactly the trap _012
-- itself had to be rescued from.
-- -----------------------------------------------------------------------------
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
  has_order boolean;
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

  -- Does this payload say anything about the order at all?
  --
  -- A client too old to know about lineups sends a roster with no `lineup` key.
  -- Taking that as "nobody is in the order" would wipe a real batting order
  -- from the account every time such a phone saved — an absence is not an
  -- instruction, and this is the same lesson as the empty roster above.
  has_order := payload ? 'lineup';

  update public.teams
  set name = coalesce(nullif(payload -> 'myTeam' ->> 'name', ''), name),
      prior_w = coalesce((payload -> 'myTeam' ->> 'priorW')::int, prior_w),
      prior_l = coalesce((payload -> 'myTeam' ->> 'priorL')::int, prior_l),
      prior_t = coalesce((payload -> 'myTeam' ->> 'priorT')::int, prior_t)
  where id = p_team_id;

  for player in select * from jsonb_array_elements(coalesce(payload -> 'roster', '[]'::jsonb))
  loop
    keep := keep || (player ->> 'id')::int;

    insert into public.players (
      team_id, name, number, position, color, client_id, sort_order, lineup_order, on_bench
    )
    values (
      p_team_id,
      coalesce(player ->> 'name', 'Player'),
      nullif(player ->> 'num', 'null')::int,
      coalesce(player ->> 'pos', 'P'),
      coalesce(player ->> 'c', '#0E7490'),
      (player ->> 'id')::int,
      coalesce((player ->> 'sortOrder')::int, (player ->> 'id')::int, 0),
      case when has_order then
        (select ord from jsonb_array_elements(payload -> 'lineup') with ordinality as t(v, ord)
          where t.v::text = (player ->> 'id'))
      end,
      case when has_order then
        coalesce((select true from jsonb_array_elements(coalesce(payload -> 'bench', '[]'::jsonb)) b
          where b::text = (player ->> 'id')), false)
      else false end
    )
    on conflict (team_id, client_id) do update
      set name = excluded.name,
          number = excluded.number,
          position = excluded.position,
          color = excluded.color,
          sort_order = excluded.sort_order,
          -- Only when the payload actually spoke about the order.
          lineup_order = case when has_order then excluded.lineup_order else public.players.lineup_order end,
          on_bench = case when has_order then excluded.on_bench else public.players.on_bench end;
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
  'Apply a season snapshot to a team in one transaction, including the batting order and the bench. Refuses to empty a non-empty roster unless allow_empty_roster is set. A payload that says nothing about the order leaves the recorded order alone. Authorisation is still checked; definer is only for atomicity.';
