-- A team with no league is private, not public.
--
-- league_is_readable(null) returned true, on the reasoning that with no league
-- there is nothing to restrict on. The effect was the opposite of intended:
-- every team not yet in a league — which is the normal state for someone just
-- getting started — had its roster, games and box scores readable by anyone,
-- including anonymous visitors.
--
-- Found by importing a season as one user and reading it back as another: the
-- second user could list all ten players.
--
-- Public reading now requires an explicit public league. Every policy that
-- consults this function already falls back to team membership, so members
-- keep full access to leagueless teams and nothing else changes.

create or replace function public.league_is_readable(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_league_id is not null
    and exists (
      select 1
      from public.leagues l
      where l.id = p_league_id
        and (l.visibility = 'public' or public.is_league_member(p_league_id))
    );
$$;

comment on function public.league_is_readable is
  'Whether a league permits reading. A null league is NOT public — leagueless rows are visible only to team members.';
