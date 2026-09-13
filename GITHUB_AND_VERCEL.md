# GitHub + Vercel

This folder is the complete RailDrop app. You do not need `node_modules` or `.next`.

## 1. Create the GitHub repo

1. Go to [https://github.com/new](https://github.com/new).
2. Name it `raildrop`. Keep it private if you want.
3. Do **not** add a README, `.gitignore`, or license on GitHub.
4. Unzip this project if you received it as a zip, then in the unzipped folder:

```bash
cd raildrop
git init
git add .
git commit -m "Add RailDrop v1"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/raildrop.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username.

## 2. Deploy on Vercel

1. Go to [https://vercel.com/new](https://vercel.com/new).
2. Import the `raildrop` GitHub repo.
3. Framework: Next.js. Leave the build command as `next build`.
4. Add these environment variables before the first production deploy:

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | from Supabase project settings |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from Supabase project settings |
| `SUPABASE_SERVICE_ROLE_KEY` | from Supabase project settings |
| `PARSE_API_KEY` | from parse.bot, starts with `pmx_` |
| `RESEND_API_KEY` | from resend.com |
| `RESEND_FROM` | `RailDrop <alerts@YOUR_DOMAIN>` |
| `CRON_SECRET` | output of `openssl rand -hex 32` |
| `NEXT_PUBLIC_APP_URL` | your Vercel URL, e.g. `https://raildrop.vercel.app` |
| `PROVIDER_CREDITS_PER_SEARCH` | `2` |
| `PROVIDER_MONTHLY_CREDIT_BUDGET` | `1000` |
| `PARSE_SCRAPER_ID` | `f800c27d-0aaa-4ca0-864e-4dc69e20f764` |

Never set `RAILDROP_LOCAL` or `E2E_TEST` on Vercel.

`postinstall` skips Playwright Chromium on Vercel/CI (production uses Parse only). Do not remove that skip — downloading Chrome on the build machine will time out or blow the install.

5. Deploy.
6. After you have the production URL, update `NEXT_PUBLIC_APP_URL` to that URL and redeploy.
7. In Supabase Auth → URL configuration, add:

- `https://YOUR_VERCEL_DOMAIN/api/auth/callback`
- `http://localhost:3000/api/auth/callback`

8. In Supabase SQL editor, run `supabase/migrations/20260902100000_init.sql`.

Hourly cron is already in `vercel.json` (`/api/cron/dispatch` at minute 5). Vercel sends `Authorization: Bearer $CRON_SECRET`.

Exact account-creation steps: `SETUP_REQUIRED.md`.
