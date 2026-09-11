-- Slice 3d: ending a game that more than one phone was scoring.
--
-- Undo needs nothing here: it is an append like any other play, and the log is
-- already immutable at the database layer. Cancelling and finalising do need
-- something, because both of them end the game for everybody.
--
-- Two functions, and one changed rule in save_game.
--
-- 1. cancel_live_game — the tombstone.
--
--    A cancelled game is not deleted and its log is not deleted. The row stops
--    being live and starts being cancelled, which is what keeps it out of the
--    standings while leaving every play that was entered readable. Deleting
--    would be the one operation nobody could undo.
--
-- 2. save_game finishes THE GAME, not a copy of it.
--
--    Until now the write was keyed on (created_by, client_id): the author's own
--    idempotency key. That is exactly right when one phone scores a game alone,
--    and wrong the moment two do — the scorer who did not start the game would
--    insert a SECOND row for it, and the standings would count it twice.
--
--    save_game now looks for the game by client id among the games this team is
--    playing, whoever started it, and finishes that one. The unique index on
--    (created_by, client_id) is untouched and still stops one author
--    duplicating a game.
--
-- 3. The box score has to agree with the log.
--
--    A finished game is written from one phone's state. If a play was entered
--    somewhere else after that state was worked out, the box score is missing
--    it — and it would be missing it silently, which is the one outcome this
--    whole build refuses. So: if the log has anything after the event that
--    called the game, the write is refused by name and the game stays live.
--
--    A game with no log at all — scored on a phone that was never signed in,
--    or finalised before any of this existed — skips every one of these checks
--    and is written exactly as it always was.

-- -----------------------------------------------------------------------------
-- cancel_live_game
-- -----------------------------------------------------------------------------
create or replace function public.cancel_live_game(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  current_status text;
begin
  if uid is null then
    raise exception 'must be signed in';
  end if;
  if not public.can_score_game(p_game_id) then
    raise exception 'not allowed to score this game';
  end if;

  select g.status into current_status from public.games g where g.id = p_game_id;
  if current_status is null then
    raise exception 'refusing to cancel game % : there is no such game', p_game_id;
  end if;

  -- Already cancelled: say nothing and succeed. This arrives through the write
  -- queue, which retries after a timeout that may have worked.
  if current_status = 'cancelled' then
    return;
  end if;
  if current_status = 'final' then
    raise exception 'refusing to cancel game % : it has already been finalised', p_game_id;
  end if;

  update public.games set status = 'cancelled' where id = p_game_id;
end;
$$;

comment on function public.cancel_live_game(uuid) is
  'Mark a live game abandoned. The row and its whole event log are kept -- the tombstone is the point. Idempotent; refuses a game that was already finalised.';

-- -----------------------------------------------------------------------------
-- save_game, third version.
--
-- Everything about what a finished game LOOKS like is byte-identical to
-- 20260101000014: the same guards, the same opponent resolution, the same
-- perspective flip, the same box-score replacement. What changes is which row
-- gets finished, and one new refusal.
--
-- The signature is deliberately unchanged. Adding even a defaulted parameter
-- would create a second overload rather than replace this function, leaving the
-- old version live and "comment on function" ambiguous -- the trap migration 12
-- had to be rescued from. Everything the new checks need is already in the
-- database.
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

  -- ---- refuse anything that does not look like a finished game ------------
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
  -- A 0-0 final is perfectly legitimate; a result that contradicts the score
  -- is not, and would quietly move the standings the wrong way.
  expected := case when us > them then 'W' when us < them then 'L' else 'T' end;

  if claimed is null then
    raise exception 'refusing to save game % : it has no result', game_client_id;
  end if;
  if claimed <> expected then
    raise exception 'refusing to save game % : result % disagrees with the score %-%, which should be %',
      game_client_id, claimed, us, them, expected;
  end if;

  -- ---- is this game already here, started by anyone? ----------------------
  select g.id, g.status into new_game_id, existing_status
  from public.games g
  where g.client_id = game_client_id
    and (g.home_team_id = p_team_id or g.away_team_id = p_team_id)
  limit 1;

  if new_game_id is not null then
    if existing_status = 'cancelled' then
      raise exception 'refusing to finalise game % : it was cancelled', game_client_id;
    end if;

    -- ---- the box score must agree with the log it came from ---------------
    --
    -- The phone calling the game appends a `final` event, then reads the whole
    -- log back and checks its box score against a replay of it. Anything that
    -- arrived BEFORE the call is therefore already accounted for. What it
    -- cannot see is a play entered somewhere else in the moment between, and
    -- that is what this catches: if the log has moved on past the event that
    -- called the game, this box score is missing plays and is refused rather
    -- than written.
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

  if new_game_id is not null then
    -- Finish the game that is already here, whoever started it. Written as an
    -- update rather than an upsert because the conflict target would be the
    -- author's key, which is the whole problem when the author is somebody
    -- else's phone.
    update public.games set
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
      home_team_id, away_team_id, label, scheduled_at, status, sport, innings,
      home_score, away_score, result, client_id, client_opponent_id, created_by
    )
    values (
      home_id, away_id, payload ->> 'label',
      coalesce((payload ->> 'date')::timestamptz, now()),
      'final', coalesce(payload ->> 'sport', 'kickball'), (payload ->> 'innings')::int,
      home_pts, away_pts, home_result, game_client_id, opponent_slug, uid
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
  end if;

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
  'Write one finalized game and its box score. Finishes the game already in the account for this client id, whoever started it, so two scorers cannot produce two rows. Refuses a game with no lines, no score, a result contradicting the score, a game that was cancelled, or a box score the event log has moved on from.';
