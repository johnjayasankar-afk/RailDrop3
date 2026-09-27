import type { Page, APIRequestContext } from '@playwright/test';

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Wipes user data (and resets the provider to healthy). */
export async function reset(
  request: APIRequestContext,
  options: { failDates?: string[]; emptyDates?: string[] } = {},
): Promise<void> {
  await request.post('/api/e2e/reset', { data: options });
}

/** Reconfigures the deterministic provider WITHOUT wiping data. */
export async function configureProvider(
  request: APIRequestContext,
  options: { failDates?: string[]; emptyDates?: string[] } = {},
): Promise<void> {
  await request.post('/api/e2e/config', { data: options });
}

/** Idempotent: a session already established by an earlier step is reused. */
export async function signIn(page: Page): Promise<void> {
  await page.goto('/dashboard');
  if (/\/login/.test(page.url())) {
    await page.getByTestId('e2e-signin').click();
  }
  await page.waitForURL('**/dashboard');
}

export interface CreateWatchOptions {
  origin?: string;
  destination?: string;
  date?: string;
  amount?: string;
  /** Adds a linked return leg, watched independently against its own total. */
  returnDate?: string;
  returnAmount?: string;
  /** Sets a target price at creation, so the very first check can reach it. */
  targetPrice?: string;
}

/** Drives the real creation form, including the station combobox. */
export async function createWatch(page: Page, options: CreateWatchOptions = {}): Promise<string> {
  const date = options.date ?? addDays(todayUtc(), 21);

  await page.goto('/watches/new');

  await page.getByRole('combobox', { name: 'From' }).fill(options.origin ?? 'BOS');
  await page
    .getByRole('listbox', { name: 'From station suggestions' })
    .getByRole('option')
    .first()
    .click();

  await page.getByRole('combobox', { name: 'To' }).fill(options.destination ?? 'NYP');
  await page
    .getByRole('listbox', { name: 'To station suggestions' })
    .getByRole('option')
    .first()
    .click();

  await page.getByLabel('Travel date').fill(date);
  await page.getByLabel('Total you actually paid').fill(options.amount ?? '250.00');

  if (options.targetPrice) {
    await page.getByRole('button', { name: /fare .* service options/i }).click();
    await page.getByLabel('Target price').fill(options.targetPrice);
  }

  if (options.returnDate) {
    await page.getByRole('checkbox', { name: 'This is a round trip' }).check();
    await page.getByLabel('Return date').fill(options.returnDate);
    await page.getByLabel('Paid for the return').fill(options.returnAmount ?? '250.00');
  }

  await page.getByRole('button', { name: 'Start watching' }).click();
  await page.waitForURL(/\/watches\/[0-9a-f-]{36}$/, { timeout: 40_000 });

  const match = /\/watches\/([0-9a-f-]{36})/.exec(page.url());
  if (!match?.[1]) throw new Error(`Could not read a watch id from ${page.url()}`);
  return match[1];
}

/** Reads the ranked option prices as integers of cents. */
export async function optionPrices(page: Page): Promise<number[]> {
  const texts = await page.locator('[data-testid="option-price"]').allInnerTexts();
  return texts.map((t) => Math.round(Number(t.replace(/[^0-9.]/g, '')) * 100));
}
