/**
 * Verifies the booking handoff targets.
 *
 * Tier 3 (generic): asserts the official Amtrak booking entry point is reachable.
 * Tier 2 (prefill): only meaningful if AMTRAK_DEEPLINK_TEMPLATE is configured.
 *   An HTTP fetch CANNOT prove a prefill works — amtrak.com renders its search
 *   client-side — so this script refuses to set AMTRAK_DEEPLINK_VERIFIED on the
 *   strength of a 200. It tells you exactly what a human/browser must confirm.
 */

import './load-env';
import {
  AMTRAK_GENERIC_BOOKING_URL,
  buildPrefillUrl,
  isSafeAmtrakUrl,
} from '../src/lib/domain/booking-link';

async function reachable(
  url: string,
): Promise<{ ok: boolean; status: number | null; note: string }> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'RailDrop/1.0 link check' },
      signal: AbortSignal.timeout(20_000),
    });
    return {
      ok: response.ok,
      status: response.status,
      note: response.ok ? 'reachable' : 'non-2xx',
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      note: error instanceof Error ? error.message : 'network error',
    };
  }
}

async function main(): Promise<void> {
  let failures = 0;

  console.log('Tier 3 — generic official handoff');
  console.log(`  URL: ${AMTRAK_GENERIC_BOOKING_URL}`);
  const generic = await reachable(AMTRAK_GENERIC_BOOKING_URL);
  console.log(`  host allowed: ${isSafeAmtrakUrl(AMTRAK_GENERIC_BOOKING_URL) ? 'yes' : 'NO'}`);
  console.log(`  http: ${generic.status ?? 'n/a'} (${generic.note})`);
  if (!generic.ok) {
    failures += 1;
    console.log('  NOTE: a bot-blocked or non-2xx response here does not mean the link is broken');
    console.log('        for a real browser. Confirm manually before treating this as a failure.');
  }

  const template = process.env.AMTRAK_DEEPLINK_TEMPLATE;
  console.log('\nTier 2 — prefilled search deep link');
  if (!template) {
    console.log('  AMTRAK_DEEPLINK_TEMPLATE is not set.');
    console.log('  RailDrop ships with AMTRAK_DEEPLINK_VERIFIED=false and uses the generic');
    console.log('  handoff. No deep-link format has been invented. This is the intended state.');
  } else {
    const url = buildPrefillUrl(template, {
      origin: 'BOS',
      destination: 'NYP',
      date: '2026-10-15',
    });
    if (!url) {
      failures += 1;
      console.log(
        `  REJECTED: the template resolves to an unsafe URL (must be https on amtrak.com).`,
      );
    } else {
      console.log(`  Resolved: ${url}`);
      const result = await reachable(url);
      console.log(`  http: ${result.status ?? 'n/a'} (${result.note})`);
      console.log('\n  A 200 is NOT sufficient. Before setting AMTRAK_DEEPLINK_VERIFIED=true you');
      console.log('  must open this URL in a real browser and confirm that origin, destination');
      console.log('  and date are actually prefilled in the search form. If they are not,');
      console.log('  leave the flag false — the generic handoff is correct and honest.');
    }
  }

  console.log(`\nBooking handoff: ${failures === 0 ? 'GENERIC VERIFIED' : 'CHECK MANUALLY'}`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
