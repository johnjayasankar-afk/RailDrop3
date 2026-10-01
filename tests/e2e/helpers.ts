/* Shared setup for the browser suite.
 *
 * The travel date used to be the literal string "2026-09-20" in four places.
 * It went past, and every spec silently stopped rendering results — the
 * window skips dates that have already gone. A date relative to today cannot
 * rot that way.
 *
 * signIn() and createWatch() lived here until the watch feature was removed.
 * There are no accounts to sign in to and nothing to create: every surface
 * is public, so a spec just navigates.
 */

import { expect, type Page } from "@playwright/test";

/** A travel date far enough out that a ±1 window is entirely in the future. */
export function travelDateInDays(days = 14): string {
  const at = new Date();
  at.setDate(at.getDate() + days);
  return at.toISOString().slice(0, 10);
}

/**
 * Runs a real search on /fares and waits for the results.
 *
 * The densest surface in the app now, and the one every layout and
 * accessibility assertion wants to be looking at.
 */
export async function searchFares(
  page: Page,
  options: { originCode?: string; destinationCode?: string } = {},
): Promise<void> {
  await page.goto("/fares");
  await hideDevOverlay(page);
  await page.getByLabel("From").fill(options.originCode ?? "BOS");
  await page.getByLabel("To", { exact: true }).fill(options.destinationCode ?? "NYP");
  await page.getByLabel("Travel date").fill(travelDateInDays());
  /* Dismiss the station suggestions before reaching for the button.
     The picker opens a list under whichever field has focus, which reflows
     everything below it — so Playwright watches the submit button move,
     waits for it to be "stable", and times out while the list is still
     open. Escape closes it; the blur is what actually commits the value. */
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 2, y: 2 } });
  await page.getByRole("button", { name: "Check the fare" }).click();
  await expect(page.locator(".lookup-results")).toBeVisible({ timeout: 60_000 });
}

/**
 * Hides the Next.js dev-overlay bubble.
 *
 * It renders into a <nextjs-portal> pinned to the bottom-left corner and
 * intercepts clicks on anything under it — at 390px that is the footer,
 * where the colour-scheme switch lives. A dev-server artifact, not a product
 * one, so the test removes it rather than the product moving around it.
 */
export async function hideDevOverlay(page: Page): Promise<void> {
  await page.addStyleTag({
    content: "nextjs-portal,[data-nextjs-dev-overlay]{display:none !important}",
  });
}
