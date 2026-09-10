-- Import an exported season into the backend, atomically.
--
-- This is the migration path off local-only storage: it takes the same JSON the
-- app already exports and reproduces it as real rows. It runs as one function
-- rather than a series of client calls for two reasons:
--
--   * Atomicity. A half-imported season — roster in, games missing — is worse
--     than a failed import, because it looks like it worked. Any error rolls
--     the whole thing back.
--   * teams has no direct INSERT policy (a team must always have a manager),
--     so creating one is a privileged operation either way.
--
-- Not idempotent by design: calling it twice imports twice. The caller confirms
-- first, which is also where the user gets told what is about to be created.

create or replace function public.import_season(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  my_team_id uuid;
  opponent_ids jsonb := '{}'::jsonb;   -- client slug -> uuid, for game linking
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

  ---------------------------------------------------------------- my team ----
  insert into public.teams (name, prior_w, prior_l, prior_t, created_by)
  values (
    coalesce(nullif(payload -> 'myTeam' ->> 'name', ''), 'My Team'),
    coalesce((payload -> 'myTeam' ->> 'priorW')::int, 0),
    coalesce((payload -> 'myTeam' ->> 'priorL')::int, 0),
    coalesce((payload -> 'myTeam' ->> 'priorT')::int, 0),
    uid
  )
  returning id into my_team_id;

  insert into public.memberships (user_id, team_id, role)
  values (uid, my_team_id, 'team_manager');

  for player in select * from jsonb_array_elements(coalesce(payload -> 'roster', '[]'::jsonb))
  loop
    insert into public.players (team_id, name, number, position, color, client_id, sort_order)
    values (
      my_team_id,
      coalesce(player ->> 'name', 'Player'),
      nullif(player ->> 'num', 'null')::int,
      coalesce(player ->> 'pos', 'P'),
      coalesce(player ->> 'c', '#0E7490'),
      (player ->> 'id')::int,
      coalesce((player ->> 'id')::int, 0)
    );
  end loop;

  ------------------------------------------------------- opposing teams ------
  -- The importer becomes manager of the opponents too. They are that user's
  -- own record of those teams; when a league is formed later, canonical teams
  -- replace them.
  for opp in select * from jsonb_array_elements(coalesce(payload -> 'teams', '[]'::jsonb))
  loop
    insert into public.teams (name, prior_w, prior_l, prior_t, client_id, created_by)
    values (
      coalesce(opp ->> 'name', 'Opponent'),
      coalesce((opp ->> 'priorW')::int, 0),
      coalesce((opp ->> 'priorL')::int, 0),
      coalesce((opp ->> 'priorT')::int, 0),
      opp ->> 'id',
      uid
    )
    returning id into opp_id;

    insert into public.memberships (user_id, team_id, role)
    values (uid, opp_id, 'team_manager');

    opponent_ids := opponent_ids || jsonb_build_object(opp ->> 'id', opp_id::text);

    for player in select * from jsonb_array_elements(coalesce(opp -> 'players', '[]'::jsonb))
    loop
      insert into public.players (team_id, name, number, position, color, client_id, sort_order)
      values (
        opp_id,
        coalesce(player ->> 'name', 'Player'),
        nullif(player ->> 'num', 'null')::int,
        coalesce(player ->> 'pos', 'P'),
        coalesce(player ->> 'c', '#3D5A73'),
        (player ->> 'id')::int,
        coalesce((player ->> 'id')::int, 0)
      );
    end loop;
  end loop;

  ------------------------------------------------------------- games ---------
  for game in select * from jsonb_array_elements(coalesce(payload -> 'history', '[]'::jsonb))
  loop
    slug := game ->> 'opponentId';
    opp_id := nullif(opponent_ids ->> slug, '')::uuid;

    -- A game against a team that has since been deleted still has to import;
    -- the name snapshot on the record is what history is actually keyed to.
    if opp_id is null then
      insert into public.teams (name, client_id, created_by)
      values (coalesce(game ->> 'opponent', 'Opponent'), slug, uid)
      returning id into opp_id;

      insert into public.memberships (user_id, team_id, role)
      values (uid, opp_id, 'team_manager');

      if slug is not null then
        opponent_ids := opponent_ids || jsonb_build_object(slug, opp_id::text);
      end if;
    end if;

    my_is_home := coalesce((game ->> 'home')::boolean, true);

    -- The client records score and result from ITS OWN perspective; the row
    -- records them from the home team's. Getting this backwards would silently
    -- invert every away result.
    if my_is_home then
      home_id := my_team_id;
      away_id := opp_id;
      home_pts := coalesce((game -> 'score' ->> 'us')::int, 0);
      away_pts := coalesce((game -> 'score' ->> 'them')::int, 0);
      home_result := game ->> 'result';
    else
      home_id := opp_id;
      away_id := my_team_id;
      home_pts := coalesce((game -> 'score' ->> 'them')::int, 0);
      away_pts := coalesce((game -> 'score' ->> 'us')::int, 0);
      home_result := case game ->> 'result'
                       when 'W' then 'L'
                       when 'L' then 'W'
                       else game ->> 'result'
                     end;
    end if;

    insert into public.games (
      home_team_id, away_team_id, label, scheduled_at, status, sport, innings,
      home_score, away_score, result, client_id, client_opponent_id, created_by
    )
    values (
      home_id, away_id,
      game ->> 'label',
      coalesce((game ->> 'date')::timestamptz, now()),
      'final',
      coalesce(game ->> 'sport', 'kickball'),
      (game ->> 'innings')::int,
      home_pts, away_pts, home_result,
      game ->> 'id', slug, uid
    )
    returning id into new_game_id;

    for line in select * from jsonb_array_elements(coalesce(game -> 'lines', '[]'::jsonb))
    loop
      line_pid := line ->> 'pid';
      line_is_mine := coalesce(line ->> 'team', 'home') = 'home';
      line_team_id := case when line_is_mine then my_team_id else opp_id end;

      -- Resolve the player only where one exists. An untracked opponent slot
      -- ('a3') deliberately has none: slot 3 is a different person each week.
      line_player_id := null;
      if line_pid like 'h%' then
        select p.id into line_player_id
        from public.players p
        where p.team_id = my_team_id
          and p.client_id = nullif(substring(line_pid from 2), '')::int;
      elsif line_pid like 'o:%' then
        select p.id into line_player_id
        from public.players p
        where p.team_id = line_team_id
          and p.client_id = nullif(split_part(line_pid, ':', 3), '')::int;
      end if;

      insert into public.game_lines (
        game_id, team_id, player_id, name_snapshot, home_away,
        ab, h, r, rbi, bb, k, d, t, hr, client_pid
      )
      values (
        new_game_id, line_team_id, line_player_id,
        coalesce(line ->> 'name', 'Player'),
        -- home_away is relative to the GAME, not to the importing team.
        case when line_is_mine = my_is_home then 'home' else 'away' end,
        coalesce((line ->> 'ab')::int, 0),
        coalesce((line ->> 'h')::int, 0),
        coalesce((line ->> 'r')::int, 0),
        coalesce((line ->> 'rbi')::int, 0),
        coalesce((line ->> 'bb')::int, 0),
        coalesce((line ->> 'k')::int, 0),
        coalesce((line ->> 'd')::int, 0),
        coalesce((line ->> 't')::int, 0),
        coalesce((line ->> 'hr')::int, 0),
        line_pid
      );
    end loop;
  end loop;

  return my_team_id;
end;
$$;

comment on function public.import_season is
  'Atomically import an exported season as a new team owned by the caller. Returns the new team id.';
