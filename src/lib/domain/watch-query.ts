import { addUtcDays, parseIsoDate } from "./calendar";

export function firstQueryValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function parseStationCode(value: string | undefined): string | undefined {
  const code = value?.trim().toUpperCase();
  if (code && /^[A-Z]{3}$/.test(code)) return code;
  return undefined;
}

export function returnTravelDate(outbound: string, stayDays: number, today: string): string {
  const days = Math.min(14, Math.max(1, Math.round(stayDays)));
  const next = addUtcDays(outbound, days);
  return next < today ? today : next;
}

export function parseTravelDate(value: string | undefined, today: string): string | undefined {
  if (!value || !parseIsoDate(value)) return undefined;
  if (value < today) return undefined;
  return value;
}

export function parsePriceDollars(value: string | undefined): string | undefined {
  if (!value || value.trim().startsWith("-")) return undefined;
  const parsed = Number(value.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return String(parsed);
}

export interface WatchFormInitial {
  origin?: string;
  destination?: string;
  date?: string;
  price?: string;
}

export function watchFormInitialFromQuery(
  query: Record<string, string | string[] | undefined>,
  today: string,
): WatchFormInitial {
  const origin = parseStationCode(firstQueryValue(query.origin));
  const destination = parseStationCode(firstQueryValue(query.destination));
  const date = parseTravelDate(firstQueryValue(query.date), today);
  const price = parsePriceDollars(firstQueryValue(query.price));
  return {
    origin,
    destination: origin && destination && origin === destination ? undefined : destination,
    date,
    price,
  };
}
