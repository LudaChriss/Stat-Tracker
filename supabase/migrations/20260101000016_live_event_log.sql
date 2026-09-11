-- Slice 3a: the append-only event log, written as the game happens.
--
-- Until now a game in progress existed only in one phone's memory. It was
-- written once, at finalisation, by save_game. Lose the phone in the 5th and
-- the game never happened -- no roster line, no score, nothing to reconstruct
-- it from. That is the gap this closes.
--
-- Three decisions are baked into the two functions below.
--
-- 1. THE SEQUENCE IS ASSIGNED BY THE SERVER.
--
--    The original schema comment described UNIQUE(game_id, seq) as a
--    compare-and-swap: a client proposes the next seq and loses the race if
--    someone else claimed it. That works, but it pushes a retry loop onto a
--    phone on a field with one bar of signal, and the loser of the race is the
--    person who has to try again.
--
--    append_game_event takes the lock instead. A per-game advisory lock, held
--    for the length of the transaction, means max(seq)+1 cannot be read stale.
--    Two phones appending at the same instant both succeed, one after the
--    other, and the order they end up in is the order the server put them in.
--    Nothing is refused, nothing is merged, nothing is dropped.
--
-- 2. AN APPEND IS IDEMPOTENT ON THE CLIENT'S OWN EVENT ID.
--
--    Same discipline as save_game, and for the same reason: these writes go
--    through the offline queue, which retries after a timeout that may
--    actually have succeeded. A second copy of a home run is worse than a
--    failed write, because it is silent. The client mints an id per event and
--    a repeat of that id returns the row that already exists.
--
--    The unique index deliberately allows NULL client_event_id, so the direct
--    INSERT path that row-level security already permits (and that the RLS
--    suites exercise) keeps working unchanged.
--
-- 3. A FINISHED GAME STOPS ACCEPTING PLAYS.
--
--    An event arriving for a game that is already final or cancelled is
--    refused by name rather than accepted and ignored. It parks in the write
--    queue where someone can see it, which is the whole point of that queue:
--    a device believing something happened that the account does not know
--    about must never be silent.

-- -----------------------------------------------------------------------------
-- The client's own id for an event.
-- -----------------------------------------------------------------------------
alter table public.game_events
  add column if not exists client_event_id text;

comment on column public.game_events.client_event_id is
  'The id the entering device minted for this event. Makes an append idempotent under queue retries. NULL is allowed so direct inserts (RLS-permitted) still work.';

-- Not partial, so it can back an ON CONFLICT if one is ever wanted here.
-- NULLs are distinct in a Postgres unique index, so rows without a client id
-- do not collide with each other.
create unique index if not exists game_events_game_client_event_uidx
  on public.game_events (game_id, client_event_id);

-- -----------------------------------------------------------------------------
-- start_live_game: the games row a live log hangs off.
--
-- Idempotent by client id, and deliberately NOT scoped to created_by when it
-- looks for an existing row. That is the difference between one shared game
-- and two private ones: when a second scorer's phone asks to start the same
-- game, it must find the row the first phone made, not mint its own. The
-- unique index on (created_by, client_id) still stops one author duplicating
-- a game.
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

  -- Already started, by anyone. This is the join path as much as the restart
  -- path: a second phone calls exactly the same function and gets the same id.
  select g.id into found_id
  from public.games g
  where g.client_id = game_client_id
    and (g.home_team_id = p_team_id or g.away_team_id = p_team_id)
  limit 1;

  if found_id is not null then
    return found_id;
  end if;

  -- ---- resolve the opponent, exactly as save_game does ---------------------
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
    home_team_id, away_team_id, label, scheduled_at, status, sport,
    home_score, away_score, result, client_id, client_opponent_id, created_by
  )
  values (
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
  'Create (or find) the live games row an event log hangs off, idempotently by client id across ALL authors -- so a second scorer joins the same game rather than starting a private copy.';

-- -----------------------------------------------------------------------------
-- append_game_event: one play, one row, one server-assigned sequence number.
-- -----------------------------------------------------------------------------
create or replace function public.append_game_event(
  p_game_id uuid,
  p_client_event_id text,
  p_kind text,
  p_payload jsonb
)
returns table (event_id uuid, event_seq bigint, event_created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  existing record;
  game_status text;
  next_seq bigint;
  inserted record;
begin
  if uid is null then
    raise exception 'must be signed in';
  end if;
  if p_kind is null then
    raise exception 'refusing to append an event with no kind';
  end if;
  if not public.can_score_game(p_game_id) then
    raise exception 'not allowed to score this game';
  end if;

  -- Already accepted. Answered before the status check on purpose: a retry of
  -- the very event that finished the game must return that event, not be
  -- refused for having finished it.
  if p_client_event_id is not null then
    select e.id, e.seq, e.created_at into existing
    from public.game_events e
    where e.game_id = p_game_id and e.client_event_id = p_client_event_id;
    if found then
      event_id := existing.id;
      event_seq := existing.seq;
      event_created_at := existing.created_at;
      return next;
      return;
    end if;
  end if;

  -- One writer at a time per game, for as long as this transaction runs.
  -- Without it two concurrent appends can both read the same max(seq) and one
  -- insert loses to the unique constraint -- pushing a retry loop onto a phone
  -- with one bar of signal.
  perform pg_advisory_xact_lock(hashtextextended(p_game_id::text, 0));

  -- Re-check under the lock: the other transaction may have been the same
  -- event arriving twice at once.
  if p_client_event_id is not null then
    select e.id, e.seq, e.created_at into existing
    from public.game_events e
    where e.game_id = p_game_id and e.client_event_id = p_client_event_id;
    if found then
      event_id := existing.id;
      event_seq := existing.seq;
      event_created_at := existing.created_at;
      return next;
      return;
    end if;
  end if;

  select g.status into game_status from public.games g where g.id = p_game_id;
  if game_status is null then
    raise exception 'refusing to append to game % : there is no such game', p_game_id;
  end if;
  if game_status in ('final', 'cancelled') then
    raise exception 'refusing to append a % event: game % is already %',
      p_kind, p_game_id, game_status;
  end if;

  select coalesce(max(e.seq), 0) + 1 into next_seq
  from public.game_events e
  where e.game_id = p_game_id;

  insert into public.game_events (game_id, seq, kind, payload, actor, client_event_id)
  values (p_game_id, next_seq, p_kind, coalesce(p_payload, '{}'::jsonb), uid, p_client_event_id)
  returning id, seq, created_at into inserted;

  event_id := inserted.id;
  event_seq := inserted.seq;
  event_created_at := inserted.created_at;
  return next;
end;
$$;

comment on function public.append_game_event(uuid, text, text, jsonb) is
  'Append one event to a live game''s log with a SERVER-assigned sequence, under a per-game advisory lock. Idempotent on client_event_id. Refuses a game that is already final or cancelled.';
