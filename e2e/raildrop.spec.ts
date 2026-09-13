import { expect, test } from '@playwright/test';

import { addDays, createWatch, optionPrices, reset, signIn, todayUtc } from './helpers';

/** Mirrors formatShortDate, which is what the plan summary renders. */
function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/**
 * E2E against RailDrop only. The app runs its real pages, API routes, services,
 * SQL and RLS; only the fare provider is deterministic (so results are stable
 * and no external credits are spent) and the session is a test shim.
 */

test.beforeEach(async ({ request }) => {
  await reset(request);
});

test.describe('authentication', () => {
  test('protects the dashboard and signs a user in', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Sign in to RailDrop' })).toBeVisible();

    await page.getByTestId('e2e-signin').click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: 'Your trips' })).toBeVisible();
  });

  test('shows an honest empty state before any watch exists', async ({ page }) => {
    await signIn(page);
    await expect(page.getByText('Watch your first trip')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Watch a trip' }).first()).toBeVisible();
  });
});

test.describe('creating a watch', () => {
  test('defaults to +/-1 day and previews exactly three search dates', async ({ page }) => {
    await signIn(page);
    await page.goto('/watches/new');

    await expect(page.getByRole('radio', { name: /1 day/ })).toBeChecked();

    const date = addDays(todayUtc(), 21);
    await page.getByLabel('Travel date').fill(date);

    // The dates are stated once, in the live plan summary, rather than in a
    // hint line beside the flexibility radios.
    const summary = page.getByTestId('plan-summary');
    await expect(summary).toContainText('3 dates');
    await expect(summary).toContainText(shortDate(addDays(date, -1)));
    await expect(summary).toContainText(shortDate(date));
    await expect(summary).toContainText(shortDate(addDays(date, 1)));
  });

  test('searches one date when flexibility is exact', async ({ page }) => {
    await signIn(page);
    await page.goto('/watches/new');
    await page.getByRole('radio', { name: /Exact date/ }).check();

    const summary = page.getByTestId('plan-summary');
    await expect(summary).toContainText('Date');
    await expect(summary).toContainText('3 a day');
  });

  test('states the whole commitment before it is made', async ({ page }) => {
    await signIn(page);
    await page.goto('/watches/new');

    const summary = page.getByTestId('plan-summary');
    // Before an amount is entered it says so rather than inventing a threshold.
    await expect(summary).toContainText('once you enter what you paid');

    await page.getByLabel('Total you actually paid').fill('128.00');
    await expect(summary).toContainText('$128');
    await expect(summary).toContainText('at least $5');

    // The provider cost is stated up front: 3 dates x 3 checks a day.
    await expect(summary).toContainText('9 a day');

    // A round trip doubles it, and the summary says so.
    await page.getByRole('checkbox', { name: 'This is a round trip' }).check();
    await page.getByLabel('Return date').fill(addDays(todayUtc(), 25));
    await page.getByLabel('Paid for the return').fill('110.00');
    await expect(summary).toContainText('18 a day');
    await expect(summary).toContainText('both directions');
  });

  test('puts the summary before the button on a phone, not after it', async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/watches/new');
    await page.getByLabel('Total you actually paid').fill('128.00');

    // On a narrow screen the rail collapses into the flow. It has to land
    // between the fields and the button: a summary below the button is read
    // after the commitment, which is no summary at all.
    const positions = await page.evaluate(() => {
      const summary = document.querySelector('[data-testid="plan-summary"]');
      const button = document.querySelector('button.rd-btn-primary[type="submit"]');
      if (!summary || !button) return null;
      const top = (el: Element) => el.getBoundingClientRect().top + window.scrollY;
      return { summary: top(summary), button: top(button) };
    });
    expect(positions).not.toBeNull();
    expect(positions!.summary).toBeLessThan(positions!.button);
  });

  test('finds stations from the local catalog without a network round trip', async ({ page }) => {
    await signIn(page);
    await page.goto('/watches/new');

    await page.getByRole('combobox', { name: 'From' }).fill('Boston');
    const listbox = page.getByRole('listbox', { name: 'From station suggestions' });
    await expect(listbox).toBeVisible();
    await expect(listbox.getByRole('option').first()).toContainText('Boston');

    await listbox.getByRole('option').first().click();
    await expect(page.getByRole('combobox', { name: 'From' })).toHaveValue(/Boston/);
  });

  test('requires a route and an amount actually paid', async ({ page }) => {
    await signIn(page);
    await page.goto('/watches/new');
    await page.getByRole('button', { name: 'Start watching' }).click();

    await expect(page.getByText('Choose a departure station')).toBeVisible();
    await expect(page.getByText('Enter what you actually paid')).toBeVisible();
  });

  test('runs an immediate first check and lands on the trip', async ({ page }) => {
    await signIn(page);
    const watchId = await createWatch(page);

    await expect(page).toHaveURL(new RegExp(`/watches/${watchId}`));
    await expect(page.getByTestId('stat-paid')).toContainText('$250');
    // The INITIAL scan ran synchronously, so a result is already present.
    await expect(page.getByTestId('stat-best')).not.toContainText('—');
  });
});

test.describe('the watch detail', () => {
  test('shows a three-day fare strip and ranks options cheapest first', async ({ page }) => {
    await signIn(page);
    await createWatch(page);

    const strip = page.getByTestId('fare-strip-day');
    await expect(strip).toHaveCount(3);
    for (const status of await strip.evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-status')),
    )) {
      expect(['SUCCESS', 'NO_AVAILABILITY']).toContain(status);
    }

    const prices = await optionPrices(page);
    expect(prices.length).toBeGreaterThan(0);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);

    // Savings are computed against what the user actually paid.
    await expect(page.getByTestId('stat-savings')).not.toContainText('—');
    await expect(page.getByText(/Save \$/).first()).toBeVisible();
  });

  test('labels how far each option is from the desired date', async ({ page }) => {
    await signIn(page);
    await createWatch(page);
    const badges = page.locator('[data-testid="option-row"]').first();
    await expect(badges).toContainText(/Your date|day earlier|day later|days earlier|days later/);
  });

  test('never labels a Thruway bus as rail among the ranked options', async ({ page }) => {
    await signIn(page);
    await createWatch(page);
    // Bus services are excluded by default, so no ranked option may claim to be one.
    await expect(
      page.locator('[data-testid="option-row"]').getByText('Bus — not rail'),
    ).toHaveCount(0);
  });
});

test.describe('booking handoff', () => {
  test('shows the fallback transition panel with everything needed to book', async ({ page }) => {
    await signIn(page);
    await createWatch(page);

    await page
      .locator('[data-testid="option-row"]')
      .first()
      .getByRole('link', { name: 'Book on Amtrak' })
      .click();
    await expect(page).toHaveURL(/\/book\//);

    await expect(page.getByRole('heading', { name: /You.re booking/ })).toBeVisible();
    for (const label of ['Date', 'Service', 'Time', 'Fare', 'Passengers']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('Observed fare')).toBeVisible();

    // The disclosure must not over-claim; the link must be the official host.
    await expect(page.getByText(/does not hold or reserve inventory/)).toBeVisible();
    const cta = page.getByRole('link', { name: 'Continue to Amtrak' });
    await expect(cta).toHaveAttribute('href', 'https://www.amtrak.com/home');
    await expect(cta).toHaveAttribute('rel', /noopener/);
    await expect(cta).toHaveAttribute('target', '_blank');

    await expect(page.getByRole('button', { name: 'Copy trip details' })).toBeVisible();
  });
});

test.describe('rebooking', () => {
  test('records a new benchmark and keeps monitoring', async ({ page }) => {
    await signIn(page);
    await createWatch(page);

    await page.getByRole('button', { name: 'I rebooked' }).click();
    await page.getByLabel('New amount paid *').fill('74.00');
    await page.getByRole('button', { name: 'Save new benchmark' }).click();

    await expect(page.getByTestId('stat-paid')).toContainText('$74');
    // A fresh benchmark resets the comparison rather than rewriting history.
    await expect(page.getByRole('button', { name: 'I rebooked' })).toBeVisible();
  });
});

test.describe('managing a watch', () => {
  test('re-checks on demand and confirms in a toast', async ({ page }) => {
    await signIn(page);
    await createWatch(page);
    await page.getByRole('button', { name: 'Check now' }).click();

    await expect(page.getByTestId('toast')).toContainText(
      /Check complete|could not be reached|some dates/,
      { timeout: 40_000 },
    );
  });

  test('pauses and resumes', async ({ page }) => {
    await signIn(page);
    await createWatch(page);

    await page.getByRole('button', { name: 'Pause' }).click();
    // The badge is the durable state; the toast is transient confirmation.
    await expect(page.locator('.rd-badge').filter({ hasText: 'Paused' })).toBeVisible();

    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  });

  test('deletes with an undo affordance, and undo restores the trip', async ({ page }) => {
    await signIn(page);
    await createWatch(page);

    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByTestId('watch-card')).toHaveCount(0);

    // Deleting is a soft delete: the price history must be recoverable.
    const toast = page.getByTestId('toast').filter({ hasText: 'Trip deleted' });
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Undo' }).click();

    await expect(page.getByTestId('watch-card')).toHaveCount(1);
    await expect(page.getByTestId('watch-card').first()).toContainText('$250');
  });

  test('pins a trip and shows the marker on the dashboard', async ({ page }) => {
    await signIn(page);
    await createWatch(page);

    await page.getByRole('button', { name: 'Pin' }).click();
    await expect(page.getByRole('button', { name: 'Unpin' })).toBeVisible();

    await page.goto('/dashboard');
    await expect(page.getByTestId('watch-card').first().getByLabel('Pinned')).toBeVisible();
  });

  test('saves a private note', async ({ page }) => {
    await signIn(page);
    await createWatch(page);

    // A note is written once, so it lives behind the disclosure with the other
    // rarely-used controls rather than occupying the page permanently.
    await page.getByRole('button', { name: /More settings/ }).click();
    await page.getByRole('button', { name: 'Add a note' }).click();
    await page.getByLabel('Private note').fill('Confirmation ABC123');
    await page.getByRole('button', { name: 'Save note' }).click();

    await expect(page.getByText('Confirmation ABC123')).toBeVisible();
  });
});

test.describe('price history', () => {
  test('explains itself before there is enough data', async ({ page }) => {
    await signIn(page);
    await createWatch(page);
    // One completed check is not a trend, and the chart says so rather than
    // drawing a single meaningless point.
    await expect(page.getByText('Not enough history yet')).toBeVisible();
  });

  test('renders a chart once there are two checks', async ({ page }) => {
    await signIn(page);
    await createWatch(page);
    await page.getByRole('button', { name: 'Check now' }).click();
    await expect(page.getByTestId('toast')).toBeVisible({ timeout: 40_000 });

    await page.reload();
    await expect(page.getByRole('img', { name: /Price history over/ })).toBeVisible();
  });
});

test.describe('exports', () => {
  test('downloads price history as CSV', async ({ page }) => {
    await signIn(page);
    const watchId = await createWatch(page);

    const response = await page.request.get(`/watches/${watchId}/export?format=csv`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/csv');

    const body = await response.text();
    expect(body).toContain('checked_at');
    expect(body).toContain('best_total_usd');
  });

  test('produces a calendar event for the trip', async ({ page }) => {
    await signIn(page);
    const watchId = await createWatch(page);

    const response = await page.request.get(`/watches/${watchId}/export?format=ics`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/calendar');

    const body = await response.text();
    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body).toContain('BOS to NYP');
    expect(body).toContain('does not modify your reservation');
  });

  test('refuses an unknown format rather than guessing', async ({ page }) => {
    await signIn(page);
    const watchId = await createWatch(page);
    const response = await page.request.get(`/watches/${watchId}/export?format=exe`);
    expect(response.status()).toBe(400);
  });
});

test.describe('command palette', () => {
  test('opens with the keyboard and navigates', async ({ page }) => {
    await signIn(page);
    await createWatch(page);
    await page.goto('/dashboard');

    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByTestId('command-palette')).toBeVisible();

    await page.getByRole('combobox', { name: 'Search trips and commands' }).fill('settings');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/settings/);
  });

  test('finds a trip by its station codes', async ({ page }) => {
    await signIn(page);
    const watchId = await createWatch(page);
    await page.goto('/dashboard');

    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox', { name: 'Search trips and commands' }).fill('BOS');
    await expect(page.getByRole('option', { name: /BOS/ }).first()).toBeVisible();
    await page.keyboard.press('Enter');

    await page.waitForURL(new RegExp(`/watches/${watchId}`));
  });

  test('closes on Escape without navigating', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard');
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByTestId('command-palette')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('command-palette')).toHaveCount(0);
    await expect(page).toHaveURL(/\/dashboard/);
  });
});

test.describe('settings', () => {
  test('saves notification preferences', async ({ page, request }) => {
    // Preferences persist, so this spec has to start from a known state rather
    // than inheriting whatever the previous spec saved.
    await reset(request);
    await signIn(page);
    await page.goto('/settings');

    await page.getByRole('switch', { name: 'Hold alerts overnight' }).click();
    await expect(page.getByLabel('From')).toBeVisible();

    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByTestId('toast')).toContainText('Settings saved');

    await page.reload();
    await expect(page.getByRole('switch', { name: 'Hold alerts overnight' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('explains push honestly when it is not configured', async ({ page }) => {
    await signIn(page);
    await page.goto('/settings');
    // No VAPID keys in the E2E environment, so it must say so rather than
    // offering a switch that cannot work.
    await expect(
      page.getByText(/not configured on this deployment|Not supported on this browser/),
    ).toBeVisible();
  });
});

test.describe('alert history', () => {
  test('shows an honest empty state', async ({ page }) => {
    await signIn(page);
    await page.goto('/alerts');
    await expect(page.getByRole('heading', { name: 'Alert history' })).toBeVisible();
    await expect(page.getByText('No alerts yet')).toBeVisible();
  });
});

test.describe('the dashboard', () => {
  test('summarises a watch as paid, best now and savings', async ({ page }) => {
    await signIn(page);
    await createWatch(page);
    await page.goto('/dashboard');

    const card = page.getByTestId('watch-card').first();
    await expect(card).toContainText('BOS');
    await expect(card).toContainText('NYP');
    await expect(card).toContainText('$250');
    await expect(card).toContainText(/Save \$/);
    await expect(card).toContainText(/View \d+ cheaper option/);
  });
});

test.describe('partial provider failure', () => {
  test('discloses the date it could not check instead of reporting no drop', async ({
    page,
    request,
  }) => {
    const date = addDays(todayUtc(), 21);
    const failing = addDays(date, 1);
    await reset(request, { failDates: [failing] });

    await signIn(page);
    await createWatch(page, { date });

    await expect(page.getByText('Some dates could not be checked')).toBeVisible();
    await expect(page.getByTestId('fare-strip-day').filter({ hasText: 'Not checked' })).toHaveCount(
      1,
    );

    // The remaining dates still produce a usable, ranked result.
    const prices = await optionPrices(page);
    expect(prices.length).toBeGreaterThan(0);
  });

  test('says the check failed rather than claiming nothing got cheaper', async ({
    page,
    request,
  }) => {
    const date = addDays(todayUtc(), 21);
    await reset(request, { failDates: [addDays(date, -1), date, addDays(date, 1)] });

    await signIn(page);
    await createWatch(page, { date });

    await expect(page.getByText('The last check failed')).toBeVisible();
    await expect(page.getByText(/not a .no drop. result/)).toBeVisible();

    // The page must never contradict itself by also claiming a no-drop result.
    await expect(page.getByTestId('stat-best')).toContainText('Unknown');
    await expect(page.getByTestId('stat-best')).not.toContainText('No drop');
    await expect(page.getByText('Nothing cheaper right now')).toHaveCount(0);
    await expect(page.getByText('We could not check this trip')).toBeVisible();

    // ...and the dashboard card must agree.
    await page.goto('/dashboard');
    await expect(page.getByTestId('watch-card').first()).toContainText('Unknown');
    await expect(page.getByTestId('watch-card').first()).toContainText(
      'could not reach the fare provider',
    );
  });
});

test.describe('accessibility basics', () => {
  test('every form control is labelled and focus is visible', async ({ page }) => {
    await signIn(page);
    await page.goto('/watches/new');

    for (const name of ['From', 'To']) {
      await expect(page.getByRole('combobox', { name })).toBeVisible();
    }
    for (const label of ['Travel date', 'Passengers', 'Total you actually paid', 'Watch for']) {
      await expect(page.getByLabel(label)).toBeVisible();
    }

    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? getComputedStyle(el).outlineStyle : 'none';
    });
    expect(outline).not.toBe('none');
  });

  test('the page has one main landmark and a skip link', async ({ page }) => {
    await signIn(page);
    await expect(page.locator('main#main')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Skip to content' })).toHaveCount(1);
  });
});

test.describe('target price', () => {
  test('sets a target, shows the gap, and records it on the timeline', async ({
    page,
    request,
  }) => {
    await reset(request);
    await signIn(page);
    const watchId = await createWatch(page, { amount: '250.00' });

    await page.getByRole('button', { name: 'Set a target' }).click();
    await page.getByLabel('Tell me when it reaches').fill('60.00');
    await page.getByRole('button', { name: 'Save target' }).click();

    await expect(page.getByText('Alert me at')).toBeVisible();
    await expect(page.getByTestId('target-price')).toContainText('$60');

    // The action is durable, not just optimistic.
    await page.reload();
    await expect(page.getByText('Alert me at')).toBeVisible();
    await expect(page.getByTestId('timeline')).toContainText('Target price set');
  });

  test('refuses a target at or above what you paid', async ({ page, request }) => {
    await reset(request);
    await signIn(page);
    await createWatch(page, { amount: '250.00' });

    await page.getByRole('button', { name: 'Set a target' }).click();
    await page.getByLabel('Tell me when it reaches').fill('250.00');
    await page.getByRole('button', { name: 'Save target' }).click();

    // Otherwise it is met by the very first check and every check after it.
    await expect(page.getByTestId('target-price').getByRole('alert')).toContainText(
      'below the $250 you paid',
    );
  });

  test('marks the target as reached on the dashboard when the fare is under it', async ({
    page,
    request,
  }) => {
    await reset(request);
    await signIn(page);
    await createWatch(page, { amount: '250.00' });

    // The deterministic provider returns fares well under $250.
    await page.getByRole('button', { name: 'Set a target' }).click();
    await page.getByLabel('Tell me when it reaches').fill('200.00');
    await page.getByRole('button', { name: 'Save target' }).click();
    await expect(page.getByText('Reached')).toBeVisible();

    await page.goto('/dashboard');
    await expect(page.getByTestId('watch-card').first()).toContainText('Target reached');
  });

  test('removes a target again', async ({ page, request }) => {
    await reset(request);
    await signIn(page);
    await createWatch(page, { amount: '250.00' });

    await page.getByRole('button', { name: 'Set a target' }).click();
    await page.getByLabel('Tell me when it reaches').fill('60.00');
    await page.getByRole('button', { name: 'Save target' }).click();
    await expect(page.getByText('Alert me at')).toBeVisible();

    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('No target set')).toBeVisible();
  });
});

test.describe('monitoring window', () => {
  test('extends, and says so on the timeline', async ({ page, request }) => {
    await reset(request);
    await signIn(page);
    await createWatch(page);

    await page.getByTestId('extend-window').getByRole('button', { name: '1 more week' }).click();
    await expect(page.getByTestId('toast')).toContainText('Monitoring extended');

    await page.reload();
    await expect(page.getByTestId('timeline')).toContainText('Monitoring extended');
  });
});

test.describe('trip timeline', () => {
  test('records what happened, in order, including the checks', async ({ page, request }) => {
    await reset(request);
    await signIn(page);
    await createWatch(page);

    const timeline = page.getByTestId('timeline');
    await expect(timeline).toContainText('Trip added');
    await expect(timeline).toContainText('check');

    // A user action is recorded alongside the automated ones.
    await page.getByRole('button', { name: 'Pause' }).click();
    await page.reload();
    await expect(timeline).toContainText('Monitoring paused');
  });
});

test.describe('account data', () => {
  test('exports everything as JSON, with push keys redacted', async ({ page, request }) => {
    await reset(request);
    await signIn(page);
    await createWatch(page);

    const response = await page.request.get('/api/account/export');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');
    expect(response.headers()['content-disposition']).toContain('raildrop-export-');

    const body = (await response.json()) as Record<string, unknown>;
    expect(body['format']).toBe('raildrop.account-export.v1');
    expect(Array.isArray(body['watches'])).toBe(true);
    expect((body['watches'] as unknown[]).length).toBe(1);
    expect(Array.isArray(body['fare_check_cycles'])).toBe(true);
    expect(body['profile']).not.toBeNull();
  });

  test('refuses the export to a signed-out visitor', async ({ page }) => {
    await page.context().clearCookies();
    const response = await page.request.get('/api/account/export');
    expect(response.status()).toBe(401);
  });
});

test.describe('account deletion guard', () => {
  test('stays disabled until the confirmation word matches exactly', async ({ page }) => {
    await signIn(page);
    await page.goto('/settings');

    await page.getByRole('button', { name: 'Delete my account' }).click();
    const confirm = page.getByRole('button', { name: 'Delete permanently' });
    await expect(confirm).toBeDisabled();

    // Deleting an account has no undo, unlike deleting a single trip, so the
    // guard has to be the exact word — not merely "something was typed".
    await page.getByLabel('Type DELETE to confirm').fill('delete me');
    await expect(confirm).toBeDisabled();

    await page.getByLabel('Type DELETE to confirm').fill('DELETE');
    await expect(confirm).toBeEnabled();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toHaveCount(0);
  });
});

test.describe('realised savings', () => {
  test('separates what was offered from what a rebooking actually saved', async ({
    page,
    request,
  }) => {
    await reset(request);
    await signIn(page);
    const watchId = await createWatch(page, { amount: '250.00' });

    await page.goto('/alerts');
    // Nothing rebooked yet: found is not the same claim as saved.
    await expect(page.getByTestId('realised-savings')).toContainText('$0');

    await page.goto(`/watches/${watchId}`);
    await page.getByRole('button', { name: 'I rebooked' }).click();
    await page.getByLabel('New amount paid').fill('180.00');
    await page.getByRole('button', { name: 'Save new benchmark' }).click();
    await expect(page.getByTestId('stat-paid')).toContainText('$180');

    await page.goto('/alerts');
    await expect(page.getByTestId('realised-savings')).toContainText('$70');
  });
});

test.describe('round trips', () => {
  test('watches both legs and links them to each other', async ({ page, request }) => {
    await reset(request);
    await signIn(page);

    const date = addDays(todayUtc(), 21);
    const outbound = await createWatch(page, {
      origin: 'BOS',
      destination: 'NYP',
      date,
      amount: '250.00',
      returnDate: addDays(date, 4),
      returnAmount: '180.00',
    });

    // The outbound leg links to a real return, monitored in its own right.
    const leg = page.getByTestId('linked-leg');
    await expect(leg).toBeVisible();
    await expect(leg).toContainText('NYP');
    await expect(leg).toContainText('$180');

    await leg.click();
    await page.waitForURL(
      (url) => /\/watches\/[0-9a-f-]{36}$/.test(url.pathname) && !url.pathname.includes(outbound),
    );

    // Symmetric: the return links back, and each leg has its own benchmark.
    await expect(page.getByTestId('stat-paid')).toContainText('$180');
    await expect(page.getByTestId('linked-leg')).toContainText('BOS');

    // The dashboard shows the pair as one journey, not two unrelated cards.
    await page.goto('/dashboard');
    await expect(page.getByTestId('watch-card')).toHaveCount(1);
    await expect(page.getByTestId('watch-card').first()).toContainText('Round trip');
    await expect(page.getByTestId('round-trip-leg')).toHaveCount(2);
  });

  test('creates a one-way when the round-trip box is left alone', async ({ page, request }) => {
    await reset(request);
    await signIn(page);
    await createWatch(page);

    await expect(page.getByTestId('linked-leg')).toHaveCount(0);
    await page.goto('/dashboard');
    await expect(page.getByTestId('watch-card')).toHaveCount(1);
  });

  test('refuses a return that falls before the outbound', async ({ page, request }) => {
    await reset(request);
    await signIn(page);

    const date = addDays(todayUtc(), 21);
    await page.goto('/watches/new');
    await page.getByRole('combobox', { name: 'From' }).fill('BOS');
    await page
      .getByRole('listbox', { name: 'From station suggestions' })
      .getByRole('option')
      .first()
      .click();
    await page.getByRole('combobox', { name: 'To' }).fill('NYP');
    await page
      .getByRole('listbox', { name: 'To station suggestions' })
      .getByRole('option')
      .first()
      .click();
    await page.getByLabel('Travel date').fill(date);
    await page.getByLabel('Total you actually paid').fill('250.00');
    await page.getByRole('checkbox', { name: 'This is a round trip' }).check();
    await page.getByLabel('Return date').fill(addDays(date, -3));
    await page.getByLabel('Paid for the return').fill('180.00');
    await page.getByRole('button', { name: 'Start watching' }).click();

    // Either the browser's own date constraint blocks the submit or the server
    // refine rejects it — the property that matters is that no half-built round
    // trip is created either way.
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/\/watches\/new/);
    await page.goto('/dashboard');
    await expect(page.getByTestId('watch-card')).toHaveCount(0);
  });
});

test.describe('target price, end to end', () => {
  test('a target set at creation produces a TARGET_REACHED alert on the first check', async ({
    page,
    request,
  }) => {
    await reset(request);
    await signIn(page);

    // The deterministic provider returns fares around $70 for this route, so a
    // $100 target is reached by the very first check.
    await createWatch(page, { amount: '250.00', targetPrice: '100.00' });

    await expect(page.getByTestId('target-price')).toContainText('Reached');

    // The whole path: form → schema → column → dispatcher → comparator → alert.
    await page.goto('/alerts');
    await expect(page.getByText('Target reached').first()).toBeVisible();

    await page.goto('/dashboard');
    await expect(page.getByTestId('watch-card').first()).toContainText('Target reached');
  });
});

test.describe('alert sensitivity', () => {
  test('is settable per trip, not only as an account default', async ({ page, request }) => {
    await reset(request);
    await signIn(page);
    await createWatch(page);

    // Set once, so it lives behind the disclosure with the other rarely-used
    // controls rather than occupying the page permanently.
    await page.getByRole('button', { name: /More settings/ }).click();
    const panel = page.getByTestId('alert-sensitivity');
    await panel.getByRole('button', { name: '$30+' }).click();
    await expect(page.getByTestId('toast')).toContainText('Threshold saved');

    // A reload legitimately closes the disclosure again — it is not sticky
    // state, and the saved value is what has to survive, not the panel.
    await page.reload();
    await page.getByRole('button', { name: /More settings/ }).click();
    await expect(panel.getByRole('button', { name: '$30+' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // A custom amount outside the presets is remembered and shown back.
    await panel.getByLabel('Or set your own').fill('12.50');
    await panel.getByRole('button', { name: 'Save' }).click();
    await page.reload();
    await page.getByRole('button', { name: /More settings/ }).click();
    await expect(panel).toContainText('Currently $12.50');
  });

  test('refuses a threshold that would silence the trip entirely', async ({ page, request }) => {
    await reset(request);
    await signIn(page);
    await createWatch(page);

    // Set once, so it lives behind the disclosure with the other rarely-used
    // controls rather than occupying the page permanently.
    await page.getByRole('button', { name: /More settings/ }).click();
    const panel = page.getByTestId('alert-sensitivity');
    await panel.getByLabel('Or set your own').fill('5000');
    await panel.getByRole('button', { name: 'Save' }).click();
    await expect(panel.getByRole('alert')).toContainText('silence this trip');
  });
});

test.describe('health check', () => {
  test('reports every dependency, including whether the scheduler is still firing', async ({
    page,
  }) => {
    const response = await page.request.get('/api/health');
    const body = (await response.json()) as Record<string, unknown>;

    // A scheduler that silently stops firing is this app's most dangerous
    // failure: everything else reports healthy and no fare is checked again.
    expect(body).toHaveProperty('scheduler');
    const scheduler = body['scheduler'] as { stale: boolean; lastDispatchAt: string | null };
    expect(typeof scheduler.stale).toBe('boolean');

    // Never-dispatched is new, not broken — a fresh deploy must not read red.
    expect(scheduler.lastDispatchAt).toBeNull();
    expect(scheduler.stale).toBe(false);

    for (const key of [
      'provider',
      'database',
      'cronConfigured',
      'pushConfigured',
      'amountUnit',
      'pricingBasis',
    ]) {
      expect(body, `health is missing ${key}`).toHaveProperty(key);
    }
  });
});

test.describe('setup checklist', () => {
  test('guides a new account through the settings that matter, then goes away', async ({
    page,
    request,
  }) => {
    await reset(request);
    await signIn(page);
    await page.goto('/dashboard');

    const checklist = page.getByTestId('setup-checklist');
    await expect(checklist).toBeVisible();
    await expect(checklist).toContainText('Watch a trip you have already booked');
    // Push is unconfigured in this environment, so that step must not appear —
    // a step nobody can complete would keep the checklist on screen forever.
    await expect(checklist).not.toContainText('Turn on push notifications');

    const watchId = await createWatch(page);
    await page.goto('/dashboard');
    await expect(checklist).toContainText('1 of 2');

    // Completing the last step retires it without any dismissal.
    await page.goto(`/watches/${watchId}`);
    await page.getByRole('button', { name: 'Set a target' }).click();
    await page.getByLabel('Tell me when it reaches').fill('90.00');
    await page.getByRole('button', { name: 'Save target' }).click();
    await expect(page.getByTestId('target-price')).toContainText('Alert me at');

    await page.goto('/dashboard');
    await expect(checklist).toHaveCount(0);
  });

  test('stays dismissed across a reload', async ({ page, request }) => {
    await reset(request);
    await signIn(page);
    await page.goto('/dashboard');

    await page.getByTestId('setup-checklist').getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByTestId('setup-checklist')).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId('setup-checklist')).toHaveCount(0);
  });
});

test.describe('price position', () => {
  test('refuses a verdict on thin history rather than inventing one', async ({ page, request }) => {
    await reset(request);
    await signIn(page);
    await createWatch(page);

    // One completed check. A confident-sounding verdict here would be noise
    // dressed as judgement, which is the one thing this product will not do.
    const panel = page.getByTestId('price-position');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Not enough history');
    await expect(panel).toContainText('at least 5 completed checks');
  });

  test('never claims a direction the data cannot support', async ({ page, request }) => {
    await reset(request);
    await signIn(page);
    await createWatch(page);

    const text = ((await page.getByTestId('price-position').innerText()) ?? '').toLowerCase();
    for (const forbidden of ['will drop', 'expect', 'predict', 'likely', 'should wait']) {
      expect(text, `price position must not say "${forbidden}"`).not.toContain(forbidden);
    }
    // "forecast" appears exactly once, in the disclaimer that it is not one.
    expect(text).toContain('not a forecast');
    expect(text.split('forecast').length - 1, 'forecast should appear only in the disclaimer').toBe(
      1,
    );
  });
});

test.describe('stale demo session', () => {
  test('a session cookie from a rebuilt database self-heals instead of failing every write', async ({
    page,
    context,
    request,
  }) => {
    await reset(request);
    await signIn(page);

    // Exactly what a dev-server restart used to leave behind: a well-formed id
    // that no longer exists in auth.users. Creation then failed
    // watches_user_id_fkey with "Could not create the watch." on every trip,
    // and nothing in that message pointed at the session.
    await context.addCookies([
      {
        name: 'rd_e2e_user',
        value: '11111111-2222-4333-8444-555555555555',
        url: 'http://127.0.0.1:3100',
      },
    ]);

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);

    const watchId = await createWatch(page);
    expect(watchId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(page.getByTestId('stat-paid')).toContainText('$250');
  });
});

test.describe('round trip on the dashboard', () => {
  test('shows both legs as one journey with a combined saving', async ({ page, request }) => {
    await reset(request);
    await signIn(page);

    const date = addDays(todayUtc(), 21);
    await createWatch(page, {
      origin: 'BOS',
      destination: 'NYP',
      date,
      amount: '250.00',
      returnDate: addDays(date, 4),
      returnAmount: '180.00',
    });

    await page.goto('/dashboard');

    // One card, not two: the pairing existed in the database and nowhere a
    // person could see it before.
    await expect(page.getByTestId('watch-card')).toHaveCount(1);
    const card = page.getByTestId('watch-card').first();
    await expect(card).toHaveAttribute('data-round-trip', 'true');
    await expect(card.getByTestId('round-trip-leg')).toHaveCount(2);
    await expect(card).toContainText('Round trip');
    await expect(card).toContainText('Paid $430 in total');

    // Each leg still opens its own page.
    await card.getByTestId('round-trip-leg').nth(1).click();
    await page.waitForURL(/\/watches\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('stat-paid')).toContainText('$180');
  });

  test('falls back to a single card when only one leg matches a filter', async ({
    page,
    request,
  }) => {
    await reset(request);
    await signIn(page);
    const date = addDays(todayUtc(), 21);
    await createWatch(page, {
      origin: 'BOS',
      destination: 'NYP',
      date,
      amount: '250.00',
      returnDate: addDays(date, 4),
      returnAmount: '180.00',
    });
    await createWatch(page, { origin: 'WAS', destination: 'PHL', date, amount: '90.00' });

    await page.goto('/dashboard');
    await page.getByLabel('Filter trips').fill('NYP');

    // A leg whose partner was filtered out still renders rather than vanishing.
    await expect(page.getByTestId('watch-card')).toHaveCount(1);
    await expect(page.getByTestId('watch-card').first()).toContainText('NYP');
  });
});

test.describe('option filters', () => {
  test('narrows the fare list and says how much it narrowed it', async ({ page, request }) => {
    await reset(request);
    await signIn(page);
    await createWatch(page);

    const bar = page.getByTestId('option-filters');
    await expect(bar).toBeVisible();

    const before = await page.getByTestId('option-row').count();
    await bar.getByRole('button', { name: /^Direct only/ }).click();

    await expect(bar).toContainText(' of ');
    for (const row of await page.getByTestId('option-row').all()) {
      await expect(row).not.toContainText('transfer');
    }

    // The banner qualifies itself: cheapest *match*, not cheapest overall.
    await expect(page.getByTestId('option-row').first()).toContainText('Cheapest match');

    await bar.getByRole('button', { name: 'Clear' }).click();
    await expect(page.getByTestId('option-row')).toHaveCount(before);
    await expect(page.getByTestId('option-row').first()).toContainText('Cheapest option');
  });

  test('never strands the user: a control that would match nothing is disabled', async ({
    page,
    request,
  }) => {
    await reset(request);
    await signIn(page);
    await createWatch(page);

    const bar = page.getByTestId('option-filters');
    const select = bar.getByRole('combobox', { name: 'Departs' });

    // The guarantee, rather than a particular combination: every choice still
    // offered leads somewhere, and the ones that lead nowhere are visibly shut.
    for (const value of ['any', 'morning', 'afternoon', 'evening']) {
      const option = select.locator(`option[value="${value}"]`);
      const disabled = await option.isDisabled();
      const label = (await option.textContent()) ?? '';
      const count = Number(/\((\d+)\)/.exec(label)?.[1] ?? '0');

      expect(disabled, `"${label.trim()}" should be disabled only at zero`).toBe(count === 0);

      if (!disabled) {
        await select.selectOption(value);
        await expect(page.getByTestId('option-row').first()).toBeVisible();
      }
    }
  });
});

test.describe('alert history', () => {
  test('groups by day, filters, and reports what happened after each alert', async ({
    page,
    request,
  }) => {
    await reset(request);
    await signIn(page);
    const watchId = await createWatch(page, { amount: '250.00' });

    await page.goto('/alerts');
    const row = page.getByTestId('alert-row').first();
    await expect(row).toBeVisible();
    // Grouped under a day header rather than a flat reverse-chronological list.
    await expect(page.getByRole('heading', { name: /Today/ })).toBeVisible();
    // Nothing has been rebooked, so no outcome is claimed.
    await expect(page.getByTestId('alert-outcome')).toHaveCount(0);

    // Rebook, and the alert that preceded it gains an outcome.
    await page.goto(`/watches/${watchId}`);
    await page.getByRole('button', { name: 'I rebooked' }).click();
    await page.getByLabel('New amount paid').fill('180.00');
    await page.getByRole('button', { name: 'Save new benchmark' }).click();
    await expect(page.getByTestId('stat-paid')).toContainText('$180');

    await page.goto('/alerts');
    const outcome = page.getByTestId('alert-outcome').first();
    await expect(outcome).toContainText('Rebooked');
    await expect(outcome).toContainText('$70');

    // Sequence, never causation.
    const text = (await outcome.innerText()).toLowerCase();
    for (const causal of ['saved you', 'because', 'thanks to']) {
      expect(text, `outcome must not claim causation: "${causal}"`).not.toContain(causal);
    }
  });

  test('filters to alerts that were acted on', async ({ page, request }) => {
    await reset(request);
    await signIn(page);
    const watchId = await createWatch(page, { amount: '250.00' });
    await createWatch(page, { origin: 'WAS', destination: 'PHL', amount: '90.00' });
    await createWatch(page, { origin: 'NYP', destination: 'ALB', amount: '60.00' });

    await page.goto(`/watches/${watchId}`);
    await page.getByRole('button', { name: 'I rebooked' }).click();
    await page.getByLabel('New amount paid').fill('180.00');
    await page.getByRole('button', { name: 'Save new benchmark' }).click();
    await expect(page.getByTestId('stat-paid')).toContainText('$180');

    await page.goto('/alerts');
    const total = await page.getByTestId('alert-row').count();
    expect(total).toBeGreaterThan(1);

    const bar = page.getByTestId('alert-filters');
    await bar.getByRole('button', { name: /^Rebooked after/ }).click();

    // Exactly the alerts with an outcome, and fewer than the whole list.
    const acted = await page.getByTestId('alert-row').count();
    expect(acted).toBeGreaterThan(0);
    expect(acted).toBeLessThan(total);
    expect(await page.getByTestId('alert-outcome').count()).toBe(acted);

    await bar.getByRole('button', { name: /^All/ }).click();
    await expect(page.getByTestId('alert-row')).toHaveCount(total);
  });
});

test.describe('demo honesty', () => {
  test('says out loud that the fares are generated, on every surface', async ({
    page,
    context,
  }) => {
    await signIn(page);
    for (const path of ['/dashboard', '/alerts', '/settings']) {
      await page.goto(path);
      await expect(page.getByTestId('demo-banner')).toContainText('Demo data');
    }

    // And to a signed-out visitor, who has the least context of all.
    await context.clearCookies();
    await page.goto('/');
    await expect(page.getByTestId('demo-banner')).toBeVisible();
    // The footer states the deployment's real provider rather than asserting
    // a licensed API it may not have.
    await expect(page.locator('footer')).toContainText('deterministic demo provider');
    await expect(page.locator('footer')).not.toContainText('licensed API');
  });
});

test.describe('list keyboard navigation', () => {
  test('j and k walk the dashboard, and Enter opens what is focused', async ({ page, request }) => {
    await reset(request);
    await signIn(page);
    await createWatch(page, { origin: 'BOS', destination: 'NYP', amount: '250.00' });
    await createWatch(page, { origin: 'WAS', destination: 'PHL', amount: '90.00' });
    await page.goto('/dashboard');
    await page.locator('[data-list-keys="ready"]').waitFor();

    await page.keyboard.press('j');
    // Real DOM focus, so focus rings, Enter and screen readers all follow.
    const first = await page.evaluate(() => document.activeElement?.getAttribute('href'));
    expect(first).toMatch(/\/watches\/[0-9a-f-]{36}/);

    await page.keyboard.press('j');
    const second = await page.evaluate(() => document.activeElement?.getAttribute('href'));
    expect(second).not.toBe(first);

    await page.keyboard.press('k');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('href'))).toBe(first);

    await page.keyboard.press('Enter');
    await page.waitForURL(new RegExp(first!.replace(/[/]/g, '\\/')));
  });

  test('never hijacks a keystroke meant for a text field', async ({ page, request }) => {
    await reset(request);
    await signIn(page);
    await createWatch(page, { origin: 'BOS', destination: 'NYP', amount: '250.00' });
    await createWatch(page, { origin: 'WAS', destination: 'PHL', amount: '90.00' });
    // The filter row only appears past two trips.
    await createWatch(page, { origin: 'NYP', destination: 'ALB', amount: '60.00' });
    await page.goto('/dashboard');

    const filter = page.getByLabel('Filter trips');
    await filter.click();
    await filter.type('jak');
    await expect(filter).toHaveValue('jak');
    // Focus stayed in the field rather than jumping into the list.
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('INPUT');
  });

  test('walks the alert list too', async ({ page, request }) => {
    await reset(request);
    await signIn(page);
    await createWatch(page, { origin: 'BOS', destination: 'NYP', amount: '250.00' });
    await createWatch(page, { origin: 'WAS', destination: 'PHL', amount: '150.00' });
    await page.goto('/alerts');
    await page.locator('[data-list-keys="ready"]').waitFor();

    await page.keyboard.press('j');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('href'))).toMatch(
      /\/watches\//,
    );
  });
});

test.describe('fare trade-offs', () => {
  test('marks the fastest option and how far behind the others are', async ({ page, request }) => {
    await reset(request);
    await signIn(page);
    await createWatch(page);
    const rows = page.getByTestId('option-row');
    const collapsed = await rows.count();
    await page.getByRole('button', { name: /Show \d+ more option/ }).click();
    // Wait for the expansion: reading straight after the click sampled the
    // collapsed list, whose five rows need not contain the overall fastest.
    await expect.poll(() => rows.count()).toBeGreaterThan(collapsed);

    const texts = await rows.allInnerTexts();

    // Exactly one row carries the marker, and it is the shortest journey.
    const fastestRows = texts.filter((t) => /\bfastest\b/.test(t));
    expect(fastestRows).toHaveLength(1);

    const minutes = texts.map((t) => {
      const m = /(\d+)h (\d+)m/.exec(t);
      return m ? Number(m[1]) * 60 + Number(m[2]) : Number.POSITIVE_INFINITY;
    });
    const shortest = Math.min(...minutes);
    expect(minutes[texts.indexOf(fastestRows[0]!)]).toBe(shortest);

    // A slower row states the gap rather than leaving it to be worked out.
    expect(texts.some((t) => /\+\d+h \d+m|\+\d+m/.test(t))).toBe(true);
  });

  test('surfaces the cheapest escape from a slow cheapest fare', async ({ page, request }) => {
    await reset(request);
    await signIn(page);
    await createWatch(page);

    const callout = page.getByTestId('faster-alternative');
    // The deterministic provider makes the cheapest the slowest on this route.
    await expect(callout).toBeVisible();
    await expect(callout).toContainText('The cheapest option is the slowest');
    await expect(callout).toContainText(/\$\d/);
    await expect(callout).toContainText(/sooner/);

    // It describes what was measured; it never tells anyone what to do.
    const text = (await callout.innerText()).toLowerCase();
    for (const advice of ['you should', 'we recommend', 'best choice', 'instead of']) {
      expect(text, `callout must not give advice: "${advice}"`).not.toContain(advice);
    }
  });

  test('keeps the cheapest option first — the ranking does not change', async ({
    page,
    request,
  }) => {
    await reset(request);
    await signIn(page);
    await createWatch(page);

    const prices = await optionPrices(page);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    await expect(page.getByTestId('option-row').first()).toContainText('Cheapest option');
  });
});

test.describe('trip page hierarchy', () => {
  test('puts the rebook action above the settings, and collapses set-once controls', async ({
    page,
    request,
  }) => {
    await reset(request);
    await signIn(page);
    await createWatch(page);

    // Alert sensitivity and the private note live behind a disclosure.
    await expect(page.getByTestId('alert-sensitivity')).toHaveCount(0);
    await page.getByRole('button', { name: /More settings/ }).click();
    await expect(page.getByTestId('alert-sensitivity')).toBeVisible();

    // Recording a rebooking sits above the management block.
    const order = await page.evaluate(() => {
      const rebook = document.querySelector('[data-testid="rebook-form"]');
      const manage = document.querySelector('[data-testid="alert-sensitivity"]');
      if (!rebook || !manage) return null;
      const top = (el: Element) => el.getBoundingClientRect().top + window.scrollY;
      return { rebook: top(rebook), manage: top(manage) };
    });
    expect(order).not.toBeNull();
    expect(order!.rebook).toBeLessThan(order!.manage);
  });
});
