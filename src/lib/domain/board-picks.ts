import type { WatchRecord } from "@/lib/db/models";
import { candidateKey, isAcela } from "@/lib/domain/board-tools";
import {
  candidateIsSame,
  durationDeltaMinutes,
  formatDurationDelta,
  trainLabel,
} from "@/lib/domain/board-decision";
import { formatUsdCompact } from "@/lib/domain/money";
import { formatDisplayDate } from "@/lib/domain/calendar";
import { formatClock } from "@/lib/domain/timezone";
import { netAfterFee } from "@/lib/domain/board-act";
import type { RankedCandidate } from "@/lib/domain/types";

export function perPersonCents(totalCents: number, passengerCount: number): number | null {
  if (passengerCount <= 1 || totalCents <= 0) return null;
  return Math.round(totalCents / passengerCount);
}

export type DecisionPickKind = "cheapest" | "fastest" | "preferred" | "yours" | "direct";

export function decisionPicks(input: {
  best: RankedCandidate | null | undefined;
  fastest: RankedCandidate | null;
  preferred: RankedCandidate | null;
  yours: RankedCandidate | null;
  direct: RankedCandidate | null;
}): Array<{ kind: DecisionPickKind; label: string; candidate: RankedCandidate }> {
  const picks: Array<{ kind: DecisionPickKind; label: string; candidate: RankedCandidate }> = [];
  if (input.best) picks.push({ kind: "cheapest", label: "Cheapest", candidate: input.best });
  if (input.fastest) {
    picks.push({ kind: "fastest", label: "Fastest cheaper", candidate: input.fastest });
  }
  if (input.direct && (!input.best || candidateKey(input.direct) !== candidateKey(input.best))) {
    picks.push({ kind: "direct", label: "Cheapest direct", candidate: input.direct });
  }
  if (input.preferred) {
    picks.push({ kind: "preferred", label: "Closest to preferred", candidate: input.preferred });
  }
  if (input.yours) picks.push({ kind: "yours", label: "Your train", candidate: input.yours });
  return picks;
}

export function cheapestDirect(ranked: RankedCandidate[]): RankedCandidate | null {
  const direct = ranked.filter((candidate) => candidate.journey.transferCount === 0);
  if (direct.length === 0) return null;
  return direct.reduce((best, item) =>
    item.totalPartyPriceCents < best.totalPartyPriceCents ? item : best,
  );
}

export function acelaContrast(ranked: RankedCandidate[]): {
  acela: RankedCandidate;
  regional: RankedCandidate;
  extraCents: number;
  fasterMinutes: number | null;
} | null {
  const acelaList = ranked.filter(isAcela);
  const regionalList = ranked.filter(
    (candidate) => !isAcela(candidate) && candidate.journey.transferCount === 0,
  );
  if (acelaList.length === 0 || regionalList.length === 0) return null;
  const acela = acelaList.reduce((best, item) =>
    item.totalPartyPriceCents < best.totalPartyPriceCents ? item : best,
  );
  const regional = regionalList.reduce((best, item) =>
    item.totalPartyPriceCents < best.totalPartyPriceCents ? item : best,
  );
  const faster =
    acela.journey.durationMinutes != null && regional.journey.durationMinutes != null
      ? regional.journey.durationMinutes - acela.journey.durationMinutes
      : null;
  return {
    acela,
    regional,
    extraCents: acela.totalPartyPriceCents - regional.totalPartyPriceCents,
    fasterMinutes: faster,
  };
}

export function withPinnedVisible<T>(
  items: T[],
  limit: number | null,
  pinnedKeys: string[],
  keyOf: (item: T) => string,
): T[] {
  const shown = limit == null ? items : items.slice(0, limit);
  if (pinnedKeys.length === 0) return shown;
  const shownKeys = new Set(shown.map(keyOf));
  const extras = items.filter(
    (item) => pinnedKeys.includes(keyOf(item)) && !shownKeys.has(keyOf(item)),
  );
  return extras.length === 0 ? shown : [...shown, ...extras];
}

export function optionAnchor(candidate: RankedCandidate): string {
  return `opt-${candidateKey(candidate)}`;
}

export function beatsBooked(candidate: RankedCandidate, yours: RankedCandidate): boolean {
  if (candidateIsSame(candidate, yours)) return false;
  const save = yours.totalPartyPriceCents - candidate.totalPartyPriceCents;
  const yoursDur = yours.journey.durationMinutes;
  const candDur = candidate.journey.durationMinutes;
  const faster = yoursDur == null || candDur == null ? 0 : yoursDur - candDur;
  if (save > 0 && faster >= 0) return true;
  if (save >= 0 && faster > 0) return true;
  return false;
}

export function trainsThatBeat(
  ranked: RankedCandidate[],
  yours: RankedCandidate | null,
): RankedCandidate[] {
  if (!yours) return [];
  return ranked
    .filter((candidate) => beatsBooked(candidate, yours))
    .sort((a, b) => a.totalPartyPriceCents - b.totalPartyPriceCents)
    .slice(0, 4);
}

export function beatNote(candidate: RankedCandidate, yours: RankedCandidate): string {
  const save = yours.totalPartyPriceCents - candidate.totalPartyPriceCents;
  const parts: string[] = [];
  if (save > 0) parts.push(`${formatUsdCompact(save)} cheaper`);
  else if (save === 0) parts.push("same price");
  const time = formatDurationDelta(durationDeltaMinutes(yours, candidate));
  if (time) parts.push(time);
  else if (save > 0) parts.push("same ride");
  return parts.join(" · ");
}

export function compareFocus(
  focused: RankedCandidate,
  bookedCents: number,
  yours: RankedCandidate | null,
): {
  saveCents: number;
  beats: boolean;
  vsYours: string | null;
} {
  return {
    saveCents: bookedCents - focused.totalPartyPriceCents,
    beats: yours ? beatsBooked(focused, yours) : false,
    vsYours: yours ? beatNote(focused, yours) : null,
  };
}

export function compareLine(input: {
  originCode: string;
  destinationCode: string;
  desiredTravelDate: string;
  bookedCents: number;
  focused: RankedCandidate;
}): string {
  const save = input.bookedCents - input.focused.totalPartyPriceCents;
  const vs =
    save > 0
      ? `save ${formatUsdCompact(save)}`
      : save < 0
        ? `${formatUsdCompact(-save)} more than you paid`
        : "same as you paid";
  return [
    `RailDrop ${input.originCode} → ${input.destinationCode} ${formatDisplayDate(input.desiredTravelDate)}.`,
    `You paid ${formatUsdCompact(input.bookedCents)}.`,
    `This: ${trainLabel(input.focused)} ${formatClock(input.focused.journey.departureAt)} ${formatUsdCompact(input.focused.totalPartyPriceCents)} · ${vs}.`,
    "Confirm on Amtrak before changing anything.",
  ].join(" ");
}

export function feeCeilingNote(saveCents: number): string | null {
  if (saveCents <= 0) return null;
  return `This listed save covers a change fee under ${formatUsdCompact(saveCents)}. Confirm the real fee on Amtrak.`;
}

export function windowStrip(input: {
  originCode: string;
  destinationCode: string;
  bookedCents: number;
  days: Array<{ date: string; candidate: RankedCandidate | null }>;
}): string {
  const parts = [
    `RailDrop ${input.originCode} → ${input.destinationCode}. You paid ${formatUsdCompact(input.bookedCents)}.`,
  ];
  for (const day of input.days) {
    if (!day.candidate) {
      parts.push(`${formatDisplayDate(day.date)} —`);
      continue;
    }
    parts.push(
      `${formatDisplayDate(day.date)} ${trainLabel(day.candidate)} ${formatClock(day.candidate.journey.departureAt)} ${formatUsdCompact(day.candidate.totalPartyPriceCents)}`,
    );
  }
  parts.push("Confirm on Amtrak before changing anything.");
  return parts.join(" ");
}

export type SwitchVerdictKind = "switch" | "look" | "keep";

export function switchVerdict(input: {
  best: RankedCandidate | null;
  yours: RankedCandidate | null;
  feeCents: number;
}): { kind: SwitchVerdictKind; label: string; copy: string } {
  if (!input.best || input.best.savingsCents <= 0) {
    return {
      kind: "keep",
      label: "Keep your ticket",
      copy: "No cheaper listed fare — yet.",
    };
  }
  const net = netAfterFee(input.best.savingsCents, input.feeCents);
  if (net <= 0) {
    return {
      kind: "keep",
      label: "Keep for now",
      copy: "Fee estimate would wipe the listed save. Confirm on Amtrak.",
    };
  }
  if (input.yours && beatsBooked(input.best, input.yours)) {
    return {
      kind: "switch",
      label: "Look at switching",
      copy: "Cheaper and not slower than yours. Confirm on Amtrak.",
    };
  }
  return {
    kind: "look",
    label: "Look closer",
    copy: "Cheaper listed — check time and the real fee on Amtrak.",
  };
}

export function soonestWatch(watches: WatchRecord[], today: string): WatchRecord | null {
  const upcoming = watches
    .filter((watch) => watch.status === "ACTIVE" && watch.desiredTravelDate >= today)
    .sort(
      (a, b) =>
        a.desiredTravelDate.localeCompare(b.desiredTravelDate) ||
        a.originCode.localeCompare(b.originCode),
    );
  return upcoming[0] ?? null;
}

export function pairNote(left: RankedCandidate, right: RankedCandidate): string {
  const save = left.totalPartyPriceCents - right.totalPartyPriceCents;
  const time = formatDurationDelta(durationDeltaMinutes(left, right));
  const price =
    save > 0
      ? `${trainLabel(right)} is ${formatUsdCompact(save)} cheaper`
      : save < 0
        ? `${trainLabel(left)} is ${formatUsdCompact(-save)} cheaper`
        : "Same listed price";
  return [price, time].filter(Boolean).join(" · ");
}

export type WatchListSort = "drops" | "soonest" | "checked";

export function sortWatches(watches: WatchRecord[], sort: WatchListSort): WatchRecord[] {
  const copy = [...watches];
  if (sort === "soonest") {
    copy.sort(
      (a, b) =>
        a.desiredTravelDate.localeCompare(b.desiredTravelDate) ||
        a.originCode.localeCompare(b.originCode),
    );
  } else if (sort === "checked") {
    copy.sort((a, b) => (b.lastCheckedAt ?? "").localeCompare(a.lastCheckedAt ?? ""));
  } else {
    copy.sort((a, b) => (b.bestSavingsCents ?? 0) - (a.bestSavingsCents ?? 0));
  }
  return copy;
}

export function duplicateWatchIds(watches: WatchRecord[]): Set<string> {
  const groups = new Map<string, string[]>();
  for (const watch of watches) {
    const key = `${watch.originCode}|${watch.destinationCode}|${watch.desiredTravelDate}`;
    const list = groups.get(key) ?? [];
    list.push(watch.id);
    groups.set(key, list);
  }
  const ids = new Set<string>();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    for (const id of list) ids.add(id);
  }
  return ids;
}

export function roundTripPairs(watches: WatchRecord[]): Array<{
  outbound: WatchRecord;
  inbound: WatchRecord;
  savingsCents: number;
}> {
  const pairs: Array<{
    outbound: WatchRecord;
    inbound: WatchRecord;
    savingsCents: number;
  }> = [];
  const used = new Set<string>();
  for (const outbound of watches) {
    if (used.has(outbound.id)) continue;
    const inbound = watches.find(
      (watch) =>
        !used.has(watch.id) &&
        watch.id !== outbound.id &&
        watch.originCode === outbound.destinationCode &&
        watch.destinationCode === outbound.originCode,
    );
    if (!inbound) continue;
    used.add(outbound.id);
    used.add(inbound.id);
    pairs.push({
      outbound,
      inbound,
      savingsCents:
        Math.max(0, outbound.bestSavingsCents ?? 0) + Math.max(0, inbound.bestSavingsCents ?? 0),
    });
  }
  return pairs;
}
