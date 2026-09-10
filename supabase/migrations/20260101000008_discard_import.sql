-- Undoing an import.
--
-- Migration up from local storage only marks local as a cache once the derived
-- figures read back identically. If they do not, the half-trusted import has to
-- be removed, or the user is left with a backend team that silently disagrees
-- with their real season.
--
-- Deleting teams is dangerous, so this is deliberately narrow. It can only
-- remove teams that:
--   * this user created, and
--   * were created by import (not built by hand), and
--   * nobody else has joined.
--
-- An import creates several teams at once — your own plus one per opponent —
-- so they are tagged with a shared batch id and discarded together. Removing
-- only the caller's team would orphan the opponents and the games between them.

alter table public.teams add column if not exists source text not null default 'manual';
alter table public.teams add column if not exists import_batch uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'teams_source_check') then
    alter table public.teams add constraint teams_source_check check (source in ('manual', 'import'));
  end if;
end
$$;

create index if not exists teams_import_batch_idx on public.teams (import_batch) where import_batch is not null;

comment on column public.teams.source is
  'How the team came to exist. Only import-created teams can be discarded by discard_import.';
comment on column public.teams.import_batch is
  'Groups every team created by a single import, so a failed import is undone as a unit.';

-- Tag the teams an import creates. Same body as before, plus source/batch.
create or replace function public.import_season(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  batch uuid := gen_random_uuid();
  my_team_id uuid;
  opponent_ids jsonb := '{}'::jsonb;
  opp jsonb;
  opp_id uuid;
  player jsonb;
  game jsonb;
  line jsonb;
  new_game_id uuid;
  my_is_home boolean;
  home_id uuid;
  away_id uuid;
  home_pts int;
  away_pts int;
  home_result text;
  line_is_mine boolean;
  line_team_id uuid;
  line_pid text;
  line_player_id uuid;
  slug text;
begin
  if uid is null then
    raise exception 'must be signed in to import a season';
  end if;

  insert into public.teams (name, prior_w, prior_l, prior_t, created_by, source, import_batch)
  values (
    coalesce(nullif(payload -> 'myTeam' ->> 'name', ''), 'My Team'),
    coalesce((payload -> 'myTeam' ->> 'priorW')::int, 0),
    coalesce((payload -> 'myTeam' ->> 'priorL')::int, 0),
    coalesce((payload -> 'myTeam' ->> 'priorT')::int, 0),
    uid, 'import', batch
  )
  returning id into my_team_id;

  insert into public.memberships (user_id, team_id, role)
  values (uid, my_team_id, 'team_manager');

  for player in select * from jsonb_array_elements(coalesce(payload -> 'roster', '[]'::jsonb))
  loop
    insert into public.players (team_id, name, number, position, color, client_id, sort_order)
    values (
      my_team_id, coalesce(player ->> 'name', 'Player'),
      nullif(player ->> 'num', 'null')::int,
      coalesce(player ->> 'pos', 'P'), coalesce(player ->> 'c', '#0E7490'),
      (player ->> 'id')::int, coalesce((player ->> 'id')::int, 0)
    );
  end loop;

  for opp in select * from jsonb_array_elements(coalesce(payload -> 'teams', '[]'::jsonb))
  loop
    insert into public.teams (name, prior_w, prior_l, prior_t, client_id, created_by, source, import_batch)
    values (
      coalesce(opp ->> 'name', 'Opponent'),
      coalesce((opp ->> 'priorW')::int, 0),
      coalesce((opp ->> 'priorL')::int, 0),
      coalesce((opp ->> 'priorT')::int, 0),
      opp ->> 'id', uid, 'import', batch
    )
    returning id into opp_id;

    insert into public.memberships (user_id, team_id, role) values (uid, opp_id, 'team_manager');
    opponent_ids := opponent_ids || jsonb_build_object(opp ->> 'id', opp_id::text);

    for player in select * from jsonb_array_elements(coalesce(opp -> 'players', '[]'::jsonb))
    loop
      insert into public.players (team_id, name, number, position, color, client_id, sort_order)
      values (
        opp_id, coalesce(player ->> 'name', 'Player'),
        nullif(player ->> 'num', 'null')::int,
        coalesce(player ->> 'pos', 'P'), coalesce(player ->> 'c', '#3D5A73'),
        (player ->> 'id')::int, coalesce((player ->> 'id')::int, 0)
      );
    end loop;
  end loop;

  for game in select * from jsonb_array_elements(coalesce(payload -> 'history', '[]'::jsonb))
  loop
    slug := game ->> 'opponentId';
    opp_id := nullif(opponent_ids ->> slug, '')::uuid;

    if opp_id is null then
      insert into public.teams (name, client_id, created_by, source, import_batch)
      values (coalesce(game ->> 'opponent', 'Opponent'), slug, uid, 'import', batch)
      returning id into opp_id;
      insert into public.memberships (user_id, team_id, role) values (uid, opp_id, 'team_manager');
      if slug is not null then
        opponent_ids := opponent_ids || jsonb_build_object(slug, opp_id::text);
      end if;
    end if;

    my_is_home := coalesce((game ->> 'home')::boolean, true);

    if my_is_home then
      home_id := my_team_id; away_id := opp_id;
      home_pts := coalesce((game -> 'score' ->> 'us')::int, 0);
      away_pts := coalesce((game -> 'score' ->> 'them')::int, 0);
      home_result := game ->> 'result';
    else
      home_id := opp_id; away_id := my_team_id;
      home_pts := coalesce((game -> 'score' ->> 'them')::int, 0);
      away_pts := coalesce((game -> 'score' ->> 'us')::int, 0);
      home_result := case game ->> 'result' when 'W' then 'L' when 'L' then 'W' else game ->> 'result' end;
    end if;

    insert into public.games (
      home_team_id, away_team_id, label, scheduled_at, status, sport, innings,
      home_score, away_score, result, client_id, client_opponent_id, created_by
    )
    values (
      home_id, away_id, game ->> 'label',
      coalesce((game ->> 'date')::timestamptz, now()),
      'final', coalesce(game ->> 'sport', 'kickball'), (game ->> 'innings')::int,
      home_pts, away_pts, home_result, game ->> 'id', slug, uid
    )
    returning id into new_game_id;

    for line in select * from jsonb_array_elements(coalesce(game -> 'lines', '[]'::jsonb))
    loop
      line_pid := line ->> 'pid';
      line_is_mine := coalesce(line ->> 'team', 'home') = 'home';
      line_team_id := case when line_is_mine then my_team_id else opp_id end;

      line_player_id := null;
      if line_pid like 'h%' then
        select p.id into line_player_id from public.players p
        where p.team_id = my_team_id and p.client_id = nullif(substring(line_pid from 2), '')::int;
      elsif line_pid like 'o:%' then
        select p.id into line_player_id from public.players p
        where p.team_id = line_team_id and p.client_id = nullif(split_part(line_pid, ':', 3), '')::int;
      end if;

      insert into public.game_lines (
        game_id, team_id, player_id, name_snapshot, home_away,
        ab, h, r, rbi, bb, k, d, t, hr, client_pid
      )
      values (
        new_game_id, line_team_id, line_player_id, coalesce(line ->> 'name', 'Player'),
        case when line_is_mine = my_is_home then 'home' else 'away' end,
        coalesce((line ->> 'ab')::int, 0), coalesce((line ->> 'h')::int, 0),
        coalesce((line ->> 'r')::int, 0), coalesce((line ->> 'rbi')::int, 0),
        coalesce((line ->> 'bb')::int, 0), coalesce((line ->> 'k')::int, 0),
        coalesce((line ->> 'd')::int, 0), coalesce((line ->> 't')::int, 0),
        coalesce((line ->> 'hr')::int, 0), line_pid
      );
    end loop;
  end loop;

  return my_team_id;
end;
$$;

-- ---------------------------------------------------------------------------

create or replace function public.discard_import(team_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  batch uuid;
  target record;
  removed int := 0;
begin
  if uid is null then
    raise exception 'must be signed in';
  end if;

  select t.* into target from public.teams t where t.id = team_id;
  if not found then
    raise exception 'no such team';
  end if;

  -- Only your own, only import-created, never a team built by hand.
  if target.created_by is distinct from uid then
    raise exception 'only the creator can discard an imported team';
  end if;
  if target.source is distinct from 'import' then
    raise exception 'only imported teams can be discarded';
  end if;

  batch := target.import_batch;

  -- Nobody else may have joined any team in the batch. Once a second person is
  -- involved this is shared data, not a private import to undo.
  if exists (
    select 1
    from public.memberships m
    join public.teams t on t.id = m.team_id
    where (batch is not null and t.import_batch = batch or t.id = team_id)
      and m.user_id <> uid
  ) then
    raise exception 'cannot discard: another member has joined this team';
  end if;

  create temporary table if not exists _discard_targets (id uuid primary key) on commit drop;
  delete from _discard_targets;

  if batch is null then
    insert into _discard_targets (id) values (team_id);
  else
    insert into _discard_targets (id)
    select t.id from public.teams t
    where t.import_batch = batch and t.created_by = uid and t.source = 'import';
  end if;

  -- Children first: game_lines, then games, then players, then memberships.
  delete from public.game_lines gl
  using public.games g
  where gl.game_id = g.id
    and (g.home_team_id in (select id from _discard_targets)
      or g.away_team_id in (select id from _discard_targets));

  delete from public.games g
  where g.home_team_id in (select id from _discard_targets)
     or g.away_team_id in (select id from _discard_targets);

  delete from public.players p where p.team_id in (select id from _discard_targets);
  delete from public.memberships m where m.team_id in (select id from _discard_targets);

  delete from public.teams t where t.id in (select id from _discard_targets);
  get diagnostics removed = row_count;

  return removed;
end;
$$;

comment on function public.discard_import is
  'Remove an import that failed verification. Only teams the caller created by import, with no other members, and only as a whole batch.';
