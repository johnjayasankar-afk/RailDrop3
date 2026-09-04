# RailDrop — GitHub + Vercel package

This zip is the **exact RailDrop app** (Amtrak fare watch). It does **not** include RideLens / Uber / Lyft code.

## What’s inside

- Next.js 16 app: watches, live board, alerts, settings
- Local mode: Wanderu + Playwright (`npm run dev:local`)
- Production: Parse only (never set `RAILDROP_LOCAL` on Vercel)
- Vercel-safe `postinstall` (skips Chromium download)

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

1. Import the GitHub repo.
2. Framework: Next.js. Build: `next build` (default).
3. Install command is already set in `vercel.json` (skips Playwright browsers).
4. Add env vars from `GITHUB_AND_VERCEL.md` / `SETUP_REQUIRED.md`.
5. **Never** set `RAILDROP_LOCAL` or `E2E_TEST` on Vercel.
6. Run `supabase/migrations/*.sql` in Supabase.
7. Set Auth callback to `https://YOUR_DOMAIN/api/auth/callback`.

## Local (Wanderu live board)

```bash
cp .env.example .env.local   # fill values
npm install
npm run playwright:install   # once
npm run dev:local
```

Open http://127.0.0.1:3000
