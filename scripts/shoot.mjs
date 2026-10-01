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

const PAGES = [
  { name: "landing", path: "/", must: ".hero-search" },
  { name: "fares", path: "/fares", must: ".lookup" },
  { name: "results", path: "/fares?from=BOS&to=NYP&flex=2", must: ".lookup", search: true },
  { name: "how-it-works", path: "/how-it-works", must: ".method-prose" },
].filter((p) => !ONLY || ONLY.split(",").includes(p.name));

const missed = [];
for (const theme of THEMES) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
    await page.emulateMedia({ colorScheme: theme });
    for (const { name, path, must, search } of PAGES) {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      if (search) {
        // The results only exist once somebody asks, and they are the
        // surface most worth photographing.
        await page.getByLabel("From").fill("BOS");
        await page.getByLabel("To", { exact: true }).fill("NYP");
        await page.keyboard.press("Escape");
        await page.locator("body").click({ position: { x: 2, y: 2 } });
        await page.getByRole("button", { name: "Check the fare" }).click();
        await page.waitForSelector(".lookup-results", { timeout: 120_000 }).catch(() => {});
        await page.fill("#paid", "128").catch(() => {});
        await page.waitForTimeout(400);
      }
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
