# Deploying this build

Source at commit `4295d21`, 2026-09-27. `npm run verify` passes on it: 660 tests,
59 files, clean production build. No `node_modules`, no `.next`, no `.git`, and
no secrets — `.env.example` is names only.

## Deploy

```bash
npm ci                 # postinstall downloads Chromium for Playwright
npm run build          # optional: prove it locally first
npx vercel --prod      # or import the folder as a NEW Vercel project
```

## Two things that were silently blocking deploys — both already fixed here

**1. Function memory.** `vercel.json` used to ask for `memory: 3008`. With fluid
compute (the default) the ceiling is **2 GB on Hobby**, 4 GB on Pro, so every
deployment was refused ~2 seconds after the push, at config validation, before
any build. A deployment that never starts has no build logs, so the dashboard
shows nothing and it looks like nothing is deploying at all. It is now 2048,
which is the most Hobby will grant and well inside Pro.

If a deploy fails and you want the real reason, it is on the commit, not in the
dashboard:

```bash
curl -s "https://api.github.com/repos/<owner>/<repo>/commits/<sha>/status" \
  | grep -E '"(state|description|target_url)"'
```

`target_url` redirects to the exact docs anchor for the limit that was breached.

**2. `src/middleware.ts` must not exist.** Next 16 renamed it to `src/proxy.ts`
and **throws** if both are present — `next dev` only warns, so it is invisible
locally. This build has `src/proxy.ts` only. `tests/unit/deployability.test.ts`
now fails in milliseconds if either problem comes back.

## Environment variables

Copy `.env.example`. Nothing below is required for live fare search to work.

| Variable                                                                                 | Needed for                                                                    |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`                                                                    | absolute links in alert emails; falls back to the Vercel URL                  |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | saving watches, history, alerts                                               |
| `RESEND_API_KEY`, `RESEND_FROM`                                                          | sending alert email                                                           |
| `CRON_SECRET`                                                                            | the hourly cron and the credit-spending health probe (`openssl rand -hex 32`) |
| `PARSE_API_KEY`, `PARSE_SCRAPER_ID`                                                      | the _fallback_ provider only; Wanderu is primary and needs no key             |

## What works with no database at all

Live fare search: `/`, `/watches/new`, and `POST /api/fares`. Measured on
2026-09-27 against live inventory — BOS→NYP returned $50.00 in 7.7 s with the
database unreachable.

The previous Supabase project (`hsztdjmrifsgpspvrnbz.supabase.co`) returns
NXDOMAIN — it no longer exists. Until a new one is configured, the pages that
need stored records say so honestly and point at the live search, rather than
showing "The board could not load". Saving a watch will fail; searching will not.

## Sanity checks after deploying

```bash
curl -s https://<your-url>/api/health                      # expect ok:true
curl -s -o /dev/null -w '%{http_code}\n' https://<your-url>/api/fares   # expect 405 (GET not allowed) — 404 means an OLD build
```

`/api/fares`, `/how-it-works` and `/unsubscribe` exist only in recent builds, so
a 404 on those is the fastest way to tell you are looking at a stale deployment.
