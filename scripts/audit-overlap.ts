/* Find text that collides with other text, on every page, at every width.
 *
 *   npx tsx scripts/audit-overlap.ts                    # against the QA server
 *   npx tsx scripts/audit-overlap.ts --base=http://127.0.0.1:3212
 *
 * Overlapping text is the one layout bug that is obvious to a reader and
 * invisible to a test suite: nothing throws, nothing fails to render, the DOM
 * is correct, and the page is simply unreadable. The dock covering the date
 * cards by 50px — "from $96" clipped mid-digit — passed every check in this
 * repo for as long as it existed.
 *
 * Contrast is not checked here, deliberately. A generic checker has to read a
 * computed backdrop, and this app paints with gradients, translucent layers and
 * color(srgb ...) values — the first version reported 114 failures and every
 * one of them was the checker misreading a colour space, not a page anybody
 * could not read. A gate that cries wolf is a gate people learn to skip, so
 * contrast on new components is verified by hand against WCAG AA instead, and
 * this file only asserts what it can actually measure.
 *
 * What it reports and what it deliberately ignores. A pair counts only when
 * both elements own visible text, neither contains the other, and they are not
 * layered on purpose: an element inside a fixed or sticky container is expected
 * to pass over the page, and flagging it would bury the real findings. Text
 * that leaves the viewport horizontally is reported separately, because that is
 * the same bug wearing different clothes.
 */

import { chromium, type Page } from "playwright";

const BASE = arg("base") ?? "http://127.0.0.1:3212";
const WIDTHS = [375, 768, 1280];

/** Below this many square pixels an intersection is antialiasing, not a bug. */
const MIN_AREA = 12;

interface Finding {
  page: string;
  width: number;
  kind: "overlap" | "offscreen" | "unnamed";
  area?: number;
  a: string;
  b?: string;
}

function arg(name: string): string | null {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function collect(page: Page): Promise<Omit<Finding, "page" | "width">[]> {
  return page.evaluate((minArea) => {
    const layered = (el: Element): boolean => {
      let node: Element | null = el;
      while (node && node !== document.body) {
        const position = getComputedStyle(node).position;
        if (position === "fixed" || position === "sticky") return true;
        node = node.parentElement;
      }
      return false;
    };

    const leaves: { el: Element; r: DOMRect; text: string }[] = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      /* checkVisibility, not a hand-rolled display/visibility/opacity check.
       *
       * The hand-rolled version reported the whole FAQ as broken: a closed
       * <details> keeps a layout box for its contents so find-in-page can
       * reach them, so every collapsed answer still has a rect and every one
       * of them "overlapped" the question below it. Fifteen findings, none of
       * them real, which is how an audit gets ignored. checkVisibility knows
       * about closed details, content-visibility, opacity and visibility. */
      if (
        !(el as Element & { checkVisibility?: (o?: unknown) => boolean }).checkVisibility?.({
          contentVisibilityAuto: true,
          opacityProperty: true,
          visibilityProperty: true,
        })
      ) {
        continue;
      }
      const owns = Array.from(el.childNodes).some(
        (node) => node.nodeType === 3 && (node.textContent ?? "").trim().length > 1,
      );
      if (!owns) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      leaves.push({ el, r, text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 44) });
    }

    const out: {
      kind: "overlap" | "offscreen" | "unnamed";
      area?: number;
      a: string;
      b?: string;
    }[] = [];

    /* A control with no accessible name is announced as just "button". Cheap
       to check, and exactly the kind of thing that only ever regresses: an
       icon button ships without its label and nothing visible changes. */
    for (const node of Array.from(
      document.querySelectorAll("button, a, input, select, textarea"),
    )) {
      const control = node as HTMLElement & { checkVisibility?: (o?: unknown) => boolean };
      if (!control.checkVisibility?.({ visibilityProperty: true, opacityProperty: true })) continue;
      const labelled = control.id
        ? document.querySelector(`label[for="${CSS.escape(control.id)}"]`)?.textContent
        : null;
      const name = (
        control.getAttribute("aria-label") ??
        control.getAttribute("title") ??
        labelled ??
        control.closest("label")?.textContent ??
        control.textContent ??
        ""
      ).trim();
      if (!name)
        out.push({
          kind: "unnamed",
          a: `<${control.tagName.toLowerCase()} class="${control.className}">`,
        });
    }

    /* The pair comparison. Restored after an edit that removed the contrast
       block sliced this out with it — for two runs the audit reported "no
       colliding text" while checking none, which is precisely the gate that
       passes for the wrong reason. */
    for (let i = 0; i < leaves.length; i += 1) {
      const a = leaves[i]!;
      // Text running off the side is the same failure, differently dressed.
      if (a.r.left < -2 || a.r.right > document.documentElement.clientWidth + 2) {
        out.push({ kind: "offscreen", a: a.text });
      }
      for (let j = i + 1; j < leaves.length; j += 1) {
        const b = leaves[j]!;
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        // Deliberate layering is not a defect.
        if (layered(a.el) || layered(b.el)) continue;
        const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (ox > 1 && oy > 1 && ox * oy >= minArea) {
          out.push({ kind: "overlap", area: Math.round(ox * oy), a: a.text, b: b.text });
        }
      }
    }

    return out;
  }, MIN_AREA);
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext();
  /* esbuild (under tsx) compiles named functions with a __name helper and then
     serialises them into the page, where that helper does not exist — every
     evaluate throws "__name is not defined". Defining it as identity in the
     page costs nothing and keeps the browser-side code readable. */
  await context.addInitScript(() => {
    (globalThis as unknown as { __name?: (fn: unknown) => unknown }).__name ??= (fn) => fn;
  });
  const page = await context.newPage();

  // A guest session, so the authenticated pages render something.
  await page.goto(`${BASE}/api/auth/guest?next=/dashboard`, { waitUntil: "domcontentloaded" });
  const created = await page.evaluate(async () => {
    const response = await fetch("/api/watches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originCode: "BOS",
        destinationCode: "NYP",
        desiredTravelDate: "2026-10-09",
        dateFlexibilityDays: 1,
        currentBookedPriceCents: 12_800,
      }),
    });
    const json = (await response.json()) as { watch?: { id: string }; id?: string };
    return json.watch?.id ?? json.id ?? null;
  });

  const paths = [
    "/",
    "/fares",
    "/watches/new",
    "/dashboard",
    "/how-it-works",
    "/settings",
    "/login",
    ...(created ? [`/watches/${created}`] : []),
  ];

  const findings: Finding[] = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of paths) {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      // Let fonts settle: a fallback face measures differently and invents overlaps.
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(350);
      for (const hit of await collect(page)) findings.push({ page: path, width, ...hit });
    }
  }
  await browser.close();

  const overlaps = findings
    .filter((f) => f.kind === "overlap")
    .sort((a, b) => (b.area ?? 0) - (a.area ?? 0));
  const offscreen = findings.filter((f) => f.kind === "offscreen");
  const unnamed = findings.filter((f) => f.kind === "unnamed");

  console.log(`\nChecked ${paths.length} pages at ${WIDTHS.join(", ")}px.\n`);
  if (overlaps.length === 0) console.log("  No colliding text.");
  for (const hit of overlaps.slice(0, 25)) {
    console.log(
      `  ${String(hit.width).padStart(4)}px ${hit.page.padEnd(22)} ${String(hit.area).padStart(6)}px²  "${hit.a}"  ×  "${hit.b}"`,
    );
  }
  if (offscreen.length > 0) {
    console.log(`\n  Text outside the viewport (${offscreen.length}):`);
    for (const hit of [
      ...new Set(
        offscreen.map((h) => `${String(h.width).padStart(4)}px ${h.page.padEnd(22)} "${h.a}"`),
      ),
    ].slice(0, 15)) {
      console.log(`  ${hit}`);
    }
  }
  if (unnamed.length > 0) {
    console.log(`\n  Controls announced as just "button" (${unnamed.length}):`);
    for (const hit of [
      ...new Set(
        unnamed.map((h) => `${String(h.width).padStart(4)}px ${h.page.padEnd(20)} ${h.a}`),
      ),
    ].slice(0, 12)) {
      console.log(`  ${hit}`);
    }
  }
  console.log("");
  process.exitCode = overlaps.length + unnamed.length > 0 ? 1 : 0;
}

void main();
