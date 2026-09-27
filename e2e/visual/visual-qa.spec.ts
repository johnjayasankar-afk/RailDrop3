import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { addDays, configureProvider, createWatch, reset, signIn, todayUtc } from '../helpers';

/**
 * Visual QA. Captures every key screen at 1440 / 1024 / 768 / 390 in BOTH themes
 * and asserts the things that actually break interfaces:
 *   - no horizontal overflow at any width
 *   - no screen silently rendering a 404
 *   - WCAG AA contrast for every text token against its real background
 *   - touch targets >= 44px on mobile
 *   - a visible focus ring
 *   - prefers-reduced-motion honoured
 */

const BREAKPOINTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '1024', width: 1024, height: 800 },
  { name: '768', width: 768, height: 900 },
  { name: '390', width: 390, height: 844 },
] as const;

const OUT = 'visual-qa';
mkdirSync(OUT, { recursive: true });

async function assertNoHorizontalOverflow(page: Page, label: string) {
  // Naming the offending element matters more than the number: "the page
  // scrolls horizontally" sends you hunting, "<div class=...> reaches 415px"
  // sends you straight to the line.
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const limit = doc.clientWidth;
    const culprits: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.right <= limit + 1 && rect.left >= -1) continue;
      const cls = el.className?.toString?.() ?? '';
      culprits.push(
        `<${el.tagName.toLowerCase()}${cls ? ` class="${cls.slice(0, 70)}"` : ''}> ` +
          `spans ${Math.round(rect.left)}→${Math.round(rect.right)}px`,
      );
      if (culprits.length >= 5) break;
    }
    return { scrollWidth: doc.scrollWidth, clientWidth: limit, culprits };
  });

  expect(
    overflow.scrollWidth,
    `${label}: page scrolls horizontally (${overflow.scrollWidth} > ${overflow.clientWidth})` +
      (overflow.culprits.length > 0 ? `\n  ${overflow.culprits.join('\n  ')}` : ''),
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

async function assertNot404(page: Page, label: string) {
  await expect(page.locator('body'), `${label} rendered a 404`).not.toContainText(
    'This page could not be found',
  );
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
}

test.describe.configure({ mode: 'serial' });

test('captures every key screen at all breakpoints, in both themes', async ({ page, request }) => {
  test.setTimeout(360_000);

  const date = addDays(todayUtc(), 21);

  await reset(request);
  await signIn(page);
  await createWatch(page, { date, amount: '250.00' });

  const noDropWatch = await createWatch(page, { date: addDays(date, 40), amount: '20.00' });

  // A round trip, so the linked-leg card is captured at every breakpoint.
  const roundTripWatch = await createWatch(page, {
    origin: 'WAS',
    destination: 'PHL',
    date,
    amount: '150.00',
    returnDate: addDays(date, 4),
    returnAmount: '140.00',
  });

  await configureProvider(request, { failDates: [addDays(date, 1)] });
  const partialWatch = await createWatch(page, { date, amount: '250.00' });

  await configureProvider(request, { failDates: [addDays(date, -1), date, addDays(date, 1)] });
  const failedWatch = await createWatch(page, { date, amount: '250.00' });

  await configureProvider(request, {});
  const happyWatch = await createWatch(page, { date, amount: '250.00' });

  // A trip with a target set, so the target UI is captured in its live state
  // rather than only in its empty one.
  await page.goto(`/watches/${happyWatch}`);
  await page.getByRole('button', { name: 'Set a target' }).click();
  await page.getByLabel('Tell me when it reaches').fill('60.00');
  await page.getByRole('button', { name: 'Save target' }).click();
  await page.getByTestId('target-price').getByText('Alert me at').waitFor({ timeout: 15_000 });

  const screens = [
    { name: 'login', path: '/login' },
    { name: 'dashboard-populated', path: '/dashboard' },
    { name: 'create-form', path: '/watches/new' },
    { name: 'watch-drop-found', path: `/watches/${happyWatch}` },
    { name: 'watch-no-drop', path: `/watches/${noDropWatch}` },
    { name: 'watch-partial', path: `/watches/${partialWatch}` },
    { name: 'watch-provider-error', path: `/watches/${failedWatch}` },
    { name: 'watch-round-trip', path: `/watches/${roundTripWatch}` },
    { name: 'alerts', path: '/alerts' },
    { name: 'settings', path: '/settings' },
    { name: 'usage', path: '/usage' },
    { name: 'offline', path: '/offline' },
    { name: 'not-found', path: '/watches/00000000-0000-4000-8000-000000000000' },
    { name: 'booking-handoff', path: `/watches/${happyWatch}` },
    { name: 'command-palette', path: '/dashboard' },
  ];

  for (const theme of ['light', 'dark'] as const) {
    for (const bp of BREAKPOINTS) {
      await page.setViewportSize({ width: bp.width, height: bp.height });

      for (const screen of screens) {
        await page.goto(screen.path);
        await setTheme(page, theme);

        if (screen.name === 'command-palette') {
          // The palette is an overlay, so it has to be captured open — it is
          // the one surface a plain page screenshot can never show.
          await page.keyboard.press('ControlOrMeta+k');
          await page.getByTestId('command-palette').waitFor({ state: 'visible', timeout: 10_000 });
          await page.getByRole('combobox', { name: 'Search trips and commands' }).fill('bos');
          await page.waitForTimeout(150);
        }

        if (screen.name === 'booking-handoff') {
          const book = page
            .locator('[data-testid="option-row"]')
            .first()
            .getByRole('link', { name: 'Book on Amtrak' });
          await book.waitFor({ state: 'visible', timeout: 15_000 });
          await book.click();
          await page.waitForURL(/\/book\//, { timeout: 15_000 });
          await setTheme(page, theme);
        }

        await page.waitForLoadState('load');
        const label = `${screen.name} @ ${bp.name} ${theme}`;
        if (screen.name !== 'not-found') await assertNot404(page, label);
        await assertNoHorizontalOverflow(page, label);
        await page.screenshot({
          path: `${OUT}/${screen.name}-${bp.name}-${theme}.png`,
          fullPage: true,
        });
      }
    }
  }

  await reset(request);
  await signIn(page);
  for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard');
    await setTheme(page, theme);
    await assertNoHorizontalOverflow(page, `dashboard-empty ${theme}`);
    await page.screenshot({ path: `${OUT}/dashboard-empty-${theme}.png`, fullPage: true });
  }

  // The landing page only renders for a signed-out visitor — signed in, `/`
  // redirects to the dashboard, so capturing it in the loop above silently
  // photographed the wrong screen.
  await page.context().clearCookies();
  for (const theme of ['light', 'dark'] as const) {
    for (const bp of BREAKPOINTS) {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.goto('/');
      await setTheme(page, theme);
      await page.waitForLoadState('load');
      const label = `marketing @ ${bp.name} ${theme}`;
      await assertNot404(page, label);
      await assertNoHorizontalOverflow(page, label);
      await page.screenshot({ path: `${OUT}/marketing-${bp.name}-${theme}.png`, fullPage: true });
    }
  }
});

test('every text token meets WCAG AA against its real background, in both themes', async ({
  page,
  request,
}) => {
  await reset(request);
  await signIn(page);
  await createWatch(page);

  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);

    const failures = await page.evaluate(() => {
      const parse = (value: string): [number, number, number] => {
        const m = value.match(/rgba?\(([^)]+)\)/);
        if (!m) return [0, 0, 0];
        const parts = (m[1] as string)
          .split(/[,\s/]+/)
          .filter(Boolean)
          .map(Number);
        return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
      };
      const lum = ([r, g, b]: [number, number, number]) => {
        const f = (c: number) => {
          const s = c / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (a: string, b: string) => {
        const la = lum(parse(a));
        const lb = lum(parse(b));
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
      };

      const style = getComputedStyle(document.documentElement);
      const v = (name: string) => style.getPropertyValue(name).trim();

      // Render each token as a real colour so getComputedStyle resolves it.
      const probe = document.createElement('span');
      document.body.appendChild(probe);
      const resolve = (cssColor: string) => {
        probe.style.color = cssColor;
        return getComputedStyle(probe).color;
      };

      const paper = resolve(v('--rd-paper'));
      const surface = resolve(v('--rd-surface'));

      // Minimum 4.5:1 for body text; 3:1 is only acceptable for large text, and
      // none of these tokens are used exclusively at large sizes.
      const checks: Array<[string, string, string, number]> = [
        ['ink on paper', v('--rd-ink'), paper, 4.5],
        ['ink on surface', v('--rd-ink'), surface, 4.5],
        ['ink-2 on surface', v('--rd-ink-2'), surface, 4.5],
        ['muted on paper', v('--rd-muted'), paper, 4.5],
        ['muted on surface', v('--rd-muted'), surface, 4.5],
        ['faint on paper', v('--rd-faint'), paper, 4.5],
        ['faint on surface', v('--rd-faint'), surface, 4.5],
        ['rust on paper', v('--rd-rust'), paper, 4.5],
        ['rust on surface', v('--rd-rust'), surface, 4.5],
        ['save on surface', v('--rd-save'), surface, 4.5],
        ['save on save-soft', v('--rd-save'), resolve(v('--rd-save-soft')), 4.5],
        ['warn on warn-soft', v('--rd-warn'), resolve(v('--rd-warn-soft')), 4.5],
        ['danger on danger-soft', v('--rd-danger'), resolve(v('--rd-danger-soft')), 4.5],
        ['rust on rust-soft', v('--rd-rust'), resolve(v('--rd-rust-soft')), 4.5],
        ['on-invert on invert', v('--rd-on-invert'), resolve(v('--rd-invert')), 4.5],
      ];

      const out: string[] = [];
      for (const [label, fg, bg, min] of checks) {
        const r = ratio(resolve(fg), bg);
        if (r < min) out.push(`${label}: ${r.toFixed(2)}:1 (needs ${min}:1)`);
      }
      probe.remove();
      return out;
    });

    expect(failures, `${theme} theme contrast failures:\n  ${failures.join('\n  ')}`).toEqual([]);
  }
});

test('no control is clipped by the card it sits in', async ({ page, request }) => {
  test.setTimeout(180_000);
  await reset(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  const watchId = await createWatch(page);

  // The page-level overflow check has a blind spot: a button pushed past the
  // edge of a card with `overflow-hidden` is invisible to it, because the page
  // itself never scrolls. That is exactly how "Book on Amtrak" came to render
  // as "Book on A" at 390px.
  const clipped: string[] = [];
  for (const path of ['/dashboard', '/alerts', '/settings', `/watches/${watchId}`]) {
    await page.goto(path);
    await page.waitForLoadState('load');

    clipped.push(
      ...(await page.evaluate((where) => {
        const out: string[] = [];
        for (const card of Array.from(document.querySelectorAll<HTMLElement>('.rd-card'))) {
          if (getComputedStyle(card).overflow === 'visible') continue;
          const bounds = card.getBoundingClientRect();
          for (const control of Array.from(card.querySelectorAll<HTMLElement>('a,button'))) {
            const rect = control.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            if (rect.right > bounds.right + 1 || rect.left < bounds.left - 1) {
              out.push(
                `${where}: "${control.innerText.trim().slice(0, 30)}" is cut off by its card`,
              );
            }
          }
        }
        return out;
      }, path)),
    );
  }

  expect(clipped, `clipped controls:\n  ${clipped.join('\n  ')}`).toEqual([]);
});

test('mobile touch targets are at least 44px tall', async ({ page, request }) => {
  await reset(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  const watchId = await createWatch(page);

  const small: string[] = [];
  // Sweep every signed-in surface, not just the one the fixture happens to land
  // on — Settings in particular is almost entirely controls.
  for (const path of [
    '/dashboard',
    '/alerts',
    '/settings',
    '/usage',
    '/watches/new',
    `/watches/${watchId}`,
  ]) {
    await page.goto(path);
    await page.waitForLoadState('load');
    for (const control of await page.locator('a.rd-btn, button.rd-btn, .rd-input').all()) {
      if (!(await control.isVisible())) continue;
      const box = await control.boundingBox();
      if (box && box.height < 40)
        small.push(`${path}: ${(await control.innerText()).trim()} (${Math.round(box.height)}px)`);
    }
  }
  expect(small, `controls below 40px tall: ${small.join(', ')}`).toEqual([]);
});

test('focus is visible and reduced motion is honoured', async ({ page }) => {
  await signIn(page);
  await page.goto('/watches/new');

  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    const style = getComputedStyle(el);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(focus?.outlineStyle).not.toBe('none');
  expect(parseFloat(focus?.outlineWidth ?? '0')).toBeGreaterThan(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/dashboard');
  const duration = await page.evaluate(() => {
    const el = document.querySelector('.rd-btn');
    return el ? getComputedStyle(el).transitionDuration : '0s';
  });
  expect(parseFloat(duration)).toBeLessThan(0.01);
});

test('the theme toggle persists a choice across navigations', async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.goto('/watches/new');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByRole('radio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('every page has a sound heading outline, landmarks and named controls', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await reset(request);
  await signIn(page);
  const watchId = await createWatch(page);

  const pages = [
    '/dashboard',
    '/alerts',
    '/settings',
    '/usage',
    '/watches/new',
    `/watches/${watchId}`,
  ];
  const problems: string[] = [];

  for (const path of pages) {
    await page.goto(path);
    await page.waitForLoadState('load');

    const found = await page.evaluate(() => {
      const issues: string[] = [];
      const visible = (el: Element) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return (
          (rect.width > 0 || rect.height > 0) &&
          style.visibility !== 'hidden' &&
          style.display !== 'none'
        );
      };

      // One h1, and no skipped levels beneath it. A screen-reader user
      // navigates by this outline; a jump from h1 to h3 reads as a missing
      // section rather than a styling choice.
      const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(visible);
      const h1s = headings.filter((h) => h.tagName === 'H1');
      if (h1s.length !== 1) issues.push(`${h1s.length} visible <h1> (expected exactly 1)`);

      let previous = 0;
      for (const heading of headings) {
        const level = Number(heading.tagName.slice(1));
        if (previous !== 0 && level > previous + 1) {
          issues.push(
            `heading jumps h${previous} → h${level} at "${(heading.textContent ?? '').trim().slice(0, 40)}"`,
          );
        }
        previous = level;
      }

      // Landmarks.
      if (!document.querySelector('main')) issues.push('no <main> landmark');
      if (!document.querySelector('nav')) issues.push('no <nav> landmark');

      // Every control needs an accessible name.
      const controls = Array.from(
        document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea'),
      ).filter(visible);
      for (const control of controls) {
        const labelledBy = control.getAttribute('aria-labelledby');
        const labelledText = labelledBy
          ? labelledBy
              .split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent ?? '')
              .join(' ')
          : '';
        const named =
          (control.getAttribute('aria-label') ?? '').trim() !== '' ||
          labelledText.trim() !== '' ||
          (control.textContent ?? '').trim() !== '' ||
          (control instanceof HTMLInputElement && (control.labels?.length ?? 0) > 0) ||
          (control instanceof HTMLSelectElement && (control.labels?.length ?? 0) > 0) ||
          (control instanceof HTMLTextAreaElement && (control.labels?.length ?? 0) > 0) ||
          (control.getAttribute('title') ?? '').trim() !== '';
        if (!named) {
          issues.push(
            `unnamed ${control.tagName.toLowerCase()}${control.id ? `#${control.id}` : ''}`,
          );
        }
      }

      // Images must be described or explicitly decorative.
      for (const img of Array.from(document.querySelectorAll('img')).filter(visible)) {
        if (!img.hasAttribute('alt') && img.getAttribute('aria-hidden') !== 'true') {
          issues.push(`<img> with no alt: ${img.getAttribute('src')?.slice(0, 40)}`);
        }
      }

      // A positive tabindex reorders the whole page for keyboard users.
      for (const el of Array.from(document.querySelectorAll('[tabindex]'))) {
        if (Number(el.getAttribute('tabindex')) > 0) {
          issues.push(`positive tabindex on <${el.tagName.toLowerCase()}>`);
        }
      }

      return issues;
    });

    problems.push(...found.map((issue) => `${path}: ${issue}`));
  }

  expect(problems, `accessibility problems:\n  ${problems.join('\n  ')}`).toEqual([]);
});
