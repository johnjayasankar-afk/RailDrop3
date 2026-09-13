import { formatDisplayDate, formatDurationMinutes, dateOffsetDays } from "./calendar";
import { formatUsdCompact } from "./money";
import { minutesFromMidnight, parsePreferredTime, formatClock } from "./timezone";
import { normalizeTrainNumber, trainLabel } from "./board-decision";
import { waitMinutes, isOvernight } from "./board-insights";
import { isCheckStale } from "./relative-time";
import type { RankedCandidate } from "./types";
import type { WatchRecord } from "@/lib/db/models";

export function sameTrainAcrossDates(
  ranked: RankedCandidate[],
  trainNumber: string | null | undefined,
  dates: string[],
): Array<{ date: string; candidate: RankedCandidate | null }> {
  const wanted = normalizeTrainNumber(trainNumber);
  if (!wanted || dates.length === 0) return [];
  return dates.map((date) => {
    const matches = ranked.filter(
      (candidate) =>
        candidate.journey.searchedTravelDate === date &&
        normalizeTrainNumber(candidate.journey.trainNumber) === wanted,
    );
    const candidate =
      matches.sort((a, b) => a.totalPartyPriceCents - b.totalPartyPriceCents)[0] ?? null;
    return { date, candidate };
  });
}

export function aroundMinutes(
  iso: string | null | undefined,
  hhmm: string | null | undefined,
): number | null {
  if (iso) {
    const minutes = minutesFromMidnight(iso);
    if (minutes != null) return minutes;
  }
  const preferred = parsePreferredTime(hhmm);
  if (!preferred) return null;
  return preferred.hour * 60 + preferred.minute;
}

export function neighborDepartures(
  ranked: RankedCandidate[],
  input: {
    travelDate: string;
    aroundIso?: string | null;
    preferredTime?: string | null;
    excludeId?: string | null;
    withinMinutes?: number;
  },
): RankedCandidate[] {
  const center = aroundMinutes(input.aroundIso, input.preferredTime);
  if (center == null) return [];
  const window = input.withinMinutes ?? 45;
  return ranked
    .filter((candidate) => {
      if (candidate.journey.searchedTravelDate !== input.travelDate) return false;
      if (input.excludeId && candidate.journey.id === input.excludeId) return false;
      const minutes = minutesFromMidnight(candidate.journey.departureAt);
      if (minutes == null) return false;
      const delta = Math.abs(minutes - center);
      return delta > 0 && delta <= window;
    })
    .sort((a, b) => a.totalPartyPriceCents - b.totalPartyPriceCents)
    .slice(0, 3);
}

export function netAfterFee(savingsCents: number, feeCents: number): number {
  return savingsCents - Math.max(0, feeCents);
}

export function feeNote(savingsCents: number, feeCents: number): string | null {
  if (feeCents <= 0) return null;
  const net = netAfterFee(savingsCents, feeCents);
  const fee = formatUsdCompact(feeCents);
  if (net > 0) {
    return `About ${formatUsdCompact(net)} after a ${fee} change fee — confirm the real fee on Amtrak.`;
  }
  if (net === 0) {
    return `A ${fee} change fee would wipe the listed savings. Confirm on Amtrak.`;
  }
  return `Listed save ${formatUsdCompact(savingsCents)} is less than a ${fee} fee. Confirm on Amtrak.`;
}

export function ladderPercent(value: number, min: number, max: number): number {
  if (max <= min) return 50;
  return Math.round(((value - min) / (max - min)) * 100);
}

export function priceLadder(
  ranked: RankedCandidate[],
  bookedCents: number,
): { min: number; max: number; booked: number; marks: number[] } {
  const prices = ranked
    .map((candidate) => candidate.totalPartyPriceCents)
    .filter((cents) => cents > 0);
  if (prices.length === 0) {
    return { min: bookedCents, max: Math.max(bookedCents, 1), booked: bookedCents, marks: [] };
  }
  const unique = [...new Set(prices)].sort((a, b) => a - b);
  return {
    min: Math.min(unique[0]!, bookedCents),
    max: Math.max(unique[unique.length - 1]!, bookedCents),
    booked: bookedCents,
    marks: unique.slice(0, 20),
  };
}

export function matchesTrainQuery(candidate: RankedCandidate, query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;
  const digits = normalizeTrainNumber(trimmed);
  const train = normalizeTrainNumber(candidate.journey.trainNumber);
  if (digits && train === digits) return true;
  const haystack = [
    candidate.journey.trainNumber ?? "",
    candidate.journey.serviceName ?? "",
    candidate.journey.originCode,
    candidate.journey.destinationCode,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(trimmed.toLowerCase());
}

export function cheaperOptionsText(input: {
  originCode: string;
  destinationCode: string;
  desiredTravelDate: string;
  bookedCents: number;
  cheaper: RankedCandidate[];
}): string {
  const header = `RailDrop ${input.originCode} → ${input.destinationCode} ${formatDisplayDate(input.desiredTravelDate)}. You paid ${formatUsdCompact(input.bookedCents)}.`;
  if (input.cheaper.length === 0) {
    return `${header} No cheaper listed trains right now. Confirm on Amtrak.`;
  }
  const lines = input.cheaper.slice(0, 5).map((candidate) => {
    const save =
      candidate.savingsCents > 0 ? ` save ${formatUsdCompact(candidate.savingsCents)}` : "";
    return `${trainLabel(candidate)} ${formatClock(candidate.journey.departureAt)} ${formatDisplayDate(candidate.journey.searchedTravelDate)} ${formatUsdCompact(candidate.totalPartyPriceCents)}${save}`;
  });
  return [header, ...lines, "Confirm on Amtrak before changing anything."].join("\n");
}

export function scanTone(status: string): "ok" | "warn" | "bad" | "run" {
  if (status === "SUCCESS" || status === "NO_AVAILABLE_ITINERARIES") return "ok";
  if (status === "PARTIAL_SUCCESS") return "warn";
  if (status === "RUNNING") return "run";
  return "bad";
}

export function passesSchedule(
  candidate: RankedCandidate,
  input: {
    departAfter?: string | null;
    arriveBefore?: string | null;
    maxDuration?: number | null;
  },
): boolean {
  const after = parsePreferredTime(input.departAfter);
  if (after) {
    const depart = minutesFromMidnight(candidate.journey.departureAt);
    if (depart == null || depart < after.hour * 60 + after.minute) return false;
  }
  const before = parsePreferredTime(input.arriveBefore);
  if (before) {
    const arrive = minutesFromMidnight(candidate.journey.arrivalAt);
    if (arrive == null || arrive > before.hour * 60 + before.minute) return false;
  }
  if (
    input.maxDuration != null &&
    candidate.journey.durationMinutes != null &&
    candidate.journey.durationMinutes > input.maxDuration
  ) {
    return false;
  }
  return true;
}

export function applyArriveBuffer(hhmm: string, extraMinutes: number): string {
  const parsed = parsePreferredTime(hhmm);
  if (!parsed || extraMinutes <= 0) return hhmm;
  const total = Math.max(0, parsed.hour * 60 + parsed.minute - extraMinutes);
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function decisionPacket(input: {
  brief: string;
  feeCopy: string | null;
  beats: RankedCandidate[];
}): string {
  const lines = [input.brief];
  if (input.feeCopy) lines.push(input.feeCopy);
  if (input.beats.length > 0) {
    lines.push(
      "Trains that beat yours (cheaper and not slower, or faster and not more expensive):",
    );
    for (const candidate of input.beats.slice(0, 4)) {
      const duration = formatDurationMinutes(candidate.journey.durationMinutes);
      lines.push(
        `  ${trainLabel(candidate)} ${formatClock(candidate.journey.departureAt)} ${formatUsdCompact(candidate.totalPartyPriceCents)}${duration ? ` · ${duration}` : ""}`,
      );
    }
  }
  lines.push("Confirm on Amtrak before changing anything.");
  return lines.join("\n\n");
}

export function missedBestNote(
  bestEverCents: number | null | undefined,
  bestNowCents: number | null | undefined,
): string | null {
  if (bestEverCents == null || bestNowCents == null || bestEverCents <= 0 || bestNowCents <= 0) {
    return null;
  }
  if (bestEverCents >= bestNowCents - 50) return null;
  return `Best listed this watch was ${formatUsdCompact(bestEverCents)} · now ${formatUsdCompact(bestNowCents)}.`;
}

export function itineraryText(candidate: RankedCandidate): string {
  const duration = formatDurationMinutes(candidate.journey.durationMinutes);
  const lines = [
    `${trainLabel(candidate)} · ${candidate.journey.originCode} → ${candidate.journey.destinationCode}`,
    `Depart ${formatClock(candidate.journey.departureAt)} ${formatDisplayDate(candidate.journey.searchedTravelDate)}`,
    `Arrive ${formatClock(candidate.journey.arrivalAt)}${duration ? ` · ${duration}` : ""}`,
  ];
  if (candidate.journey.legs.length >= 2) {
    for (let index = 0; index < candidate.journey.legs.length; index += 1) {
      const leg = candidate.journey.legs[index]!;
      const next = candidate.journey.legs[index + 1];
      const wait = next ? waitMinutes(leg.arrivalAt, next.departureAt) : null;
      lines.push(
        `  ${formatClock(leg.departureAt)} ${leg.serviceName ?? "Train"} ${leg.trainNumber ?? ""} ${leg.originCode} → ${leg.destinationCode} ${formatClock(leg.arrivalAt)}${wait != null ? ` · ${wait}m wait` : ""}`,
      );
    }
  }
  lines.push(
    `Listed ${formatUsdCompact(candidate.totalPartyPriceCents)}. Confirm on Amtrak before changing anything.`,
  );
  return lines.join("\n");
}

export function lastDeparture(ranked: RankedCandidate[]): RankedCandidate | null {
  if (ranked.length === 0) return null;
  return ranked.reduce((latest, item) =>
    item.journey.departureAt > latest.journey.departureAt ? item : latest,
  );
}

export function earliestDeparture(ranked: RankedCandidate[]): RankedCandidate | null {
  if (ranked.length === 0) return null;
  return ranked.reduce((earliest, item) =>
    item.journey.departureAt < earliest.journey.departureAt ? item : earliest,
  );
}

export function nextMatchingKey(
  keys: string[],
  current: string | null,
  wanted: Set<string>,
): string | null {
  if (wanted.size === 0 || keys.length === 0) return null;
  const start = current ? keys.indexOf(current) : -1;
  for (let step = 1; step <= keys.length; step += 1) {
    const key = keys[(Math.max(start, -1) + step) % keys.length];
    if (key && wanted.has(key)) return key;
  }
  return null;
}

export function amtrakFieldsText(candidate: RankedCandidate): string {
  return [
    `${candidate.journey.originCode} → ${candidate.journey.destinationCode}`,
    candidate.journey.searchedTravelDate,
    `${trainLabel(candidate)} · ${formatClock(candidate.journey.departureAt)}`,
    `Listed ${formatUsdCompact(candidate.totalPartyPriceCents)}`,
    "Confirm on Amtrak before changing anything.",
  ].join("\n");
}

export function arrivalDateNote(departureAt: string, arrivalAt: string): string | null {
  if (!isOvernight(departureAt, arrivalAt)) return null;
  const day = arrivalAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return `arrives ${formatDisplayDate(day)}`;
}

export function hasDeparted(
  travelDate: string,
  departureAt: string,
  today: string,
  nowMinutes: number | null,
): boolean {
  if (travelDate < today) return true;
  if (travelDate > today) return false;
  if (nowMinutes == null) return false;
  const depart = minutesFromMidnight(departureAt);
  return depart != null && depart < nowMinutes;
}

export function minutesUntilDepart(
  travelDate: string,
  departureAt: string,
  today: string,
  nowMinutes: number | null,
): number | null {
  if (nowMinutes == null || travelDate !== today) return null;
  const depart = minutesFromMidnight(departureAt);
  if (depart == null) return null;
  return depart - nowMinutes;
}

export type AttentionLevel = "soon" | "drop" | "stale" | "ok";

export function watchAttention(
  watch: WatchRecord,
  today: string,
): { level: AttentionLevel; label: string } {
  if (watch.status === "PAUSED") return { level: "ok", label: "Paused" };
  if (watch.status === "COMPLETED") return { level: "ok", label: "Ended" };
  const days = dateOffsetDays(today, watch.desiredTravelDate);
  if (days <= 1) return { level: "soon", label: "Act soon" };
  if ((watch.bestSavingsCents ?? 0) > 0) return { level: "drop", label: "Drop found" };
  if (isCheckStale(watch.lastCheckedAt)) return { level: "stale", label: "Stale board" };
  return { level: "ok", label: "Watching" };
}
