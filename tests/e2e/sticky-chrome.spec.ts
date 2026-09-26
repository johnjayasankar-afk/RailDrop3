import { expect, test } from "@playwright/test";
import { createWatch, openDock, signIn } from "./helpers";

/* How much of a phone screen is underneath something pinned.
 *
 * Measured, not eyeballed. At 390×844 on a scrolled board this was: header
 * 59px, sticky trip rail 120px, action dock 519px — 698 of 844, so 16% of the
 * screen was the only part not covered by a sticky layer, and a tap aimed at a
 * chip in that band landed on the dock instead. Two mobile specs failed on
 * "element intercepts pointer events" and that is what they were telling us.
 *
 * This test exists so the dock cannot quietly grow back. It asserts a budget,
 * not a pixel count, so adding a control is fine and adding a panel is not.
 */

test.describe("sticky chrome budget", () => {
  test("leaves most of the screen usable", async ({ page }) => {
    await signIn(page);
    await createWatch(page);
    // Scrolled, which is when sticky layers actually overlay content.
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(300);

    const measured = await page.evaluate(() => {
      const covered: Array<{ selector: string; top: number; bottom: number }> = [];
      for (const selector of [".site-header", ".trip-rail", ".action-dock"]) {
        const node = document.querySelector(selector);
        if (!node) continue;
        const position = getComputedStyle(node).position;
        if (position !== "sticky" && position !== "fixed") continue;
        const box = node.getBoundingClientRect();
        if (box.height === 0) continue;
        covered.push({ selector, top: box.top, bottom: box.bottom });
      }
      // Union, because the header and the trip rail overlap by a few pixels.
      const rows = covered
        .map((c) => [Math.max(0, c.top), Math.min(window.innerHeight, c.bottom)] as const)
        .filter(([top, bottom]) => bottom > top)
        .sort((a, b) => a[0] - b[0]);
      let union = 0;
      let edge = 0;
      for (const [top, bottom] of rows) {
        const from = Math.max(top, edge);
        if (bottom > from) union += bottom - from;
        edge = Math.max(edge, bottom);
      }
      return { viewport: window.innerHeight, union, covered };
    });

    const share = measured.union / measured.viewport;
    // The number is the point of the test, so it goes in the run output.
    console.log(
      `sticky chrome: ${Math.round(share * 100)}% of ${measured.viewport}px at ${page.viewportSize()?.width}px wide`,
    );
    /* Desktop is allowed a little more because the dock keeps its comparison
       panel there — it was 48% before the button row stopped wrapping and the
       destructive action moved out, and at 48% the verdict card's last line was
       being cut in half by the dock's top edge on arrival. */
    const budget = (page.viewportSize()?.width ?? 0) >= 768 ? 0.44 : 0.4;
    expect(share, JSON.stringify(measured.covered)).toBeLessThan(budget);
  });

  test("the dock is a strip until it is asked to be more", async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) >= 768, "the collapse toggle is phone-only");
    await signIn(page);
    await createWatch(page);
    const dock = page.locator(".action-dock");
    expect(await dock.evaluate((node) => node.getBoundingClientRect().height)).toBeLessThan(80);

    // And everything it holds is one tap away.
    await page.getByRole("button", { name: /Actions/ }).click();
    await expect(page.getByRole("button", { name: "Check now" })).toBeVisible();
    expect(await dock.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThan(80);
  });

  test("a chip in the middle of the board can actually be tapped", async ({ page }) => {
    // The regression this is really about: a real finger aiming at a real
    // control and hitting a pinned layer instead.
    await signIn(page);
    await createWatch(page);
    const chip = page.getByRole("button", { name: "I rebooked", exact: true });
    await chip.evaluate((node) => node.scrollIntoView({ block: "center" }));
    await chip.click({ timeout: 5_000 });
    await expect(page.getByPlaceholder("New actual total paid")).toBeVisible();
  });

  test("nothing pinned permanently hides a control", async ({ page }) => {
    /* The dock overlaps content while you scroll — that is what a bottom dock
       does. What it must never do is put a control somewhere no scroll position
       can reach, which is the difference between "in the way" and "broken".
       scroll-padding-bottom is what makes this true. */
    await signIn(page);
    await createWatch(page);
    // On a phone the dock's controls are one tap behind "Actions"; above 768px
    // this is a no-op. Being behind a toggle is not being hidden.
    await openDock(page);
    for (const name of ["Check now", "Pause", "Watch settings"]) {
      const control = page.getByRole("button", { name, exact: true }).first();
      await control.scrollIntoViewIfNeeded();
      const box = await control.boundingBox();
      expect(box, name).not.toBeNull();
      const onTop = await page.evaluate(
        ([x, y]) => {
          const hit = document.elementFromPoint(x as number, y as number);
          return hit ? (hit.textContent?.trim().slice(0, 30) ?? "") : null;
        },
        [box!.x + box!.width / 2, box!.y + box!.height / 2],
      );
      expect(onTop, `${name} is under something pinned`).toContain(name);
    }
  });
});
