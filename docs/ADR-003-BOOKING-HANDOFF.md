# ADR-003 — Booking handoff

**Status:** Accepted · **Date:** 2026-09-02

## Context

RailDrop shows a cheaper Amtrak option and must get the user to a place where they can buy it. It must
**never** modify a reservation, and it must never lie about where a link goes.

Amtrak publishes no documented deep-link contract for prefilled search or booking. Any URL shape inferred
from observing the website is undocumented, unversioned, and may break or silently ignore parameters.

## Decision

A `BookingLinkResolver` with **three tiers, in strict priority order**, and an explicit confidence value
that the UI is required to reflect.

### Tier 1 — `EXACT` (provider-supplied)

Used only when the normalized provider payload contains a booking URL **and** `isSafeAmtrakUrl()` passes:

- scheme is `https:`
- host is exactly `amtrak.com` or a `*.amtrak.com` subdomain (suffix match on `.amtrak.com`, so
  `amtrak.com.evil.tld` is rejected)
- no credentials in the URL, no embedded newline/control characters

This also closes the open-redirect hole: an attacker-controlled provider payload cannot make RailDrop
render a link to an arbitrary host.

### Tier 2 — `SEARCH_PREFILL` (verified deep link)

A prefilled amtrak.com search link, **enabled only when `AMTRAK_DEEPLINK_VERIFIED=true`**. That flag is
not something a developer sets by hand on a hunch: `npm run verify:booking-links` drives a real browser to
the candidate URL and asserts that the origin, destination and date actually appear prefilled. If the
assertion fails, the script tells you to leave the flag off, and the resolver falls through to tier 3.

**As shipped, this flag is `false`.** No deep-link format was invented, and none is claimed to work.

### Tier 3 — `GENERIC` (default, always available)

Link to the official Amtrak booking entry point (`https://www.amtrak.com/home`, verified reachable),
preceded by a RailDrop transition panel that carries every detail the user needs:

```
You're booking:
BOS → NYP · Sep 19 · Train 179 · 7:05 AM · Flexible Coach
Observed fare: $74     Observed: 2:02 PM ET
[ Continue to Amtrak ]   [ Copy trip details ]
```

Copy is explicit that this is a handoff, not exact inventory:
_"We'll send you to Amtrak's booking page — enter these details to find this fare."_

## Verification performed (2026-09-02)

Tier 3 was **browser-verified**: navigating to `https://www.amtrak.com/home` loads Amtrak's booking
entry point (it redirects to `https://amtrak.com`, also an allowed host) and renders the search form
with **From**, **To**, **Depart Date** and **Traveler** fields — precisely the values RailDrop's
transition panel asks the user to enter, and which **Copy trip details** puts on their clipboard.
So the fallback is not merely reachable; it lands the user where the copied details are usable.

Tier 2 remains **disabled**. No Amtrak prefill contract is published, so there was nothing honest to
implement. `npm run verify:booking-links` refuses to set the flag on the strength of an HTTP 200,
because amtrak.com renders its search client-side and a 200 proves nothing about prefill.

## Rules the implementation must satisfy

1. Every option offers **Book on Amtrak** and **Copy trip details**, at every tier.
2. The UI never states or implies that a generic URL points at specific inventory.
3. Every outbound link is `rel="noopener noreferrer"` and host-validated at render time.
4. Observed price and observation timestamp are always shown next to the CTA — fares move, and the user
   must know how stale the number is.
5. Tier degradation is silent to the code path but visible in telemetry
   (`booking_handoff_confidence` counter), so a tier-1 regression is noticed.

## Consequences

- **Good:** never brittle by default, never dishonest, safe against hostile provider payloads, and the user
  always has enough information to complete the booking manually in seconds.
- **Bad:** the generic path costs the user a few extra interactions on amtrak.com.
- **Revisit when:** Amtrak publishes an affiliate/deep-link contract, or a provider payload is confirmed to
  carry stable booking URLs — either of which upgrades users to tier 1/2 with no domain-code change.
