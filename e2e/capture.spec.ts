import { test } from '@playwright/test';
import { signIn } from './helpers';

const OUT = '/private/tmp/claude-501/-Users-johnjayasankar-Library-Application-Support-Claude-scratch-workspaces-94125b45-abfb-4ce8-9080-d469d15d31c9-e7c0af3d-a0a0-48f9-b501-7788299489b1-scratch-2026-09-03-0c4f76/a0693671-7431-48fb-989a-d258ff4cf122/scratchpad/shots';

test('capture', async ({ page }, info) => {
  test.setTimeout(300_000);
  const tag = info.project.name === 'mobile' ? 'm' : 'd';
  const scheme = (process.env.SCHEME ?? 'light') as 'light' | 'dark';
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/${tag}-${scheme}-landing.png`, fullPage: true });
  await signIn(page);
  const paths: Array<[string, string]> = [
    ['dashboard', '/dashboard'],
    ['alerts', '/alerts'],
    ['settings', '/settings'],
    ['new', '/watches/new'],
  ];
  for (const [name, p] of paths) {
    await page.goto(p);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${OUT}/${tag}-${scheme}-${name}.png`, fullPage: true });
  }
  await page.goto('/dashboard');
  const links = page.locator('a[href^="/watches/"]:not([href="/watches/new"])');
  const hrefs = Array.from(new Set(await links.evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href')!))));
  console.log('HREFS', hrefs.join(' '));
  let i = 0;
  for (const h of hrefs.slice(0, 3)) {
    await page.goto(h);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${OUT}/${tag}-${scheme}-trip${i++}.png`, fullPage: true });
  }
  await page.goto('/login');
  await page.screenshot({ path: `${OUT}/${tag}-${scheme}-login.png`, fullPage: true });
  await page.goto('/nope-404');
  await page.screenshot({ path: `${OUT}/${tag}-${scheme}-404.png`, fullPage: true });
});
