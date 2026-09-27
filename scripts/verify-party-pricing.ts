/**
 * Resolves, empirically, whether provider fares are PER PASSENGER or TOTAL PARTY.
 *
 * This is the single most dangerous unverified assumption in RailDrop: comparing
 * a 2-passenger benchmark against a 1-passenger fare would manufacture a 50%
 * "saving" that does not exist. Until this is resolved, multi-passenger watches
 * are displayed but never alerted on.
 *
 * Cost: exactly 2 requests (~4 credits).
 */

import './load-env';
import { addDays, todayInTimeZone } from '../src/lib/domain/dates';
import { createParseProviderFromEnv } from '../src/lib/providers/parse/client';

function cheapest(journeys: Array<{ fares: Array<{ amountCents: number }> }>): number | null {
  const amounts = journeys.flatMap((j) => j.fares.map((f) => f.amountCents));
  return amounts.length > 0 ? Math.min(...amounts) : null;
}

async function main(): Promise<void> {
  if (!process.env.PARSE_API_KEY) {
    console.error('PARSE_API_KEY is not set. Cannot verify party pricing.');
    process.exit(1);
  }

  const [origin = 'BOS', destination = 'NYP', date] = process.argv.slice(2);
  const travelDate = date ?? addDays(todayInTimeZone(new Date(), 'America/New_York'), 30);

  // Force a raw comparison: the adapter must not pre-apply any basis.
  const provider = createParseProviderFromEnv({
    normalize: {
      pricingBasis: 'TOTAL_PARTY',
      amountUnit: process.env.PROVIDER_AMOUNT_UNIT === 'cents' ? 'cents' : 'dollars',
    },
  });

  console.log(`Comparing 1 adult vs 2 adults on ${origin} -> ${destination} ${travelDate}`);
  console.log('(2 requests, ~4 credits)\n');

  const one = await provider.search(
    { originCode: origin, destinationCode: destination, date: travelDate, passengers: 1 },
    { requestId: 'party-1' },
  );
  const two = await provider.search(
    { originCode: origin, destinationCode: destination, date: travelDate, passengers: 2 },
    { requestId: 'party-2' },
  );

  const oneCheapest = cheapest(one.journeys);
  const twoCheapest = cheapest(two.journeys);

  console.log(`1 adult : ${one.journeys.length} journeys, cheapest fare ${format(oneCheapest)}`);
  console.log(`2 adults: ${two.journeys.length} journeys, cheapest fare ${format(twoCheapest)}\n`);

  if (oneCheapest === null || twoCheapest === null) {
    console.error('UNRESOLVED — one of the queries returned no priced fares.');
    console.error('Try a busier route/date. Leave PROVIDER_PRICING_BASIS=UNKNOWN meanwhile.');
    process.exit(1);
  }

  const ratio = twoCheapest / oneCheapest;
  console.log(`Ratio (2 adults / 1 adult): ${ratio.toFixed(3)}\n`);

  if (Math.abs(ratio - 2) <= 0.05) {
    console.log('VERDICT: TOTAL_PARTY');
    console.log('The 2-adult amount is ~2x the 1-adult amount, so the provider already');
    console.log('returns a total for the whole party.\n');
    console.log('Set in your environment:\n\n  PROVIDER_PRICING_BASIS=TOTAL_PARTY\n');
    process.exit(0);
  }

  if (Math.abs(ratio - 1) <= 0.02) {
    console.log('VERDICT: PER_PASSENGER');
    console.log('The amount did not change with party size, so it is a per-passenger fare');
    console.log('and RailDrop must multiply it by the passenger count.\n');
    console.log('Set in your environment:\n\n  PROVIDER_PRICING_BASIS=PER_PASSENGER\n');
    process.exit(0);
  }

  console.error('VERDICT: UNRESOLVED');
  console.error(`The ratio ${ratio.toFixed(3)} matches neither interpretation cleanly.`);
  console.error('This can happen when inventory differs between the two queries.');
  console.error('Re-run on a different route/date. Until it resolves, leave');
  console.error('PROVIDER_PRICING_BASIS=UNKNOWN — multi-passenger alerts stay suppressed,');
  console.error('which is the safe behaviour.');
  process.exit(1);
}

function format(cents: number | null): string {
  return cents === null ? '(none)' : `$${(cents / 100).toFixed(2)}`;
}

main().catch((error: unknown) => {
  console.error(
    'Party pricing verification failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
