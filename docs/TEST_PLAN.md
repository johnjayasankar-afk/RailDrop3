# RailDrop — Test Plan

## Layers

| Layer       | Runner                           | Scope                                                                                                | Speed   |
| ----------- | -------------------------------- | ---------------------------------------------------------------------------------------------------- | ------- |
| Unit        | Vitest (`--project unit`)        | pure domain, adapter normalization, env guards                                                       | ms      |
| Integration | Vitest (`--project integration`) | migrations + RLS + constraints on **real Postgres** (PGlite), and full pipeline with a fake provider | seconds |
| E2E         | Playwright                       | RailDrop UI only, deterministic provider, seeded DB                                                  | ~1 min  |
| Live checks | scripts, opt-in                  | one controlled real provider call, one real email                                                    | manual  |

`npm run test:all` runs unit + integration. `npm run verify` runs
format → lint → typecheck → unit + integration → build → secret scan.

## Unit tests

**SearchPlanner** — ±0 / ±1 / ±2 · past dates dropped · desired date itself in the past · month boundary
(Aug 31 → Sep 1) · year boundary (Dec 31 → Jan 1) · leap day (Feb 28/29/Mar 1, 2028) · timezone-sensitive
"today" (a watch in `Pacific/Kiritimati` vs `Pacific/Midway` at the same instant) · passenger propagation.

**Dedupe** — identical searches collapse · overlapping windows (19/20/21 + 20/21/22 → **4** calls, not 6) ·
different passenger counts do **not** collapse · different routes do not collapse · assignment fan-out maps
each watch back to its own results · `savedCalls` arithmetic.

**Ranking** — cheapest first · $59 D-1 beats $120 D · equal price prefers desired date · then smaller
displacement · then preferred-time proximity (only when supplied) · then fewer transfers · then shorter
duration · then stronger fare family · fully deterministic on ties.

**Eligibility** — Flexible-vs-Flexible default · restricted fares excluded by default, included and flagged
when enabled · unavailable inventory rejected · wrong travel class rejected · Thruway excluded by default,
included when toggled, never labelled rail · `UNKNOWN` service type excluded · journey with no fare
rejected (`NO_FARE`) rather than priced at 0 · passenger mismatch rejected.

**Money / pricing** — integer cents throughout · no float arithmetic · `TOTAL_PARTY` vs `PER_PASSENGER`
vs `UNKNOWN` · `UNKNOWN` + 1 pax ⇒ unambiguous · `UNKNOWN` + 2 pax ⇒ ambiguous ⇒ alert suppressed ·
formatting ($1,234.50) · rounding never invents a cent.

**AlertComparator** — first qualifying drop alerts · identical set + identical price does not · a $6 drop
alerts, a $2 drop does not (threshold $5) · **$89 D-1 alerted, then $90 exact-date ⇒ alerts**
(`BETTER_CONVENIENCE`) · $95 exact-date after $89 D-1 does **not** (outside price tolerance) · cooldown
suppresses, urgent drop bypasses cooldown · dedupe key stability · ambiguous pricing suppresses ·
`FAILED` cycle never alerts.

**Schedule** — 3 slots per local day · due-slot selection at 07:59/08:00/13:00/20:01 · missed slots become
`SKIPPED` not a burst · DST spring-forward and fall-back in `America/New_York` (2026-03-08, 2026-11-01) ·
`Asia/Kolkata` (+05:30) and `Pacific/Chatham` (+12:45) offsets · monitoring-window expiry at execution ·
`INITIAL`/`MANUAL` do not consume slots.

**Rebook** — benchmark replaced, history appended, `benchmark_version` bumped, alert state reset,
monitoring continues inside the window and stops outside it · historical rows immutable.

**Provider adapter** — normalizes a realistic `search_trains` body · fare families `VLU`/`FLX`/`SVR` →
`VALUE`/`FLEXIBLE`/`SAVER` · unknown family → `UNKNOWN` · bus leg → `THRUWAY_BUS` · multi-leg →
`CONNECTING_RAIL` · empty journeys ⇒ `NO_AVAILABILITY` **success**, not an error · unrecognisable body ⇒
`ProviderSchemaError` · every documented error code maps to the right `ProviderErrorKind` · retry/backoff
bounded and jittered · circuit breaker opens and recovers · credits read from headers.

**Booking links** — tier order · hostile hosts rejected (`amtrak.com.evil.tld`, `http://`, userinfo,
`javascript:`) · tier 2 off unless verified · generic fallback always produced · trip-details text complete.

**Security guards** — `createFareProvider` throws for a non-live provider in production without the loud
override · server-only env access from a browser context throws.

## Integration tests (real Postgres via PGlite)

- migrations apply cleanly from scratch, and are **idempotent** (apply twice)
- every expected table, unique index, FK and check constraint exists
- **RLS**: user A cannot select/update/delete user B's watches, cycles, snapshots, options, alerts
  (IDOR); anonymous access denied; service role bypasses
- `scheduled_check_runs` unique claim: two concurrent inserts, exactly one wins
- full pipeline: watch → planner → fake provider → normalizer → eligibility → ranking → snapshot →
  opportunity → alert → notification row
- 3-date orchestration produces 3 snapshots and one cycle
- partial provider failure ⇒ `PARTIAL_SUCCESS`, other dates still ranked, disclosure flag set
- total provider failure ⇒ `FAILED`, **no** alert
- duplicate dispatch invocation ⇒ one cycle, provider called 3 times total
- cross-watch dedupe ⇒ 4 provider calls for 2 overlapping watches
- rebook mid-window ⇒ new benchmark, monitoring continues, alert state reset
- budget hard stop ⇒ cycle recorded `SKIPPED_BUDGET`, zero provider calls
- email failure ⇒ delivery `FAILED`, alert row still present

## E2E (Playwright, deterministic provider)

auth → create watch (station picker, ±1 default, actual paid price) → immediate INITIAL scan →
results render → 3-day fare strip → cheapest-first ordering → **Book on Amtrak** fallback panel →
**I rebooked** → pause/resume → delete → partial-failure UI → mobile (390 px) flow.

### How E2E achieves fidelity

E2E runs the **real** pages, API routes, services, SQL and RLS. Only two seams are substituted:
the fare provider (deterministic, so results are stable and no credits are spent) and the session
(a cookie shim, because Supabase Auth needs a hosted project). The database is a real PostgreSQL 17
running in-process, and user-scoped queries execute as the `authenticated` role, so RLS is genuinely
enforced through the UI. The harness refuses to initialise outside `E2E_MODE`.

## Visual QA

Breakpoints **1440 / 1024 / 768 / 390** across: dashboard, create form, watch detail, drop-found, no-drop,
partial data, provider error, completed watch, loading, mobile booking flow.
Automated by `npm run visual`, which asserts rather than merely captures: no horizontal overflow at
any breakpoint, no screen silently rendering a 404, hit targets ≥ 44 px, a visible focus outline, and
`prefers-reduced-motion` collapsing transitions. 40 screenshots are written to `visual-qa/`.

## Live checks (opt-in, credit-spending)

- `npm run probe:provider` — **one** future-date query, validates the real schema, writes a sanitized
  fingerprint. Never run in a loop.
- `npm run verify:party-pricing` — 2 calls (1 adult vs 2 adults), resolves `PROVIDER_PRICING_BASIS`.
- `npm run email:test` — one "RailDrop is ready" email, asserts Resend acceptance.
- `npm run verify:booking-links` — browser-navigates the handoff URL; only sets deep-link verification if
  the prefill genuinely works.

**No live integration is ever reported as PASS without a real response being validated.**
