# RailDrop — GitHub + Vercel package

This zip is the **exact RailDrop app** (Amtrak fare watch). It does **not** include RideLens / Uber / Lyft code.

## What’s inside

- Next.js 16 app: watches, live board, alerts, settings, guest mode
- Live fares via **Wanderu** (local Playwright; Vercel uses `@sparticuz/chromium` + `puppeteer-core`)
- Optional Parse fallback if `PARSE_API_KEY` is set
- Vercel-safe `postinstall` (skips Playwright Chromium download)

## Push to GitHub

```bash
unzip raildrop-full.zip -d raildrop && cd raildrop
npm install
git init
git add .
git commit -m "Add RailDrop"
git branch -M main
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

## Deploy on Vercel

1. Import the GitHub repo (or redeploy after uploading this zip / pushing).
2. Framework: Next.js. Build: `next build` (default).
3. Install command is already set in `vercel.json` (skips Playwright browsers).
4. Functions use **3008 MB** and **300s** for fare checks (required for Chromium).
5. Add env vars from `GITHUB_AND_VERCEL.md` / `SETUP_REQUIRED.md`.
6. **Never** set `RAILDROP_LOCAL` or `E2E_TEST` on Vercel.
7. Do **not** set `FARE_PROVIDER=parse` unless you want Parse-only.
8. Run `supabase/migrations/*.sql` in Supabase (including guest profiles).
9. Set Auth callback to `https://YOUR_DOMAIN/api/auth/callback`.

### Prove live fares after deploy

```
https://YOUR_DOMAIN/api/health/provider
https://YOUR_DOMAIN/api/health/provider?probe=1
```

`probe=1` runs one real BOS→NYP search (can take up to ~60s). You want `"status":"SUCCESS"` and `journeys > 0`.

If Cloudflare blocks Vercel IPs, set a hosted browser endpoint:

```
BROWSER_WS_ENDPOINT=wss://chrome.browserless.io?token=YOUR_TOKEN
```

## Local (Wanderu live board)

```bash
cp .env.example .env.local   # fill values
npm install
npm run playwright:install   # once
npm run dev:local
```

Open http://127.0.0.1:3000
