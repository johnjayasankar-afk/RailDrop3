# SETUP_REQUIRED

Everything that can be built, tested and verified without external credentials **has been**.
What remains needs accounts and secrets that only you can create.

Each step lists the exact command to run once you have the key.

---

## Status of external integrations

| Integration                                | State                        | Why                                                                                                                                                                                                        |
| ------------------------------------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fare provider (Parse.bot `amtrak-com-api`) | **Not live-verified**        | No `PARSE_API_KEY` exists on this machine. The client, error taxonomy and normalizer are fully unit-tested against realistic payloads, but no real response has been observed.                             |
| Supabase (Postgres / Auth / Cron)          | **Not deployed**             | No Supabase project or CLI is available here. Migrations and RLS are verified against a real PostgreSQL 17 (embedded), so they are known-good SQL — they have simply not been applied to a hosted project. |
| Resend email                               | **Not live-verified**        | No `RESEND_API_KEY`. Rendering, escaping and the transport contract are unit-tested; no real message has been sent.                                                                                        |
| Vercel deployment                          | **Not deployed**             | No Vercel CLI or token is available here.                                                                                                                                                                  |
| Amtrak deep link                           | **Deliberately not enabled** | No official prefill contract exists. RailDrop ships the generic handoff, which is honest and unbreakable. See ADR-003.                                                                                     |

Nothing above is reported as working. See the final report for what _is_ verified.

---

## 1. Supabase (required)

1. Create a project at <https://supabase.com/dashboard>.
2. From **Project Settings → API**, copy the Project URL, the `anon` key and the `service_role` key.
3. From **Project Settings → Database**, copy the connection string (session pooler is fine).
4. Put them in `.env.local` (and later in Vercel):

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
   SUPABASE_SERVICE_ROLE_KEY=<service role key>
   SUPABASE_DB_URL=postgresql://postgres:<password>@<host>:5432/postgres
   ```

5. Apply the schema and seed the station catalog:

   ```bash
   npm run db:push
   ```

   (`supabase db push` works equally well if you install the CLI. `db:push` needs only
   `SUPABASE_DB_URL`, so no CLI is required.)

6. Confirm it:

   ```bash
   npm run db:verify
   ```

7. In **Authentication → URL Configuration**, add `http://localhost:3000/auth/callback` and
   `https://<your-domain>/auth/callback` to the redirect allow-list.

---

## 2. Fare provider (required)

1. Create an account at <https://parse.bot> and subscribe to the **Amtrak API** in the marketplace
   (`amtrak-com-api`). The free tier is 200 credits/month at 5 requests/minute; `search_trains`
   costs 2 credits per call.
2. Copy your API key (it starts with `pmx_`) into `.env.local`:

   ```
   PARSE_API_KEY=pmx_...
   ```

3. **Prove you are getting live fares** (~2 credits). This is the single most important
   command in this file:

   ```bash
   npm run verify:live -- BOS NYP 2026-10-15
   ```

   It prints every normalized journey and fare, runs plausibility checks that would catch a stale,
   synthetic or 100x-mis-scaled feed, and then tells you exactly what to compare on amtrak.com.
   It deliberately does not call an HTTP 200 a success — **until you have compared one fare against
   amtrak.com with your own eyes, treat the feed as unverified.**

   For a deeper schema fingerprint (~2 more credits):

   ```bash
   npm run probe:provider -- BOS NYP 2026-10-15
   ```

   This prints the field aliases the adapter matched, the first normalized journey, and writes
   `docs/provider-schema-fingerprint.json`. If it reports a `SCHEMA` error, the response shape has
   moved: add the new aliases to the `A` table in `src/lib/providers/parse/adapter.ts`.

   Sanity-check the printed fare amounts against amtrak.com. If they are 100× off, set
   `PROVIDER_AMOUNT_UNIT=cents`.

4. **Resolve party pricing** (~4 credits). This is required before RailDrop will alert on any
   multi-passenger trip:

   ```bash
   npm run verify:party-pricing -- BOS NYP 2026-10-15
   ```

   It prints a verdict and the exact line to set:

   ```
   PROVIDER_PRICING_BASIS=TOTAL_PARTY     # or PER_PASSENGER
   ```

   Until this is set, single-passenger watches work normally (both interpretations agree) and
   multi-passenger watches are displayed but never emailed about. That suppression is deliberate.

5. Align the budget with your plan:

   ```
   PROVIDER_CREDITS_PER_SEARCH=2
   PROVIDER_MONTHLY_CREDIT_BUDGET=5000
   ```

6. Optionally replace the bootstrap station catalog with the provider's own (~2 credits):

   ```bash
   npm run refresh:stations
   ```

---

## 3. Email (required for alerts)

1. Create an account at <https://resend.com>, verify a sending domain, and create an API key.
2. Set:

   ```
   RESEND_API_KEY=re_...
   RESEND_FROM=RailDrop <alerts@yourdomain.com>
   ```

3. Send one real message and confirm acceptance:

   ```bash
   npm run email:test -- you@example.com
   ```

---

## 4. Cron secret (already generated)

A cryptographically random 256-bit `CRON_SECRET` has been generated into `.env.local`
(git-ignored). Read it with:

```bash
grep CRON_SECRET .env.local
```

To rotate it:

```bash
npm run gen:cron-secret
```

---

## 5. Optional: push notifications

Fares move faster than inboxes. Push is the channel that catches a drop while it
still exists, and it is the reason the app is installable.

```bash
npm run gen:vapid
```

Paste the three lines it prints into `.env.local` and into your Vercel
environment variables:

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...   # the browser needs this to subscribe
VAPID_PRIVATE_KEY=...              # server only — never a NEXT_PUBLIC_ name
VAPID_SUBJECT=mailto:you@example.com
```

Then, in the app, open **Settings → Push notifications** and turn the switch on.
The browser prompts once; the endpoint it returns is stored in
`push_subscriptions` and is private to your account under RLS.

Leaving these unset is a supported configuration. Settings says push is
unavailable and explains why, alerts continue to go out by email, and nothing
fails silently.

Notes worth knowing:

- Push requires HTTPS (or `localhost`). It will not work over a plain-HTTP LAN
  address.
- iOS only delivers Web Push to apps added to the Home Screen. Safari →
  Share → _Add to Home Screen_, then enable the switch from inside that app.
- A revoked subscription (HTTP 404/410) deletes the row rather than retrying,
  so a wiped device stops costing you delivery attempts.

## 6. Deploy

```bash
npx vercel link
npx vercel env add NEXT_PUBLIC_SUPABASE_URL production
npx vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
npx vercel env add SUPABASE_SERVICE_ROLE_KEY production
npx vercel env add PARSE_API_KEY production
npx vercel env add PROVIDER_PRICING_BASIS production
# Omitting these three does not fail loudly — it silently stops all alerting:
#   PROVIDER_AMOUNT_UNIT wrong  -> every fare x100, nothing is ever below benchmark
#   budget vars unset           -> a 200-credit account runs against a 5000 default
npx vercel env add PROVIDER_AMOUNT_UNIT production
npx vercel env add PROVIDER_CREDITS_PER_SEARCH production
npx vercel env add PROVIDER_MONTHLY_CREDIT_BUDGET production
npx vercel env add RESEND_API_KEY production
npx vercel env add RESEND_FROM production
npx vercel env add CRON_SECRET production
npx vercel env add NEXT_PUBLIC_APP_URL production
npx vercel env add RAILDROP_ADMIN_EMAILS production
npx vercel --prod
```

Then point the scheduler at the deployment (run once in the Supabase SQL editor — this keeps the
secret out of every migration file):

```sql
alter database postgres set app.settings.raildrop_app_url    = 'https://your-app.vercel.app';
alter database postgres set app.settings.raildrop_cron_secret = '<CRON_SECRET>';
```

Verify the whole thing:

```bash
curl -s https://your-app.vercel.app/api/health | jq
npm run db:verify
```

`/api/health` must report:

- `"provider": { "live": true, "configured": true }` — if `live: false`, a simulated provider is
  configured and RailDrop would show fake fares. Fix before anyone uses it.
- `"amountUnit"` matching your provider. If this is wrong every fare is out by 100x and **no watch
  will ever alert**, while everything else looks green.
- `"cronConfigured": true` — otherwise no scheduled check can ever run, and health reports
  `degraded`.
- `"pricingBasis"` — `UNKNOWN` means multi-passenger watches are deliberately never alerted on.

---

## 7. Optional: Amtrak prefilled deep link

RailDrop ships with `AMTRAK_DEEPLINK_VERIFIED=false` and uses the generic, official Amtrak booking
handoff, with full trip details preserved in RailDrop and a **Copy trip details** action. No deep-link
format was invented.

If you obtain a documented or affiliate prefill URL, set `AMTRAK_DEEPLINK_TEMPLATE` using
`{origin}`, `{destination}` and `{date}` placeholders, then:

```bash
npm run verify:booking-links
```

Only set `AMTRAK_DEEPLINK_VERIFIED=true` after opening the resolved URL in a real browser and
confirming the fields are genuinely prefilled. A 200 response is not sufficient — amtrak.com renders
its search client-side.

---

## What you do **not** need to do

- write or apply any SQL by hand — `npm run db:push` does it
- configure RLS — it is in the migrations and verified by tests
- schedule anything manually — `0004_cron.sql` installs the hourly job, and `vercel.json`
  declares a redundant Vercel Cron
- seed stations — the bootstrap catalog (127 stations) is applied by `db:push`
