import { describe, expect, it } from 'vitest';

import nextConfig from '../../next.config';

/**
 * The dev server needs `unsafe-eval` for Fast Refresh. That relaxation is
 * gated on NODE_ENV, and this is the guard that keeps it from ever reaching a
 * built artefact — the failure mode is invisible in review and total in effect.
 *
 * Vitest runs with NODE_ENV=test, so what these assertions see is exactly the
 * non-development branch.
 */
async function policy(): Promise<string> {
  const groups = await nextConfig.headers!();
  const header = groups
    .flatMap((group) => group.headers)
    .find((h) => h.key === 'Content-Security-Policy');
  expect(header, 'no Content-Security-Policy header is configured').toBeDefined();
  return header!.value;
}

describe('production Content-Security-Policy', () => {
  it('never allows eval', async () => {
    expect(await policy()).not.toContain('unsafe-eval');
  });

  it('never opens connect-src to plaintext or arbitrary websockets', async () => {
    const csp = await policy();
    const connect = csp.split('; ').find((d) => d.startsWith('connect-src')) ?? '';
    expect(connect).not.toContain('ws:');
    expect(connect).not.toContain('http://');
  });

  it('keeps the directives that make clickjacking and base-tag injection impossible', async () => {
    const csp = await policy();
    for (const directive of [
      "default-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ]) {
      expect(csp, `missing directive: ${directive}`).toContain(directive);
    }
  });
});
