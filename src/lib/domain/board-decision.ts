import { dateBadge, formatDisplayDate, formatDurationMinutes } from "./calendar";
import { formatUsdCompact } from "./money";
import { formatClock } from "./timezone";
import type { RankedCandidate } from "./types";

export function normalizeTrainNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/[^0-9]/g, "");
  return digits.length > 0 ? digits.replace(/^0+/, "") || "0" : null;
}

export function findBookedCandidate(
  ranked: RankedCandidate[],
  bookedTrainNumber: string | null | undefined,
  desiredTravelDate?: string,
): RankedCandidate | null {
  const wanted = normalizeTrainNumber(bookedTrainNumber);
  if (!wanted) return null;
  const matches = ranked.filter(
    (candidate) => normalizeTrainNumber(candidate.journey.trainNumber) === wanted,
  );
  if (matches.length === 0) return null;
  const sameDay = desiredTravelDate
    ? matches.filter((candidate) => candidate.journey.searchedTravelDate === desiredTravelDate)
    : [];
  const pool = sameDay.length > 0 ? sameDay : matches;
  return pool.reduce((best, item) =>
    item.totalPartyPriceCents < best.totalPartyPriceCents ? item : best,
  );
}

export function sameDayCheapest(
  ranked: RankedCandidate[],
  desiredTravelDate: string,
): RankedCandidate | null {
  const sameDay = ranked.filter(
    (candidate) => candidate.journey.searchedTravelDate === desiredTravelDate,
  );
  return sameDay[0] ?? null;
}

export function durationDeltaMinutes(from: RankedCandidate, to: RankedCandidate): number | null {
  if (from.journey.durationMinutes == null || to.journey.durationMinutes == null) return null;
  return to.journey.durationMinutes - from.journey.durationMinutes;
}

export function formatDurationDelta(minutes: number | null): string | null {
  if (minutes == null || minutes === 0) return null;
  const abs = Math.abs(minutes);
  const label = abs >= 60 ? formatDurationMinutes(abs) : `${abs}m`;
  if (!label) return null;
  return minutes < 0 ? `${label} faster` : `${label} longer`;
}

export function windowInsight(
  byDate: Array<[string, RankedCandidate]>,
  desiredTravelDate: string,
): string | null {
  const desired = byDate.find(([date]) => date === desiredTravelDate)?.[1];
  if (!desired) return null;
  let best: RankedCandidate | null = null;
  let bestDate: string | null = null;
  for (const [date, candidate] of byDate) {
    if (!best || candidate.totalPartyPriceCents < best.totalPartyPriceCents) {
      best = candidate;
      bestDate = date;
    }
  }
  if (!best || !bestDate || bestDate === desiredTravelDate) {
    return "Your travel day is the cheapest date in this window.";
  }
  const save = desired.totalPartyPriceCents - best.totalPartyPriceCents;
  if (save <= 0) return null;
  const badge = dateBadge(
    best.dateOffsetDays !== 0 ? best.dateOffsetDays : bestDate < desiredTravelDate ? -1 : 1,
  ).toLowerCase();
  return `${formatDisplayDate(bestDate)} is ${formatUsdCompact(save)} cheaper than your travel day (${badge}).`;
}

export function closestToPreferred(ranked: RankedCandidate[]): RankedCandidate | null {
  const timed = ranked.filter((candidate) => candidate.preferredTimeDeltaMinutes != null);
  if (timed.length === 0) return null;
  return timed.reduce((best, item) =>
    (item.preferredTimeDeltaMinutes ?? Number.MAX_SAFE_INTEGER) <
    (best.preferredTimeDeltaMinutes ?? Number.MAX_SAFE_INTEGER)
      ? item
      : best,
  );
}

export function trainLabel(candidate: RankedCandidate): string {
  return `${candidate.journey.serviceName ?? "Amtrak"} ${candidate.journey.trainNumber ?? ""}`.trim();
}

export function decisionBrief(input: {
  originCode: string;
  destinationCode: string;
  desiredTravelDate: string;
  bookedCents: number;
  bookedTrainNumber: string | null;
  best: RankedCandidate | null;
  yours: RankedCandidate | null;
  sameDay: RankedCandidate | null;
}): string {
  const lines = [
    `${input.originCode} → ${input.destinationCode} · ${formatDisplayDate(input.desiredTravelDate)} · you paid ${formatUsdCompact(input.bookedCents)}.`,
  ];
  if (!input.best) {
    lines.push("No listed trains on the board yet.");
    return lines.join(" ");
  }
  lines.push(
    `Cheapest listed: ${trainLabel(input.best)} at ${formatClock(input.best.journey.departureAt)}, ${formatUsdCompact(input.best.totalPartyPriceCents)}${input.best.savingsCents > 0 ? ` (save ${formatUsdCompact(input.best.savingsCents)})` : ""}. ${dateBadge(input.best.dateOffsetDays)}.`,
  );
  if (input.yours && candidateIsSame(input.yours, input.best)) {
    lines.push("Your train is the cheapest listed option right now.");
  } else if (input.yours) {
    const extra = input.yours.totalPartyPriceCents - input.best.totalPartyPriceCents;
    const time = formatDurationDelta(durationDeltaMinutes(input.best, input.yours));
    lines.push(
      `Your train ${input.bookedTrainNumber} is listed at ${formatUsdCompact(input.yours.totalPartyPriceCents)}${extra > 0 ? ` — ${formatUsdCompact(extra)} more than the cheapest` : ""}${time ? `, ${time}` : ""}.`,
    );
  } else if (input.bookedTrainNumber) {
    lines.push(`Train ${input.bookedTrainNumber} is not on this live board.`);
  }
  if (
    input.sameDay &&
    input.best &&
    !candidateIsSame(input.sameDay, input.best) &&
    input.sameDay.savingsCents > 0
  ) {
    lines.push(
      `Same day cheapest: ${trainLabel(input.sameDay)} at ${formatUsdCompact(input.sameDay.totalPartyPriceCents)}.`,
    );
  }
  lines.push("Listed fare — confirm on Amtrak before you change anything.");
  return lines.join(" ");
}

export function friendText(input: {
  originCode: string;
  destinationCode: string;
  desiredTravelDate: string;
  bookedCents: number;
  best: RankedCandidate | null;
}): string {
  if (!input.best) {
    return `RailDrop ${input.originCode} → ${input.destinationCode} ${formatDisplayDate(input.desiredTravelDate)}: no listed trains yet. You paid ${formatUsdCompact(input.bookedCents)}.`;
  }
  return `RailDrop ${input.originCode} → ${input.destinationCode} ${formatDisplayDate(input.desiredTravelDate)}: cheapest listed ${formatUsdCompact(input.best.totalPartyPriceCents)} on ${trainLabel(input.best)} at ${formatClock(input.best.journey.departureAt)}. You paid ${formatUsdCompact(input.bookedCents)}. Confirm on Amtrak before changing anything.`;
}

export function candidateIsSame(a: RankedCandidate, b: RankedCandidate): boolean {
  return a.journey.id === b.journey.id && a.fare.id === b.fare.id;
}

function icsStamp(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!match) return iso.replace(/[-:]/g, "").slice(0, 15);
  return `${match[1]}${match[2]}${match[3]}T${match[4]}${match[5]}00`;
}

function icsEscape(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\n", "\\n");
}

export function calendarIcs(candidate: RankedCandidate): string {
  const summary = icsEscape(
    `${trainLabel(candidate)} ${candidate.journey.originCode} → ${candidate.journey.destinationCode}`,
  );
  const description = icsEscape(
    `Listed ${formatUsdCompact(candidate.totalPartyPriceCents)}. Confirm on Amtrak. RailDrop is not a ticket.`,
  );
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//RailDrop//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `DTSTART:${icsStamp(candidate.journey.departureAt)}`,
    `DTEND:${icsStamp(candidate.journey.arrivalAt)}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${icsEscape(`${candidate.journey.originCode} to ${candidate.journey.destinationCode}`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
