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
