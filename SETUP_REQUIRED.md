# Remaining human actions

These are the only steps this environment could not finish. No API keys or cloud logins were available here.

## 1. Parse fare data

1. Create an API key at [https://parse.bot](https://parse.bot) → Settings → API Keys. The value starts with `pmx_`.
2. Confirm marketplace API `amtrak-com-api` / scraper `f800c27d-0aaa-4ca0-864e-4dc69e20f764`.
3. Set the secret on Vercel and locally:

```bash
vercel env add PARSE_API_KEY production
```

Local:

```bash
# in .env.local
PARSE_API_KEY=pmx_your_key
```

Without this key, RailDrop will not invent Amtrak fares.

## 2. Supabase

1. Create a project at [https://supabase.com/dashboard](https://supabase.com/dashboard).
2. Authentication → Providers → Email: enable magic link / OTP.
3. Authentication → URL configuration: add `https://YOUR_DOMAIN/api/auth/callback` and `http://localhost:3000/api/auth/callback`.
4. SQL editor: run `supabase/migrations/20260902100000_init.sql`.
5. Copy Project URL, anon key, and service role key into Vercel / `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

6. Optional CLI, if you install and login later:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

## 3. Resend

1. Create an API key at [https://resend.com](https://resend.com).
2. Verify a sending domain, or use the onboarding sender Resend provides for testing.
3. Set:

```
RESEND_API_KEY=re_...
RESEND_FROM=RailDrop <alerts@YOUR_DOMAIN>
```

4. Send one test from the Resend dashboard or after deploy:

Subject: `RailDrop is ready`  
Body: `Your RailDrop fare alerts are working.`

## 4. Vercel deploy

1. Install and login: `npm i -g vercel && vercel login`
2. From this directory:

```bash
vercel link
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add PARSE_API_KEY production
vercel env add RESEND_API_KEY production
vercel env add RESEND_FROM production
vercel env add CRON_SECRET production
vercel env add NEXT_PUBLIC_APP_URL production
vercel env add PROVIDER_CREDITS_PER_SEARCH production
vercel env add PROVIDER_MONTHLY_CREDIT_BUDGET production
```

3. Generate the cron secret locally, then paste it when Vercel prompts:

```bash
openssl rand -hex 32
```

4. Set `NEXT_PUBLIC_APP_URL` to the Vercel URL, then:

```bash
vercel --prod
```

5. Confirm Vercel Cron has `/api/cron/dispatch` at `5 * * * *` (already in `vercel.json`). Vercel sends `Authorization: Bearer $CRON_SECRET`.

## 5. After keys exist

1. Open `/api/health` — `fareProviderConfigured` should be true.
2. Create a BOS → NYP watch for a future date.
3. Confirm the initial scan writes a cycle and does not show invented fares.
4. Click **Book on Amtrak**. Expect the official Amtrak site plus copied trip details unless Parse later returns a real itinerary URL.

## Email authentication (SPF, DKIM, DMARC)

Alert mail that is not authenticated lands in spam, and a fare alert in spam is
the same as no fare alert. Resend verifies the domain; these records make
receivers trust it.

Add at your DNS provider for the sending domain (`RESEND_FROM`):

| Type  | Host                | Value                                                            |
| ----- | ------------------- | ---------------------------------------------------------------- |
| TXT   | `send`              | `v=spf1 include:amazonses.com ~all`                              |
| CNAME | `resend._domainkey` | the value shown in Resend → Domains → DKIM                       |
| TXT   | `_dmarc`            | `v=DMARC1; p=none; rua=mailto:dmarc@yourdomain; adkim=r; aspf=r` |

Notes that matter:

- **Start DMARC at `p=none`.** It reports without rejecting. Read the aggregate
  reports for a couple of weeks, confirm SPF and DKIM pass, then move to
  `p=quarantine` and later `p=reject`. Going straight to `p=reject` with a
  misconfigured record silently destroys your own deliverability.
- **`RESEND_FROM` must be on the verified domain.** A friendly `From` on a
  domain you have not authenticated fails DMARC alignment even when SPF passes.
- Verify with `dig TXT send.yourdomain`, `dig CNAME resend._domainkey.yourdomain`
  and `dig TXT _dmarc.yourdomain`.

## Unsubscribe signing key

`UNSUBSCRIBE_SECRET` signs the per-watch unsubscribe token. It falls back to
`CRON_SECRET` if unset, which is fine for a single deployment. Generate a
dedicated one with `openssl rand -hex 32` if you would rather the two rotate
independently.

Rotating it invalidates unsubscribe links in already-delivered mail. The
`List-Unsubscribe` header in those messages will stop working, so rotate
deliberately, not routinely.
