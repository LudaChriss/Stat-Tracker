-- Slice 3b: a second phone finds out that a play happened.
--
-- The log is already the truth; this is only about being told. Postgres
-- publishes inserts on game_events, Supabase Realtime relays them, and a phone
-- watching a game folds each one into the order the server put it in.
--
-- Realtime applies the table's own SELECT policy to every row before it
-- relays it, so this grants nobody anything: whoever could already read the
-- log gets told about it sooner, and whoever could not still sees nothing.
--
-- WHAT THIS DOES NOT REPLACE. A live socket over a mobile network drops
-- messages and whole connections without saying so. The client polls the same
-- log alongside this, which is what actually guarantees convergence; realtime
-- is what makes it feel immediate. Trusting the socket alone would mean a play
-- that was genuinely written could stay invisible on the other phone for the
-- rest of the game.

do $$
begin
  -- The publication is created by Supabase's own bootstrap; on a plain
  -- Postgres it may not exist at all, and this migration must not be the
  -- reason a reset fails.
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'game_events'
    ) then
      alter publication supabase_realtime add table public.game_events;
    end if;
  end if;
end
$$;

-- Finding the game someone else is already scoring is a lookup by status on a
-- team's games; without this it is a sequential scan of every game every time
-- a phone checks.
create index if not exists games_status_idx on public.games (status);
