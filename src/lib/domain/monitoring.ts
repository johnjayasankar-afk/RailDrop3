import { compareIsoDates, generateSearchDates, type DateFlexibilityDays } from "./calendar";
import { localIsoDate } from "./timezone";
import type { MonitorPreset } from "./types";

export const MONITOR_PRESET_HOURS: Record<
  Exclude<MonitorPreset, "until_departure" | "custom">,
  number
> = {
  "24h": 24,
  "48h": 48,
  "72h": 72,
};

export interface MonitoringWindow {
  startAt: Date;
  endAt: Date | null;
  preset: MonitorPreset;
}

export function resolveMonitoringWindow(input: {
  bookedAt: Date;
  preset: MonitorPreset;
  customEndAt?: Date | null;
  desiredTravelDate: string;
  flexibilityDays: DateFlexibilityDays;
  timeZone: string;
}): MonitoringWindow {
  const startAt = input.bookedAt;
  if (input.preset === "custom") {
    if (!input.customEndAt) {
      throw new Error("custom monitoring requires customEndAt");
    }
    return { startAt, endAt: input.customEndAt, preset: "custom" };
  }
  if (input.preset === "until_departure") {
    const window = generateSearchDates(
      input.desiredTravelDate,
      input.flexibilityDays,
      localIsoDate(startAt, input.timeZone),
    );
    const lastDate = window.dates[window.dates.length - 1] ?? input.desiredTravelDate;
    return {
      startAt,
      endAt: endOfLocalDate(lastDate, input.timeZone),
      preset: "until_departure",
    };
  }
  const hours = MONITOR_PRESET_HOURS[input.preset];
  return {
    startAt,
    endAt: new Date(startAt.getTime() + hours * 60 * 60 * 1000),
    preset: input.preset,
  };
}

export function shouldCompleteWatch(input: {
  now: Date;
  monitorEndAt: Date | null;
  desiredTravelDate: string;
  flexibilityDays: DateFlexibilityDays;
  timeZone: string;
}): boolean {
  if (input.monitorEndAt && input.now.getTime() >= input.monitorEndAt.getTime()) {
    return true;
  }
  const today = localIsoDate(input.now, input.timeZone);
  const remaining = generateSearchDates(
    input.desiredTravelDate,
    input.flexibilityDays,
    today,
  ).dates;
  return remaining.length === 0;
}

export function usableSearchDates(input: {
  now: Date;
  desiredTravelDate: string;
  flexibilityDays: DateFlexibilityDays;
  timeZone: string;
}): string[] {
  return generateSearchDates(
    input.desiredTravelDate,
    input.flexibilityDays,
    localIsoDate(input.now, input.timeZone),
  ).dates;
}

export function earliestCutoffIso(dates: string[]): string | null {
  if (dates.length === 0) return null;
  return [...dates].sort(compareIsoDates)[0] ?? null;
}

function endOfLocalDate(isoDate: string, timeZone: string): Date {
  const probe = new Date(`${isoDate}T23:59:59.000Z`);
  const offsetGuess = localOffsetMs(probe, timeZone);
  return new Date(Date.parse(`${isoDate}T23:59:59.000Z`) - offsetGuess);
}

function localOffsetMs(instant: Date, timeZone: string): number {
  const local = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(local.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second"),
  );
  return asUtc - instant.getTime();
}
