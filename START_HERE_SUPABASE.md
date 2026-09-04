# RailDrop setup — do this in order (first time)

You only need a browser. Check each box as you go. When you finish **Part A**, paste the 3 values back in chat and I’ll wire the rest I can from here.

---

## Part A — Supabase (sign-in / magic link)

### A1. Create account + project
1. Open **https://supabase.com/dashboard**
2. Sign up / log in (GitHub is fine).
3. Click **New project**.
4. Fill in:
   - **Name:** `raildrop` (anything is fine)
   - **Database password:** generate one and **save it in your password manager** (you rarely need it again)
   - **Region:** closest to you (e.g. East US)
5. Click **Create new project**. Wait until it says the project is ready (1–2 minutes).

### A2. Turn on email magic link
1. Left sidebar → **Authentication**
2. **Sign In / Providers** (or **Providers**)
3. Open **Email**
4. Make sure Email is **Enabled**
5. Prefer **Magic link** / OTP style sign-in (default is fine for RailDrop)
6. Save if there’s a Save button

### A3. Allow your live site + local to finish login
1. Still under **Authentication** → **URL Configuration**
2. **Site URL:** paste your live Vercel URL, e.g. `https://raildrop-xxx.vercel.app`  
   (no trailing slash)
3. **Redirect URLs** — add **both** of these (one per line / one Add each):
   - `https://YOUR_VERCEL_DOMAIN/api/auth/callback`
   - `http://localhost:3000/api/auth/callback`
4. Replace `YOUR_VERCEL_DOMAIN` with your real Vercel hostname.
5. Save.

### A4. Create the database tables
1. Unzip your RailDrop zip if needed.
2. Open this file on your computer:  
   `supabase/migrations/20260902100000_init.sql`
3. Select **all** text → Copy.
4. In Supabase: left sidebar → **SQL Editor** → **New query**
5. Paste → click **Run**
6. You want a success / “Success. No rows returned” style message — not a red error.

### A5. Copy your 3 keys
1. Left sidebar → **Project Settings** (gear)
2. **API**
3. Copy these three (keep the service_role private):

| Paste this name later | Where it is in Supabase |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | **Project URL** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **anon** `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | **service_role** `secret` key |

**Stop here and paste those 3 values into the Cursor chat** (you can say “here are my Supabase keys”).  
I’ll confirm format and tell you exactly what to put in Vercel next.

---

## Part B — Vercel env vars (fixes “Supabase is not configured”)

1. Open **https://vercel.com** → your RailDrop project  
2. **Settings** → **Environment Variables**
3. Add these for **Production** (and Preview if you want):

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_APP_URL=https://YOUR_VERCEL_DOMAIN
```

4. Also add when you have them (fares + email alerts):

```
PARSE_API_KEY=pmx_...
PARSE_SCRAPER_ID=f800c27d-0aaa-4ca0-864e-4dc69e20f764
RESEND_API_KEY=re_...
RESEND_FROM=RailDrop <onboarding@resend.dev>
CRON_SECRET=   ← run: openssl rand -hex 32
PROVIDER_CREDITS_PER_SEARCH=2
PROVIDER_MONTHLY_CREDIT_BUDGET=1000
```

5. **Never** add `RAILDROP_LOCAL` or `NEXT_PUBLIC_RAILDROP_LOCAL` on Vercel.

6. **Deployments** → open latest → **⋯** → **Redeploy** → confirm.  
   Wait until it finishes, then try **Send magic link** again.

---

## Part C — Optional later (not required for sign-in)

- **Parse** (live Amtrak fares in production): https://parse.bot → API key `pmx_...`
- **Resend** (alert emails): https://resend.com → API key; for testing you can use Resend’s onboarding from-address

---

## About the “final zip with env variables”

**Secrets must not go inside the GitHub/Vercel zip.**  
If they do, anyone with the repo can steal your database.

What we do instead:
1. You paste keys in chat (or only into Vercel yourself).
2. I can write a local `.env.local` on your machine for local testing.
3. The downloadable zip stays **without** secrets (safe to push).
4. Production secrets live only in **Vercel → Environment Variables**.
