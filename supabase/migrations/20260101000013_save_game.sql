-- Persist a finalized game.
--
-- A narrow slice pulled forward from phase 3: when a game is marked final on a
-- device it is written to the backend, so it stops being phone-only. This is
-- NOT the append-only command log, and nothing here does live or shared
-- scoring — a finished game is written once, as a unit.
--
-- Two disciplines carried over from earlier mistakes:
--
--   * Idempotent. The write goes through the offline queue and may be retried
--     after a timeout that actually succeeded. A duplicated game silently
--     corrupts the standings, which is worse than a failed write, so the same
--     client_id resolves to the same row every time.
--
--   * Refuses rather than accepts. save_season quietly accepted an empty
--     roster and deleted ten players. A game that looks unfinished is rejected
--     by name, so the queue parks it where it can be seen.

-- One finalized game per client id per author. Not partial: a partial unique
-- index cannot back an ON CONFLICT clause, which is how the roster upsert
-- silently failed for a whole day.
create unique index if not exists games_author_client_id_key
  on public.games (created_by, client_id);

create or replace function public.save_game(p_team_id uuid, payload jsonb)
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
  if not public.can_manage_team(p_team_id) then
    raise exception 'not allowed to record games for this team';
  end if;

  -- ---- refuse anything that does not look like a finished game ------------
  if payload ->> 'id' is null then
    raise exception 'refusing to save a game with no id';
  end if;

  line_count := jsonb_array_length(coalesce(payload -> 'lines', '[]'::jsonb));
  if line_count = 0 then
    raise exception 'refusing to save game % : it has no box-score lines, so nothing was actually recorded', payload ->> 'id';
  end if;

  if payload -> 'score' is null
     or payload -> 'score' ->> 'us' is null
     or payload -> 'score' ->> 'them' is null then
    raise exception 'refusing to save game % : it has no final score', payload ->> 'id';
  end if;

  us := (payload -> 'score' ->> 'us')::int;
  them := (payload -> 'score' ->> 'them')::int;
  claimed := payload ->> 'result';
  -- A 0-0 final is perfectly legitimate; a result that contradicts the score
  -- is not, and would quietly move the standings the wrong way.
  expected := case when us > them then 'W' when us < them then 'L' else 'T' end;

  if claimed is null then
    raise exception 'refusing to save game % : it has no result', payload ->> 'id';
  end if;
  if claimed <> expected then
    raise exception 'refusing to save game % : result % disagrees with the score %-%, which should be %',
      payload ->> 'id', claimed, us, them, expected;
  end if;

  -- ---- resolve the opponent ------------------------------------------------
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

  -- ---- perspective ---------------------------------------------------------
  -- The row records score and result from the HOME team's point of view,
  -- because a game belongs to two teams. The client records its own.
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

  insert into public.games (
    home_team_id, away_team_id, label, scheduled_at, status, sport, innings,
    home_score, away_score, result, client_id, client_opponent_id, created_by
  )
  values (
    home_id, away_id, payload ->> 'label',
    coalesce((payload ->> 'date')::timestamptz, now()),
    'final', coalesce(payload ->> 'sport', 'kickball'), (payload ->> 'innings')::int,
    home_pts, away_pts, home_result, payload ->> 'id', opponent_slug, uid
  )
  on conflict (created_by, client_id) do update
    set home_team_id = excluded.home_team_id,
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

  -- Replacing the lines wholesale keeps a retry identical to a first write
  -- rather than accumulating duplicates.
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
      -- relative to the GAME, not to us
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
  'Write one finalized game and its box score, idempotently by client id. Refuses a game with no lines, no score, or a result contradicting the score.';
