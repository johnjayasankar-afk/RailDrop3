import { expect, test, type Page } from "@playwright/test";
import { createWatch, hideDevOverlay, signIn } from "./helpers";

/* Structural accessibility, checked on the rendered page.
 *
 * Not a substitute for using the thing with a screen reader, and it does not
 * pretend to be — it catches the mechanical failures that are invisible in
 * review and obvious to anyone who cannot use a mouse. Every rule here is one
 * that makes a page unusable rather than untidy: a control with no name is a
 * control a screen reader announces as "button", a skipped heading level breaks
 * the outline people navigate by, and a focus ring that was removed and not
 * replaced means a keyboard user cannot see where they are.
 *
 * Hand-rolled rather than axe-core, because axe is a runtime dependency for
 * something that is a page of DOM queries, and the brief asks before adding
 * one. The rules below are the subset of axe that has ever caught anything in
 * this codebase.
 */

const PAGES: Array<{ name: string; path: string }> = [
  { name: "landing", path: "/" },
  { name: "how it works", path: "/how-it-works" },
  { name: "new watch", path: "/watches/new" },
  { name: "dashboard", path: "/dashboard" },
];

/** Everything a screen reader would announce as nameless. */
async function namelessControls(page: Page) {
  return page.evaluate(() => {
    const offenders: string[] = [];
    const selector =
      "button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=link]";
    for (const el of Array.from(document.querySelectorAll(selector))) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (el.getAttribute("aria-hidden") === "true" || el.closest("[aria-hidden='true']")) continue;

      const labelled = el.getAttribute("aria-labelledby");
      const named =
        (el.getAttribute("aria-label") ?? "").trim() ||
        (labelled ? (document.getElementById(labelled)?.textContent ?? "").trim() : "") ||
        (el as HTMLElement).innerText.trim() ||
        (el.getAttribute("title") ?? "").trim() ||
        (el.getAttribute("placeholder") ?? "").trim() ||
        // A label element pointing at it, or wrapping it.
        (el.id
          ? (document.querySelector(`label[for="${el.id}"]`)?.textContent ?? "").trim()
          : "") ||
        (el.closest("label")?.textContent ?? "").trim() ||
        (el.querySelector("img[alt]")?.getAttribute("alt") ?? "").trim() ||
        (el.querySelector("svg title")?.textContent ?? "").trim();

      if (!named) {
        offenders.push(
          `<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 40)}">`,
        );
      }
    }
    return offenders;
  });
}

/** Heading levels that jump — h2 straight to h4 — which breaks the outline. */
async function skippedHeadings(page: Page) {
  return page.evaluate(() => {
    const levels = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
      .filter((h) => {
        const style = getComputedStyle(h);
        return style.display !== "none" && style.visibility !== "hidden";
      })
      .map((h) => ({
        level: Number(h.tagName[1]),
        text: h.textContent?.trim().slice(0, 40) ?? "",
      }));
    const jumps: string[] = [];
    let previous = 0;
    for (const heading of levels) {
      if (previous && heading.level > previous + 1) {
        jumps.push(`h${previous} → h${heading.level} at "${heading.text}"`);
      }
      previous = heading.level;
    }
    return jumps;
  });
}

test.describe("accessibility", () => {
  for (const { name, path } of PAGES) {
    test(`${name}: every control has a name`, async ({ page }) => {
      await signIn(page);
      await page.goto(path);
      await hideDevOverlay(page);
      const offenders = await namelessControls(page);
      expect(offenders, `nameless on ${path}:\n${offenders.join("\n")}`).toEqual([]);
    });

    test(`${name}: the heading outline does not skip a level`, async ({ page }) => {
      await signIn(page);
      await page.goto(path);
      const jumps = await skippedHeadings(page);
      expect(jumps, `on ${path}: ${jumps.join("; ")}`).toEqual([]);
    });

    test(`${name}: has one main landmark and exactly one h1`, async ({ page }) => {
      await signIn(page);
      await page.goto(path);
      const counts = await page.evaluate(() => ({
        main: document.querySelectorAll("main, [role=main]").length,
        h1: Array.from(document.querySelectorAll("h1")).filter(
          (h) => getComputedStyle(h).display !== "none",
        ).length,
      }));
      expect(counts.main, "main landmarks").toBe(1);
      expect(counts.h1, "h1 elements").toBe(1);
    });
  }

  test("the board: every control has a name", async ({ page }) => {
    // The densest page in the app by a wide margin, and the one where a
    // nameless icon button is most likely to slip in.
    await signIn(page);
    await createWatch(page);
    await hideDevOverlay(page);
    const offenders = await namelessControls(page);
    expect(offenders, `nameless on the board:\n${offenders.join("\n")}`).toEqual([]);
  });

  test("the board: the heading outline does not skip a level", async ({ page }) => {
    await signIn(page);
    await createWatch(page);
    const jumps = await skippedHeadings(page);
    expect(jumps, jumps.join("; ")).toEqual([]);
  });

  test("nothing steals the tab order with a positive tabindex", async ({ page }) => {
    /* A positive tabindex jumps its element to the front of the tab order for
       the whole document, which reorders every other control on the page
       relative to it. It is almost never what anyone meant. */
    await signIn(page);
    await createWatch(page);
    const positive = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[tabindex]"))
        .map((el) => Number(el.getAttribute("tabindex")))
        .filter((value) => value > 0),
    );
    expect(positive).toEqual([]);
  });

  test("keyboard focus is visible wherever it lands", async ({ page }) => {
    /* `outline: none` with nothing in its place is the single most common way
       to make a page unusable by keyboard while looking fine in review. */
    await signIn(page);
    await page.goto("/watches/new");
    await hideDevOverlay(page);

    const invisible: string[] = [];
    for (let step = 0; step < 25; step += 1) {
      await page.keyboard.press("Tab");
      const result = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        const hasOutline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
        const hasRing = style.boxShadow !== "none" && style.boxShadow !== "";
        const hasBorderChange = style.borderColor !== "";
        return {
          visible: hasOutline || hasRing || hasBorderChange,
          tag: `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}`,
        };
      });
      if (result && !result.visible) invisible.push(result.tag);
    }
    expect(invisible, `no visible focus on:\n${invisible.join("\n")}`).toEqual([]);
  });

  test("the skip link works and lands somewhere real", async ({ page }) => {
    // The first thing a keyboard user meets, and it is useless if its target
    // does not exist.
    await signIn(page);
    await page.goto("/watches/new");
    await page.keyboard.press("Tab");
    const skip = await page.evaluate(() => {
      const el = document.activeElement as HTMLAnchorElement | null;
      if (!el || el.tagName !== "A") return null;
      const href = el.getAttribute("href") ?? "";
      return {
        text: el.innerText.trim(),
        href,
        targetExists: href.startsWith("#") ? Boolean(document.querySelector(href)) : false,
      };
    });
    expect(skip, "the first tab stop should be a skip link").not.toBeNull();
    expect(skip!.text).toMatch(/skip/i);
    expect(skip!.targetExists, `${skip!.href} does not exist`).toBe(true);
  });

  test("the command palette is announced as a dialog and traps nothing", async ({ page }) => {
    await signIn(page);
    await createWatch(page);
    await hideDevOverlay(page);
    await page.keyboard.press("ControlOrMeta+k");

    const dialog = page.getByRole("dialog", { name: /board commands/i });
    await expect(dialog).toBeVisible();
    /* Scoped to the dialog: a <select> has an implicit combobox role, so an
       unscoped query matches the board's Sort control too. */
    const combo = dialog.getByRole("combobox");
    await expect(combo).toBeFocused();
    await expect(combo).toHaveAttribute("aria-controls", /palette-list/);
    await expect(combo).toHaveAttribute("aria-activedescendant", /palette-/);

    // Escape gets you out. A dialog you cannot leave by keyboard is a trap.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});
