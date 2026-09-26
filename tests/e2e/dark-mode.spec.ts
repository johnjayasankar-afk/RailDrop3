import { expect, test } from "@playwright/test";
import { createWatch, hideDevOverlay, signIn } from "./helpers";

/* Night.
 *
 * This is a product people use at 11pm in a station deciding whether to move a
 * ticket, and a white page at that moment is a flashbulb. These assert the
 * things that are easy to get wrong and invisible until someone is standing on
 * a platform: that the page actually inverts, that a manual choice survives a
 * reload without a white flash first, and that no surface was left behind as a
 * porcelain rectangle on a near-black board.
 */

/** Relative luminance, for "is this actually dark". */
async function luminanceOf(page: import("@playwright/test").Page, selector: string) {
  return page.evaluate((sel) => {
    const node = document.querySelector(sel);
    if (!node) return null;
    let element: Element | null = node;
    while (element) {
      const bg = getComputedStyle(element).backgroundColor;
      const parts = bg.match(/[\d.]+/g)?.map(Number) ?? [];
      const opaque = parts.length >= 3 && (parts.length < 4 || parts[3]! > 0.5);
      if (opaque) {
        const [r, g, b] = parts.slice(0, 3).map((v) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
      }
      element = element.parentElement;
    }
    return null;
  }, selector);
}

test.describe("dark mode", () => {
  test("follows the system preference", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await signIn(page);
    await page.goto("/how-it-works");
    const luminance = await luminanceOf(page, "body");
    expect(luminance, "body should be near-black").toBeLessThan(0.05);

    await page.emulateMedia({ colorScheme: "light" });
    expect(await luminanceOf(page, "body")).toBeGreaterThan(0.8);
  });

  test("declares color-scheme so form controls and scrollbars follow", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/how-it-works");
    const scheme = await page.evaluate(
      () => getComputedStyle(document.documentElement).colorScheme,
    );
    expect(scheme).toContain("dark");
  });

  test("a manual choice overrides the system and survives a reload", async ({ page }) => {
    // The system says dark; the person says day. The person wins, and keeps
    // winning after a refresh.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/how-it-works");
    await hideDevOverlay(page);
    await page.getByRole("button", { name: "Day" }).click();
    expect(await luminanceOf(page, "body")).toBeGreaterThan(0.8);

    await page.reload();
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
    expect(await luminanceOf(page, "body")).toBeGreaterThan(0.8);
  });

  test("the choice is applied before first paint, not after", async ({ page }) => {
    /* The whole point of the blocking script in <head>. Applied from an effect
       instead, every navigation would start white and snap — which is the
       flashbulb this feature exists to avoid. */
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/how-it-works");
    await hideDevOverlay(page);
    await page.getByRole("button", { name: "Night" }).click();
    expect(await luminanceOf(page, "body")).toBeLessThan(0.05);

    /* domcontentloaded, not commit: commit fires when the response starts, before
       any script has run, so it proves nothing either way. At DOMContentLoaded
       the parser has reached the end of the document and React has not hydrated
       — if the attribute is set by then, it was set by the blocking script in
       <head> and not by an effect afterwards. */
    await page.goto("/how-it-works", { waitUntil: "domcontentloaded" });
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");

    // And it really is in the head, ahead of the body, which is what makes the
    // timing above true rather than lucky.
    const inHead = await page.evaluate(() =>
      Array.from(document.head.querySelectorAll("script")).some((s) =>
        s.textContent?.includes("raildrop.theme"),
      ),
    );
    expect(inHead, "the theme script must be in <head>").toBe(true);
  });

  test("returns to following the device when asked", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/how-it-works");
    await hideDevOverlay(page);
    await page.getByRole("button", { name: "Day" }).click();
    await page.getByRole("button", { name: "Auto" }).click();
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined();
    expect(await luminanceOf(page, "body")).toBeLessThan(0.05);
  });

  test("leaves no porcelain rectangles on the board", async ({ page }) => {
    /* The failure this catches: a surface with a hardcoded #ffffff that nobody
       tokenised. The header and the action dock were both exactly this — one a
       white bar across the top of a near-black page, one a white strip at the
       foot of it. */
    await page.emulateMedia({ colorScheme: "dark" });
    await signIn(page);
    await createWatch(page);

    const bright = await page.evaluate(() => {
      const offenders: string[] = [];
      /* Structural surfaces only. A bright button on a dark board is the point
         of a call to action — "Book on Amtrak" is mint and the timetable's
         primary is near-white, deliberately, in both schemes. What must never
         be bright is the thing underneath them. */
      const SURFACES = "div,section,header,footer,main,nav,aside,form,article,ul,ol,table";
      for (const element of Array.from(document.querySelectorAll(SURFACES))) {
        if (element.closest("a,button,[role='button'],label")) continue;
        const box = element.getBoundingClientRect();
        // Only things big enough to be a surface rather than a badge or a dot.
        if (box.width * box.height < 8000) continue;
        const bg = getComputedStyle(element).backgroundColor;
        const parts = bg.match(/[\d.]+/g)?.map(Number) ?? [];
        if (parts.length < 3) continue;
        if (parts.length >= 4 && parts[3]! < 0.5) continue;
        const [r, g, b] = parts;
        const luminance = 0.2126 * (r! / 255) + 0.7152 * (g! / 255) + 0.0722 * (b! / 255);
        if (luminance > 0.6) {
          offenders.push(
            `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 40)} = ${bg}`,
          );
        }
      }
      return offenders;
    });

    expect(bright, `light surfaces in dark mode:\n${bright.join("\n")}`).toEqual([]);
  });
});
