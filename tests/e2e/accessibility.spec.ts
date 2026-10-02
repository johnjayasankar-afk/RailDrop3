import { expect, test, type Page } from "@playwright/test";
import { hideDevOverlay, searchFares } from "./helpers";

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
  { name: "fares", path: "/fares" },
  { name: "how it works", path: "/how-it-works" },
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
      await page.goto(path);
      await hideDevOverlay(page);
      const offenders = await namelessControls(page);
      expect(offenders, `nameless on ${path}:\n${offenders.join("\n")}`).toEqual([]);
    });

    test(`${name}: the heading outline does not skip a level`, async ({ page }) => {
      await page.goto(path);
      const jumps = await skippedHeadings(page);
      expect(jumps, `on ${path}: ${jumps.join("; ")}`).toEqual([]);
    });

    test(`${name}: has one main landmark and exactly one h1`, async ({ page }) => {
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

  test("the results: every control has a name", async ({ page }) => {
    // The densest page in the app by a wide margin, and the one where a
    // nameless icon button is most likely to slip in.
    await searchFares(page);
    await hideDevOverlay(page);
    const offenders = await namelessControls(page);
    expect(offenders, `nameless on the results:\n${offenders.join("\n")}`).toEqual([]);
  });

  test("the results: the heading outline does not skip a level", async ({ page }) => {
    await searchFares(page);
    const jumps = await skippedHeadings(page);
    expect(jumps, jumps.join("; ")).toEqual([]);
  });

  test("nothing steals the tab order with a positive tabindex", async ({ page }) => {
    /* A positive tabindex jumps its element to the front of the tab order for
       the whole document, which reorders every other control on the page
       relative to it. It is almost never what anyone meant. */
    await searchFares(page);
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
    await page.goto("/fares");
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

  test("the date field can actually be typed into", async ({ page }) => {
    /* It could not. `onFocus={openCalendar}` opened the popover, which
       re-ran the focus-follows-cursor effect, which moved focus onto a day
       <button> within the same commit — so clicking or tabbing into the
       field took focus straight out of it. Digits went to the button, which
       swallows them, and Space picked the cursor date and closed the
       calendar. The Tab loop below walks straight past this asserting
       nothing but focus visibility, which is why it survived. */
    await page.goto("/fares");
    await hideDevOverlay(page);

    const input = page.locator(".datefield-input");
    await input.click();
    await expect(input, "focus left the field the moment it was clicked").toBeFocused();
    // And the calendar did not open itself on top of the reader.
    await expect(page.locator(".datefield-pop")).toHaveCount(0);

    await input.fill("");
    await input.pressSequentially("2026-12-18");
    await expect(input).toHaveValue("2026-12-18");
    await expect(input, "typing moved focus out of the field").toBeFocused();
    // Typing a date must not submit the search.
    await expect(page.locator(".lookup-results")).toHaveCount(0);
  });

  test("the calendar opens on demand and gives the field back", async ({ page }) => {
    await page.goto("/fares");
    await hideDevOverlay(page);

    await page.getByRole("button", { name: /open the calendar/i }).click();
    const grid = page.locator(".datefield-pop");
    await expect(grid).toHaveCount(1);
    // Opening from the button DOES hand focus to the grid, which is the one
    // case where the announcement is wanted.
    await expect(page.locator('.datefield-pop [data-cursor="true"]')).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(grid).toHaveCount(0);
    await expect(
      page.locator(".datefield-input"),
      "Escape dropped focus on the body instead of the field",
    ).toBeFocused();
  });

  test("the calendar says it takes the keyboard, in the default window", async ({ page }) => {
    /* The one line advertising the grid rendered only at ±0, and the product
       defaults to ±1 — invisible in the state almost everyone is in. */
    await page.goto("/fares");
    await page.getByRole("button", { name: /open the calendar/i }).click();
    await expect(page.locator(".datefield-hint")).toContainText(/arrow keys move/i);
  });

  test("the skip link works and lands somewhere real", async ({ page }) => {
    // The first thing a keyboard user meets, and it is useless if its target
    // does not exist.
    await page.goto("/fares");
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
});
