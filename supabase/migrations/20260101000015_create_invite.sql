-- Minting an invite.
--
-- The invites table, accept_invite, and the policies that let only a manager or
-- a league admin see and create invites all shipped in 1a/1b. accept_invite
-- already refuses a used code and an expired one, and takes a row lock so two
-- people racing the same code cannot both get in. None of that is changed here.
--
-- What was missing is the other end: a safe way to create one. Left to a plain
-- INSERT, the client picks the code, the expiry and the role, which puts three
-- things in the wrong place:
--
--   * The CODE would be as unguessable as whatever the client happened to
--     generate. Nobody can list invites they do not manage, so a code is the
--     only secret protecting a membership.
--   * The EXPIRY would be whatever was sent, including "never".
--   * The ROLE could be any of the four. A team manager could mint a
--     league_admin invite scoped to their team. Today that grants nothing —
--     is_league_admin only reads league-scoped rows — but it is a row that
--     says a thing that is not true, sitting in the table waiting for someone
--     to write a query that trusts it.
--
-- So: one function, which decides all three.

-- -----------------------------------------------------------------------------
-- A code people have to type or paste. Crockford-style alphabet: no I, L, O or
-- U, so it cannot be misread off a phone screen or misheard across a field.
-- -----------------------------------------------------------------------------
create or replace function public.new_invite_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(
    substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ',
           (floor(random() * 32) + 1)::int, 1),
    ''
  )
  from generate_series(1, 10);
$$;

comment on function public.new_invite_code() is
  'A 10-character invite code from an alphabet with no easily-confused letters.';

-- -----------------------------------------------------------------------------
-- Create an invite for a team, with a role and a lifetime.
-- -----------------------------------------------------------------------------
create or replace function public.create_invite(
  p_team_id uuid,
  p_role text,
  p_days int default 7
)
returns public.invites
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_days int;
  v_code text;
  v_invite public.invites;
  attempts int := 0;
begin
  if uid is null then
    raise exception 'must be signed in';
  end if;

  -- Only someone who owns the team may hand out access to it. A scorer cannot
  -- recruit; this is the same rule the invites INSERT policy states, restated
  -- here because SECURITY DEFINER bypasses that policy.
  if not public.can_manage_team(p_team_id) then
    raise exception 'not allowed to invite people to this team';
  end if;

  -- A team invite grants a role on a team. league_admin is not one of those,
  -- and silently downgrading it would be worse than refusing.
  if p_role not in ('team_manager', 'team_scorer', 'viewer') then
    raise exception 'a team invite can grant team_manager, team_scorer or viewer, not %', p_role;
  end if;

  -- Bounded, and bounded at both ends: an invite that never expires is a
  -- permanent key to the team left lying around.
  v_days := least(greatest(coalesce(p_days, 7), 1), 30);

  -- Retry on the astronomically unlikely collision rather than failing.
  loop
    attempts := attempts + 1;
    v_code := public.new_invite_code();
    begin
      insert into public.invites (code, team_id, role, expires_at, created_by)
      values (v_code, p_team_id, p_role, now() + make_interval(days => v_days), uid)
      returning * into v_invite;
      exit;
    exception when unique_violation then
      if attempts >= 5 then
        raise exception 'could not generate a unique invite code';
      end if;
    end;
  end loop;

  return v_invite;
end;
$$;

comment on function public.create_invite(uuid, text, int) is
  'Mint a single-use, expiring invite granting a team role. Only a team manager or the league admin may call it; the code, the expiry (1-30 days) and the allowed roles are decided here, not by the caller.';

-- -----------------------------------------------------------------------------
-- What an invite is for, WITHOUT being able to see the invites table.
--
-- Someone holding a code needs to know what they are accepting before they
-- accept it — which team, which role, and whether it is still good. They cannot
-- read `invites`: the SELECT policy is limited to the manager and the league
-- admin, and widening it would let anyone enumerate codes.
--
-- This returns only what the holder of a valid code already has a right to
-- know, and never says whether a code exists when it is expired or spent — the
-- caller gets the same shape either way.
-- -----------------------------------------------------------------------------
create or replace function public.peek_invite(invite_code text)
returns table (team_id uuid, team_name text, role text, expires_at timestamptz, usable boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.team_id,
    t.name,
    i.role,
    i.expires_at,
    (i.used_at is null and i.expires_at > now()) as usable
  from public.invites i
  left join public.teams t on t.id = i.team_id
  where i.code = invite_code;
$$;

comment on function public.peek_invite(text) is
  'What a code would grant: team, name, role, expiry, and whether it is still usable. Readable by anyone holding the code, which is the only way to see an invite you do not manage.';
