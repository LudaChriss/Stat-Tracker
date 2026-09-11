-- Slice 4c: a game played between two teams in a league belongs to that league.
--
-- Until now nothing the app wrote ever set `games.league_id`. A fixture created
-- by schedule_game carried one; a game actually SCORED did not. The effect is
-- that a league table built from league games would have been permanently
-- empty, however many games were played in it — the rows existed and simply
-- were not filed anywhere the league could see them.
--
-- The rule, and it is deliberately narrow: a game belongs to a league when BOTH
-- teams are in that SAME league. One team in a league and one outside it is a
-- friendly, not a league fixture, and filing it under the league would put a
-- result in a table against a team the table does not contain.
--
-- WHAT THIS CHANGES ABOUT WHO CAN SEE A GAME, stated plainly because it is a
-- real consequence and not a side effect. `games_select_visible` admits anyone
-- for whom `league_is_readable(league_id)` is true. A league is public by
-- default (D3), so scoring a game between two teams in a public league makes
-- that game — and its box score — readable by anyone, signed in or not. That is
-- what a league IS: a table other people can look at. A league whose games
-- should not be public is set to private, which the column already supports and
-- which RLS already enforces.
--
-- Both functions are replaced at their existing signatures. Neither gains a
-- parameter: an overload would leave the previous version live beside the new
-- one, which is the trap _012 had to be rescued from.

-- -----------------------------------------------------------------------------
-- The league two teams share, or nothing.
-- -----------------------------------------------------------------------------
create or replace function public.shared_league(p_home uuid, p_away uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select h.league_id
  from public.teams h, public.teams a
  where h.id = p_home
    and a.id = p_away
    and h.league_id is not null
    and h.league_id = a.league_id;
$$;

comment on function public.shared_league(uuid, uuid) is
  'The league both teams are in, or NULL. A game belongs to a league only when both sides do -- one in and one out is a friendly, not a fixture.';

-- -----------------------------------------------------------------------------
-- start_live_game: file the live row under the league, if there is one.
--
-- Byte-identical to _016 apart from the two lines that compute and store
-- league_id.
-- -----------------------------------------------------------------------------
create or replace function public.start_live_game(p_team_id uuid, payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  game_client_id text;
  opponent_slug text;
  opponent_name text;
  opp_id uuid;
  my_is_home boolean;
  home_id uuid;
  away_id uuid;
  found_id uuid;
begin
  if uid is null then
    raise exception 'must be signed in';
  end if;
  if not public.can_score_team(p_team_id) then
    raise exception 'not allowed to record games for this team';
  end if;

  game_client_id := payload ->> 'clientId';
  if game_client_id is null then
    raise exception 'refusing to start a live game with no client id';
  end if;

  select g.id into found_id
  from public.games g
  where g.client_id = game_client_id
    and (g.home_team_id = p_team_id or g.away_team_id = p_team_id)
  limit 1;

  if found_id is not null then
    return found_id;
  end if;

  opponent_slug := payload ->> 'opponentId';
  opponent_name := coalesce(payload ->> 'opponent', 'Opponent');

  select t.id into opp_id
  from public.teams t
  join public.memberships m on m.team_id = t.id and m.user_id = uid
  where t.client_id is not distinct from opponent_slug
    and t.id <> p_team_id
  limit 1;

  if opp_id is null then
    insert into public.teams (name, client_id, created_by)
    values (opponent_name, opponent_slug, uid)
    returning id into opp_id;
    insert into public.memberships (user_id, team_id, role) values (uid, opp_id, 'team_manager');
  end if;

  my_is_home := coalesce((payload ->> 'home')::boolean, true);
  if my_is_home then
    home_id := p_team_id; away_id := opp_id;
  else
    home_id := opp_id; away_id := p_team_id;
  end if;

  insert into public.games (
    league_id, home_team_id, away_team_id, label, scheduled_at, status, sport,
    home_score, away_score, result, client_id, client_opponent_id, created_by
  )
  values (
    public.shared_league(home_id, away_id),
    home_id, away_id, payload ->> 'label',
    coalesce((payload ->> 'date')::timestamptz, now()),
    'live', coalesce(payload ->> 'sport', 'kickball'),
    0, 0, null, game_client_id, opponent_slug, uid
  )
  returning id into found_id;

  return found_id;
end;
$$;

comment on function public.start_live_game(uuid, jsonb) is
  'Create (or find) the live games row an event log hangs off, idempotently by client id across ALL authors -- so a second scorer joins the same game rather than starting a private copy. Filed under the league both teams share, if they share one.';

-- -----------------------------------------------------------------------------
-- save_game: the same, on the finished row.
--
-- Byte-identical to _018 apart from league_id on the insert and the update. In
-- particular the game-already-here lookup, the cancelled refusal, the
-- straggler check, the opponent resolution, the perspective flip and the
-- box-score replacement are unchanged.
-- -----------------------------------------------------------------------------
create or replace function public.save_game(
  p_team_id uuid,
  payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  opponent_slug text;
  opponent_name text;
  opp_id uuid;
  my_is_home boolean;
  home_id uuid;
  away_id uuid;
  home_pts int;
  away_pts int;
  home_result text;
  us int;
  them int;
  claimed text;
  expected text;
  line_count int;
  game_client_id text;
  existing_status text;
  final_seq bigint;
  stragglers int;
  new_game_id uuid;   -- never named game_id: it would collide with game_lines.game_id
  line jsonb;
  line_is_mine boolean;
  line_team_id uuid;
  line_pid text;
  line_player_id uuid;
begin
  if uid is null then
    raise exception 'must be signed in';
  end if;
  if not public.can_score_team(p_team_id) then
    raise exception 'not allowed to record games for this team';
  end if;

  game_client_id := payload ->> 'id';
  if game_client_id is null then
    raise exception 'refusing to save a game with no id';
  end if;

  line_count := jsonb_array_length(coalesce(payload -> 'lines', '[]'::jsonb));
  if line_count = 0 then
    raise exception 'refusing to save game % : it has no box-score lines, so nothing was actually recorded', game_client_id;
  end if;

  if payload -> 'score' is null
     or payload -> 'score' ->> 'us' is null
     or payload -> 'score' ->> 'them' is null then
    raise exception 'refusing to save game % : it has no final score', game_client_id;
  end if;

  us := (payload -> 'score' ->> 'us')::int;
  them := (payload -> 'score' ->> 'them')::int;
  claimed := payload ->> 'result';
  expected := case when us > them then 'W' when us < them then 'L' else 'T' end;

  if claimed is null then
    raise exception 'refusing to save game % : it has no result', game_client_id;
  end if;
  if claimed <> expected then
    raise exception 'refusing to save game % : result % disagrees with the score %-%, which should be %',
      game_client_id, claimed, us, them, expected;
  end if;

  select g.id, g.status into new_game_id, existing_status
  from public.games g
  where g.client_id = game_client_id
    and (g.home_team_id = p_team_id or g.away_team_id = p_team_id)
  limit 1;

  if new_game_id is not null then
    if existing_status = 'cancelled' then
      raise exception 'refusing to finalise game % : it was cancelled', game_client_id;
    end if;

    select max(e.seq) into final_seq
    from public.game_events e where e.game_id = new_game_id and e.kind = 'final';

    if final_seq is not null then
      select count(*) into stragglers
      from public.game_events e
      where e.game_id = new_game_id and e.seq > final_seq;

      if stragglers > 0 then
        raise exception
          'refusing to finalise game % : % play(s) were entered after the game was called, so this box score is missing them. The game is still live -- finalise it again from a phone that has them.',
          game_client_id, stragglers;
      end if;
    end if;
  end if;

  opponent_slug := payload ->> 'opponentId';
  opponent_name := coalesce(payload ->> 'opponent', 'Opponent');

  select t.id into opp_id
  from public.teams t
  join public.memberships m on m.team_id = t.id and m.user_id = uid
  where t.client_id is not distinct from opponent_slug
    and t.id <> p_team_id
  limit 1;

  if opp_id is null then
    insert into public.teams (name, client_id, created_by)
    values (opponent_name, opponent_slug, uid)
    returning id into opp_id;
    insert into public.memberships (user_id, team_id, role) values (uid, opp_id, 'team_manager');
  end if;

  my_is_home := coalesce((payload ->> 'home')::boolean, true);
  if my_is_home then
    home_id := p_team_id; away_id := opp_id;
    home_pts := us; away_pts := them;
    home_result := claimed;
  else
    home_id := opp_id; away_id := p_team_id;
    home_pts := them; away_pts := us;
    home_result := case claimed when 'W' then 'L' when 'L' then 'W' else claimed end;
  end if;

  if new_game_id is not null then
    update public.games set
      league_id = coalesce(league_id, public.shared_league(home_id, away_id)),
      home_team_id = home_id,
      away_team_id = away_id,
      label = payload ->> 'label',
      scheduled_at = coalesce((payload ->> 'date')::timestamptz, scheduled_at),
      status = 'final',
      sport = coalesce(payload ->> 'sport', 'kickball'),
      innings = (payload ->> 'innings')::int,
      home_score = home_pts,
      away_score = away_pts,
      result = home_result,
      client_opponent_id = opponent_slug
    where id = new_game_id;
  else
    insert into public.games (
      league_id, home_team_id, away_team_id, label, scheduled_at, status, sport, innings,
      home_score, away_score, result, client_id, client_opponent_id, created_by
    )
    values (
      public.shared_league(home_id, away_id),
      home_id, away_id, payload ->> 'label',
      coalesce((payload ->> 'date')::timestamptz, now()),
      'final', coalesce(payload ->> 'sport', 'kickball'), (payload ->> 'innings')::int,
      home_pts, away_pts, home_result, game_client_id, opponent_slug, uid
    )
    on conflict (created_by, client_id) do update
      set league_id = coalesce(public.games.league_id, excluded.league_id),
          home_team_id = excluded.home_team_id,
          away_team_id = excluded.away_team_id,
          label = excluded.label,
          scheduled_at = excluded.scheduled_at,
          status = excluded.status,
          sport = excluded.sport,
          innings = excluded.innings,
          home_score = excluded.home_score,
          away_score = excluded.away_score,
          result = excluded.result,
          client_opponent_id = excluded.client_opponent_id
    returning id into new_game_id;
  end if;

  delete from public.game_lines gl where gl.game_id = new_game_id;

  for line in select * from jsonb_array_elements(payload -> 'lines')
  loop
    line_pid := line ->> 'pid';
    line_is_mine := coalesce(line ->> 'team', 'home') = 'home';
    line_team_id := case when line_is_mine then p_team_id else opp_id end;

    line_player_id := null;
    if line_pid like 'h%' then
      select p.id into line_player_id from public.players p
      where p.team_id = p_team_id and p.client_id = nullif(substring(line_pid from 2), '')::int;
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

  return new_game_id;
end;
$$;

comment on function public.save_game(uuid, jsonb) is
  'Write one finalized game and its box score. Finishes the game already in the account for this client id, whoever started it, so two scorers cannot produce two rows. Files it under the league both teams share, if they share one. Refuses a game with no lines, no score, a result contradicting the score, a game that was cancelled, or a box score the event log has moved on from.';
