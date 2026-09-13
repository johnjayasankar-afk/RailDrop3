/**
 * THE command that answers "am I getting live Amtrak prices?".
 *
 * It makes one real call through whichever provider is configured, prints the
 * normalized result in full, runs plausibility checks that would catch a stale,
 * synthetic or mis-scaled feed, and then tells you exactly what to compare
 * against amtrak.com with your own eyes.
 *
 * It deliberately does NOT declare success on an HTTP 200. A 200 carrying
 * fabricated or 100x-wrong numbers is worse than an error, because a fare
 * monitor built on it will email people about savings that do not exist.
 *
 *   npm run verify:live -- BOS NYP 2026-10-15
 *   npm run verify:live -- CHI SEA           (long-distance, exercises sleepers)
 */

import './load-env';
import { addDays, todayInTimeZone } from '../src/lib/domain/dates';
import { formatCents } from '../src/lib/domain/money';
import { getServerEnv } from '../src/lib/env';
import { createFareProvider, describeActiveProvider } from '../src/lib/providers';
import { ProviderError } from '../src/lib/providers/fare-provider';
import type { FareSearchResult } from '../src/lib/domain/types';

const MIN_PLAUSIBLE = 500; // $5
const MAX_PLAUSIBLE = 500_000; // $5,000

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fatal: boolean;
}

function runPlausibilityChecks(result: FareSearchResult): Check[] {
  const checks: Check[] = [];
  const journeys = result.journeys;
  const fares = journeys.flatMap((j) => j.fares);

  checks.push({
    name: 'journeys returned',
    ok: journeys.length > 0,
    detail: `${journeys.length} journeys`,
    fatal: false, // a genuinely empty route/date is legitimate
  });

  if (journeys.length === 0) return checks;

  checks.push({
    name: 'at least one priced fare',
    ok: fares.length > 0,
    detail: `${fares.length} fares across ${journeys.length} journeys`,
    fatal: true,
  });

  const amounts = fares.map((f) => f.amountCents);
  if (amounts.length > 0) {
    const lo = Math.min(...amounts);
    const hi = Math.max(...amounts);
    checks.push({
      name: 'fares in a plausible range',
      ok: lo >= MIN_PLAUSIBLE && hi <= MAX_PLAUSIBLE,
      detail: `${formatCents(lo)} – ${formatCents(hi)} (expected $5 – $5,000). If these are 100x off, set PROVIDER_AMOUNT_UNIT.`,
      fatal: true,
    });
  }

  checks.push({
    name: 'travel date matches the request',
    ok: journeys.every((j) => j.travelDate === result.request.date),
    detail: `requested ${result.request.date}, got ${[...new Set(journeys.map((j) => j.travelDate))].join(', ')}`,
    fatal: true,
  });

  checks.push({
    name: 'route matches the request',
    ok: journeys.every(
      (j) =>
        j.originCode === result.request.originCode &&
        j.destinationCode === result.request.destinationCode,
    ),
    detail: `${result.request.originCode} to ${result.request.destinationCode}`,
    fatal: true,
  });

  const arrivalsAfterDeparture = journeys.filter((j) => j.arrivalLocal > j.departureLocal).length;
  checks.push({
    name: 'arrivals are after departures',
    ok: arrivalsAfterDeparture === journeys.length,
    detail: `${arrivalsAfterDeparture}/${journeys.length}`,
    fatal: false, // an overnight journey can legitimately look inverted per-day
  });

  const named = journeys.filter((j) => j.serviceName || j.trainNumber).length;
  checks.push({
    name: 'services are identifiable',
    ok: named === journeys.length,
    detail: `${named}/${journeys.length} have a name or train number`,
    fatal: false,
  });

  const durations = journeys.map((j) => j.durationMinutes).filter((d) => d > 0);
  checks.push({
    name: 'durations are sane',
    ok: durations.length > 0 && durations.every((d) => d >= 10 && d <= 5760),
    detail:
      durations.length > 0
        ? `${Math.min(...durations)}–${Math.max(...durations)} min`
        : 'no durations parsed',
    fatal: false,
  });

  const unknownService = journeys.filter((j) => j.serviceType === 'UNKNOWN').length;
  checks.push({
    name: 'service types resolved',
    ok: unknownService === 0,
    detail:
      unknownService === 0
        ? 'all journeys classified as rail or bus'
        : `${unknownService} journeys could not be classified — they are excluded from alerts`,
    fatal: false,
  });

  const unknownFamily = fares.filter((f) => f.family === 'UNKNOWN').length;
  checks.push({
    name: 'fare families recognised',
    ok: unknownFamily < fares.length,
    detail:
      unknownFamily === 0
        ? 'all fare families mapped'
        : `${unknownFamily}/${fares.length} unmapped — add the raw value to the adapter alias table`,
    fatal: unknownFamily === fares.length,
  });

  return checks;
}

async function main(): Promise<void> {
  const env = getServerEnv();
  const active = describeActiveProvider();

  const [origin = 'BOS', destination = 'NYP', dateArg] = process.argv.slice(2);
  const date = dateArg ?? addDays(todayInTimeZone(new Date(), 'America/New_York'), 30);

  console.log('─'.repeat(72));
  console.log('RailDrop live fare verification');
  console.log('─'.repeat(72));
  console.log(
    `Provider        ${active.id}${active.isLive ? '' : '  (NOT LIVE — simulated data)'}`,
  );
  console.log(`Configured      ${active.configured ? 'yes' : 'NO — missing credentials'}`);
  console.log(`Pricing basis   ${env.pricingBasis}`);
  console.log(`Amount unit     ${env.amountUnit}`);
  console.log(`Query           ${origin} -> ${destination} on ${date}, 1 adult`);
  console.log('─'.repeat(72));

  if (!active.isLive) {
    console.error(
      '\nFARE_PROVIDER is not a live provider, so this proves nothing about real fares.',
    );
    console.error('Set FARE_PROVIDER=parse (or http) with credentials, then re-run.');
    process.exit(1);
  }
  if (!active.configured) {
    console.error('\nThe active provider has no credentials configured. See SETUP_REQUIRED.md.');
    process.exit(1);
  }

  let result: FareSearchResult;
  const startedAt = Date.now();
  try {
    const provider = createFareProvider();
    result = await provider.search(
      { originCode: origin, destinationCode: destination, date, passengers: 1 },
      { requestId: 'verify-live' },
    );
  } catch (error) {
    console.error('\nLIVE VERIFICATION FAILED\n');
    if (error instanceof ProviderError) {
      console.error(`  kind        ${error.kind}`);
      console.error(`  http        ${error.httpStatus ?? 'n/a'}`);
      console.error(`  message     ${error.message}`);
      const hints: Record<string, string> = {
        AUTH: 'Check your API key.',
        NOT_FOUND: 'Check the scraper id / URL template.',
        SCHEMA:
          'The response shape is not recognised. Add the field aliases to the A table in src/lib/providers/parse/adapter.ts.',
        RATE_LIMIT: 'You are over the plan rate limit. Wait and retry.',
        BLOCKED: 'The upstream blocked the request.',
      };
      if (hints[error.kind]) console.error(`\n  ${hints[error.kind]}`);
    } else {
      console.error(error);
    }
    process.exit(1);
  }

  const elapsed = Date.now() - startedAt;
  console.log(
    `\nHTTP ${result.meta.httpStatus} in ${result.meta.latencyMs}ms (${elapsed}ms total)`,
  );
  console.log(`Credits charged  ${result.meta.creditsCharged ?? 'not reported'}`);
  console.log(`Credits left     ${result.meta.creditsRemaining ?? 'not reported'}`);
  console.log(`Availability     ${result.availability}`);

  console.log('\nField aliases the adapter matched:');
  for (const alias of result.meta.schemaAliases) console.log(`  ${alias}`);

  console.log(`\nJourneys (${result.journeys.length}):`);
  for (const j of result.journeys.slice(0, 8)) {
    const cheapest = j.fares.length > 0 ? Math.min(...j.fares.map((f) => f.amountCents)) : null;
    console.log(
      `  ${(j.trainNumber ?? '—').padEnd(6)} ${(j.serviceName ?? '').padEnd(22)} ` +
        `${j.departureLocal.slice(11)} -> ${j.arrivalLocal.slice(11)}  ` +
        `${String(j.durationMinutes).padStart(4)}min  ${j.serviceType.padEnd(16)} ` +
        `${cheapest !== null ? formatCents(cheapest) : 'no fare'}`,
    );
    for (const f of j.fares) {
      console.log(
        `           ${f.family.padEnd(9)} ${f.travelClass.padEnd(9)} ${formatCents(f.amountCents).padStart(9)} ` +
          `${f.availability.padEnd(10)} raw="${f.familyRaw ?? ''}"/"${f.travelClassRaw ?? ''}"`,
      );
    }
  }
  if (result.journeys.length > 8) console.log(`  … and ${result.journeys.length - 8} more`);

  console.log('\nPlausibility checks:');
  const checks = runPlausibilityChecks(result);
  let fatalFailures = 0;
  for (const check of checks) {
    if (!check.ok && check.fatal) fatalFailures += 1;
    const mark = check.ok ? 'PASS' : check.fatal ? 'FAIL' : 'WARN';
    console.log(`  ${mark}  ${check.name.padEnd(32)} ${check.detail}`);
  }

  console.log('\n' + '─'.repeat(72));
  if (fatalFailures > 0) {
    console.error(`${fatalFailures} fatal check(s) failed. Do NOT trust this feed yet.`);
    process.exit(1);
  }

  // The step no automated check can replace.
  console.log('MACHINE CHECKS PASSED — now confirm with your own eyes.');
  console.log('─'.repeat(72));
  console.log('\nOpen this in a normal browser and compare the cheapest fare above:\n');
  console.log('  https://www.amtrak.com/home\n');
  console.log(`  From ${origin}   To ${destination}   Depart ${date}   1 adult\n`);
  console.log('If the numbers match, your feed is live and correct. If they do not:');
  console.log('  - out by ~100x        -> set PROVIDER_AMOUNT_UNIT=cents');
  console.log('  - out by ~2x          -> run `npm run verify:party-pricing`');
  console.log(
    '  - unrelated trains    -> the provider is not really querying Amtrak; do not ship it',
  );
  console.log('  - plausible but stale -> re-run in an hour and see whether anything moves\n');
  console.log('Until you have done this comparison once, treat the feed as UNVERIFIED.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
