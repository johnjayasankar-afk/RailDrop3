/**
 * ONE controlled live call to the fare provider.
 *
 * Purpose: validate the real response schema and write a sanitized fingerprint
 * so production can pin the field aliases that actually occur. It deliberately
 * makes a single request — never a loop — because every call costs credits.
 *
 *   npm run probe:provider -- BOS NYP 2026-10-15
 */

import './load-env';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addDays, todayInTimeZone } from '../src/lib/domain/dates';
import { createParseProviderFromEnv } from '../src/lib/providers/parse/client';
import { ProviderError } from '../src/lib/providers/fare-provider';

const FINGERPRINT = join(process.cwd(), 'docs', 'provider-schema-fingerprint.json');

async function main(): Promise<void> {
  if (!process.env.PARSE_API_KEY) {
    console.error('PARSE_API_KEY is not set. Cannot probe the live provider.');
    console.error(
      'This is the ONLY way to verify the real response schema — see SETUP_REQUIRED.md.',
    );
    process.exit(1);
  }

  const [origin = 'BOS', destination = 'NYP', date] = process.argv.slice(2);
  const travelDate = date ?? addDays(todayInTimeZone(new Date(), 'America/New_York'), 30);

  console.log(`Probing ${origin} -> ${destination} on ${travelDate} (1 request, ~2 credits)...\n`);

  const provider = createParseProviderFromEnv();
  const startedAt = Date.now();

  try {
    const result = await provider.search(
      { originCode: origin, destinationCode: destination, date: travelDate, passengers: 1 },
      { requestId: 'probe' },
    );

    console.log(`HTTP ${result.meta.httpStatus} in ${result.meta.latencyMs}ms`);
    console.log(`Credits charged: ${result.meta.creditsCharged ?? 'not reported'}`);
    console.log(`Credits remaining: ${result.meta.creditsRemaining ?? 'not reported'}`);
    console.log(`Availability: ${result.availability}`);
    console.log(`Journeys normalized: ${result.journeys.length}\n`);

    console.log('Field aliases matched by the adapter:');
    for (const alias of result.meta.schemaAliases) console.log(`  ${alias}`);

    const sample = result.journeys[0];
    if (sample) {
      console.log('\nFirst normalized journey:');
      console.log(`  id           ${sample.providerJourneyId}`);
      console.log(`  service      ${sample.serviceName ?? '(none)'} ${sample.trainNumber ?? ''}`);
      console.log(`  route        ${sample.originCode} -> ${sample.destinationCode}`);
      console.log(`  departs      ${sample.departureLocal}`);
      console.log(`  arrives      ${sample.arrivalLocal}`);
      console.log(`  duration     ${sample.durationMinutes} min`);
      console.log(`  transfers    ${sample.transfers}`);
      console.log(`  serviceType  ${sample.serviceType}`);
      console.log(`  legs         ${sample.legs.length}`);
      console.log('  fares:');
      for (const fare of sample.fares) {
        console.log(
          `    ${fare.family.padEnd(9)} ${fare.travelClass.padEnd(9)} ` +
            `${(fare.amountCents / 100).toFixed(2)} ${fare.currency}  ${fare.availability}` +
            `  (raw family "${fare.familyRaw ?? ''}", raw class "${fare.travelClassRaw ?? ''}")`,
        );
      }
      console.log(
        '\nSanity check the amounts above against amtrak.com. If they are 100x off, ' +
          'set PROVIDER_AMOUNT_UNIT=cents.',
      );
    } else {
      console.log('\nNo journeys were returned. Either this route/date genuinely has no service,');
      console.log('or the response shape changed. Re-run with a busier route before concluding.');
    }

    // The fingerprint records the SHAPE, never fares or any payload content.
    const fingerprint = {
      probedAt: new Date().toISOString(),
      request: { origin, destination, date: travelDate, passengers: 1 },
      httpStatus: result.meta.httpStatus,
      latencyMs: result.meta.latencyMs,
      creditsCharged: result.meta.creditsCharged,
      journeysReturned: result.journeys.length,
      availability: result.availability,
      schemaAliases: result.meta.schemaAliases,
      fareFamiliesSeen: [
        ...new Set(result.journeys.flatMap((j) => j.fares.map((f) => f.familyRaw))),
      ],
      travelClassesSeen: [
        ...new Set(result.journeys.flatMap((j) => j.fares.map((f) => f.travelClassRaw))),
      ],
      serviceTypesSeen: [...new Set(result.journeys.map((j) => j.serviceType))],
      providerBookingUrlPresent: result.journeys.some((j) => j.bookingUrl !== null),
    };
    writeFileSync(FINGERPRINT, `${JSON.stringify(fingerprint, null, 2)}\n`);
    console.log(`\nWrote ${FINGERPRINT}`);
    console.log(`\nPROVIDER LIVE VERIFIED in ${Date.now() - startedAt}ms.`);
  } catch (error) {
    if (error instanceof ProviderError) {
      console.error(`\nPROVIDER PROBE FAILED — ${error.kind} (HTTP ${error.httpStatus ?? 'n/a'})`);
      console.error(error.message);
      if (error.kind === 'AUTH') console.error('\nCheck PARSE_API_KEY.');
      if (error.kind === 'NOT_FOUND') console.error('\nCheck PARSE_SCRAPER_ID.');
      if (error.kind === 'SCHEMA') {
        console.error('\nThe response shape is not recognised. Add the new aliases to');
        console.error('src/lib/providers/parse/adapter.ts (the A alias table).');
      }
    } else {
      console.error('\nPROVIDER PROBE FAILED:', error);
    }
    process.exit(1);
  }
}

main();
