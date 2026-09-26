# Phase 0 — correctness audit

Date: 2026-09-25. Baseline commit `ea3dd8e`, plus `66da9b1` which committed the
in-flight working tree as-is so the fixes below are reviewable diffs.

**How to read the evidence column.** "Verified live" means I drove it in a
browser against a running dev server and watched the result. "Verified by test"
means a test in this repo fails if the behaviour regresses. "Read" means I
established it by reading the code and did not execute that path. Nothing below
is asserted from assumption.

---

## 0.0 The tree was never green (not in the original brief)

`npm run verify` failed on its **first** step, `format:check`, in 21 files. Because
the steps are `&&`-chained, `lint` had never run in that pipeline — and it had
**three real errors** waiting behind the formatting failure:

| Error                                                  | File                       | Fix                                                                                |
| ------------------------------------------------------ | -------------------------- | ---------------------------------------------------------------------------------- |
| Cannot access refs during render                       | `searching-overlay.tsx:23` | ref write moved into an effect                                                     |
| Cannot call impure function during render (`Date.now`) | `watch-detail.tsx:561`     | extracted as `extensionWindow()` in the domain layer, tested across a DST boundary |
| setState synchronously within an effect                | `watch-detail.tsx:571`     | suppressed with the real fix scheduled — see the note below                        |

The formatting pass is its own commit so it cannot hide a behaviour change.

**One deliberate suppression.** The settings form re-seeds five `useState`s from
props in an effect. The correct shape is a keyed `<WatchSettingsForm/>` that
remounts with fresh defaults, which arrives in Phase 1.2 when the settings panel
becomes its own component. Doing that component surgery in Phase 0 would change
rendered output, which Phase 1 explicitly forbids. It is an `eslint-disable`
with a comment naming the real fix, not a silent one.

`npm run verify` now exits 0: 115 tests, 0 lint errors, build passes.

---

## 0.1 Keyboard handler hijacks browser shortcuts — **confirmed, HIGH, fixed**

Real, and slightly worse than described. The handler bound **20 bare keys** at
`window` and guarded only against `INPUT`/`TEXTAREA`/`SELECT`. It never read
`metaKey`, `ctrlKey`, `altKey`, `isComposing`, or `isContentEditable`, and every
branch called `preventDefault()`.

Blast radius on the live site, all simultaneously:

| Chord                                                                             | What happened                                                                                                                                                                   |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `⌘C` / `Ctrl+C`                                                                   | **Fired a live-fare recheck and swallowed the copy.** On the Parse path that spends `PROVIDER_CREDITS_PER_SEARCH`; on Wanderu it launches Chromium. The clipboard stayed empty. |
| `⌘R`                                                                              | Opened the rebook form instead of reloading                                                                                                                                     |
| `⌘P`                                                                              | Toggled a pin instead of printing                                                                                                                                               |
| `⌘F`                                                                              | Copied Amtrak search fields instead of find-in-page                                                                                                                             |
| `⌘Z` / `⌘U` / `⌘I` / `⌘B` / `⌘T` / `⌘G` / `⌘J` / `⌘K` / `⌘N` / `⌘Y` / `⌘W` / `⌘H` | All captured                                                                                                                                                                    |

**Fix.** `shouldHandleBoardKey()` in `src/lib/domain/board-keys.ts` — pure, nine
tests. Declines modified keys, IME composition, text-entry tags and
`contenteditable`. Shift deliberately still passes, because `?` is `Shift+/`.

**Evidence.** Verified live: with the board focused, `⌘C` produces no overlay and
no toast; plain `c` still fires the recheck and shows "Board refreshed · 6
options". Verified by test: `tests/unit/board-keys.test.ts`.

---

## 0.2 Station coverage gap — **confirmed, worse than described, partly fixed**

The real numbers differ from the brief: the catalog holds **194 rows / 189
unique codes** (not 197) and the map has **20 ids** (not 21). So **169 codes —
89% of the catalog — have no verified provider id.**

Three findings the brief did not anticipate:

**(a) Two lookups disagreed, and the product showed one station while searching
another.** `STATION_BY_CODE` built a `Map` (last entry wins) while
`stationByCode()` in the provider layer used `STATIONS.find` (first wins). Five
codes appear twice, so for those the picker and the search disagreed. `SFA`
displayed **St. Albans, VT** and searched **San Francisco, CA** — and the
returned journeys were relabeled with the traveler's own codes
(`wanderu-normalizer.ts` sets `originCode: request.originCode`). A real price,
for a station nobody chose, presented as theirs. That is precisely the thing the
product promises not to do. **Fixed:** one first-wins lookup, used everywhere,
with a test asserting the two agree for every catalog entry.

**(b) `relaxStationMatch` is a no-op for the 169 unmapped codes.** The guard is
`if (!relax && mapped && tripStationId)`; `mapped` is `undefined` for them, so
both the strict and the "relaxed" pass fall through to the same city/state
comparison. The retry buys nothing. **Not fixed** — it is dead weight rather
than a defect, and removing it belongs with the provider work in Phase 4.6.

**(c) The failure is recorded as a success.** An unmapped station yields
`NO_INVENTORY`, which `check-cycle.ts` pushes to `datesSucceeded`. The traveler
sees a completed check with no cheaper fare, rather than "this station is not
supported". Two silent shapes:

- **Wrong city string** → every trip dropped. `BUF` is filed under "Depew",
  `ALB` under "Rensselaer", `MET` under "Iselin".
- **Two stations, one city** → the filter cannot tell them apart and returns the
  other platform's fare. `RVR`/`RVM`, `CRH`/`CVS`, `OAC`/`OKJ`, `EVR`/`EVE`.

**And the fallback does not save it**, for two independent reasons:
`FallbackFareProvider` only engages on `PROVIDER_ERROR` — which this never is —
and without `PARSE_API_KEY` there is no secondary at all, while
`fareProviderStatus()` still reports `configured: true`.

**Fixed:** `stationCoverage()` classifies every code as verified / unverified /
ambiguous / unknown, the search API returns it, and the picker labels it before
a watch exists. A hand-typed three-letter code the catalog has never heard of is
now called out instead of silently accepted. `scripts/verify-station-map.ts`
probes the mapped ids and reports drift; it never writes the map, because a
machine guessing station ids is how (a) happened.

**Left open, deliberately:** `SFA` and `OSC` are each two different real places.
Deciding which owns the code needs an authoritative Amtrak source. Guessing
would be inventing data, so they are reported as ambiguous. Three rows that were
the same station listed twice (`PTH`, `CIN`, `MKA`) were merged.

**Evidence.** Verified live: typing "Buffalo" shows `UNVERIFIED` beside NBU, BUF
and BFX. Verified by test: `tests/unit/station-coverage.test.ts`, which pins
189/20/169 so adding an unmapped station is a deliberate act.

---

## 0.3 Doc cross-contamination — **confirmed, fixed**

`docs/FAILURE_MODES.md` was RideLens's matrix: Obi, Curb, Uber, Lyft, Empower,
surge pricing, geocodes. Nothing to do with Amtrak. Rewritten from the actual
failure surface, organised around the distinction the product rests on —
`NO_INVENTORY` (Amtrak had nothing) versus `PROVIDER_ERROR` (we did not get an
answer) — and it records the places that line is still blurred.

---

## 0.4 Deployment domain mismatch — **confirmed, fixed**

Four code sites hardcoded `https://raildrop.app`, which this deployment does not
serve: `metadataBase`, both sitemap entries, and the robots sitemap pointer. A
fifth had `raildrop.app` baked into the OG PNG as display text. Meanwhile the
alert email CTA came from `NEXT_PUBLIC_APP_URL`, whose zod default is
`http://localhost:3000` — and both `SETUP_REQUIRED.md:87` and
`GITHUB_AND_VERCEL.md:50` tell you to set it _after_ the first deploy. **So the
first production alert emails shipped a dead localhost link.**

**Fixed.** `appOrigin()` in `src/lib/config.ts`: explicit config →
`VERCEL_PROJECT_PRODUCTION_URL` → localhost. Used by `metadataBase`, sitemap,
robots and the email CTA. The OG card now says "Amtrak fare watch" — a static
image cannot resolve an origin at request time, and naming a domain we do not
serve is worse than naming none.

**Evidence.** Verified by test: `tests/unit/app-origin.test.ts` (6 cases) and a
test that forbids product-domain literals anywhere in `src/app`.

---

## 0.5 Theme colour mismatch — **confirmed, fixed**

`#efe8d9` was the pre-Labs paper. The re-skin moved `--paper` to `#f8f6f1` in
`globals.css` and left the old value in five places: `viewport.themeColor`, the
manifest's `theme_color` and `background_color`, both app icons, the OG card and
the email body. The browser chrome sat a shade darker than the page it framed.

All reconciled to `#f8f6f1`, with `tests/unit/theme-color.test.ts` reading
`--paper` out of the stylesheet and asserting the others match.

**The media-query (light/dark) form is deliberately deferred to Phase 3.6.**
There is no `prefers-color-scheme` block in `globals.css` at all today, so a
dark `themeColor` would promise a theme that does not exist.

---

## 0.6 Cron secret in query string — **confirmed, fixed**

`?secret=` was accepted alongside the header, compared with `===`. A secret in a
query string lands in Vercel's access logs, in any `Referer` sent onward, and in
the history of every browser it is pasted into. Vercel Cron sends the header, so
the query form was pure attack surface.

**Fixed.** Header only, in a shared `operatorAuthorized()`
(`src/lib/auth/operator.ts`), compared in constant time over SHA-256 digests —
digests rather than `timingSafeEqual` on the raw strings, because that throws on
a length mismatch, which itself leaks the length. GET still delegates to POST
(Vercel Cron issues GET) but now requires the header on both, so a browser
visiting the URL gets 401 instead of triggering a dispatch.

**An adjacent hole the brief did not list, now closed.**
`/api/health/provider?probe=1` ran a **real** BOS→NYP search for any anonymous
caller — Chromium launch plus provider credits, at 3008 MB × 120 s per hit, in a
loop if anyone felt like it. It now requires the same operator credential.
Unauthenticated callers get configuration booleans only.
`docs/SECURITY_REVIEW.md:16` claimed "internal health is also secret-gated";
that was false when written and is true now.

---

## 0.7 Function cost / cold start — **confirmed, partly fixed**

**Measured worst case.** On serverless `MAX_CONCURRENT_PAGES` is 1 and the
per-date budget is `PAGE_GOTO_TIMEOUT_MS` 55 s + first wait 25 s + `TRIP_WAIT_MS`
28 s + `EXTRA_WAIT_MS` 5 s ≈ **113 s per attempt**, with `maxAttempts` 2. A ±1
window is three dates, serialized: **up to ~680 s against a 300 s ceiling.** The
platform kills the invocation, no cycle row is completed, and the traveler sees
the previous check as the newest one with no sign anything was attempted.

**Fixed: a hard deadline.** `src/lib/domain/cycle-budget.ts` reserves 45 s of the
300 s for writing the cycle down. Before each search the cycle asks whether the
**slowest search so far** would still fit; if not it stops. Deliberately not a
bare "is the deadline past" check — starting a search that cannot finish spends a
credit, holds the only page, and dies anyway. The first search always proceeds,
because a cycle that tries nothing is indistinguishable from an outage.

Dates never reached are recorded as `PROVIDER_ERROR` with a plain message, never
as empty inventory, so the cycle degrades to `PARTIAL_SUCCESS`. They cost no
credits.

**Evidence.** Verified by test: `tests/unit/cycle-budget.test.ts` (6 cases) and
two integration tests asserting a squeezed budget yields one search,
`PARTIAL_SUCCESS`, `datesFailed = [the two it never reached]`, and
`providerRequests = 1`.

**Not done: right-sizing memory.** 3008 MB × 4 routes is still unmeasured. Peak
RSS needs a real Chromium run on the deployment, which I cannot do from here
without deploying. Carried to Phase 4.1 with the measurement method recorded
rather than a guessed number substituted.

---

## 0.8 Junk — **confirmed, fixed**

`.DS_Store` was **tracked** (committed in `ea3dd8e`, "Update .DS_Store"), so the
`.gitignore` entry did not untrack it. Removed from the index. `.gitignore`
gained `.playwright/`, `test-results/`, `playwright-report/`, `.vercel`,
`coverage/`. Five untouched Next scaffold SVGs (`file`, `globe`, `next`,
`vercel`, `window`) deleted after confirming zero references.

**`tests 2/` — a Finder duplicate of the entire test tree — was not junk.** It
was byte-identical to `tests/` except for one file that was _newer_ and tested
`pinBrowsersPath`, an export that exists. Those tests **failed against the
current source**, and they were right to:

> `pinBrowsersPath()` joined `process.cwd()`, which on Vercel is `/var/task` —
> the deployment bundle, mounted **read-only**. `mkdirSync` threw `ENOENT`/`EROFS`
> on every cold start and the raw error reached the UI, so live fares failed
> before a browser was ever launched.

Fixed to use `/tmp` on Vercel, with the read-only case added to
`sanitizeProviderError`. Tests ported, duplicate removed.

**`.env.example` did not exist**, although `docs/SECURITY.md:14` says it
documents the names. Written.

---

## 0.9 Functionality sweep

| Area                                     | Verdict                   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Guest flow `/api/auth/guest?next=…`      | **Works**                 | Verified live: redirects to `/watches/new` with a session                                                                                                                                                                                                                                                                                                                                                                                                                |
| Create watch → board renders             | **Works**                 | Verified live: BOS→NYP $128 created, board rendered 6 cheaper options                                                                                                                                                                                                                                                                                                                                                                                                    |
| Station search + picker                  | **Works**                 | Verified live: "Buffalo" returns NBU/BUF/BFX with coverage tags                                                                                                                                                                                                                                                                                                                                                                                                          |
| Coverage labelling (new)                 | **Works**                 | Verified live, see 0.2                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `C` recheck                              | **Works**                 | Verified live: toast "Board refreshed · 6 options"                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `⌘C` does not hijack (new)               | **Works**                 | Verified live, see 0.1                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `?` help sheet                           | **Works**                 | Verified live: opens, lists 19 entries, `Esc` closes                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `T` copy for a friend                    | **Works**                 | Verified live via a `writeText` spy; copy reads "cheapest listed $74 … You paid $128. Confirm on Amtrak before changing anything."                                                                                                                                                                                                                                                                                                                                       |
| Clipboard failure path                   | **Fixed**                 | Was broken: 15 call sites, zero error handling, every one showing a success toast unconditionally — so on a non-secure context or an iOS in-app browser the copy failed and the UI said it worked. Now one `copyText()` in `src/lib/clipboard.ts`: Clipboard API, then a selection-based fallback, then an honest failure that puts the text on screen to copy by hand. 9 unit tests. Verified live with both routes disabled: no toast, panel shown, text pre-selected. |
| Help sheet accuracy                      | **Fixed**                 | Six entries described behaviour the board does not have. `C` now says it only works while the watch is active; `P`, `Z` and `?` say they toggle; `B` says it jumps to the _first_ beater; `Esc` describes what it actually closes.                                                                                                                                                                                                                                       |
| Focus fallbacks                          | **Partial**               | Read: `I`, `Y`, `F`, `Enter` fall back to `ranked[0]` when nothing is focused — which may be a train hidden or filtered off the board. The sheet says "the focused train".                                                                                                                                                                                                                                                                                               |
| Filters and sorts                        | **Works**                 | Read: all 12 filters + 5 sorts traced to `filterBoard`/`sortBoard`; verified live at desktop that the board responds                                                                                                                                                                                                                                                                                                                                                     |
| Two reset paths diverge                  | **Partial**               | Read: `clearFilters()` and the `Esc` branch differ on `picked` — `Esc` clears it, the button does not                                                                                                                                                                                                                                                                                                                                                                    |
| 404 / not-found                          | **Works, but misleading** | Verified live: a watch URL without a session renders "The watch may have been deleted, or the link is stale" rather than offering sign-in. Designed state, wrong message. Phase 3.8.                                                                                                                                                                                                                                                                                     |
| Mobile 375px — no horizontal overflow    | **Works**                 | Verified live: `scrollWidth === clientWidth === 375` on the board                                                                                                                                                                                                                                                                                                                                                                                                        |
| Mobile 375px — sticky dock               | **Partial**               | Verified live by measurement: `.action-dock` is **445 px tall on an 812 px viewport (55%)** and overlaps the `+24h/+48h/+72h` row by 11 px. Leaves a third of the screen for the board. Phase 3/4.                                                                                                                                                                                                                                                                       |
| Hydration                                | **Broken**                | Verified live: React logs "A tree hydrated but some attributes of the server rendered HTML didn't match… **This won't be patched up.**" on `/watches/new`. See below.                                                                                                                                                                                                                                                                                                    |
| Delete watch                             | **Fixed**                 | Was one click from "Copy packet", irreversible, taking the whole price history with it. Now two-step and self-disarming after 4s; verified live that the first click sends no request.                                                                                                                                                                                                                                                                                   |
| Email sign-in, magic link, OTP, callback | **Not verified**          | Requires live Supabase; no credentials in this environment. Read only.                                                                                                                                                                                                                                                                                                                                                                                                   |
| Alert email HTML/text render             | **Not verified live**     | Requires Resend. Read: template builds, CTA now uses `appOrigin()`, covered by integration tests through `RecordingMailer`.                                                                                                                                                                                                                                                                                                                                              |
| Print stylesheet, reduced-motion         | **Not verified**          | Read: both exist in `globals.css` (`@media print`, `@media (prefers-reduced-motion: reduce)` covering 8 animated classes). Not exercised.                                                                                                                                                                                                                                                                                                                                |

### The hydration error, and a decision I did not make alone

The `labs-glass` / `labs-ui` layer committed in the baseline runs a
framework-free DOM script on every page with `observe: true`. It adds classes and
inline custom properties to `header` and `.panel`, and it **rewrites every `h1`
and `h2` into `<span class="wd">` word wrappers**. React's hydration diff shows
exactly that:

```
<h1
+   className="serif mt-2 text-4xl"
-   className="serif mt-2 text-4xl wds wds--io is-in"
-   data-wd-done="1"
>
+   Watch a trip
```

Three problems, of increasing importance:

1. A hydration mismatch React says it will not patch up, on a core page.
2. Splitting headings into per-word spans is an accessibility and
   select/copy hazard, and it fights Phase 4.9.
3. It is **generic web motion** — scroll reveals, a pointer-tracking highlight,
   backdrop-blur glass. Phase 3 of the brief is explicit: every animation must
   read as _mechanical departure board_, and the existing idiom is paper, ink,
   gold rules and split-flap. The glass layer is a different product's language
   wearing this one's colours.

**Resolved:** you chose to keep the look and drop the script. The `gl` class and
its tint are now declared in the markup and the stylesheet exactly as the script
used to inject them, `labs-ui.tsx` and `labs-ui.js` are deleted, and the
JS-only rules (`.gl-on`, the `.wd` word-reveal block) are pruned.

Verified live on a clean tab: **no console output at all** on `/watches/new`,
and computed styles are identical to what the script produced — header
`--gl-tint: .5`, panels `.62`, both `blur(16px) saturate(1.8)` with the same
rim shadow; zero `.wd` spans and zero injected attributes. What is lost is the
scroll-reveal and the per-word heading arrival; the material is unchanged.

---

## Carried forward

| Item                                                                         | Phase                                           |
| ---------------------------------------------------------------------------- | ----------------------------------------------- |
| Clipboard: one `copy()` helper, fallback, never a silent success             | 1.3                                             |
| Keyed `<WatchSettingsForm/>` to remove the `set-state-in-effect` suppression | 1.2                                             |
| Help-sheet wording reconciled with behaviour; `B` cycles like `N`            | 2.2 (the palette becomes the canonical surface) |
| Delete confirmation                                                          | 2                                               |
| Right-size 3008 MB from a measured peak RSS                                  | 4.1                                             |
| Remove the dead `relaxStationMatch` retry; circuit breaker; canary           | 4.6                                             |
| RLS cross-user denial test; logger redaction test; rate limit on check       | 4.7                                             |
| Sticky dock height on small viewports                                        | 3.5                                             |
| Sign-in-aware not-found copy                                                 | 3.8                                             |
