-- Why we spoke, and why we didn't.
--
-- Every cycle makes an alert decision and, until now, only the positive ones
-- left a trace: an alert row exists when mail was sent, and nothing at all
-- exists when it was not. So "why didn't you tell me about the $60?" had no
-- answer beyond re-deriving it from code and hoping the inputs were the same.
--
-- The silences are the interesting half. This records both, with the two
-- fingerprints that produced the decision and the sentence the policy wrote at
-- the time, so the answer months later is the reasoning as it actually ran
-- rather than as we would reconstruct it.

create table if not exists public.alert_decisions (
  id uuid primary key,
  watch_id uuid not null references public.watches(id) on delete cascade,
  cycle_id uuid references public.fare_check_cycles(id) on delete set null,
  -- first_qualifying | better_price | opportunity_lost | new_opportunity |
  -- worse_but_qualifying | departure_imminent | no_qualifying | unchanged
  reason text not null,
  notified boolean not null,
  -- What the traveler had been told, and what this cycle saw. Snapshots, so a
  -- later change to the watch cannot rewrite the record of the decision.
  alerted_fingerprint jsonb,
  observed_fingerprint jsonb,
  explanation text not null,
  created_at timestamptz not null default now()
);

create index if not exists alert_decisions_watch_idx
  on public.alert_decisions (watch_id, created_at desc);

alter table public.alert_decisions enable row level security;

-- Readable by the owner of the watch: this is the traveler's own answer to
-- "why didn't you tell me". Writes are service-role only.
drop policy if exists "alert_decisions_select_own" on public.alert_decisions;
create policy "alert_decisions_select_own" on public.alert_decisions
  for select using (
    exists (
      select 1 from public.watches w
      where w.id = alert_decisions.watch_id and w.user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Down
--
--   drop table if exists public.alert_decisions;
--
-- Reversible. Discards the record of why past alerts were or were not sent,
-- which cannot be reconstructed afterwards.
-- ─────────────────────────────────────────────────────────────────────────────
