import { createWatchSchema, type CreateWatchInput } from "@/lib/validation/watch";
import { resolveMonitoringWindow } from "@/lib/domain/monitoring";
import { nextSlotAfter } from "@/lib/domain/timezone";
import type { WatchRecord } from "@/lib/db/models";
import type { RailDropRepository } from "@/lib/db/repository";
import type { FareProvider } from "@/lib/providers/fare-provider";
import type { Mailer } from "@/lib/notifications/send-alert";
import { runWatchCycle } from "@/lib/orchestration/check-cycle";
import { isValidTimeZone } from "@/lib/domain/timezone";
import { generateSearchDates } from "@/lib/domain/calendar";
import { localIsoDate } from "@/lib/domain/timezone";

export async function createWatchAndScan(input: {
  userId: string;
  email: string;
  body: unknown;
  repo: RailDropRepository;
  provider: FareProvider;
  mailer?: Mailer;
  now?: Date;
}) {
  const parsed: CreateWatchInput = createWatchSchema.parse(input.body);
  if (parsed.originCode === parsed.destinationCode) {
    throw new Error("Origin and destination must differ");
  }
  if (!isValidTimeZone(parsed.timezone)) {
    throw new Error("Invalid timezone");
  }

  const now = input.now ?? new Date();
  const today = localIsoDate(now, parsed.timezone);
  const window = generateSearchDates(parsed.desiredTravelDate, parsed.dateFlexibilityDays, today);
  if (window.dates.length === 0) {
    throw new Error("All dates in the travel window have already passed");
  }

  const bookedAt = parsed.bookedAt ? new Date(parsed.bookedAt) : now;
  const monitoring = resolveMonitoringWindow({
    bookedAt,
    preset: parsed.monitorPreset,
    customEndAt: parsed.customMonitorEndAt ? new Date(parsed.customMonitorEndAt) : null,
    desiredTravelDate: parsed.desiredTravelDate,
    flexibilityDays: parsed.dateFlexibilityDays,
    timeZone: parsed.timezone,
  });
  const next = nextSlotAfter(now, parsed.timezone);

  const watch: WatchRecord = {
    id: crypto.randomUUID(),
    userId: input.userId,
    originCode: parsed.originCode,
    destinationCode: parsed.destinationCode,
    desiredTravelDate: parsed.desiredTravelDate,
    dateFlexibilityDays: parsed.dateFlexibilityDays,
    preferredDepartureTime: parsed.preferredDepartureTime ?? null,
    passengerCount: parsed.passengerCount,
    bookedTrainNumber: parsed.bookedTrainNumber ?? null,
    bookedDepartureAt: parsed.bookedDepartureAt ?? null,
    bookedFareFamily: parsed.bookedFareFamily,
    travelClass: parsed.travelClass,
    currentBookedPriceCents: parsed.currentBookedPriceCents,
    includeRestrictedFares: parsed.includeRestrictedFares,
    includeThruway: parsed.includeThruway,
    minimumSavingsCents: parsed.minimumSavingsCents,
    bookedAt: bookedAt.toISOString(),
    monitorStartAt: monitoring.startAt.toISOString(),
    monitorEndAt: monitoring.endAt ? monitoring.endAt.toISOString() : null,
    monitorPreset: parsed.monitorPreset,
    timezone: parsed.timezone,
    alertEmail: parsed.alertEmail?.trim() || input.email?.trim() || "",
    status: "ACTIVE",
    lastCheckCycleId: null,
    lastCheckedAt: null,
    nextCheckSlot: next.slot,
    nextCheckAtLabel: next.label,
    bestPriceCents: null,
    bestSavingsCents: null,
    lastOpportunity: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  await input.repo.upsertProfile({
    id: input.userId,
    email: input.email?.trim() || parsed.alertEmail?.trim() || "guest@raildrop.local",
    timezone: parsed.timezone,
    createdAt: now.toISOString(),
  });
  await input.repo.createWatch(watch);
  const cycle = await runWatchCycle({
    watch,
    trigger: "INITIAL",
    now,
    repo: input.repo,
    provider: input.provider,
    mailer: input.mailer,
  });
  return cycle.watch;
}
