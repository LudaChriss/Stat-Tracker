-- =============================================================================
-- Slice 1a: initial Supabase Postgres schema for the rec-league stat tracker.
--
-- Scope: tables, constraints, indexes, and updated_at triggers only.
-- Row Level Security is enabled on every table below so nothing is
-- accidentally world-writable, but no policies are written here -- that is
-- slice 1b's job. Until policies exist, every table is readable/writable by
-- nobody except the postgres role (and Supabase's service_role, which
-- bypasses RLS entirely).
-- =============================================================================

-- gen_random_uuid() is built into Postgres core since v13, but Supabase
-- projects ship with pgcrypto available; enabling it explicitly keeps this
-- migration portable to any Postgres >= 9.4 that lacks the core function.
create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Shared trigger: keep updated_at current on every UPDATE.
-- Applied to every mutable table below. game_events is deliberately excluded
-- -- it is an append-only log and rows are never updated in place.
-- -----------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger function: stamps updated_at = now() on every UPDATE of a mutable table.';

-- =============================================================================
-- profiles
-- One row per authenticated user, keyed to auth.users. Holds app-level
-- profile data that doesn't belong in Supabase's own auth schema.
-- =============================================================================
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is
  'App-facing profile for an authenticated user; 1:1 with auth.users.';

create trigger set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- =============================================================================
-- leagues
-- A named competition/season that teams and games can optionally belong to.
-- =============================================================================
create table public.leagues (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  sport      text not null,
  visibility text not null default 'public'
             check (visibility in ('public', 'private')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.leagues is
  'A league/season that teams and games can optionally be organized under.';

create index leagues_created_by_idx on public.leagues(created_by);

create trigger set_updated_at
  before update on public.leagues
  for each row execute function public.set_updated_at();

-- =============================================================================
-- teams
-- A roster-owning team. league_id is nullable so a team can exist (and play
-- games, and keep history) before it ever joins a league.
-- =============================================================================
create table public.teams (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid references public.leagues(id) on delete set null,
  name       text not null,
  prior_w    int not null default 0,
  prior_l    int not null default 0,
  prior_t    int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teams_prior_w_nonneg check (prior_w >= 0),
  constraint teams_prior_l_nonneg check (prior_l >= 0),
  constraint teams_prior_t_nonneg check (prior_t >= 0)
);

comment on table public.teams is
  'A team and its manually-entered prior record offset for untracked games. Not deleted when a league is deleted, so a team can leave/lose its league and keep playing.';

create index teams_league_id_idx on public.teams(league_id);
create index teams_created_by_idx on public.teams(created_by);

create trigger set_updated_at
  before update on public.teams
  for each row execute function public.set_updated_at();

-- =============================================================================
-- players
-- A team's roster entry. Roster rows are cascade-deleted with their team --
-- that's safe because finished-game history lives in game_lines, which
-- snapshots the player's name and only soft-references this row.
-- =============================================================================
create table public.players (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  name       text not null,
  number     int,
  position   text not null,
  color      text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint players_color_hex check (color ~ '^#[0-9A-Fa-f]{6}$')
);

comment on table public.players is
  'A roster entry (name, number, position, jersey/display color) belonging to a team.';

create index players_team_id_idx on public.players(team_id);

create trigger set_updated_at
  before update on public.players
  for each row execute function public.set_updated_at();

-- =============================================================================
-- games
-- The historical game record. home_team_id/away_team_id are nullable with
-- ON DELETE SET NULL: deleting a team must never delete a finished game's
-- history, so the game row survives and the *_team_name_snapshot columns
-- (frozen at game creation, mirroring game_lines.name_snapshot) keep the
-- opponent's name readable even after the team is renamed or removed.
-- =============================================================================
create table public.games (
  id                       uuid primary key default gen_random_uuid(),
  league_id                uuid references public.leagues(id) on delete set null,
  home_team_id             uuid references public.teams(id) on delete set null,
  away_team_id             uuid references public.teams(id) on delete set null,
  home_team_name_snapshot  text not null,
  away_team_name_snapshot  text not null,
  label                    text,
  scheduled_at             timestamptz not null,
  status                   text not null default 'scheduled'
                           check (status in ('scheduled', 'live', 'final', 'cancelled')),
  sport                    text not null,
  innings                  int,
  home_score               int not null default 0,
  away_score               int not null default 0,
  result                   text
                           check (result in ('W', 'L', 'T')),
  created_by               uuid references public.profiles(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint games_distinct_teams
    check (home_team_id is null or away_team_id is null or home_team_id <> away_team_id),
  constraint games_result_only_when_final
    check (status = 'final' or result is null),
  constraint games_innings_positive check (innings is null or innings > 0),
  constraint games_scores_nonneg check (home_score >= 0 and away_score >= 0)
);

comment on table public.games is
  'A single game between two teams: schedule, live/final status, score, and result (W/L/T from the home team''s perspective).';

create index games_league_id_idx on public.games(league_id);
create index games_home_team_id_idx on public.games(home_team_id);
create index games_away_team_id_idx on public.games(away_team_id);
create index games_created_by_idx on public.games(created_by);

create trigger set_updated_at
  before update on public.games
  for each row execute function public.set_updated_at();

-- =============================================================================
-- game_events
-- Append-only command log for live scoring. Each row is one accepted command
-- against a game; the UNIQUE(game_id, seq) constraint is the compare-and-swap
-- primitive that makes concurrent scorers safe (a client proposes the next
-- seq and the insert fails if someone else already claimed it). Rows are
-- never updated, so there is no updated_at column or trigger here.
-- =============================================================================
create table public.game_events (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games(id) on delete cascade,
  seq        bigint not null,
  kind       text not null,
  payload    jsonb not null default '{}'::jsonb,
  actor      uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint game_events_seq_positive check (seq > 0),
  constraint game_events_game_seq_unique unique (game_id, seq)
);

comment on table public.game_events is
  'Append-only command log for live scoring; UNIQUE(game_id, seq) makes concurrent scoring safe and the log replays to derive game state.';

create index game_events_game_id_idx on public.game_events(game_id);
create index game_events_actor_idx on public.game_events(actor);

-- =============================================================================
-- game_lines
-- Materialised box score for a finalised game -- one row per player who
-- appeared. player_id is nullable (opponents may be unrostered) and
-- team_id is nullable too, because deleting a team must never delete a
-- finished game's box score. name_snapshot (and home_away, frozen at write
-- time) is what makes that survival lossless: the line stays fully readable
-- even after the player or team it pointed to is gone.
-- =============================================================================
create table public.game_lines (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid not null references public.games(id) on delete cascade,
  team_id       uuid references public.teams(id) on delete set null,
  player_id     uuid references public.players(id) on delete set null,
  name_snapshot text not null,
  home_away     text not null check (home_away in ('home', 'away')),
  ab  int not null default 0,
  h   int not null default 0,
  r   int not null default 0,
  rbi int not null default 0,
  bb  int not null default 0,
  k   int not null default 0,
  d   int not null default 0,
  t   int not null default 0,
  hr  int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_lines_stats_nonneg check (
    ab >= 0 and h >= 0 and r >= 0 and rbi >= 0 and bb >= 0 and
    k >= 0 and d >= 0 and t >= 0 and hr >= 0
  )
);

comment on table public.game_lines is
  'Materialised box score line (one row per player) for a finalised game; survives team/player deletion via name_snapshot.';

create index game_lines_game_id_idx on public.game_lines(game_id);
create index game_lines_team_id_idx on public.game_lines(team_id);
create index game_lines_player_id_idx on public.game_lines(player_id);

create trigger set_updated_at
  before update on public.game_lines
  for each row execute function public.set_updated_at();

-- =============================================================================
-- memberships
-- Grants a user a role scoped to exactly one of a team or a league.
-- =============================================================================
create table public.memberships (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  team_id    uuid references public.teams(id) on delete cascade,
  league_id  uuid references public.leagues(id) on delete cascade,
  role       text not null
             check (role in ('league_admin', 'team_manager', 'team_scorer', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memberships_exactly_one_scope check (num_nonnulls(team_id, league_id) = 1)
);

comment on table public.memberships is
  'Grants a user a role scoped to exactly one team or one league (never both, never neither).';

create index memberships_user_id_idx on public.memberships(user_id);
create index memberships_team_id_idx on public.memberships(team_id);
create index memberships_league_id_idx on public.memberships(league_id);

-- Prevent duplicate grants of the same scope to the same user.
create unique index memberships_user_team_uidx
  on public.memberships(user_id, team_id) where team_id is not null;
create unique index memberships_user_league_uidx
  on public.memberships(user_id, league_id) where league_id is not null;

create trigger set_updated_at
  before update on public.memberships
  for each row execute function public.set_updated_at();

-- =============================================================================
-- invites
-- A redeemable code granting a role on exactly one of a team or a league.
-- =============================================================================
create table public.invites (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  team_id    uuid references public.teams(id) on delete cascade,
  league_id  uuid references public.leagues(id) on delete cascade,
  role       text not null
             check (role in ('league_admin', 'team_manager', 'team_scorer', 'viewer')),
  created_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null,
  used_by    uuid references public.profiles(id) on delete set null,
  used_at    timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invites_exactly_one_scope check (num_nonnulls(team_id, league_id) = 1),
  constraint invites_used_at_requires_used_by
    check ((used_at is null) = (used_by is null))
);

comment on table public.invites is
  'A redeemable, expiring invite code granting a role on exactly one team or league.';

create index invites_team_id_idx on public.invites(team_id);
create index invites_league_id_idx on public.invites(league_id);
create index invites_created_by_idx on public.invites(created_by);
create index invites_used_by_idx on public.invites(used_by);

create trigger set_updated_at
  before update on public.invites
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row Level Security: enabled everywhere, policies deferred to slice 1b.
-- With RLS on and no policies defined, only the postgres/service_role can
-- read or write these tables in the meantime.
-- =============================================================================
alter table public.profiles     enable row level security;
alter table public.leagues      enable row level security;
alter table public.teams        enable row level security;
alter table public.players      enable row level security;
alter table public.games        enable row level security;
alter table public.game_events  enable row level security;
alter table public.game_lines   enable row level security;
alter table public.memberships  enable row level security;
alter table public.invites      enable row level security;
