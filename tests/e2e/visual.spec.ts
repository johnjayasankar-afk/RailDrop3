import { expect, test } from "@playwright/test";

test("visual scan at key widths", async ({ page }) => {
  await page.request.post("/api/test/session", { data: { email: "qa@raildrop.test" } });
  await page.goto("/watches/new");
  await page.getByLabel("Desired travel date").fill("2026-09-20");
  await page.getByLabel("Actual total paid").fill("128");
  await page.getByRole("button", { name: "Start watching" }).click();
  await expect(page.getByText("Cheapest in your window")).toBeVisible({ timeout: 15_000 });

  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByText("Book on Amtrak").first()).toBeVisible();
    await expect(page.getByText("Copy trip details").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    expect(overflow, `horizontal overflow at ${width}`).toBe(false);
  }
});
