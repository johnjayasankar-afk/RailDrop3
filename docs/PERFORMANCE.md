# Performance

Measured 2026-09-26 on an Apple Silicon Mac at 120 Hz, against the dev server
(`npm run dev:qa`, fixture provider, in-memory store) except where the bundle
figures are noted as production build output.

**Read the caveats before quoting these.** A dev build runs unminified React
with development warnings, so render and interaction numbers here are
pessimistic — production is faster. Frame-rate numbers, layout shift and DOM
size are essentially the same in both. This machine is also fast and
high-refresh; a mid-range phone will not reproduce the frame numbers below, and
nothing here has been measured on one.

## Provider accuracy (measured 2026-09-27, live inventory)

`npx tsx scripts/eval-providers.ts` scores the fare providers against live
Amtrak inventory. It costs real provider credit and takes minutes.

**What it can claim.** There is no ground truth here short of buying a ticket,
so it does not score against Amtrak's real price. It measures three things that
are checkable: how often a search comes back usable, how many fares fail a
plausibility check — which is how you find out the parser has drifted from the
page — and, when two providers are configured, whether they agree. Agreement is
most useful when it fails: two sources forty per cent apart proves one is wrong,
and the eval refuses to average them.

Nine searches, three corridors, three dates:

|                   |                                |
| ----------------- | ------------------------------ |
| Usable            | 8 / 9                          |
| Outright failures | 0                              |
| Latency           | **p50 2.2 s · p95 2.9 s**      |
| Fares returned    | 238 believable, **0 rejected** |
| Coverage          | median 32 trains per search    |

Zero plausibility rejections across 238 fares: the parser is reading the page
correctly. Latency is much better than the 2–12 s recorded in the section below,
which was measured while the live site was being hammered by repeated
measurement runs — a reminder that a number taken during your own load test is
a number about your load test.

**The one failure was a real bug, and the eval is why it was found.** PHL→NYP on
2026-10-22 returned zero trains, reproducibly, while the next day on the same
corridor returned 33. The app reported that as "nothing listed on the live
board... not a problem at our end". It is now judged against the rest of the
window and failed as an unreadable date. See `src/lib/domain/empty-result.ts`.

Set `PARSE_API_KEY` to have the eval cross-check two providers against each
other.

## Where the time actually goes (measured 2026-09-27, production build)

`next start` against the local file store, five-date BOS→NYP window, real
Wanderu scraping. Every number below is a median of at least three runs.

| Stage                             | Cost         | Notes                                |
| --------------------------------- | ------------ | ------------------------------------ |
| Board page, server render (warm)  | **53–92 ms** | 110 KB of HTML                       |
| Dashboard, server render (warm)   | **26–32 ms** |                                      |
| Board page, first render (cold)   | 750 ms       | One-off, per process                 |
| JS the board loads, gzipped       | **218 KB**   | 12 chunks                            |
| **One live fare search**          | **2–12 s**   | Per date. Dominates everything else. |
| **Creating a watch (5 dates)**    | **15 s**     | What a person actually waits for     |
| A repeat search inside 20 minutes | **0.3 s**    | The dedup cache, doing its job       |

**The render path is not the problem and optimising it would be theatre.** A
warm board renders in under 100 ms; one date of live scraping costs fifty times
that. Everything a traveler experiences as slow is Wanderu's page loading in a
headless browser, and the only two things that have ever moved that number are
the dedup cache (0.3 s instead of 15 s on a repeat) and search concurrency.

### Search concurrency, and a wrong answer that looked right

A single slow cycle showed three concurrent searches at 41 s each where two had
taken 8.5 s. The obvious inference — three headless pages starve each other —
was wrong, and it survived long enough to get written into the code.

Wall clock for the same five-date window, medians of three runs:

| Pages at once | Wall clock |
| ------------- | ---------- |
| 1             | ~22 s      |
| 2             | ~18 s      |
| **3**         | **~15 s**  |
| 4             | ~28 s      |

Three is the best of them and four falls off a cliff, which is where the
contention actually starts. The 41 s observation was the live site having a bad
minute: run-to-run variance at a fixed setting spans 12 s to 29 s, wide enough
to swallow any difference between 1, 2 and 3.

The lesson is in the code as a comment, because it is the kind of mistake that
repeats: **do not re-tune this from one observation.** `WANDERU_MAX_PAGES` and
`RAILDROP_SEARCH_PARALLEL` override it without a deploy, capped at 4.

Serverless stays at 1, for memory rather than speed — a Lambda has a fraction of
the RAM and an OOM costs the whole cycle.

## The headline

**There was no scroll problem to fix.** This was measured before any change, at
three sizes, and again after. The app holds 120 fps with zero dropped frames.

| Surface                                | Frames | Median | p95    | Worst  | Frames > 32 ms | FPS   |
| -------------------------------------- | ------ | ------ | ------ | ------ | -------------- | ----- |
| Landing page                           | 264    | 8.3 ms | 9.2 ms | 9.4 ms | **0**          | 120.5 |
| Watch board, 9 rows (770 DOM nodes)    | 312    | 8.3 ms | 9.3 ms | 9.4 ms | **0**          | 120.5 |
| Watch board, 60 rows (2,816 DOM nodes) | 359    | 8.3 ms | 9.2 ms | 9.5 ms | **0**          | 120.5 |

Method: a scripted scroll over the full page height, sampling
`requestAnimationFrame` deltas. The 60-row case was produced by cloning real
rows in the DOM, so it measures layout, paint and composite of a busy-corridor
board — not React's cost to build it.

**Consequence: the board is not virtualized, deliberately.** The plan called for
windowing at 60+ rows. At 60 rows the board drops no frames, so virtualization
would add a scroll-position failure mode and a stack of complexity to fix a
problem that does not exist at this scale. Revisit if a corridor ever produces
several hundred rows, and measure again first.

## Other measurements

| Metric                   | Measured              | Notes                                                             |
| ------------------------ | --------------------- | ----------------------------------------------------------------- |
| Cumulative layout shift  | **0**                 | No FOUT reflow; `next/font` already emits size-adjusted fallbacks |
| Fonts                    | 104 KB across 4 files | Inter var + IBM Plex Mono 400/500, self-hosted, cached            |
| Client JS, all routes    | **311 KB gzipped**    | Production build, 22 chunks                                       |
| CSS                      | **12.2 KB gzipped**   | One stylesheet                                                    |
| Server render (TTFB)     | 58–78 ms              | Dev, in-memory store. Production adds the Supabase round-trip.    |
| Interaction: sort change | ~31 ms of real work   | Dev build; see below                                              |

### On that ~31 ms

A sort or filter change measured ~47 ms end to end, but the measurement harness
itself (two chained `requestAnimationFrame` calls) costs ~15.7 ms, so the real
work is ~31 ms in a dev build. Production React typically renders this class of
tree two to three times faster, which puts it near a single frame. It was not
optimised further because the number could not be shown to be a problem.

### No dependency bloat

`lucide-react`, `date-fns`, `zod` and `@supabase/supabase-js` appear in **zero**
client components — checked, not assumed. There are 14 `"use client"` files; the
largest is `watch-detail.tsx` at ~2,400 lines.

## What was changed, and what it actually bought

**`BoardRow` is memoised, and its callbacks are stable.** The row previously
received four freshly-built arrow functions per render, which makes `React.memo`
useless — the props always differ. The four handlers now take the row key and
are created once with `useCallback`, reading volatile state from the refs the
keyboard handler already maintains.

Honest result: **this did not move the number at 9 rows** — 50.7 ms median
before, 52.4 ms after, which is within noise. It is kept because it is correct,
carries no measured regression, removes four closure allocations per row per
render, and is the shape that pays at 60 rows. It is not presented as a speedup.

**Skeletons on dark surfaces.** The four `loading.tsx` files marked their
swatches `bg-[#2a241e]` to make them dark inside the near-black departure strip.
That class never did anything: `.skeleton` sets the `background` shorthand,
which resets `background-color`, so every navigation to a watch page flashed
bright bars inside a near-black strip. The dead classes are gone and the shimmer
now takes its stops from the surface it sits on, so `.depart-strip .skeleton`
renders dark green on `#13241b` and paper skeletons are unchanged.

**Alert email palette.** The template still carried the pre-port maroon and
cream. Ported to the shipped green.

## What was considered and rejected

| Idea                                              | Why not                                                                                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Virtualize the board                              | 60 rows drops zero frames. Would add scroll-anchoring bugs to fix nothing.                                                                                                                              |
| `content-visibility: auto` on below-fold sections | Wrong `contain-intrinsic-size` causes scrollbar jitter — the exact symptom the work was meant to remove — against a baseline already at 120 fps with no measurable upside on any device available here. |
| Pause off-screen infinite animations              | Seven run continuously, but all are composited transforms, all are covered by the `prefers-reduced-motion` block, and the compositor shows no dropped frames.                                           |
| Font preload / `font-display` change              | CLS is already 0 and fonts are cached. Nothing to win.                                                                                                                                                  |

## Budgets

No budget is enforced in CI yet. Proposed starting points, from today's numbers:

- Client JS, all routes: **350 KB gzipped** (currently 311 KB)
- CSS: **16 KB gzipped** (currently 12.2 KB)
- Board scroll at 60 rows: **zero frames over 32 ms**
- CLS on every route: **0**

## How to reproduce

1. `npm run dev:qa`, create a watch through the UI (guest flow).
2. In the browser console, sample `requestAnimationFrame` deltas across a
   scripted `window.scrollTo` over `scrollHeight - innerHeight`.
3. Front the tab first. A backgrounded tab throttles rAF to ~1 fps and
   `first-contentful-paint` reports tens of seconds — both are artifacts, not
   results. Two measurements in this session had to be discarded for exactly
   that reason.
