import { CHECK_SLOTS, type CheckSlot } from "./types";

export const DEFAULT_TIMEZONE = "America/New_York";
export const SLOT_HOURS: Record<CheckSlot, number> = {
  MORNING: 8,
  AFTERNOON: 14,
  EVENING: 20,
};

export interface ZonedDateTime {
  timeZone: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  isoDate: string;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function zonedDateTime(instant: Date, timeZone: string): ZonedDateTime {
  if (!isValidTimeZone(timeZone)) {
    throw new Error(`Invalid IANA timezone: ${timeZone}`);
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);

  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;

  const year = Number(read("year"));
  const month = Number(read("month"));
  const day = Number(read("day"));
  const hour = Number(read("hour"));
  const minute = Number(read("minute"));

  return {
    timeZone,
    year,
    month,
    day,
    hour,
    minute,
    isoDate: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

export function localIsoDate(instant: Date, timeZone: string): string {
  return zonedDateTime(instant, timeZone).isoDate;
}

export function dueSlotsAt(
  instant: Date,
  timeZone: string,
): Array<{ slot: CheckSlot; localDate: string }> {
  const local = zonedDateTime(instant, timeZone);
  const due: Array<{ slot: CheckSlot; localDate: string }> = [];

  for (const slot of CHECK_SLOTS) {
    const slotHour = SLOT_HOURS[slot];
    if (local.hour > slotHour || (local.hour === slotHour && local.minute >= 0)) {
      due.push({ slot, localDate: local.isoDate });
    }
  }

  return due;
}

export function nextSlotAfter(
  instant: Date,
  timeZone: string,
): { slot: CheckSlot; localDate: string; label: string } {
  const local = zonedDateTime(instant, timeZone);
  for (const slot of CHECK_SLOTS) {
    if (local.hour < SLOT_HOURS[slot]) {
      return {
        slot,
        localDate: local.isoDate,
        label: formatSlotLabel(slot),
      };
    }
  }

  const tomorrow = addLocalDays(local.isoDate, 1);
  return {
    slot: "MORNING",
    localDate: tomorrow,
    label: formatSlotLabel("MORNING"),
  };
}

export function formatSlotLabel(slot: CheckSlot): string {
  const hour = SLOT_HOURS[slot];
  const suffix = hour >= 12 ? "PM" : "AM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:00 ${suffix}`;
}

export function addLocalDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function parsePreferredTime(value: string | null | undefined): {
  hour: number;
  minute: number;
} | null {
  if (!value) return null;
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function minutesFromMidnight(isoDateTime: string): number | null {
  const date = new Date(isoDateTime);
  if (Number.isNaN(date.getTime())) return null;
  const match = /T(\d{2}):(\d{2})/.exec(isoDateTime);
  if (match) {
    return Number(match[1]) * 60 + Number(match[2]);
  }
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

export function preferredTimeDeltaMinutes(
  departureAt: string,
  preferredTime: string | null | undefined,
): number | null {
  const preferred = parsePreferredTime(preferredTime);
  if (!preferred) return null;
  const departureMinutes = minutesFromMidnight(departureAt);
  if (departureMinutes === null) return null;
  return Math.abs(departureMinutes - (preferred.hour * 60 + preferred.minute));
}

export function formatBoardStamp(iso: string | null | undefined, timeZone: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatClock(isoDateTime: string): string {
  const match = /T(\d{2}):(\d{2})/.exec(isoDateTime);
  if (!match) {
    const date = new Date(isoDateTime);
    if (Number.isNaN(date.getTime())) return isoDateTime;
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }
  const hour = Number(match[1]);
  const minute = match[2];
  const suffix = hour >= 12 ? "PM" : "AM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${minute} ${suffix}`;
}
