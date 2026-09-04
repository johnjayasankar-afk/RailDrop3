export type DateFlexibilityDays = 0 | 1 | 2;

export interface SearchDateWindow {
  desiredDate: string;
  flexibilityDays: DateFlexibilityDays;
  today: string;
  dates: string[];
  skippedPastDates: string[];
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function assertIsoDate(value: string): string {
  if (!ISO_DATE.test(value)) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  const parsed = parseIsoDate(value);
  if (!parsed) {
    throw new Error(`Invalid calendar date: ${value}`);
  }
  return formatIsoDate(parsed);
}

export function parseIsoDate(value: string): Date | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

export function formatIsoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addUtcDays(isoDate: string, days: number): string {
  const date = parseIsoDate(assertIsoDate(isoDate));
  if (!date) throw new Error(`Invalid ISO date: ${isoDate}`);
  date.setUTCDate(date.getUTCDate() + days);
  return formatIsoDate(date);
}

export function compareIsoDates(a: string, b: string): number {
  return assertIsoDate(a).localeCompare(assertIsoDate(b));
}

export function dateOffsetDays(fromDesired: string, candidate: string): number {
  const from = parseIsoDate(assertIsoDate(fromDesired));
  const to = parseIsoDate(assertIsoDate(candidate));
  if (!from || !to) throw new Error("Invalid date offset inputs");
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

export function generateSearchDates(
  desiredDate: string,
  flexibilityDays: DateFlexibilityDays,
  today: string,
): SearchDateWindow {
  const desired = assertIsoDate(desiredDate);
  const todayDate = assertIsoDate(today);
  if (flexibilityDays !== 0 && flexibilityDays !== 1 && flexibilityDays !== 2) {
    throw new Error(`Unsupported date_flexibility_days: ${flexibilityDays}`);
  }

  const raw: string[] = [];
  for (let offset = -flexibilityDays; offset <= flexibilityDays; offset += 1) {
    raw.push(addUtcDays(desired, offset));
  }

  const dates: string[] = [];
  const skippedPastDates: string[] = [];
  for (const date of raw) {
    if (compareIsoDates(date, todayDate) < 0) {
      skippedPastDates.push(date);
    } else {
      dates.push(date);
    }
  }

  return {
    desiredDate: desired,
    flexibilityDays,
    today: todayDate,
    dates,
    skippedPastDates,
  };
}

export function dateBadge(offsetDays: number): string {
  if (offsetDays === 0) return "SAME DAY";
  if (offsetDays === -1) return "1 DAY EARLIER";
  if (offsetDays === 1) return "1 DAY LATER";
  if (offsetDays < 0) return `${Math.abs(offsetDays)} DAYS EARLIER`;
  return `${offsetDays} DAYS LATER`;
}

export function formatDurationMinutes(minutes: number | null | undefined): string | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return null;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hours <= 0) return `${mins}m`;
  return `${hours}h ${String(mins).padStart(2, "0")}m`;
}

export function formatDisplayDate(isoDate: string): string {
  const date = parseIsoDate(assertIsoDate(isoDate));
  if (!date) return isoDate;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function formatDaysUntil(isoDate: string, today: string): string {
  const days = dateOffsetDays(today, isoDate);
  if (days < 0) return "Travel date passed";
  if (days === 0) return "Travels today";
  if (days === 1) return "Travels tomorrow";
  return `Departs in ${days} days`;
}

export function daysUntilFlap(isoDate: string, today: string): string {
  const days = dateOffsetDays(today, isoDate);
  if (days < 0) return "PASSED";
  if (days === 0) return "TODAY";
  if (days === 1) return "1 DAY";
  return `${days} DAYS`;
}

export function formatDisplayDateLong(isoDate: string): string {
  const date = parseIsoDate(assertIsoDate(isoDate));
  if (!date) return isoDate;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}
