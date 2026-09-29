/* Photograph every surface, both themes, both widths.
 *
 *   node scripts/shoot.mjs --out=/tmp/shots [--base=http://127.0.0.1:3212]
 *
 * Design work on this app kept being done against the three pages a signed-out
 * visitor can reach, because those are the three you get by opening the site.
 * The board — the surface the product exists for — is behind a session and a
 * watch, so it was reviewed least and is the most complicated thing here.
 *
 * Same seeding as scripts/audit-overlap.ts, and for the same reason: in dev
 * the first request to a route rebuilds its module graph and hands the
 * in-memory repository a fresh empty Map, so /watches/[id] is warmed BEFORE
 * the watch is created or the board photographs its own empty state.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const arg = (name) => {
  const hit = process.argv.find((v) => v.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const BASE = arg("base") ?? "http://127.0.0.1:3212";
const OUT = arg("out") ?? "shots";
const ONLY = arg("only");
const WIDTHS = (arg("widths") ?? "1440,390").split(",").map(Number);
const THEMES = (arg("themes") ?? "dark,light").split(",");

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext();
await context.addInitScript(() => {
  globalThis.__name ??= (fn) => fn;
});
const page = await context.newPage();

await page.goto(`${BASE}/api/auth/guest?next=/dashboard`, { waitUntil: "domcontentloaded" });
await page.goto(`${BASE}/watches/00000000-0000-0000-0000-000000000000`, {
  waitUntil: "domcontentloaded",
});
const created = await page.evaluate(async () => {
  const r = await fetch("/api/watches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      originCode: "BOS",
      destinationCode: "NYP",
      desiredTravelDate: "2026-10-09",
      dateFlexibilityDays: 1,
      currentBookedPriceCents: 12800,
    }),
  });
  const j = await r.json();
  return j.watch?.id ?? j.id ?? null;
});
if (!created) {
  console.error("Could not create a watch — the board would not be photographed.");
  process.exit(1);
}

const PAGES = [
  { name: "landing", path: "/", must: ".ticket" },
  { name: "fares", path: "/fares", must: ".lookup" },
  { name: "new-watch", path: "/watches/new", must: "form" },
  { name: "dashboard", path: "/dashboard", must: ".lookup-title" },
  { name: "board", path: `/watches/${created}`, must: ".trip-rail" },
  { name: "how-it-works", path: "/how-it-works", must: ".method-prose" },
  { name: "settings", path: "/settings", must: ".panel" },
  { name: "login", path: "/login", must: "form" },
].filter((p) => !ONLY || ONLY.split(",").includes(p.name));

const missed = [];
for (const theme of THEMES) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
    await page.emulateMedia({ colorScheme: theme });
    for (const { name, path, must } of PAGES) {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      // The dev overlay hit-tests above the page and photographs as a badge.
      await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
      await page.waitForTimeout(400);
      if (!(await page.locator(must).first().count())) missed.push(`${name} ${theme} ${width}`);
      const file = `${OUT}/${name}-${theme}-${width}.png`;
      await page.screenshot({ path: file, fullPage: width >= 700 });
      console.log(file);
    }
  }
}
await browser.close();
if (missed.length) {
  console.error(`\nRendered nothing: ${missed.join(", ")}`);
  process.exitCode = 1;
}
