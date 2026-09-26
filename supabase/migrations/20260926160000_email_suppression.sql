-- A list of addresses we must not write to, and a reason for each.
--
-- A guest can put an email on a watch without an account. Until now there was
-- no unsubscribe link, no List-Unsubscribe header, and no way for that person
-- to identify themselves to us in order to ask us to stop. In most
-- jurisdictions that is unlawful; it is wrong regardless.
--
-- Keyed on the address rather than the watch: someone who asks to stop hearing
-- from us means all of it, not one trip. The reason is kept so an operator can
-- tell "they asked" from "the mailbox bounced" from "they called it spam" —
-- three different facts that deserve different handling.

create table if not exists public.email_suppressions (
  email text primary key,
  reason text not null check (reason in ('UNSUBSCRIBED', 'BOUNCED', 'COMPLAINED', 'MANUAL')),
  -- The watch the request came from, when there was one. Nulled if that watch
  -- is later deleted: the suppression must outlive it.
  watch_id uuid references public.watches(id) on delete set null,
  detail text,
  created_at timestamptz not null default now()
);

alter table public.email_suppressions enable row level security;

-- No policy is granted deliberately: this table is written and read by the
-- service role only. A suppression list readable by users would leak who has
-- complained, and one writable by users would let anyone silence anyone.

-- ─────────────────────────────────────────────────────────────────────────────
-- Down
--
--   drop table if exists public.email_suppressions;
--
-- Reversible, and destructive in a way that matters: dropping this table
-- resumes mail to people who asked us to stop. Do not run it to "clean up".
-- ─────────────────────────────────────────────────────────────────────────────
