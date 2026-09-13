# Getting live Amtrak fares: the complete landscape

Researched 2026-09-02 by sweeping five independent angles (marketplaces, GDS and
partner distribution, consumer aggregators, open source, and long-tail sources) and
then **live-probing every candidate with `curl`**. What follows is what was actually
observed, not what vendors claim.

## The short answer

**There is no free, keyless, sanctioned source of Amtrak fares.** Every option
needs either an API key or a commercial agreement. Anything that promises
otherwise is either not returning fares, not returning _Amtrak_, or not
returning real data.

The fastest legitimate path is **~15 minutes**: a free Parse.bot account, then
`npm run verify:live`.

---

## Verified by direct probe

| Source                                          | Probe result                                                                              | Verdict                       |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------- |
| **Parse.bot `amtrak-com-api`**                  | `401 {"error":"Missing X-API-Key header"}` — endpoint exists, key-gated, no bot challenge | **VIABLE, self-serve**        |
| amtrak.com (`/`, `/v4/journey-solution-option`) | `403` Akamai edge block, even for `/robots.txt`                                           | Bot-protected                 |
| rider.amtrak.com (mobile backend)               | `403`, Akamai-fronted                                                                     | Bot-protected                 |
| Amtrak GTFS (`content.amtrak.com/.../GTFS.zip`) | `200`, 19 MB — 8 files, **no `fare_attributes.txt`**                                      | Schedules only, no fares      |
| `api-v3.amtraker.com/v3/trains`                 | `200`, 1.1 MB of live train status — **no price field**                                   | Status only, no fares         |
| Sabre Rail (`api.platform.sabre.com/v1/rail/*`) | `401`; public docs name `2V - Amtrak`                                                     | Real, needs sales             |
| Travelport Universal API (RailService)          | `401`; sample XML shows a genuine priced Amtrak payload                                   | Real, needs sales             |
| SilverRail SilverCore                           | `401`; docs redirect map leaks `/docs/amtrak-implementation-tests`                        | Real, needs sales             |
| Distribusion Retailer API                       | `401`                                                                                     | Real, needs sales             |
| Omio B2B                                        | `401` on `api.omio.com/v3/search`; Cloudflare challenge on the portal                     | Real, needs sales             |
| Amadeus Rail                                    | `401`; **zero** occurrences of "Amtrak" in an 8.4 MB portal bundle                        | Coverage unproven             |
| Rome2Rio API                                    | `free.rome2rio.com` does not resolve; `api.rome2rio.com` → `404`                          | Dead / indicative prices only |
| RailForLess                                     | Cloudflare Turnstile on the front end                                                     | Bot-protected                 |
| Apify Amtrak actors (×4)                        | `200` — schedules, stations, live positions                                               | **No fares in any schema**    |
| `trainpricealerts.com/api/search`               | `200`, no key required                                                                    | **Do not use** — see below    |

### Two traps worth naming

**The Apify "Amtrak, Greyhound & Megabus Scraper"** has Amtrak in its title and
store metadata, but its README, output schema and examples cover **Megabus and
FlixBus only**. You would pay for bus fares. The author of the _other_ Amtrak
actor states plainly that Amtrak's booking flow sits behind Akamai Bot Manager
and is deliberately out of scope — which is the clearest available evidence for
why no scraper marketplace carries Amtrak fares.

**`trainpricealerts.com/api/search`** returns priced itineraries with no key and
no challenge, and it does not survive inspection: NYP→WAS came back as a two-leg
Northeast Regional + Crescent itinerary at $269 for a route Amtrak runs hourly as
a single ~3h20m train; CHI→LAX came back with `train_number: "27:11:3710:710:5710"`,
4 transfers, 76 hours, and both stations literally named "Union Station". That is
not amtrak.com output. It is also another operator's undocumented internal
endpoint behind their paywall. RailDrop does not use it and neither should you.

---

## What RailDrop does about it

The `FareProvider` seam means **any** of the viable options above can drive the
product. Three implementations ship:

| `FARE_PROVIDER` | What it is                                                                                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parse`         | Parse.bot `amtrak-com-api`. Self-serve key, free tier.                                                                                                                            |
| `http`          | **A generic JSON adapter configured entirely by environment variables.** Point it at a GDS endpoint, a partner API, your own proxy — anything that returns JSON. No code changes. |
| `deterministic` | Offline, stable fixtures for tests and E2E. Structurally barred from production.                                                                                                  |

The `http` provider is the answer to "whatever key I can actually get". It
substitutes `{origin} {destination} {date} {passengers}` into a URL and/or a JSON
body, attaches your credential to any header you name, and feeds the response
through the same tolerant normalizer, error taxonomy, retry policy, circuit
breaker and credit accounting as every other provider.

```bash
FARE_PROVIDER=http
HTTP_PROVIDER_URL='https://api.example.com/rail/search'
HTTP_PROVIDER_METHOD=POST
HTTP_PROVIDER_BODY='{"origin":"{origin}","destination":"{destination}","departure_date":"{date}","num_adults":{passengers}}'
HTTP_PROVIDER_AUTH_HEADER=Authorization
HTTP_PROVIDER_AUTH_VALUE='Bearer {key}'
HTTP_PROVIDER_KEY=...
```

Both paths were exercised against real endpoints during development: pointed at
Parse.bot the generic adapter produced a correctly classified `AUTH` failure, and
pointed at a real 200-returning JSON API with no fare fields it produced
`SCHEMA` — **not** a silent "no cheaper fares found". That distinction is the
whole point.

---

## What we will not do

RailDrop does not drive a browser against amtrak.com to extract fares, and does
not attempt to evade Akamai. That path needs no key, and it is the reason it is
excluded: it is against Amtrak's Terms of Use, it breaks whenever they tighten
the challenge, and it is not something to build into an app you intend to publish
and deploy. The generic `http` provider exists so you never have to.

---

## Cost, at 3 checks/day

One `±1` watch = 3 searches/cycle × 4 cycles/day (INITIAL + 3 slots) × 2 credits
≈ **182 credits per watch-month**.

| Parse.bot plan | Credits/mo | Watches | Cost per watch-month |
| -------------- | ---------- | ------- | -------------------- |
| Free           | 200        | 1       | $0                   |
| Hobby $30      | 1,000      | 5       | $6.00                |
| Developer $100 | 5,000      | **27**  | $3.66                |
| Team $300      | 20,000     | 109     | $2.75                |
| Company $1,000 | 100,000    | 549     | $1.82                |

Credits bind long before rate limits do: 27 watches is 81 calls/day against a
100/min ceiling. Cross-watch deduplication reduces this further whenever travel
windows overlap — two watches sharing two dates cost 4 calls, not 6.
