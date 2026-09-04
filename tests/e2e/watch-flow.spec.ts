import { expect, test } from "@playwright/test";

async function signIn(page: import("@playwright/test").Page) {
  await page.request.post("/api/test/session", {
    data: { email: "qa@raildrop.test" },
  });
}

test("creates a BOS-NYP watch and shows ranked window results", async ({ page }) => {
  await signIn(page);
  await page.goto("/watches/new");
  await page.getByLabel("Origin station").fill("BOS");
  await page.getByLabel("Destination station").fill("NYP");
  await page.getByLabel("Desired travel date").fill("2026-09-20");
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
  await page.getByLabel("Desired travel date").fill("2026-09-20");
  await page.getByLabel("Actual total paid").fill("128");
  await page.getByRole("button", { name: "Start watching" }).click();
  await expect(page.getByText("I rebooked")).toBeVisible({ timeout: 15_000 });
  await page.getByPlaceholder("New actual total paid").fill("89");
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/rebook") && response.ok()),
    page.getByRole("button", { name: "Update benchmark" }).click(),
  ]);
  await page.reload();
  await expect(page.getByText(/Current booked benchmark \$89/)).toBeVisible();
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/dashboard/);
});

test("dashboard and mobile layout", async ({ page }) => {
  await signIn(page);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Your watches" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Watch trip" }).first()).toBeVisible();
  await expect(page.getByText("Active watches")).toBeVisible();
});
