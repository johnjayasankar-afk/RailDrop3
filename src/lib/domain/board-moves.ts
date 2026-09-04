import { formatDisplayDate } from "./calendar";
import { formatUsdCompact } from "./money";
import { normalizeTrainNumber } from "./board-decision";
import type { FareFamily, RankedCandidate } from "./types";

export type MoveKind = "drop" | "rise" | "new";

export interface BoardMove {
  key: string;
  train: string;
  date: string;
  kind: MoveKind;
  previousCents: number | null;
  currentCents: number;
  deltaCents: number;
}

export function journeyIdentity(candidate: RankedCandidate): string {
  const train =
    normalizeTrainNumber(candidate.journey.trainNumber) ?? candidate.journey.departureAt;
  return [
    candidate.journey.searchedTravelDate,
    train,
    candidate.journey.originCode,
    candidate.journey.destinationCode,
  ].join("|");
}

export function cheapestByIdentity(ranked: RankedCandidate[]): Map<string, RankedCandidate> {
  const map = new Map<string, RankedCandidate>();
  for (const candidate of ranked) {
    const key = journeyIdentity(candidate);
    const existing = map.get(key);
    if (!existing || candidate.totalPartyPriceCents < existing.totalPartyPriceCents) {
      map.set(key, candidate);
    }
  }
  return map;
}

export function boardMoves(previous: RankedCandidate[], current: RankedCandidate[]): BoardMove[] {
  const before = cheapestByIdentity(previous);
  const after = cheapestByIdentity(current);
  const moves: BoardMove[] = [];
  for (const [key, now] of after) {
    const then = before.get(key);
    const train = `${now.journey.serviceName ?? "Train"} ${now.journey.trainNumber ?? ""}`.trim();
    if (!then) {
      moves.push({
        key,
        train,
        date: now.journey.searchedTravelDate,
        kind: "new",
        previousCents: null,
        currentCents: now.totalPartyPriceCents,
        deltaCents: 0,
      });
      continue;
    }
    const delta = then.totalPartyPriceCents - now.totalPartyPriceCents;
    if (delta === 0) continue;
    moves.push({
      key,
      train,
      date: now.journey.searchedTravelDate,
      kind: delta > 0 ? "drop" : "rise",
      previousCents: then.totalPartyPriceCents,
      currentCents: now.totalPartyPriceCents,
      deltaCents: delta,
    });
  }
  return moves.sort((a, b) => {
    if (a.kind === "drop" && b.kind !== "drop") return -1;
    if (b.kind === "drop" && a.kind !== "drop") return 1;
    return Math.abs(b.deltaCents) - Math.abs(a.deltaCents);
  });
}

export function moveLabel(move: BoardMove): string {
  const when = formatDisplayDate(move.date);
  if (move.kind === "new") {
    return `${move.train} appeared on ${when} at ${formatUsdCompact(move.currentCents)}`;
  }
  const verb = move.kind === "drop" ? "dropped" : "rose";
  return `${move.train} ${verb} ${formatUsdCompact(Math.abs(move.deltaCents))} on ${when} · now ${formatUsdCompact(move.currentCents)}`;
}

export type UrgencyLevel = "passed" | "now" | "soon" | "watch";

export function travelUrgency(daysUntil: number): { level: UrgencyLevel; copy: string } {
  if (daysUntil < 0) {
    return { level: "passed", copy: "Travel date passed." };
  }
  if (daysUntil <= 1) {
    return {
      level: "now",
      copy: "Travels today or tomorrow — confirm on Amtrak if you switch.",
    };
  }
  if (daysUntil <= 5) {
    return {
      level: "soon",
      copy: "Five days or fewer.",
    };
  }
  return {
    level: "watch",
    copy: "Time to wait for a real drop.",
  };
}

export function hassleNote(input: {
  savingsCents: number;
  minimumSavingsCents: number;
  daysUntil: number;
}): string | null {
  if (input.savingsCents <= 0) return null;
  if (input.savingsCents < input.minimumSavingsCents) {
    return `This listed save is below your ${formatUsdCompact(input.minimumSavingsCents)} alert threshold.`;
  }
  if (input.daysUntil <= 2 && input.savingsCents < 2500) {
    return "A small save this close to departure may not be worth changing a ticket. Confirm fees on Amtrak.";
  }
  if (input.savingsCents >= 5000) {
    return "This is a meaningful listed drop — still confirm the ticket and any change rules on Amtrak.";
  }
  return null;
}

export function changeRuleNote(family: FareFamily): string {
  switch (family) {
    case "FLEXIBLE":
      return "Flexible is usually easiest to change. We never calculate Amtrak fees.";
    case "VALUE":
      return "Value often has change fees — confirm on Amtrak.";
    case "SAVER":
      return "Saver is often restrictive. Confirm you can change it on Amtrak.";
    default:
      return "Change rules depend on the fare you bought. Confirm on Amtrak.";
  }
}

export function monitorRemaining(
  endAtIso: string | null,
  now = new Date(),
): {
  label: string;
  percent: number;
} | null {
  if (!endAtIso) return { label: "Watching until departure", percent: 100 };
  const end = new Date(endAtIso).getTime();
  if (Number.isNaN(end)) return null;
  const left = end - now.getTime();
  if (left <= 0) return { label: "Monitoring window ended", percent: 0 };
  const hours = Math.round(left / 3_600_000);
  if (hours < 24) {
    return {
      label: `Watching for ${Math.max(1, hours)} more hour${hours === 1 ? "" : "s"}`,
      percent: Math.min(100, (hours / 48) * 100),
    };
  }
  const days = Math.round(hours / 24);
  return {
    label: `Watching for ${days} more day${days === 1 ? "" : "s"}`,
    percent: Math.min(100, (days / 14) * 100),
  };
}

export function durationShare(minutes: number | null, maxMinutes: number): number {
  if (minutes == null || maxMinutes <= 0) return 0;
  return Math.min(100, Math.max(8, Math.round((minutes / maxMinutes) * 100)));
}
