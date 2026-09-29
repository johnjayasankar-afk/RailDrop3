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
 * Contrast is checked, but only where it can be. A generic checker has to read
 * a computed backdrop, and this app paints with gradients, translucent layers
 * and color(srgb ...) values — the first version of that reported 114
 * failures and every one was the checker misreading a colour space, not a page
 * anybody could not read. A gate that cries wolf is a gate people learn to
 * skip, so it was deleted and contrast was verified by hand instead.
 *
 * Verifying by hand is what let `.readout-mark` ship at 4.16:1 against a 4.5
 * requirement, in mint, on the figure labelled "Difference". So the check is
 * back, scoped to a declared list of type primitives that sit on solid fills,
 * and an element whose backdrop it cannot resolve to an opaque colour is
 * reported as UNMEASURED rather than passed. Three buckets — measured, failing
 * and unmeasurable — because the failure mode of the first attempt was a
 * checker that could not tell the third from the first.
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

/** Declared at module scope so the report can say how many of these were
 *  actually reached; the browser side receives it as an argument. */
const TYPE_PRIMITIVES = [
  ".readout-mark",
  ".readout",
  ".micro",
  ".hud-label",
  ".hud-delta",
  ".hud-callname",
  ".verdict-qual",
  /* The date row. Unboxing the fare turned this card from a board
     surface into a paper one and left board ink on it, so in light mode
     its labels were white on white — and the sweep did not look, because
     the card was not on this list. */
  ".date-card .eyebrow",
  ".date-card > :first-child",
  ".ladder-end",
  ".unsaved-lead",
  ".unsaved-foot",
  /* Controls. The material layer left .btn-primary with a transparent
     background and white text on porcelain — 1.05:1, invisible — and
     this sweep did not look, because it only watched type. A button is
     the surface where a contrast failure costs the most. */
  ".btn",
  ".btn-primary",
  ".btn-ghost",
  ".chip",
  /* Widened before the redesign, on the principle that a gate you extend
     after you change the colours is a gate that ratifies whatever you
     did. These are the type primitives a reader actually reads: the
     headings, the lede, the prose, the FAQ, the figures on the board. */
  ".lookup-title",
  ".lookup-lede",
  ".kicker",
  ".eyebrow",
  ".spec-value",
  ".metric-value",
  ".board-note",
  ".faq summary",
  ".method-prose p",
  ".hud-value",
  ".hud-money",
  ".verdict > p",
  ".fh-stats dd",
  ".fh-call-reason",
  ".coverage-note",
  ".sample-head",
  ".board-head",
  ".filter-label",
  ".ticket .price",
  ".assistant-note",
  ".lookup-caveat",
  ".prov-note",
];
const TYPE_PRIMITIVE_COUNT = TYPE_PRIMITIVES.length;

/** Below this many square pixels an intersection is antialiasing, not a bug. */
const MIN_AREA = 12;

interface Finding {
  page: string;
  width: number;
  kind: "overlap" | "offscreen" | "unnamed" | "contrast" | "unmeasured" | "measured";
  area?: number;
  a: string;
  b?: string;
}

function arg(name: string): string | null {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function collect(page: Page): Promise<Omit<Finding, "page" | "width">[]> {
  return page.evaluate(
    ({ minArea, TYPE_PRIMITIVES }) => {
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
        /* Text removed from the accessibility tree is not text a reader is
         asked to read.
         
         The split-flap stacks four clipped copies of the same glyph — the new
         top half, the old bottom half, and the two leaves that rotate between
         them — so a departure board legitimately reports three overlaps per
         character cell, which is 60 findings on one page and an audit nobody
         looks at again. The mechanism sits inside aria-hidden with the real
         text beside it in an sr-only span, so nothing here is hidden from
         anyone; it is the same string, painted four times, to make an object
         look like it turns.
         
         This is a genuine loosening and it is worth naming: content wrongly
         marked aria-hidden now escapes the overlap check. That is a different
         bug — invisible-to-screen-readers content — and it wants a different
         check, not this one reporting it as a collision. The unnamed-control
         sweep below is untouched. */
        if (el.closest('[aria-hidden="true"]')) continue;
        const owns = Array.from(el.childNodes).some(
          (node) => node.nodeType === 3 && (node.textContent ?? "").trim().length > 1,
        );
        if (!owns) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        leaves.push({
          el,
          r,
          text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 44),
        });
      }

      const out: {
        kind: "overlap" | "offscreen" | "unnamed" | "contrast" | "unmeasured" | "measured";
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
        if (!control.checkVisibility?.({ visibilityProperty: true, opacityProperty: true }))
          continue;
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

      /* Contrast, for the type primitives only.
       *
       * Every selector here renders on a solid panel or board fill, so walking
       * up for the first opaque background is a correct reading rather than a
       * guess. `.readout-mark` is first on the list because it is the one that
       * shipped failing: stepped to 55% opacity so the digits would carry the
       * line, which at 9.2px in mint is 4.16:1 against a 4.5 requirement. */

      const channels = (value: string): number[] | null => {
        const parts = (value.match(/[\d.]+/g) ?? []).map(Number);
        if (parts.length < 3) return null;
        // color(srgb 0.039 ...) is 0-1; rgb() is 0-255. The first attempt at
        // this treated them the same and reported the header as unreadable.
        const scale = /^color\(/.test(value) ? 255 : 1;
        return [parts[0]! * scale, parts[1]! * scale, parts[2]! * scale, parts[3] ?? 1];
      };

      const relLum = (r: number, g: number, b: number): number => {
        const f = (v: number) => {
          const n = v / 255;
          return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };

      for (const selector of TYPE_PRIMITIVES) {
        for (const node of Array.from(document.querySelectorAll(selector))) {
          const el = node as HTMLElement & { checkVisibility?: (o?: unknown) => boolean };
          if (!el.checkVisibility?.({ visibilityProperty: true, opacityProperty: true })) continue;
          if (!(el.textContent ?? "").trim()) continue;

          const own = getComputedStyle(el);
          // The mark inherits its colour; read it from wherever it is painted.
          const painted =
            own.color === "rgba(0, 0, 0, 0)" && el.parentElement
              ? getComputedStyle(el.parentElement).color
              : own.color;
          const fg = channels(painted);

          let backdrop: number[] | null = null;
          let walker: HTMLElement | null = el;
          while (walker) {
            const candidate = channels(getComputedStyle(walker).backgroundColor);
            if (candidate && candidate[3]! > 0.95) {
              backdrop = candidate;
              break;
            }
            walker = walker.parentElement;
          }

          const label = `${selector} "${(el.textContent ?? "").trim().slice(0, 18)}"`;
          if (!fg || !backdrop) {
            out.push({ kind: "unmeasured", a: label });
            continue;
          }

          const alpha = Number(own.opacity) * (fg[3] ?? 1);
          const mix = (i: number) => fg[i]! * alpha + backdrop![i]! * (1 - alpha);
          const ratio =
            (Math.max(
              relLum(mix(0), mix(1), mix(2)),
              relLum(backdrop[0]!, backdrop[1]!, backdrop[2]!),
            ) +
              0.05) /
            (Math.min(
              relLum(mix(0), mix(1), mix(2)),
              relLum(backdrop[0]!, backdrop[1]!, backdrop[2]!),
            ) +
              0.05);

          const size = parseFloat(own.fontSize);
          const bold = Number(own.fontWeight) >= 700;
          const floor = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
          out.push({ kind: "measured", a: selector });
          if (ratio < floor) {
            out.push({
              kind: "contrast",
              a: `${label} — ${ratio.toFixed(2)}:1, needs ${floor} at ${size.toFixed(1)}px`,
            });
          }
        }
      }

      return out;
    },
    { minArea: MIN_AREA, TYPE_PRIMITIVES },
  );
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
  /* Compile /watches/[id] BEFORE the watch exists.
   *
   * In dev the first request to a route builds its module graph from scratch,
   * which hands the in-memory repository a brand new empty Map — so a watch
   * created seconds earlier is gone by the time the page renders it. The board
   * page is the LAST path in the sweep, so its first visit was always its
   * compile, and this audit spent every run reporting on "That page is not on
   * this timetable" while claiming to have checked the fare board. A clean
   * result from a page that was never loaded is worse than no audit. */
  await page.goto(`${BASE}/watches/00000000-0000-0000-0000-000000000000`, {
    waitUntil: "domcontentloaded",
  });
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

  /* Each page says what proves it rendered.
   *
   * The first version of this guard asked only "does <main> have more than a
   * hundred characters", which the 404 page passes with room to spare — it is
   * a designed page with a headline and two paragraphs. An audit that cannot
   * tell the fare board from "That page is not on this timetable" reports a
   * clean sweep of a page it never saw. The selector is the contract. */
  const paths: { path: string; must: string }[] = [
    { path: "/", must: ".ticket" },
    { path: "/fares", must: ".lookup" },
    { path: "/watches/new", must: "form" },
    { path: "/dashboard", must: ".lookup-title" },
    { path: "/how-it-works", must: ".method-prose" },
    { path: "/settings", must: ".panel" },
    { path: "/login", must: "form" },
    ...(created ? [{ path: `/watches/${created}`, must: ".trip-rail" }] : []),
  ];

  if (!created) {
    console.error("\n  Could not create a watch — the board page would not be audited.\n");
    process.exitCode = 1;
    await browser.close();
    return;
  }

  const findings: Finding[] = [];
  const missing: string[] = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const { path, must } of paths) {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      // Let fonts settle: a fallback face measures differently and invents overlaps.
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(350);
      const shown = await page.evaluate(
        (selector) => ({
          found: Boolean(document.querySelector(selector)),
          url: location.pathname,
        }),
        must,
      );
      if (!shown.found || shown.url !== path) {
        missing.push(
          `${String(width).padStart(4)}px ${path} → ${shown.url}  (no ${must})`.replace(/\s+$/, ""),
        );
      }
      for (const hit of await collect(page)) findings.push({ page: path, width, ...hit });
    }
  }
  await browser.close();

  const overlaps = findings
    .filter((f) => f.kind === "overlap")
    .sort((a, b) => (b.area ?? 0) - (a.area ?? 0));
  const offscreen = findings.filter((f) => f.kind === "offscreen");
  const unnamed = findings.filter((f) => f.kind === "unnamed");
  const lowContrast = [...new Set(findings.filter((f) => f.kind === "contrast").map((f) => f.a))];
  const unmeasured = [...new Set(findings.filter((f) => f.kind === "unmeasured").map((f) => f.a))];
  /* How many contrast readings actually happened.
   *
   * Without this the report is identical whether every ratio passed or the
   * selector list matched nothing at all, and a gate that cannot tell those
   * apart is the one thing this file's own header warns against. A selector
   * list is easy to break silently: rename a class in a redesign and its row
   * quietly stops being checked. */
  const measured = findings.filter((f) => f.kind === "measured");
  const coveredSelectors = new Set(measured.map((f) => f.a));

  console.log(`\nChecked ${paths.length} pages at ${WIDTHS.join(", ")}px.\n`);
  console.log(
    `  Contrast: ${measured.length} readings over ${coveredSelectors.size} of ` +
      `${TYPE_PRIMITIVE_COUNT} declared selectors.`,
  );
  if (measured.length === 0) {
    console.log("  NOTHING WAS MEASURED — the selector list matches no rendered element.");
    process.exitCode = 1;
  }
  const unreached = TYPE_PRIMITIVES.filter((selector) => !coveredSelectors.has(selector));
  if (unreached.length > 0) {
    /* Not a failure. A selector can legitimately go unreached because the
       state that renders it is not in the sweep — an error panel, a populated
       dashboard. But an unreached selector is also exactly what a rename
       leaves behind, and the two are indistinguishable unless the report
       names them. */
    console.log(`  Not reached in any sweep (${unreached.length}): ${unreached.join(", ")}`);
  }
  if (missing.length > 0) {
    console.log(
      `  NOT ACTUALLY CHECKED — these rendered nothing, or redirected (${missing.length}):`,
    );
    for (const line of missing) console.log(`  ${line}`);
    console.log("");
  }
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
  if (lowContrast.length > 0) {
    console.log(`\n  Below WCAG AA (${lowContrast.length}):`);
    for (const hit of lowContrast.slice(0, 12)) console.log(`  ${hit}`);
  }
  /* Printed, never silent. The first contrast gate in this repo could not
     tell "I read this and it is fine" from "I could not read this", which is
     how it produced 114 findings and got deleted. */
  if (unmeasured.length > 0) {
    console.log(`\n  Contrast not measurable — no opaque backdrop found (${unmeasured.length}):`);
    for (const hit of unmeasured.slice(0, 8)) console.log(`  ${hit}`);
  }
  console.log("");
  process.exitCode =
    overlaps.length + unnamed.length + missing.length + lowContrast.length > 0 ? 1 : 0;
}

void main();
