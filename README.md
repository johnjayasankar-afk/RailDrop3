# RailDrop

Know when your train gets cheaper.

Book the flexible fare. RailDrop watches the rest.

## Use it on this machine

```bash
npm install
npm run dev:local
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000)

1. Sign in with any email (local mode, no password).
2. Watch a trip, for example BOS → NYP.
3. Local mode pulls **live listed fares** via Wanderu (Playwright Chromium). First install runs `npm run playwright:install`.
4. Production uses Parse. Never invents Amtrak fares.

Do not set `RAILDROP_LOCAL` on Vercel.

## Upload to GitHub and deploy to Vercel

See **[GITHUB_AND_VERCEL.md](./GITHUB_AND_VERCEL.md)**.

Cloud keys (Supabase, Parse, Resend) are listed in **[SETUP_REQUIRED.md](./SETUP_REQUIRED.md)**.

## Docs

- `docs/PRODUCT_SPEC.md`
- `docs/ARCHITECTURE.md`
- `docs/TEST_PLAN.md`

```bash
npm run test
npm run test:e2e
npm run verify
```
