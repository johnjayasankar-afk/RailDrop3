/**
 * BookingLinkResolver - see docs/ADR-003-BOOKING-HANDOFF.md.
 *
 * Three tiers, strict priority, honest disclosure. No deep link is ever invented.
 */

import { formatCents } from './money';
import { formatMediumDate, formatClock, minutesOfDayFromLocalIso } from './dates';
import type { BookingHandoff, Candidate, Watch } from './types';

/** The official, generic Amtrak booking entry point. */
export const AMTRAK_GENERIC_BOOKING_URL = 'https://www.amtrak.com/home';

const DISCLOSURES = {
  EXACT: 'This link came with the fare and points at Amtrak booking.',
  SEARCH_PREFILL:
    'This opens an Amtrak search prefilled with your route and date. Confirm the fare on Amtrak.',
  GENERIC:
    'We will send you to Amtrak booking to find this fare. RailDrop does not hold or reserve inventory.',
} as const;

/** Matches ASCII control characters, which have no place in a URL. */
const CONTROL_CHARS = new RegExp('[\\x00-\\x1F\\x7F]');

/**
 * Only https URLs on amtrak.com (or a subdomain) may ever be rendered as a
 * booking link. Closes open-redirect and hostile-payload holes.
 */
export function isSafeAmtrakUrl(value: string | null | undefined): boolean {
  if (!value || typeof value !== 'string') return false;
  if (CONTROL_CHARS.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return host === 'amtrak.com' || host.endsWith('.amtrak.com');
}

export interface ResolverOptions {
  /**
   * Only true after `npm run verify:booking-links` drove a real browser to the
   * template and confirmed the prefill. Ships false.
   */
  deeplinkVerified: boolean;
  /**
   * Optional URL template with {origin} {destination} {date} placeholders.
   * Deliberately supplied by configuration, never guessed in code.
   */
  deeplinkTemplate?: string | null;
}

export function buildPrefillUrl(
  template: string,
  params: { origin: string; destination: string; date: string },
): string | null {
  const url = template
    .replaceAll('{origin}', encodeURIComponent(params.origin))
    .replaceAll('{destination}', encodeURIComponent(params.destination))
    .replaceAll('{date}', encodeURIComponent(params.date));
  return isSafeAmtrakUrl(url) ? url : null;
}

function safeMinutes(iso: string): number | null {
  try {
    return minutesOfDayFromLocalIso(iso);
  } catch {
    return null;
  }
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

export function buildCopyText(details: BookingHandoff['tripDetails']): string {
  const depMin = safeMinutes(details.departureLocal);
  const arrMin = safeMinutes(details.arrivalLocal);
  const service = [details.serviceName, details.trainNumber ? `#${details.trainNumber}` : null]
    .filter(Boolean)
    .join(' ');
  const lines: Array<string | null> = [
    'RailDrop - trip details',
    `Route:      ${details.originCode} to ${details.destinationCode}`,
    `Date:       ${formatMediumDate(details.date)}`,
    service ? `Service:    ${service}` : null,
    depMin !== null && arrMin !== null
      ? `Time:       ${formatClock(depMin)} - ${formatClock(arrMin)}`
      : null,
    `Class:      ${titleCase(details.fareFamily)} / ${titleCase(details.travelClass)}`,
    `Passengers: ${details.passengers}`,
    `Observed:   ${formatCents(details.observedTotalCents)} at ${new Date(details.observedAt).toUTCString()}`,
    '',
    'Fares and availability change. RailDrop does not modify your Amtrak reservation.',
  ];
  return lines.filter((line): line is string => line !== null).join('\n');
}

export function resolveBookingHandoff(
  candidate: Candidate,
  watch: Watch,
  observedAt: string,
  options: ResolverOptions,
): BookingHandoff {
  const { journey, fare } = candidate;

  const tripDetails: BookingHandoff['tripDetails'] = {
    originCode: journey.originCode,
    destinationCode: journey.destinationCode,
    date: journey.travelDate,
    trainNumber: journey.trainNumber,
    serviceName: journey.serviceName,
    departureLocal: journey.departureLocal,
    arrivalLocal: journey.arrivalLocal,
    fareFamily: fare.family,
    travelClass: fare.travelClass,
    passengers: watch.passengers,
    observedTotalCents: fare.partyTotalCents,
    observedAt,
  };

  const copyText = buildCopyText(tripDetails);

  // Tier 1 - provider-supplied, host-validated.
  if (isSafeAmtrakUrl(journey.bookingUrl)) {
    return {
      url: journey.bookingUrl as string,
      confidence: 'EXACT',
      disclosure: DISCLOSURES.EXACT,
      tripDetails,
      copyText,
    };
  }

  // Tier 2 - verified prefilled search, only when a browser test proved it works.
  if (options.deeplinkVerified && options.deeplinkTemplate) {
    const url = buildPrefillUrl(options.deeplinkTemplate, {
      origin: journey.originCode,
      destination: journey.destinationCode,
      date: journey.travelDate,
    });
    if (url) {
      return {
        url,
        confidence: 'SEARCH_PREFILL',
        disclosure: DISCLOSURES.SEARCH_PREFILL,
        tripDetails,
        copyText,
      };
    }
  }

  // Tier 3 - generic official handoff. Always available, never over-claims.
  return {
    url: AMTRAK_GENERIC_BOOKING_URL,
    confidence: 'GENERIC',
    disclosure: DISCLOSURES.GENERIC,
    tripDetails,
    copyText,
  };
}
