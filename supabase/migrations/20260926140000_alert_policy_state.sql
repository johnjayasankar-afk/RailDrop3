-- Separate what we told a traveler from what we last saw.
--
-- watches.last_opportunity was doing both jobs, and the alert comparator asked
-- the wrong one. When qualifying options vanished the column kept the old
-- fingerprint, so:
--
--   told about $47 → it sells out → $60 appears, still $68 under their $128
--   → "is 60 at least 100 cents below 47?" → no → silence, forever.
--
-- The traveler holds an email about a fare that does not exist and is never
-- told about the one that does. Two columns, because they are two facts.
--
-- last_opportunity keeps its current meaning: the most recent observation.
-- last_alerted_opportunity is the fare we actually put in front of someone,
-- and it is the only thing a "worth another email?" comparison may be made
-- against.

alter table public.watches
  add column if not exists last_alerted_opportunity jsonb,
  -- Said once per lost opportunity, so a sold-out fare does not generate an
  -- email on every cycle for the rest of the window.
  add column if not exists opportunity_lost_notified boolean not null default false,
  -- The final last-call near departure, also once.
  add column if not exists departure_alert_sent boolean not null default false,
  -- 6.2: the re-alert threshold was hardcoded at 100 cents while
  -- PRODUCT_SPEC.md described the savings threshold as configurable. Null
  -- means "use the default", so existing watches keep today's behaviour.
  add column if not exists alert_improvement_cents integer;

-- Existing watches have been alerted against last_opportunity, so seed the new
-- column with it. Without this, every active watch would treat its next
-- qualifying find as a first_qualifying and send a duplicate opening email.
update public.watches
set last_alerted_opportunity = last_opportunity
where last_alerted_opportunity is null
  and last_opportunity is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Down
--
--   alter table public.watches
--     drop column if exists alert_improvement_cents,
--     drop column if exists departure_alert_sent,
--     drop column if exists opportunity_lost_notified,
--     drop column if exists last_alerted_opportunity;
--
-- Reversible in structure. Reverting reintroduces the silence described above,
-- and loses which watches have already been told their option went.
-- ─────────────────────────────────────────────────────────────────────────────
