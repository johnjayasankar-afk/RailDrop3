/* Shared setup for the browser suite.
 *
 * The travel date used to be the literal string "2026-09-20" in four places.
 * It went past, and every spec that created a watch silently stopped rendering
 * a board — the window skips dates that have already gone, so there were no
 * options, no `best`, and the assertions failed on text that was never going
 * to appear. A date relative to today cannot rot that way.
 */

import { expect, type Page } from "@playwright/test";

/** A travel date far enough out that a ±3 window is entirely in the future. */
export function travelDateInDays(days = 14): string {
  const at = new Date();
  at.setDate(at.getDate() + days);
  return at.toISOString().slice(0, 10);
}

export async function signIn(page: Page, email = "qa@raildrop.test"): Promise<void> {
  await page.request.post("/api/test/session", { data: { email } });
}

/** Creates a BOS → NYP watch and waits for its board. Returns the board's path. */
export async function createWatch(
  page: Page,
  options: { originCode?: string; destinationCode?: string; paid?: string } = {},
): Promise<string> {
  await page.goto("/watches/new");
  await page.getByLabel("Origin station").fill(options.originCode ?? "BOS");
  await page.getByLabel("Destination station").fill(options.destinationCode ?? "NYP");
  await page.getByLabel("Desired travel date").fill(travelDateInDays());
  await page.getByLabel("Actual total paid").fill(options.paid ?? "128");
  await page.getByRole("button", { name: "Start watching" }).click();
  await expect(page.getByText("Cheapest in your window")).toBeVisible({ timeout: 25_000 });
  return new URL(page.url()).pathname;
}

/**
 * Reveals the dock's controls.
 *
 * Below 768px the dock is a 44px summary strip and its buttons are one tap
 * behind "Actions" — it used to be 519px tall and cover most of the screen.
 * Above that width the toggle is not rendered and this is a no-op.
 */
export async function openDock(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: /Actions|Less/ });
  if (await toggle.isVisible().catch(() => false)) {
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  }
}

/**
 * Hides the Next.js dev-overlay bubble.
 *
 * It renders into a <nextjs-portal> pinned to the bottom-left corner and
 * intercepts clicks on anything under it — at 390px that is the footer, where
 * the colour-scheme switch lives. A dev-server artifact, not a product one, so
 * the test removes it rather than the product moving around it.
 */
export async function hideDevOverlay(page: Page): Promise<void> {
  await page.addStyleTag({
    content: "nextjs-portal,[data-nextjs-dev-overlay]{display:none !important}",
  });
}
