-- Phase 3 loose ends: a live game nobody finished, and the way back to the
-- schedule for a league fixture that was called off.
--
-- Additive only. One nullable column and two new functions. Nothing that exists
-- is replaced: save_game, schedule_game, start_live_game, append_game_event and
-- cancel_live_game are all exactly as they were.
--
-- 1. abandon_live_game — end a game that has stopped, on somebody else's behalf.
--
--    The tombstone is the one cancel_live_game already writes: status
--    `cancelled`, the row and its whole log kept. That is deliberate (D18). Every
--    reader that keeps a game out of a season, a history, a league table or the
--    league screen's lists already keeps `cancelled` out, and has tests saying
--    so. A new status would have to be taught to every one of them, and the one
--    that was missed would count an abandoned game as a result.
--
--    What is new is that the LOG says it too, in the same transaction, with a
--    `cancel` event whose payload says `abandoned` — so the record shows who
--    ended the game and that it was ended for having stopped, and a phone that
--    comes back to it later is taken out of it by the replay it already does.
--    It is a `cancel` event rather than a new kind so that a phone on an older
--    build folds it as the end of the game rather than ignoring it.
--
--    And it refuses if the log has moved since the caller looked. "Stale" is
--    judged on a phone, from a list that can be a few seconds old; a rain delay
--    ending in those seconds must not be abandoned out from under the scorer.
--    The check runs under the same per-game lock every append takes, so a play
--    and an abandon cannot interleave.
--
-- 2. reschedule_called_off_game — put a cancelled league fixture back on the
--    calendar, as a NEW fixture (D19).
--
--    Not by returning the same row to `scheduled`. A called-off game's row may
--    have a phone somewhere still holding plays it entered and never sent. While
--    the row is cancelled those plays are refused when they arrive and park where
--    they can be seen. Put the same row back on the schedule and score it again,
--    and they are accepted — into a different game. The server cannot tell "no
--    plays were entered" from "no plays arrived", so this applies to a fixture
--    with an empty log exactly as much as to one with plays in it.
--
--    The old row keeps its log and its tombstone, and records which fixture
--    replaced it, which is how the league screen knows it has been dealt with.

-- -----------------------------------------------------------------------------
-- games.replaced_by
-- -----------------------------------------------------------------------------
alter table public.games
  add column if not exists replaced_by uuid references public.games(id) on delete set null;

comment on column public.games.replaced_by is
  'For a called-off league fixture: the fixture that was scheduled in its place. Null for everything else.';

-- -----------------------------------------------------------------------------
-- abandon_live_game
-- -----------------------------------------------------------------------------
create or replace function public.abandon_live_game(p_game_id uuid, p_seen_seq bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  current_status text;
  last_seq bigint;
begin
  if uid is null then
    raise exception 'must be signed in';
  end if;
  if not public.can_score_game(p_game_id) then
    raise exception 'not allowed to score this game';
  end if;
  if p_seen_seq is null then
    raise exception 'refusing to abandon game % : say which play you last saw', p_game_id;
  end if;

  -- The same lock append_game_event takes. Everything below sees a log no play
  -- can be added to until this transaction ends.
  perform pg_advisory_xact_lock(hashtextextended(p_game_id::text, 0));

  select g.status into current_status from public.games g where g.id = p_game_id;
  if current_status is null then
    raise exception 'refusing to abandon game % : there is no such game', p_game_id;
  end if;

  -- Already over by cancellation, from here or anywhere: succeed quietly. A
  -- retry of an abandon that worked must not be reported as a failure.
  if current_status = 'cancelled' then
    return;
  end if;
  if current_status = 'final' then
    raise exception 'refusing to abandon game % : it has already been finalised', p_game_id;
  end if;
  if current_status <> 'live' then
    raise exception 'refusing to abandon game % : it has not been started', p_game_id;
  end if;

  select coalesce(max(e.seq), 0) into last_seq
  from public.game_events e where e.game_id = p_game_id;

  if last_seq > p_seen_seq then
    raise exception
      'refusing to abandon game % : % play(s) have been entered since you looked, so it is still being scored',
      p_game_id, last_seq - p_seen_seq;
  end if;

  insert into public.game_events (game_id, seq, kind, payload, actor, client_event_id)
  values (
    p_game_id, last_seq + 1, 'cancel',
    jsonb_build_object('reason', 'abandoned', 'seenSeq', p_seen_seq),
    uid, 'abandon:' || p_game_id::text
  );

  update public.games set status = 'cancelled' where id = p_game_id;
end;
$$;

comment on function public.abandon_live_game(uuid, bigint) is
  'End a live game that has stopped being scored: a cancel event saying abandoned, and the cancelled tombstone, together. Keeps the row and the whole log. Refuses if any play was appended after p_seen_seq. Idempotent on a game already cancelled.';

-- -----------------------------------------------------------------------------
-- reschedule_called_off_game
-- -----------------------------------------------------------------------------
create or replace function public.reschedule_called_off_game(p_game_id uuid, payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  old record;
  v_client_id text;
  new_id uuid;
begin
  if uid is null then
    raise exception 'must be signed in';
  end if;

  select g.id, g.league_id, g.home_team_id, g.away_team_id, g.status, g.sport, g.replaced_by
  into old
  from public.games g
  where g.id = p_game_id
  for update;

  if not found or old.league_id is null then
    raise exception 'refusing to reschedule game % : there is no such league game', p_game_id;
  end if;
  -- The same words schedule_game uses, so the app says the same thing.
  if not public.is_league_admin(old.league_id) then
    raise exception 'only a league admin can schedule games in this league';
  end if;
  if old.status <> 'cancelled' then
    raise exception 'refusing to reschedule game % : it is %, not called off', p_game_id, old.status;
  end if;

  -- Already put back. A retry lands on the fixture the first attempt made, and
  -- moving THAT fixture is schedule_game's job, like any other.
  if old.replaced_by is not null then
    return old.replaced_by;
  end if;

  v_client_id := payload ->> 'clientId';
  if v_client_id is null then
    raise exception 'refusing to schedule a game with no id';
  end if;

  if not exists (select 1 from public.teams t where t.id = old.home_team_id and t.league_id = old.league_id) then
    raise exception 'refusing to schedule: the home team is not in this league';
  end if;
  if not exists (select 1 from public.teams t where t.id = old.away_team_id and t.league_id = old.league_id) then
    raise exception 'refusing to schedule: the away team is not in this league';
  end if;

  insert into public.games (
    league_id, home_team_id, away_team_id, scheduled_at, label, status, sport, client_id, created_by
  )
  values (
    old.league_id, old.home_team_id, old.away_team_id,
    coalesce((payload ->> 'scheduledAt')::timestamptz, now()),
    payload ->> 'label', 'scheduled', old.sport, v_client_id, uid
  )
  returning id into new_id;

  update public.games set replaced_by = new_id where id = p_game_id;
  return new_id;
end;
$$;

comment on function public.reschedule_called_off_game(uuid, jsonb) is
  'Put a called-off (cancelled) league fixture back on the calendar as a new scheduled fixture between the same teams. League admin only. The old row keeps its log and its tombstone and records replaced_by. Idempotent: a second call returns the fixture the first one made.';

-- Signed-in callers only. Both functions already refuse a caller with no
-- auth.uid(); this keeps anonymous callers from reaching them at all.
revoke all on function public.abandon_live_game(uuid, bigint) from public;
grant execute on function public.abandon_live_game(uuid, bigint) to authenticated;
revoke all on function public.reschedule_called_off_game(uuid, jsonb) from public;
grant execute on function public.reschedule_called_off_game(uuid, jsonb) to authenticated;
