-- Give every new account a profile row.
--
-- leagues.created_by, teams.created_by and invites.created_by all reference
-- public.profiles. Nothing was creating that row, so a freshly signed-up user
-- hit a foreign-key violation on the very first thing they do — creating their
-- team. The RLS suite missed it because it inserted profiles by hand with the
-- service role, which no real signup flow does.
--
-- Supabase owns auth.users, so the profile is created by trigger rather than by
-- the client, which also means it cannot be skipped or forged.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      split_part(coalesce(new.email, 'player'), '@', 1)
    )
  )
  on conflict (id) do nothing;  -- idempotent: never block a signup
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill anyone who signed up before this trigger existed.
insert into public.profiles (id, display_name)
select u.id, split_part(coalesce(u.email, 'player'), '@', 1)
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;
