-- Allow guest (cookie) profiles that are not Supabase Auth users.
alter table public.profiles drop constraint if exists profiles_id_fkey;

-- Guests may have an empty email until they opt into alerts or sign in.
alter table public.profiles alter column email set default '';
