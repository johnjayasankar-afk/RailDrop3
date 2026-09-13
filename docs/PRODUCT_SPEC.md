# RailDrop — Product Spec (v1)

## Positioning

**Know when your train gets cheaper.**

You already bought an Amtrak ticket. RailDrop watches the same route for a window after your purchase and
tells you when a materially cheaper option appears — on your date, the day before, or the day after.

RailDrop **does not** change your reservation, hold inventory, or buy anything. It observes and reports.

## Core user story

> "I bought an Amtrak ticket between two stations. For the next 48 hours, search three times per day across
> my desired departure date plus one day before and one day after. If **any** Amtrak rail option between
> those same stations becomes materially cheaper than what I paid, tell me and show me the cheapest
> alternatives."

## Watch inputs

**Required**

| Field                  | Notes                                                               |
| ---------------------- | ------------------------------------------------------------------- |
| Origin station         | 3-letter Amtrak code, picked from a local catalog                   |
| Destination station    | must differ from origin                                             |
| Desired departure date | not in the past (in the watch timezone)                             |
| Amount actually paid   | **canonical benchmark**, integer cents, total for the party as paid |
| Passenger count        | 1–8                                                                 |

**Optional**

| Field                                  | Default                                                    |
| -------------------------------------- | ---------------------------------------------------------- |
| Preferred departure time               | none (used only as ranking key #4)                         |
| Date flexibility                       | `1` day (±1) — also `0` or `2`                             |
| Travel class                           | `COACH`                                                    |
| Fare family paid                       | `FLEXIBLE`                                                 |
| Monitoring window                      | `48h` — also `24h`, `72h`, `until departure`, custom hours |
| Timezone                               | `America/New_York`                                         |
| Minimum savings to alert               | `$5`                                                       |
| Include Thruway (bus)                  | off                                                        |
| Include cheaper restricted fares       | off                                                        |
| Original train number / departure time | recorded for context only                                  |

The **actual paid price is canonical**. RailDrop never derives a benchmark from a formula — in particular
it does **not** model Flexible as "10% above" anything.

## Monitoring behaviour

- **One INITIAL scan immediately** on watch creation.
- **Three scheduled scans per day** at local `08:00`, `14:00`, `20:00` in the watch's timezone.
- `INITIAL` and `MANUAL` scans do not consume a scheduled slot.
- Monitoring stops at the end of the window, when the desired date passes, or when the user
  pauses/deletes the watch.

A "check" is one **cycle** covering the whole travel window (all of D-1 / D / D+1), not one API call.

## Service scope

| Normalized type   | v1 default                                            |
| ----------------- | ----------------------------------------------------- |
| `DIRECT_RAIL`     | included                                              |
| `CONNECTING_RAIL` | included                                              |
| `THRUWAY_BUS`     | **excluded** (toggle to include; always badged "Bus") |
| `UNKNOWN`         | excluded from alerts                                  |

Non-rail transportation is never labelled rail.

## Eligibility for comparison

A candidate qualifies when it: matches the station route; falls on one of the valid search dates; is
available/bookable per provider data; is inside the service scope; matches the travel class; satisfies the
fare-family filter (default: **Flexible Coach vs. Flexible Coach**); and matches the passenger count.

With "include cheaper restricted fares" on, Value/Saver candidates are included and clearly labelled
**Restricted** with their change/refund implications noted.

## Opportunity rule

```
qualifies  ⇔  candidate_party_total ≤ benchmark − minimum_savings
```

Every eligible journey on every valid date competes. The original train is not privileged.

## Ranking

Price first, then desired date, then smallest date displacement, then preferred-time proximity, then fewer
transfers, then shorter duration, then stronger fare flexibility.

_$59 one day early beats $120 on the exact day._

## Alerts

Meaningful, not noisy. Sent on: first qualifying drop; a materially lower best price; or a
same-price-but-materially-more-convenient option. Cooldown, dedupe key, and pricing-confidence gates apply.

## Screens

| Screen                          | Purpose                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `/`                             | Marketing: what it does, honest limits                                                         |
| `/login`                        | Supabase email magic link                                                                      |
| `/dashboard`                    | All watches as cards: route, window, paid, best now, savings, cheapest option, last/next check |
| `/watches/new`                  | Create form: stations, date, flexibility, paid amount, passengers, options                     |
| `/watches/[id]`                 | Detail: header stats, 3-day fare strip, ranked cheapest options, cycle history, rebook         |
| `/watches/[id]/book/[optionId]` | Booking transition panel + handoff                                                             |
| `/usage`                        | Provider requests, credits, dedup savings, budget headroom                                     |

### Watch card

```
BOS → NYP        SEP 20 ±1 DAY
PAID $128    BEST NOW $74    SAVE $54
Cheapest: Sep 19 · Northeast Regional 179 · 7:05 AM
Updated 2:02 PM        Next check 8:00 PM
[ View 8 cheaper options ]
```

### Watch detail

Header: `BOS → NYP`, `Sep 20 ±1 day`, current ticket `$128`, best now `$74`, save up to `$54`.

Fare strip:

```
SEP 19        SEP 20        SEP 21
from $74      from $81      from $86
```

A date that could not be checked shows `Not checked` with the reason — never `—` or `$0`.

Cheapest options list (top 5, expandable): price, savings, date, displacement label
("1 day earlier"), service/train, departure → arrival, duration, transfers, fare family, class,
availability, and **Book on Amtrak** + **Copy trip details**.

## Rebook

**I rebooked** captures: new amount (required), and optional new date / train / time / fare family.
It appends to `booking_price_events` (append-only history), sets the new active benchmark, bumps
`benchmark_version`, resets alert state, and continues monitoring if still inside the window.
Historical benchmarks are never rewritten.

## Email

Subject: `Fare drop: BOS → NYP from $74 — save $54`

Body: current ticket → cheapest option (full detail) → up to 3 other options → `View options` CTA.
Footer: _"Fares and availability may change. RailDrop does not automatically modify your Amtrak
reservation."_ A `PARTIAL_SUCCESS` cycle adds a line naming the dates that could not be checked.

## Non-goals for v1

Automatic rebooking; holding inventory; payments; multi-city / return-trip optimisation; non-Amtrak
carriers; scraping amtrak.com.
