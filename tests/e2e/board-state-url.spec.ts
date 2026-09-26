import { expect, test } from "@playwright/test";
import { createWatch, signIn } from "./helpers";

/* The board state actually reaching the URL, and coming back out.
 *
 * The codec is unit-tested; what a unit test cannot show is that the effect
 * writes it, that a reload restores it, and that nothing about history makes
 * Back unusable. The FAQ used to say "filters stay on this visit only" and this
 * is the test that makes the new sentence true.
 */

async function openBoard(page: import("@playwright/test").Page) {
  await signIn(page);
  return createWatch(page);
}

const sort = (page: import("@playwright/test").Page) => page.getByLabel("Sort");

/** The decoded `b` parameter. Asserting on the raw URL would be asserting on
 *  percent-encoding, which is the browser's business and not the feature's. */
const boardParam = (page: import("@playwright/test").Page) =>
  new URL(page.url()).searchParams.get("b") ?? "";

test("a filtered board is a link, and the link restores it", async ({ page }) => {
  const path = await openBoard(page);

  // An untouched board has a clean URL: nothing to share yet, and localStorage
  // stays in charge of pins.
  await expect(page).toHaveURL(new RegExp(`${path}$`));

  await sort(page).selectOption("price");
  await expect.poll(() => boardParam(page), { timeout: 4_000 }).toBe("s:price");
  const shared = page.url();

  // The whole point: someone opening the link sees that board, not a fresh one.
  await page.goto(shared);
  await expect(page.getByText("Cheapest in your window")).toBeVisible({ timeout: 20_000 });
  await expect(sort(page)).toHaveValue("price");
});

test("carries a time filter and a narrowed date through a reload", async ({ page }) => {
  await openBoard(page);
  await page.getByLabel("Leave after").fill("09:00");
  await sort(page).selectOption("duration");
  /* Polled, because the URL write is coalesced on a timer — holding J must not
     write a hundred history entries a second. Reading straight after the second
     change caught the state between the two writes. */
  await expect.poll(() => boardParam(page), { timeout: 4_000 }).toContain("ta:09:00");
  await expect.poll(() => boardParam(page), { timeout: 4_000 }).toContain("s:duration");

  await page.reload();
  await expect(page.getByText("Cheapest in your window")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel("Leave after")).toHaveValue("09:00");
  await expect(sort(page)).toHaveValue("duration");
});

test("clearing the view clears the link", async ({ page }) => {
  const path = await openBoard(page);
  await sort(page).selectOption("price");
  await expect(page).toHaveURL(/\?b=/, { timeout: 4_000 });

  await sort(page).selectOption("rank");
  // Back to default, so the parameter goes rather than lingering as `?b=`.
  await expect(page).toHaveURL(new RegExp(`${path}$`), { timeout: 4_000 });
});

test("Back leaves the page instead of walking through every filter", async ({ page }) => {
  const path = await openBoard(page);
  await page.goto("/dashboard");
  await page.goto(path);
  await expect(page.getByText("Cheapest in your window")).toBeVisible({ timeout: 25_000 });

  // Five view changes. With pushState this would be five history entries and
  // Back would be unusable.
  for (const value of ["price", "depart", "duration", "savings", "rank"]) {
    await sort(page).selectOption(value);
  }
  await page.waitForTimeout(400);

  await page.goBack();
  await expect(page).toHaveURL(/dashboard/);
});

test("an untrusted link cannot put the board somewhere it cannot leave", async ({ page }) => {
  const path = await openBoard(page);
  await page.goto(`${path}?b=s:__proto__,d:not-a-date,du:-5,f:maglev,g:qqq`);
  await expect(page.getByText("Cheapest in your window")).toBeVisible({ timeout: 20_000 });
  // Every field was rejected, so the board sits at its defaults.
  await expect(sort(page)).toHaveValue("rank");
  await expect(page.getByLabel("Leave after")).toHaveValue("");
});

test("says so when a shared link names a train the board no longer has", async ({ page }) => {
  const path = await openBoard(page);
  await page.goto(`${path}?b=p:gone-journey:gone-fare,s:price`);
  await expect(page.getByText(/not on the board any more/)).toBeVisible({ timeout: 20_000 });
  // And the rest of the link still applied.
  await expect(sort(page)).toHaveValue("price");
});
