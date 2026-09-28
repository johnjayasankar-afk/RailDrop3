import { assertIsoDate, compareIsoDates } from "./calendar";

/* A fare search that can be sent to somebody.
 *
 * Route and date travel in the link; the fares never do. That restraint is the
 * whole design. A card that carried a price in a query parameter would let
 * anybody mint a link reading "BOS to NYP, $5" and have it render in RailDrop's
 * own typeface on RailDrop's own background — the product's one promise broken
 * by a URL, with the forgery indistinguishable from the real thing.
 *
 * So the link says where and when, the recipient's own search says how much,
 * and every number on the page has still been observed by the time anyone sees
 * it.
 */

export interface SharedSearch {
  originCode: string;
  destinationCode: string;
  travelDate: string | null;
  flexibilityDays: 0 | 1 | 2;
  passengers: number;
}

const CODE = /^[A-Za-z]{3}$/;
const MAX_PASSENGERS = 8;

/**
 * Read a shared search out of query parameters.
 *
 * Everything is treated as hostile: these values arrive from a stranger's link
 * and are rendered into an image and a form. Anything unreadable falls back to
 * a default rather than being repaired — guessing what someone meant by "BOSTON"
 * is how you end up searching a route they did not ask for.
 */
export function readSharedSearch(
  params: Record<string, string | string[] | undefined>,
  fallbackDate: string,
): SharedSearch {
  return {
    originCode: code(params.from) ?? "BOS",
    destinationCode: code(params.to) ?? "NYP",
    travelDate: date(params.on) ?? fallbackDate,
    flexibilityDays: flexibility(params.flex),
    passengers: passengers(params.pax),
  };
}

/** The canonical link for a search, for copying and for the card. */
export function sharedSearchHref(search: SharedSearch): string {
  const query = new URLSearchParams({
    from: search.originCode,
    to: search.destinationCode,
    ...(search.travelDate ? { on: search.travelDate } : {}),
    ...(search.flexibilityDays > 0 ? { flex: String(search.flexibilityDays) } : {}),
    ...(search.passengers > 1 ? { pax: String(search.passengers) } : {}),
  });
  return `/fares?${query.toString()}`;
}

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function code(value: string | string[] | undefined): string | null {
  const raw = first(value)?.trim();
  return raw && CODE.test(raw) ? raw.toUpperCase() : null;
}

function date(value: string | string[] | undefined): string | null {
  const raw = first(value)?.trim();
  if (!raw) return null;
  try {
    const iso = assertIsoDate(raw);
    // A date is not a calendar-shaped string: 2026-02-31 passes the pattern.
    const parsed = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10) === iso ? iso : null;
  } catch {
    return null;
  }
}

function flexibility(value: string | string[] | undefined): 0 | 1 | 2 {
  const raw = Number.parseInt(first(value) ?? "", 10);
  return raw === 1 || raw === 2 ? raw : 0;
}

function passengers(value: string | string[] | undefined): number {
  const raw = Number.parseInt(first(value) ?? "", 10);
  if (!Number.isFinite(raw)) return 1;
  return Math.min(MAX_PASSENGERS, Math.max(1, raw));
}

/** Whether a shared date has already gone, so the page can say so. */
export function isPastDate(travelDate: string | null, today: string): boolean {
  return travelDate !== null && compareIsoDates(travelDate, today) < 0;
}
