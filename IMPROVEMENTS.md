# Improvement log

A running record of iterative design and product cycles, newest first. Read this
before starting a cycle, then reassess against the actual product rather than
trusting the plan below.

Architectural decisions and the reasoning behind them live in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); this file is about what changed
in the product and what is worth doing next.

---

## Cycle 7 — The trade-off a price-ranked list hides

**Why this.** Reading the trip page against real data showed the option list
making the reader do arithmetic it already had the numbers for. On this route
the cheapest fare at **$62.05 takes 5h40m**, while **$64.18 takes 4h29m** — two
dollars for seventy-one minutes. Ranking by price is correct and stays; but
across fourteen rows nobody spots that without a spreadsheet, and it is exactly
the decision the page exists to support.

The trip page was also the longest surface in the product at 2906px, with
roughly 600px of it a stack of set-once controls sitting between the fares and
the record of what happened.

**Delivered.**

| Change                                                                                           | Why                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Journey time on every option**: the quickest is marked, the rest carry how far behind they are | The list had duration but no comparison, so the reader held fourteen numbers in their head                                                                              |
| **A "worth knowing" line** when the cheapest is meaningfully slower                              | It names the _cheapest escape_, not the quickest — the least you can pay to avoid the slow one is the useful version of the offer                                       |
| Both from a pure module (`tradeoffs.ts`)                                                         | Silent in the common case where the cheapest is already fast, and silent when something is both cheaper and faster, because "pay more to go faster" would then be wrong |
| **The rebook action moved up**, directly under the fares                                         | It is how the product learns what actually happened, and it was fifth in a stack of settings below the fold                                                             |
| **Set-once controls collapsed** behind a disclosure                                              | Alert sensitivity and the private note are found once and then forgotten; they were occupying a permanent block above the activity log                                  |
| **One `Disclosure` component** now serves the trip page and the create form                      | The create form had a hand-rolled version from last cycle                                                                                                               |

**Verified** (actually run):

- 316 unit tests, 123 integration tests, all passing.
- The full E2E and visual suite across desktop and mobile, including seven new
  tests for the trade-off signals and the trip-page hierarchy.
- `npm run build`, `check:secrets`, `check:budget` (8 routes within budget).
- Rendered and inspected at 1440 and 390, before and after.

**Two real defects found by testing this cycle's own work:**

- The "fastest" marker rendered with only a CSS margin between it and the
  duration, so the text ran together as `3h 33mfastest` — one word to a screen
  reader, and to any string match. The markup now carries real whitespace.
- At 390px the new deltas tipped an already-tight meta line into wrapping
  mid-value (`7:30 / PM`, `+2h / 7m`), and once the row was restacked
  "Book on Amtrak" rendered as "Book on A", clipped by its own card.

**A blind spot in the project's own gates, now closed.** The overflow sweep only
ever asked whether the _page_ scrolled sideways, so a control pushed past the
edge of a card with `overflow-hidden` was invisible to it — which is exactly how
the clipped button reached a screenshot. A new check walks every `.rd-card` on
every signed-in page at 390px and fails on any control outside its bounds. It
was self-tested by reintroducing the defect, and it names the control and the
page.

**The honesty line held here:** these are comparisons over fares already
fetched. Nothing is reordered, nothing is hidden, and the copy states what was
measured without telling anyone what to do — an E2E test asserts the callout
never says _you should_, _we recommend_ or _best choice_.

**Limitations.** Trade-offs compare against the options RailDrop found in the
window it searched; a faster train outside that window is invisible, which is
the same boundary the rest of the product has. The fastest marker is computed
over everything matching the filters, so it can sit in a row that is not on
screen until "show more" is pressed.

**Highest-value next.**

1. **A fare calendar** — named for four cycles. The honest version is a one-off,
   explicitly costed "check more dates" scan rather than a quiet widening,
   because `date_flexibility_days` is deliberately capped at ±2 for cost
   control. That is a genuine feature, not a view change.
2. **Alert history pagination.** 100 rows is still the ceiling.
3. **Empty and error states on the create form** — the station picker's
   no-results and the submit failure path remain the least designed moments.
4. **The options list at 390px** — the densest surface on the smallest screen,
   and the one place where the new time deltas have the least room.

---

## Cycle 6 — Stating the commitment, and keys for dense lists

**Why these.** The create form is the entry point to everything and had gone
uncritiqued for several cycles. It stated every fact about what RailDrop would
do — how many dates, how many searches, when checks run, what counts as
material — but scattered across five hint lines attached to five different
fields. Read that way none of them answered the question a person is actually
holding: _what am I committing to here_. It also left half a 1440px page empty.

The lists became dense in cycles 4 and 5, which is exactly when keyboard
navigation starts to matter.

**Delivered.**

| Change                                                                  | Why                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A live "What will happen" rail** on the create form                   | Route, the exact dates, the check times and timezone, the provider searches per day and in total, and the alert threshold against the amount entered — composed into one statement, updating as you type                        |
| Derived from a **pure planner** (`plan-preview.ts`)                     | Same arithmetic the scheduler uses, so the promise cannot drift from the behaviour. It drops dates already past and says which, and caps the window at the journey                                                              |
| The five hint lines it replaced are **gone**, not duplicated            | Including a second date-span calculation in the form that compared dates as strings                                                                                                                                             |
| **j / k / arrows / Enter** on the dashboard, option list and alert list | Implemented by moving real DOM focus, so focus rings, Enter, scroll-into-view and screen-reader announcement come from the platform rather than being reimplemented against a shadow index                                      |
| The **fare & service options disclosure** became a real control         | It was a bare text button with no affordance — the least finished element on the form                                                                                                                                           |
| **`serviceWorker.ready` now has a deadline**                            | It never resolves when no worker activates (a private window, blocked site data, an error in sw.js), leaving the push panel on "Checking this device…" forever with no explanation. Losing the race is reported as a real state |

**Verified** (actually run):

- 304 unit tests, 123 integration tests, all passing.
- 146 E2E and visual checks across desktop and mobile, all passing — including
  six new tests for the summary, the mobile ordering and keyboard navigation.
- `npm run build`, `check:secrets`, `check:budget` (8 routes within budget).
- Rendered and inspected at 1440 and 390, before and after.

**Refined after a second pass over my own work:** on a phone the rail first
landed _below_ the submit button — a summary read after the commitment is no
summary at all. The form is now the grid itself, so the rail falls between the
fields and the button on a narrow screen and sits in column two on a wide one.
An E2E test asserts that ordering by measured position, not by markup.

**Two things this cycle's own tooling caught:** a case-sensitive selector in the
E2E helper that broke when the disclosure label changed, and a hydration race
where `j` could be pressed before the listener attached. The second is now
observable — the hook marks its container `data-list-keys="ready"`, because "the
list is on screen" and "the list responds to keys" are different claims.

**Limitations.** The plan summary's search counts describe the schedule, not
billing; actual provider spend still depends on de-duplication across trips that
share a route and date, which the planner deliberately does not try to predict.
Keyboard navigation covers the three main lists, not the fare-by-date strip.

**Highest-value next.**

1. **A fare calendar.** Named for three cycles and still the obvious next
   visualisation; still gated on a costed, explicit opt-in because it multiplies
   provider searches.
2. **Alert history pagination.** 100 rows is the ceiling; day grouping makes a
   "load older" affordance natural.
3. **The trip detail page** is now the longest surface in the product and has
   not had a density pass.
4. **Empty and error states on the create form** — the station picker's
   no-results and the submit failure path are the least designed moments left.

---

## Cycle 5 — Saying what is true, and closing the loop

**Why these.** A critique of the two surfaces cycle 4 named as next found one
correctness problem that outranked any design work: the landing page footer
asserted that RailDrop "reads published fares through a licensed API", on every
deployment — including ones running the deterministic demo provider. That is an
integration claim the product could not back, on its most public surface, from a
product whose entire posture is refusing to assert what it does not know.

The alerts page was the other named surface: a flat list with the same width
waste the dashboard had, and no answer to the question people actually bring to
an alert history — _did any of this lead anywhere?_

**Delivered.**

| Change                                                                                               | Why                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The provider claim is now read from the deployment**, not asserted in copy                         | A live provider is named; a demo deployment says so. The old sentence was false on any deployment without a licensed API                                                                                                   |
| **A demo-data banner** on every surface, signed in and out                                           | Generated fares go through exactly the same pipeline as real ones and looked identical. Nothing on screen distinguished a synthetic $62.05 from an observed one. Renders nothing at all when a live provider is configured |
| **Alert outcomes** — "Rebooked within the hour, at $70 below the previous benchmark"                 | The benchmark ledger already knew whether anything followed an alert. Attribution is to the _latest_ alert before the rebooking, and only downward moves count                                                             |
| **Alerts grouped by day**, in the user's timezone                                                    | A flat list is fine at three alerts and unreadable at three hundred. Grouping on the UTC date would file an 8pm Eastern alert under the following day                                                                      |
| **Alert filters** — rebooked after / no rebooking / delivery failed                                  | The two questions people bring here: which of these did I act on, and did any fail to reach me                                                                                                                             |
| **Alert rows rebuilt** to use the full width                                                         | Same weakness the dashboard had: content in the left third, price far right, empty middle                                                                                                                                  |
| **Landing features regrouped** into _It watches properly_, _It reaches you well_, _It never guesses_ | Ten equal bullets gave "your data stays yours" the same weight as the thing the product is for, and read as a feature dump rather than a point of view                                                                     |

**A line held deliberately.** Outcomes report **sequence, not cause**. "You
rebooked after this alert, at $70 less" is a fact; "this alert saved you $70" is
a claim about why somebody acted, which the data cannot support. Both the unit
tests and an E2E test assert the copy never says _saved you_, _because_ or
_thanks to_.

**Verified** (actually run):

- 292 unit tests, 123 integration tests, all passing.
- 136 E2E and visual checks across desktop and mobile, all passing — including
  four new tests for outcomes, filtering and the demo disclosure.
- `npm run build`, `check:secrets`, `check:budget` (8 routes within budget).
- Rendered and inspected at 1440 and 390, before and after, in both themes.

**Refined after a second pass over my own work:** rows without an outcome were
rendering a bordered strip holding one right-aligned badge — a rule and ~30px of
near-empty space on most rows. Delivery badges now ride the meta line when there
is no outcome to report, and the "Not rebooked" filler text was removed
entirely; the absence of a green edge already says it.

**Limitations.** Outcome attribution assumes a rebooking recorded in RailDrop.
Someone who rebooks on Amtrak without telling RailDrop shows as no outcome,
which is correct — the product cannot see Amtrak — but it understates real
usage. Alert filtering is client-side over the loaded page (100 rows).

**Highest-value next.**

1. **A fare calendar.** Still the obvious next visualisation, still gated on a
   costed opt-in design because it multiplies provider searches.
2. **Keyboard depth.** The palette is good; the dashboard, option list and alert
   list have nothing beyond tab order. `j`/`k` and `Enter` would suit the
   density these lists now have.
3. **Settings.** The last signed-in surface untouched by the last two cycles.
4. **Alert history pagination.** 100 rows is the current ceiling; day grouping
   makes a "load older" affordance natural.

---

## Cycle 4 — Density, and making round trips real

**Why these.** A critique of the rendered pages at 1440 and 390 found the same
weakness everywhere: rows and cards used roughly half their horizontal space,
which made every list tall, sparse and slow to scan. Two features shipped in
earlier cycles were also incomplete in practice — round-trip pairing existed in
the database and nowhere a person could see it, and `/usage` sat in primary
navigation while being unreachable for almost everyone.

**Delivered.**

| Change                                                                                    | Why                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Dashboard card rebuilt** as two columns — identity and money left, evidence right       | The previous card left >50% of its width empty and pushed price history off the card for most trips. A drop now also earns a coloured left edge, so a long list can be scanned without reading a number                  |
| **Round-trip legs render as one journey**                                                 | Linked legs were two unrelated cards that could sit pages apart under a sort, each with a badge pointing at nothing. Grouping is `src/lib/domain/trip-grouping.ts` — pure, and it pairs only on a _reciprocated_ link    |
| **Combined saving** across both legs                                                      | The one figure that needs both legs to mean anything                                                                                                                                                                     |
| **Fare-option filters** — direct only, rail only, no restricted, part of day, travel date | A three-day window on a busy corridor returns 15–20 options and the cheapest is often a 5am departure with two changes. Ranking cannot fix that; only the traveller knows what is acceptable                             |
| **Every filter carries the count it would leave, and disables itself at zero**            | A filter that can only produce "nothing matches" is a dead end the user has to discover and undo                                                                                                                         |
| **Option rows ~25% shorter** — actions moved beside the price                             | The actions sat on their own full-width rule, adding ~60px of empty space to every option                                                                                                                                |
| **Trend on each card** — "↓ $12 since last check"                                         | Derived from history already collected; answers the at-a-glance question the sparkline only hints at                                                                                                                     |
| **Removed the duplicate empty state** on the trip page                                    | "Not enough history" and "Not enough history yet" stacked as two grey slabs and read as broken. The verdict panel now collapses to one line below the confidence floor, and the chart is omitted rather than shown empty |
| **`/usage` hidden from navigation for non-operators**                                     | It is admin-gated, but sat in the mobile tab bar and the dashboard footer for every user, dead-ending in "you cannot see this"                                                                                           |

**Verified** (actually run, not assumed):

- 282 unit tests, 123 integration tests, all passing.
- 130 E2E and visual checks across desktop and mobile, all passing — including
  four new tests for grouping and filters.
- `npm run build`, `check:secrets`, `check:budget` (8 routes within budget).
- Rendered pages inspected at 1440 and 390 in the browser, before and after.

**Two defects the project's own gates caught in this cycle's work**, both fixed:
a 36px control in the new filter bar (touch-target sweep) and round-trip leg
rows breaking across three lines at 390px (visual inspection).

**Limitations.** Filters are client-side over the already-loaded option set,
which is correct at this scale (tens of rows) and would need rethinking at
hundreds. The trend indicator needs two completed checks, so it reads "1 check"
for the first few hours of a trip's life.

**Highest-value next.**

1. **Alerts page filtering and grouping.** It is a flat list; with months of
   history it will need the same treatment the dashboard just got.
2. **A fare calendar.** The date strip shows ±1/±2 days. A wider month view is
   the obvious next visualisation, but it multiplies provider searches — it
   needs an explicit, costed, opt-in design rather than a quiet expansion.
3. **Landing page.** Untouched this cycle and now the least considered surface
   relative to the app behind it.
4. **Keyboard depth.** The palette is good; the option list and dashboard have
   no keyboard affordances beyond tab order.

---

## Cycles 1–3 (summary)

Recorded in detail in `docs/ARCHITECTURE.md` §19–§30 and in the git history.

- **Cycle 1** — the product itself: schema, RLS, scheduler, provider
  abstraction, alert engine, email, dashboard, trip detail, booking handoff.
- **Cycle 2** — notifications and the installable app: Web Push, quiet hours
  that hold rather than drop, PWA, soft delete with undo, command palette,
  exports, settings.
- **Cycle 3** — target prices, the trip timeline, realised savings, round trips
  (data model), account export and deletion, the bundle budget, the
  accessibility gate, scheduler staleness in `/api/health`, and "is this a good
  price?" descriptive statistics.

**A standing constraint, restated because every cycle rediscovers it:** there is
no live Amtrak fare source wired up. `docs/LIVE-FARE-SOURCES.md` holds the probe
evidence. `HttpJsonFareProvider` will talk to any JSON fare API via environment
configuration, and `npm run verify:live` refuses to call an HTTP 200 a success
until a human has compared one fare against amtrak.com. The demo runs on a
deterministic provider, which is clearly labelled as such and is refused
outright in production without an explicit opt-in variable.
