import { formatDurationMinutes, formatDisplayDate } from "@/lib/domain/calendar";
import { formatUsdCompact } from "@/lib/domain/money";
import { minutesFromMidnight } from "@/lib/domain/timezone";
import type { RankedCandidate } from "@/lib/domain/types";

export type TimeBucket = "morning" | "afternoon" | "evening";
export type BoardSort = "rank" | "price" | "depart" | "duration" | "savings";
export type ServiceFilter = "all" | "regional" | "acela" | "direct";

export function departureBucket(departureAt: string): TimeBucket {
  const minutes = minutesFromMidnight(departureAt) ?? 0;
  const hour = Math.floor(minutes / 60);
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

export function isAcela(candidate: RankedCandidate): boolean {
  const name = `${candidate.journey.serviceName ?? ""} ${candidate.journey.trainNumber ?? ""}`;
  return /acela/i.test(name);
}

export function savingsPercent(bookedCents: number, foundCents: number): number | null {
  if (bookedCents <= 0 || foundCents >= bookedCents) return null;
  return Math.round(((bookedCents - foundCents) / bookedCents) * 100);
}

export function centsPerHour(priceCents: number, durationMinutes: number | null): number | null {
  if (durationMinutes == null || durationMinutes <= 0) return null;
  return Math.round(priceCents / (durationMinutes / 60));
}

export function filterBoard(
  ranked: RankedCandidate[],
  input: {
    dateFilter: string | "all";
    service: ServiceFilter;
    bucket: TimeBucket | "all";
    savingsOnly: boolean;
    departAfter?: string | null;
    arriveBefore?: string | null;
    maxDuration?: number | null;
  },
): RankedCandidate[] {
  return ranked.filter((candidate) => {
    if (input.dateFilter !== "all" && candidate.journey.searchedTravelDate !== input.dateFilter) {
      return false;
    }
    if (input.service === "acela" && !isAcela(candidate)) return false;
    if (input.service === "regional" && isAcela(candidate)) return false;
    if (input.service === "direct" && candidate.journey.transferCount > 0) return false;
    if (input.bucket !== "all" && departureBucket(candidate.journey.departureAt) !== input.bucket) {
      return false;
    }
    if (input.savingsOnly && candidate.savingsCents <= 0) return false;
    const after = input.departAfter?.trim();
    const before = input.arriveBefore?.trim();
    if (after) {
      const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(after);
      const depart = minutesFromMidnight(candidate.journey.departureAt);
      if (!match || depart == null || depart < Number(match[1]) * 60 + Number(match[2])) {
        return false;
      }
    }
    if (before) {
      const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(before);
      const arrive = minutesFromMidnight(candidate.journey.arrivalAt);
      if (!match || arrive == null || arrive > Number(match[1]) * 60 + Number(match[2])) {
        return false;
      }
    }
    if (
      input.maxDuration != null &&
      candidate.journey.durationMinutes != null &&
      candidate.journey.durationMinutes > input.maxDuration
    ) {
      return false;
    }
    return true;
  });
}

export function sortBoard(ranked: RankedCandidate[], sort: BoardSort): RankedCandidate[] {
  if (sort === "rank") return [...ranked];
  const copy = [...ranked];
  copy.sort((a, b) => {
    if (sort === "price") return a.totalPartyPriceCents - b.totalPartyPriceCents;
    if (sort === "depart") return a.journey.departureAt.localeCompare(b.journey.departureAt);
    if (sort === "duration") {
      return (a.journey.durationMinutes ?? 9999) - (b.journey.durationMinutes ?? 9999);
    }
    if (sort === "savings") return b.savingsCents - a.savingsCents;
    return a.rankScore - b.rankScore;
  });
  return copy;
}

export function boardCsv(ranked: RankedCandidate[]): string {
  const rows = [
    ["Date", "Depart", "Arrive", "Train", "Duration", "Price", "Savings", "Service"].join(","),
  ];
  for (const candidate of ranked) {
    const train =
      `${candidate.journey.serviceName ?? "Amtrak"} ${candidate.journey.trainNumber ?? ""}`.trim();
    rows.push(
      [
        formatDisplayDate(candidate.journey.searchedTravelDate),
        candidate.journey.departureAt,
        candidate.journey.arrivalAt,
        `"${train.replaceAll('"', '""')}"`,
        formatDurationMinutes(candidate.journey.durationMinutes) ?? "",
        formatUsdCompact(candidate.totalPartyPriceCents),
        candidate.savingsCents > 0 ? formatUsdCompact(candidate.savingsCents) : "0",
        candidate.journey.serviceType,
      ].join(","),
    );
  }
  return `${rows.join("\n")}\n`;
}

export function candidateKey(candidate: RankedCandidate): string {
  return `${candidate.journey.id}:${candidate.fare.id}`;
}
