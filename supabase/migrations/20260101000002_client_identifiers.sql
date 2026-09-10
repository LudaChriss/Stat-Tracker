-- Stable client-side identifiers.
--
-- The scoring engine keys every box-score line by a "pid" string: 'h0' for a
-- rostered player, 'a3' for an untracked opponent batting slot, 'o:slug:2' for
-- a rostered opponent. Season stats, standings and box scores are all derived
-- from those keys.
--
-- Without persisting them, a season written to Postgres and read back returns
-- different identities than it went in with, and every historical stat line
-- detaches from the player it belongs to. (Verified: a round trip through the
-- real column set produced null pids across the board.)
--
-- These are therefore not a client implementation detail leaking into the
-- schema — they are the stable external identity of a scorebook entry, and
-- have to outlive any particular device.

alter table public.players add column if not exists client_id integer;
alter table public.teams add column if not exists client_id text;
alter table public.games add column if not exists client_id text;
alter table public.games add column if not exists client_opponent_id text;
alter table public.game_lines add column if not exists client_pid text;

comment on column public.players.client_id is
  'Client-side roster id. Box-score pids are derived from it, so it must be stable across a round trip.';
comment on column public.teams.client_id is
  'Client-side team slug, referenced by rostered-opponent pids (o:slug:n).';
comment on column public.games.client_id is
  'Client-side game id, so an imported season keeps its game identities.';
comment on column public.games.client_opponent_id is
  'Client-side opponent slug as recorded at the time of the game.';
comment on column public.game_lines.client_pid is
  'Scorebook key for this line (h0 / a3 / o:slug:2). Load-bearing: stats and box scores are keyed by it.';

-- A roster id is unique within its team; the same int may recur across teams.
create unique index if not exists players_team_client_id_idx
  on public.players (team_id, client_id)
  where client_id is not null;

-- Looking a line up by its scorebook key is the common read.
create index if not exists game_lines_client_pid_idx
  on public.game_lines (game_id, client_pid);
