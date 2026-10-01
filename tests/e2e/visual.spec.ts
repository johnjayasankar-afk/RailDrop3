import { searchFares } from "./helpers";
import { expect, test } from "@playwright/test";

/* The results survive every width without the page growing sideways.
 *
 * Horizontal overflow is the layout bug a reader notices immediately and a
 * test suite never does: nothing throws, nothing fails to render, and the
 * whole page slides under their thumb. It has shipped here twice — once
 * from a dock wider than the viewport, once from a glow bleeding 10% past
 * each edge, where no ELEMENT overflowed because the culprit was a
 * pseudo-element and so nothing in the DOM pointed at it.
 */
test("results survive every width without overflowing", async ({ page }) => {
  await searchFares(page);

  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    // Let a reflow settle before measuring; a mid-transition read is noise.
    await page.waitForTimeout(250);

    // The answer is the one thing that must be on screen at every width.
    await expect(page.locator(".lookup-best").first()).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(2);
  }
});
