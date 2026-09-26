# Two arguments

Written 2026-09-26, against the codebase as it stands. Nothing here is
implemented. Numbers are from this repo or from measurements recorded in
`docs/PERFORMANCE.md` and `docs/AUDIT.md`; where I am guessing, I say so.

---

## 10.1 Should RailDrop drop the Chromium scrape?

### What it costs today, concretely

|                         |                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| Function size           | 3008 MB × 300 s for `/api/cron/worker` (`vercel.json`)                                                          |
| Concurrency             | `MAX_CONCURRENT_PAGES = 1` on serverless                                                                        |
| Per date                | 55 s navigation + 25 s first wait + 28 s trip wait + 5 s settle, up to 2 attempts                               |
| Station coverage        | **20 of 189** catalog codes have a verified Wanderu id — 89% do not                                             |
| Failure mode of the gap | Silent: unmapped stations fall back to matching city strings, which yields either nothing or the wrong platform |

That last row is the one that should bother us most. It is not a cost, it is a
correctness problem: the scrape works _well_ on twenty Northeast Corridor
stations and _silently badly_ everywhere else. We papered over it with honest
labelling in the picker, which is the right interim answer and not a solution.

### The case for keeping it

**It is the only source that is free per query.** Parse bills ~2 credits per
search. At three slots a day on a ±1 window, one watch is nine searches a day,
~270 a month, ~540 credits a month — for one traveler. Chromium's cost is
compute, which is bounded by the budget ceiling built in 5.3 and does not scale
linearly with watch count the way per-query billing does. Cross-watch dedup
(5.2) compounds this: on a popular corridor, one run serves everyone, and the
marginal traveler is free. With Parse, the marginal traveler costs credits
whether or not somebody else just asked the same question.

**It is the reason the product can promise "every bookable option".** A
narrower source means a narrower promise, and the promise is the product.

**The hard engineering is already paid for.** Lease-based scheduling, the
reaper, single-flight dedup, the cycle deadline, the budget ceiling — that
machinery exists because of Chromium, but it is all provider-agnostic. Dropping
Chromium does not recover that work; it just leaves it over-specified.

### The case against

**It is legally ambiguous in a way the rest of the product is not.** The
product refuses to scrape amtrak.com, refuses to invent deep links, and refuses
to state a fare it did not observe. Then it drives a headless browser against a
third party's site. That is not the same posture. If we are ever asked to
justify it, "we were careful about Amtrak" will not cover Wanderu.

**It is the single largest source of operational fragility.** A DOM change
turns into zero results. We detect that as `PROVIDER_ERROR` rather than as
false data — good — but the traveler still gets nothing, and we find out from
them.

**It forces the whole cost structure.** 3 GB functions exist for Chromium.
Nothing else in the app needs more than 1 GB; the dispatch route dropped to
1 GB the moment it stopped running searches.

**The coverage story is already a compromise.** We are paying all of the above
for 20 verified stations.

### The alternatives, honestly costed

**Parse-only.** Removes the legal ambiguity, the 3 GB functions, the DOM
fragility, and ~600 lines of browser plumbing. Costs money per query, linearly,
forever — and the cross-watch dedup that makes popular corridors nearly free
stops being a compute saving and becomes a billing saving, which is better but
smaller. _Unknown I cannot resolve from here: Parse's actual station coverage._
If it is also ~20 NEC stations, this changes nothing about coverage and is
straightforwardly better. If it is national, it is better still and the
comparison is not close.

**An official data agreement.** The only option that makes the product durable
rather than tolerated. Also the only one that cannot be executed unilaterally,
takes months, and probably requires being a business rather than a project
first. Worth starting precisely because it is slow.

**A user-side browser extension reading the traveler's own session.** Superficially
elegant — the data is genuinely theirs, no third-party site is touched by us,
and coverage becomes whatever Amtrak shows them. I would argue against it
firmly. It requires the traveler to install something before they get value,
which destroys the guest flow that is currently the product's best feature; it
only works while their browser is open, which is incompatible with checking
three times a day for 48 hours; and it moves credential-adjacent surface into
our software. The conversion cost alone disqualifies it.

**Narrow to corridors with a cheaper source.** This is the disguised version of
what we already are. We are a Northeast Corridor product with a national
station list. Formalising that — 20 corridors, stated plainly, with the rest
marked unsupported rather than "coverage unverified" — would make the product
more honest overnight and cost nothing.

### Recommendation

**Do not drop Chromium yet. Do stop pretending it is national, and get the
number that decides it.**

Three steps, in order:

1. **Measure Parse's real station coverage.** One afternoon with
   `scripts/probe-provider.ts`. Everything above turns on this and I cannot
   answer it from the repo. Until it is known, the Parse-only argument is
   unfalsifiable in either direction.
2. **Narrow the promise to what is verified.** Ship the 20 mapped stations as
   the supported set. Keep the rest reachable but labelled. This is a copy and
   catalog change, not an architecture change, and it is the honest position
   regardless of which provider wins.
3. **Then decide.** If Parse covers materially more than 20 stations, migrate
   and delete the browser. If it does not, keep Chromium, but as an explicitly
   NEC-only product with a cost ceiling — which, after 5.3, it now has.

The thing I would not do is keep running a fragile national-looking scraper
that is verified for one corridor. That is the status quo, and it is the worst
of the options because it is the only one that misleads.

---

## 10.2 What is the moat, and does it require rail?

### What is actually general

The domain layer is almost entirely not about trains:

| Module                                                         | What it really is                                              |
| -------------------------------------------------------------- | -------------------------------------------------------------- |
| `calendar` / `monitoring`                                      | Window generation around a committed date                      |
| `eligibility`                                                  | Is this alternative comparable to what you bought?             |
| `ranking`                                                      | Order by value under uncertainty                               |
| `opportunity`                                                  | Has the world changed enough to be worth saying?               |
| `board-state`                                                  | How a person interrogates a set of alternatives                |
| `run-lease`, `search-dedup`, `cycle-budget`, `provider-budget` | How to poll an expensive external market safely and affordably |

Only `service-type`, `fare-family`, `wanderu-*` and the station catalog are
rail-specific. The engine is: _watch a market you have already committed to, and
speak only when acting is genuinely better._

That framing applies cleanly to hotels, flights with fare-difference rebooking,
event tickets — anywhere post-purchase prices are published and changing is
possible but costly.

### Why breadth is the wrong next move anyway

**The engine is not the moat.** It is perhaps six weeks of good engineering.
Any competent team could rebuild `opportunity.ts`. What is hard to copy is the
thing we have been accumulating by accident: three-times-daily observations of
NEC pricing, which nobody publishes. Phase 7 exists to turn that into a product
and it has not been built. Going broad before building it abandons the only
asset that compounds.

**Breadth multiplies the worst part of the system.** Each new market is a new
provider integration, a new eligibility model, new change-fee semantics, and a
new legal posture. We currently have _one_ provider and it covers 11% of our own
station list. The correct response to that is not a second market.

**The data asset is superlinear and the engine is not.** Every day of NEC
observations makes the corridor statistics better, makes the wait-or-book call
more confident, and makes the public corridor pages more useful — all of which
attract more watches, which produce more observations. The engine does not
improve by being used.

### Where I will argue against the premise

The question assumes depth and breadth are alternatives. The genuinely
interesting third option is **depth in rail, with the engine deliberately kept
market-agnostic** — which is the current shape, and worth protecting on purpose
rather than by accident. Concretely: keep rail concepts out of
`src/lib/domain/*` except the four modules named above, and treat any new
rail-ism there as a design error. That costs nothing now and keeps the breadth
option alive without spending anything on it.

The ESLint rule that keeps `src/lib/domain` I/O-free could be extended to flag
rail vocabulary in the general modules. Cheap, and it turns an intention into a
check.

### What breaks in each direction

**Going deep in rail:** the ceiling is the size of the Amtrak fare-watching
market, which is small. Chromium fragility stays. An official partnership
becomes essential rather than nice, and if refused, the product stays
permanently semi-legitimate.

**Going broad:** the corridor data never reaches critical mass in any single
market, so the wait-or-book call stays low-confidence everywhere. The provider
surface multiplies while 89% of the existing station list is still unverified.
Most likely outcome is two shallow products instead of one defensible one.

### Recommendation

**Depth in rail. Build Phase 7 next, and keep the engine clean as insurance.**

Specifically: Phase 7.1 (corridor statistics) and 7.4 (the methodology page) are
the highest-value unbuilt work in either wave. 7.1 turns exhaust into an asset;
7.4 is what separates this from a scraper with a UI — a product willing to
state what it does not know. Both are cheap relative to everything else
outstanding, and neither depends on resolving 10.1.

If depth in rail hits its ceiling, the engine is still portable, because we will
have kept it that way deliberately. That is a real option, and it costs nothing
to hold.
