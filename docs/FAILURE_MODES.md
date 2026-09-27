# Failure modes & mitigations

RailDrop's promise is that it never invents a price. Most of the work in this
document is therefore about one distinction: **a fare that does not exist** and
**a fare we failed to look up** must never render as the same thing.

The previous version of this file described Obi, Curb, Uber, Lyft and surge
pricing. It belonged to a different product and has been replaced.

## The one that matters

`NO_INVENTORY` means the provider answered and there was nothing to sell.
`PROVIDER_ERROR` means we did not get an answer. The first is a fact about
Amtrak; the second is a fact about us. `resolveCycleStatus`
(`src/lib/orchestration/check-cycle.ts`) keeps them apart, and the board renders
failed dates by name rather than folding them into "no cheaper fare yet".

Where that line is currently blurred is recorded honestly in the table below.

## Deployment

The failure mode with the highest cost so far, and the only one where **nothing
was wrong with the application**. Worth its own section because every other
entry in this file assumes the code under discussion is the code that is running.

Three independent faults produced one symptom — "nothing has deployed since 13
September" — and each was individually sufficient, so fixing any one of them
would have changed nothing observable. That is what made it take two weeks.

**1. The domain serves a different repository.** `rail-drop3.vercel.app` is built
from the `rail-drop4` repo, which holds a single commit ("v1", 13 September) and
has not been pushed to since. Confirmed by that repo's commit list and by a
string in the live HTML that exists only there. No amount of pushing to
`RailDrop3` could change what that domain serves.

**2. The Vercel project that _is_ connected to `RailDrop3` rejects every push in
about two seconds.** `vercel.json` asked for `memory: 3008` on four functions.
With fluid compute — the default — the ceiling is **2 GB on Hobby**, 4 GB on
Pro, so the deployment was refused at config validation, before any build. A
deployment that never started has no build logs, which is exactly why this read
as "nothing is deploying" rather than "a build is failing". The only diagnosis is
on the commit itself:

```
GET /repos/<owner>/RailDrop3/commits/<sha>/status
  state:       failure
  context:     Vercel
  description: Deployment failed.
  target_url:  https://vercel.link/3c4   → /docs/limits#serverless-function-memory
  created_at:  two seconds after the push
```

3008 is the old pre-fluid-compute Lambda ceiling, which is why it looks like a
legitimate number — and why `rail-drop4`, on a Pro scope, accepts the identical
file. Now pinned to 2048 and guarded.

**3. `middleware.ts` and `proxy.ts` both existed for the same fortnight.** From
`ea3dd8e` (13 September) to `d3d9b66` (27 September) every commit carried both,
and Next 16 does not warn — `next/dist/build/index.js` throws:

> Both middleware file `./src/middleware.ts` and proxy file `./src/proxy.ts` are
> detected. Please use `./src/proxy.ts` only.

`next dev` only warns, so local work never revealed it. This one never got to
fail a real build, because fault 2 rejected the deployment first — but it would
have, the moment the memory was fixed.

The lesson is none of the three individually. It is that every reported symptom
throughout was "the app is broken", and the app was not broken: fifty-two commits
touching `src/` — including the one that returns a price with no database at all
— were verified green locally against code no visitor could reach.

| Scenario                                         | What happens now                                                                                                                                                              | Mitigation / status                                                                                                                                                                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`middleware.ts` and `proxy.ts` both present**  | `next build` throws before compiling. `next dev` only warns, so local work is unaffected and the break is invisible until a deploy.                                           | Guarded: `tests/unit/deployability.test.ts` fails in ~5 ms with the reason attached. `npm run verify` did already run `next build` and would have caught it — the failure was that a build takes minutes and got skipped.       |
| **Neither file present**                         | The build succeeds and every protected route becomes public, because `proxy.ts` is what gates `/dashboard`, `/settings`, `/usage` and `/watches`.                             | Guarded by the same test, which asserts exactly one of the two exists. This is the quieter half and the reason the check is not simply "does not have both".                                                                    |
| **`vercel.json` over the plan's memory ceiling** | Deployment refused ~2 s after the push, before the build, so no build logs exist and the dashboard shows nothing useful. The GitHub commit status carries the only diagnosis. | Guarded: `tests/unit/deployability.test.ts` fails if any function asks for more than 2048 MB or more than 300 s, and names the offending routes.                                                                                |
| **Verified locally, never deployed**             | A green `npm run verify` says nothing about what is serving traffic.                                                                                                          | **Open.** Nothing in the repo compares the deployed bundle to `HEAD`. Probing the live site for a route added after the last known-good deploy dates the running build in one request, and is how the fourteen days were found. |

## Provider

| Scenario                                  | What happens now                                                                                                                                                                                                           | Mitigation / status                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Wanderu DOM change**                    | The trip payload stops parsing, `fetchTrips` throws "Wanderu returned no trip data". `isRetryableWanderuError` returns false, so no retry, and the date is recorded `PROVIDER_ERROR`.                                      | Correct behaviour — it fails loudly rather than reporting an empty window. `scripts/verify-station-map.ts` probes the mapped stations so drift is visible before a traveler hits it. No synthetic canary yet (planned, Phase 4.6).                                                                                              |
| **Chromium cold start**                   | `@sparticuz/chromium` launches per cold invocation. The browser cache path is pinned by `pinBrowsersPath()`.                                                                                                               | Fixed: that function used to join `process.cwd()`, which on Vercel is the read-only `/var/task`, so `mkdirSync` threw on every cold start. It now uses `/tmp` on Vercel.                                                                                                                                                        |
| **Serialized page loads exceed the wall** | `MAX_CONCURRENT_PAGES` is 1 on serverless. A ±1 window is 3 dates, each up to 55 s navigation + 25 s first wait + 28 s trip wait + 5 s settle, with up to 2 attempts. Worst case is several times the 300 s `maxDuration`. | **Open.** The function is killed mid-flight and the cycle is never recorded. A hard per-cycle deadline that degrades to `PARTIAL_SUCCESS` is the fix; see `docs/AUDIT.md` §0.7.                                                                                                                                                 |
| **Parse 429 / 5xx**                       | `isTransientProviderFailure` retries 429 and ≥500 with exponential backoff, honouring `Retry-After` up to 90 s. 400/401/404/422 are never retried.                                                                         | Working as intended. Jitter is **bounded** (`min(250ms, delay/2)`), not full jitter — a thundering herd across watches is still possible.                                                                                                                                                                                       |
| **Parse key absent**                      | `createFareProvider` builds no secondary at all, yet `fareProviderStatus()` still reports `configured: true`.                                                                                                              | Misleading status string. The fallback chain also only engages on `PROVIDER_ERROR`, so it cannot rescue the station-map gap below.                                                                                                                                                                                              |
| **Station map miss**                      | 20 of 189 catalog stations have a verified Wanderu id. The rest fall back to matching Wanderu's city/state strings.                                                                                                        | Partly fixed. Mismatched city names (BUF is filed under "Depew") silently yield zero trips and read as `NO_INVENTORY`. Same-city pairs (RVR/RVM) can return **the wrong station's fare**, relabeled with the requested code. The picker now labels these "coverage unverified" so the traveler is told before the watch exists. |
| **Ambiguous station code**                | `SFA` and `OSC` are each held by two different stations in the catalog.                                                                                                                                                    | Fixed the dangerous half: one first-wins lookup is now shared by the UI and the provider, so they can no longer disagree. Deciding which station owns the code needs an authoritative Amtrak source; until then they are reported as ambiguous rather than guessed.                                                             |

## Scheduling

| Scenario                 | What happens now                                                                                                                                                                                                                      | Mitigation / status                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Cron double delivery** | `scheduled_check_runs (watch_id, local_check_date, check_slot)` is unique. A duplicate loses the insert and skips.                                                                                                                    | Working. Overlapping deploys and retries are safe.                                                                             |
| **DST slot skew**        | Slots are local wall time (08:00 / 14:00 / 20:00) resolved through `Intl` + IANA zones, never fixed UTC offsets. The hourly wake asks whether a slot has passed in the watch's timezone, so each slot is claimed once per local date. | Working. `extensionWindow()` is tested across the November transition.                                                         |
| **Missed wake**          | Any later hourly wake claims a slot whose row is still missing while the local date is unchanged.                                                                                                                                     | Catch-up is intentional; a skipped hour does not skip the check.                                                               |
| **Cron secret exposure** | Was accepted as `?secret=` in the query string, which lands in Vercel access logs, in referrers, and in browser history.                                                                                                              | Fixed: `Authorization: Bearer` only, compared in constant time, shared by the cron route and the credit-spending health probe. |

## Delivery

| Scenario                         | What happens now                                                                                                                                        | Mitigation / status                                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Resend bounce or API failure** | `ResendMailer` never throws: it returns `{status: "FAILED", errorMessage}` and the delivery row records it.                                             | Working. A failed send does not fail the cycle, and the alert is not silently marked delivered.                                                       |
| **Resend not configured**        | The same soft failure, with "RESEND_API_KEY or RESEND_FROM is not configured".                                                                          | Working, but invisible unless someone reads the deliveries table.                                                                                     |
| **Email CTA points nowhere**     | The link was built from `NEXT_PUBLIC_APP_URL`, which defaults to `http://localhost:3000` — and the setup docs have you set it _after_ the first deploy. | Fixed: `appOrigin()` resolves explicit config → `VERCEL_PROJECT_PRODUCTION_URL` → localhost, and a test forbids product-domain literals in `src/app`. |
| **Duplicate alert for one drop** | `OpportunityComparator` compares against the stored fingerprint; unchanged results are silent.                                                          | Working.                                                                                                                                              |

## Data & access

| Scenario                             | What happens now                                                                                                                                                                                                                                                                                                         | Mitigation / status                                                                                                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Supabase RLS denial**              | A cross-user read returns no rows rather than another traveler's watch.                                                                                                                                                                                                                                                  | Believed correct; **not yet proven by a test**. Phase 4.7 adds one that attempts a cross-user read and expects denial.                                                                                                                    |
| **Zero inventory vs provider error** | Distinguished end to end — see above.                                                                                                                                                                                                                                                                                    | The one exception is the station-map miss, which currently arrives as `NO_INVENTORY`. Labelled in the UI rather than hidden.                                                                                                              |
| **Price semantics unknown**          | A fare whose party total cannot be derived is excluded from ranking rather than guessed.                                                                                                                                                                                                                                 | Working. This is the rule the whole product rests on.                                                                                                                                                                                     |
| **Live probe abuse**                 | `/api/health/provider?probe=1` ran a real search for any anonymous caller, spending credits and 3 GB × 120 s of compute per hit.                                                                                                                                                                                         | Fixed: the probe requires the operator credential. The unauthenticated response is limited to configuration booleans.                                                                                                                     |
| **Database unreachable, on a page**  | Every API route was wrapped in `routeGuard`, but the pages were not, so `/dashboard`, `/watches/[id]`, `/settings` and `/unsubscribe` threw into `app/error.tsx`: "The board could not load ... this is usually a brief hitch." The board was fine, the host no longer resolved, and the retry offered could never work. | Fixed: `loadPageData` (`src/lib/pages/load-guard.ts`) degrades a transport failure to an honest state and rethrows everything else, so a bug is still loud. `/unsubscribe` gained a fourth outcome rather than claim a write that failed. |
| **Parse key rejected but stored**    | The local key endpoint wrote the key to `.env.local` before validating it, leaving a rejected key on disk.                                                                                                                                                                                                               | Fixed: validate first, persist second, and report a write failure as a warning rather than a 500.                                                                                                                                         |
