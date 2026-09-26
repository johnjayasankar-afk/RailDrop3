import { expect, test } from "@playwright/test";
import { openDock, signIn, travelDateInDays } from "./helpers";

test("creates a BOS-NYP watch and shows ranked window results", async ({ page }) => {
  await signIn(page);
  await page.goto("/watches/new");
  await page.getByLabel("Origin station").fill("BOS");
  await page.getByLabel("Destination station").fill("NYP");
  await page.getByLabel("Desired travel date").fill(travelDateInDays());
  await page.getByLabel("Actual total paid").fill("128");
  await page.getByRole("button", { name: "Start watching" }).click();
  await expect(page.getByText("Cheapest in your window")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/DAY EARLIER|SAME DAY|DAY LATER/).first()).toBeVisible();
  await expect(page.getByText("Book on Amtrak").first()).toBeVisible();
  await expect(page.getByText("Copy trip details").first()).toBeVisible();
  await expect(page.getByText("from $").first()).toBeVisible();
});

test("supports rebook, pause, and delete", async ({ page }) => {
  await signIn(page);
  await page.goto("/watches/new");
  await page.getByLabel("Desired travel date").fill(travelDateInDays());
  await page.getByLabel("Actual total paid").fill("128");
  await page.getByRole("button", { name: "Start watching" }).click();
  // Exact, because the hero also offers "Use this price in I rebooked" once the
  // board has a cheapest option — which it now does, since the travel date is
  // no longer a hardcoded day in the past.
  const rebookChip = page.getByRole("button", { name: "I rebooked", exact: true });
  await expect(rebookChip).toBeVisible({ timeout: 15_000 });
  // The panel is collapsed. The spec used to fill a field that was not in the
  // document yet and time out waiting for it.
  // Centred first: at 390px the page has a sticky bar at each edge, and a chip
  // that comes to rest against one of them is behind it. scroll-padding covers
  // the app's own scrolling; a synthetic click does its own.
  await rebookChip.scrollIntoViewIfNeeded();
  await rebookChip.evaluate((node) => node.scrollIntoView({ block: "center" }));
  await rebookChip.click();
  await page.getByPlaceholder("New actual total paid").fill("89");
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/rebook") && response.ok()),
    page.getByRole("button", { name: "Update benchmark" }).click(),
  ]);
  await page.reload();
  /* Not the price-history panel: that lives behind "More analysis" and is not
     in the document after a reload, so the old assertion waited on text that
     was never going to appear. The new benchmark shows on the trip rail at
     desktop width and in the dock's summary line on a phone — the figure is
     what matters, and it is present either way. */
  // visible=true, because the trip rail keeps a copy of this figure in the DOM
  // and hides it at phone width; .first() would resolve to that one.
  await expect(page.getByText("$89").locator("visible=true").first()).toBeVisible();
  await openDock(page);
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
  // Two steps by design: the first click arms it, the second means it. A single
  // click used to destroy a watch, so the spec's one click no longer suffices.
  // Delete moved out of the always-pinned dock and into Watch settings, with
  // the other things that change the watch itself.
  await page.getByRole("button", { name: "Watch settings" }).click();
  await page.getByRole("button", { name: "Delete this watch" }).click();
  await page.getByRole("button", { name: "Confirm deleting this watch" }).click();
  await expect(page).toHaveURL(/dashboard/);
});

test("dashboard and mobile layout", async ({ page }) => {
  await signIn(page);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Your watches" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Watch trip" }).first()).toBeVisible();
  await expect(page.getByText("Active watches")).toBeVisible();
});
