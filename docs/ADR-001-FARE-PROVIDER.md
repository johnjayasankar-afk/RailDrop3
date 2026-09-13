# ADR-001 — Fare provider

**Status:** Accepted · **Date:** 2026-09-02

## Context

RailDrop needs current Amtrak fares for a route/date. Amtrak publishes no public developer API.

Options considered:

1. **Scrape amtrak.com directly** (HTTP or headless browser).
2. **Reverse-engineer amtrak.com's private booking endpoints.**
3. **A licensed GDS / rail aggregator** (Amtrak via a travel distribution partner).
4. **Parse.bot marketplace `amtrak-com-api`** — a hosted, maintained structured API.

## Decision

Use **option 4**, behind a `FareProvider` interface, with `ParseFareProvider` as the v1
implementation — **and ship a generic, configuration-driven HTTP provider alongside it** so the
product is not hostage to any single vendor.

### Updated 2026-09-02 after an exhaustive live probe

Five research angles were swept and every candidate was probed with `curl`. The full evidence table
is in [LIVE-FARE-SOURCES.md](LIVE-FARE-SOURCES.md). The conclusions that changed this ADR:

- **There is no free, keyless, sanctioned Amtrak fare source.** Verified by direct download: the
  Amtrak GTFS zip contains no `fare_attributes.txt`; `api-v3.amtraker.com` returns live train status
  with no price field anywhere; every Apify "Amtrak" actor returns schedules, stations or positions
  and **none** returns a fare.
- **amtrak.com and its mobile backend are Akamai-protected** — `403` on every path including
  `/robots.txt`. Reaching fares there means evading bot protection, which this project will not do.
- **Sabre, Travelport, SilverRail and Distribusion genuinely carry Amtrak** (Travelport's own public
  sample XML shows `SupplierCode="2V"` with a real `TotalPrice`), but all are sales-gated.
- **Parse.bot is the only self-serve option** with a documented fare payload and an instant free tier.
- One keyless endpoint that _does_ return priced itineraries — `trainpricealerts.com/api/search` —
  returns data that does not survive inspection (a 76-hour CHI→LAX with a malformed train number, a
  two-leg NYP→WAS on a route Amtrak runs hourly). It is also another operator's internal endpoint.
  **Rejected.**

Because the viable options are heterogeneous and mostly gated behind agreements we cannot make on the
user's behalf, a second implementation ships: `HttpJsonFareProvider`, configured entirely by
`HTTP_PROVIDER_*` environment variables. Whatever credential the operator can obtain, it can be wired
in without touching application code, and it inherits the same normalizer, error taxonomy, retry
policy, circuit breaker and credit accounting.

Options 1 and 2 are **explicitly out of scope and prohibited in this codebase**: no scraping of amtrak.com,
no browser automation for fare extraction, no CAPTCHA circumvention, no private-endpoint reverse
engineering. Option 3 is the right long-term answer for a commercial product but requires a commercial
agreement that does not exist today; the `FareProvider` interface exists precisely so it can be swapped in
without touching domain code.

## The interface

```ts
interface FareProvider {
  readonly id: string; // 'parse' | 'deterministic'
  readonly isLive: boolean; // false ⇒ must never run in production
  search(req: FareSearchRequest, ctx: ProviderCallContext): Promise<FareSearchResult>;
}
```

`FareSearchResult` is fully normalized — no provider JSON escapes the adapter.

## Provider contract as documented (2026-09-02)

- Base: `https://api.parse.bot/scraper/{scraper_id}/{endpoint}`
- Scraper id for `amtrak-com-api`: `f800c27d-0aaa-4ca0-864e-4dc69e20f764` (configurable via
  `PARSE_SCRAPER_ID` — never hardcode a vendor id as immutable)
- Auth: `X-API-Key: pmx_…`
- `search_trains` — **POST**, body `{ origin, destination, departure_date: 'YYYY-MM-DD', num_adults? }`,
  returns all journey solution options with fare families `VLU` / `FLX` / `SVR`, seat availability
  inventory, and ancillary flags. **2 credits per call, charged on success.**
- Errors: `400` malformed · `401` bad key · `404` unknown scraper · `422 stale_input` ·
  `429` rate limit (`retry_after`) · `500 error` scraper fault · `502 upstream_error` ·
  `503 blocked` (retry only if `retry_after`).
- Headers: `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-RateLimit-Daily-Remaining`, `Retry-After`,
  `X-Credits-Charged`, `X-Credits-Remaining`.
- Tiers at time of writing: Free 200 credits/mo & 5 rpm · Developer 5,000 & 100 rpm · Company 100,000 & 500 rpm.

## Call-shape decisions

- **One `search_trains` call per (route, date, pax).** It already returns _all_ journey solutions with
  fares, so ±1 day costs **3 calls per cycle**, not one per train.
- **`get_cheapest_fare` is deliberately not used.** We need the full option list anyway (for ranking, the
  fare strip, and convenience comparison); calling it first would double external spend for information we
  already receive.
- **`get_station_autocomplete` is not called per keystroke.** Stations are seeded locally and refreshed
  deliberately (`scripts/refresh-stations.ts`), so typing costs zero credits.

## Schema uncertainty and how it is contained

Parse.bot documents the endpoint contract and error envelope but **not** a complete field-level response
schema for `search_trains`. Rather than guess:

- the adapter accepts an ordered list of **candidate container paths** and **field aliases**;
- it parses leniently with Zod and records which alias matched (`ProviderMetadata.schemaAliases`);
- an unrecognisable body raises `ProviderSchemaError` — surfaced as a provider failure, **never** as
  "no cheaper fares found";
- `npm run probe:provider` writes `docs/provider-schema-fingerprint.json` from a single real response so
  production can pin the observed shape.

## Party pricing

Per-passenger vs. total-party is **not documented**. It is resolved empirically by
`npm run verify:party-pricing` (`num_adults: 1` vs `2` on one route/date). Until resolved,
`PROVIDER_PRICING_BASIS=UNKNOWN` and multi-passenger watches are computed for display but **never
alerted on**. Single-passenger watches are unaffected because the two bases are arithmetically identical.

## Cost control

`PROVIDER_CREDITS_PER_SEARCH` and `PROVIDER_MONTHLY_CREDIT_BUDGET` are configuration, never constants in
code. Actual spend is read from `X-Credits-Charged` when present. Soft stop at 80%, hard stop at 100%,
plus a per-dispatch ceiling, a manual-check cooldown, and a circuit breaker.

Steady-state estimate for one ±1 watch: 3 searches × 4 cycles/day × 2 credits = **24 credits/day**
(~720/month). The usage page shows the real number; the estimate is not trusted.

## Consequences

- **Good:** legal, maintained, one call per route/date, rich normalized data, real credit telemetry.
- **Bad:** third-party dependency for a core function; undocumented response schema; per-call cost.
- **Mitigation:** the `FareProvider` seam, tolerant parsing with loud failure, circuit breaker, budget
  caps, and a `DeterministicFareProvider` that makes the entire pipeline testable without spending a cent.
