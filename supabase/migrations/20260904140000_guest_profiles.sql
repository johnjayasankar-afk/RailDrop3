-- REQUIRED for guest / optional sign-in on an existing RailDrop Supabase project.
-- SQL Editor → New query → paste → Run. Expect: Success. No rows returned.

alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles alter column email set default '';
