import { logger } from "@/lib/logger";
import { dueSlotsAt, nextSlotAfter } from "@/lib/domain/timezone";
import { shouldCompleteWatch } from "@/lib/domain/monitoring";
import type { FareProvider } from "@/lib/providers/fare-provider";
import type { RailDropRepository } from "@/lib/db/repository";
import type { Mailer } from "@/lib/notifications/send-alert";
import { runWatchCycle } from "./check-cycle";
import type { FareSearchResult } from "@/lib/domain/types";

export async function dispatchScheduledChecks(input: {
  repo: RailDropRepository;
  provider: FareProvider;
  mailer?: Mailer;
  now?: Date;
}): Promise<{
  considered: number;
  claimed: number;
  completed: number;
  skippedDuplicate: number;
}> {
  const now = input.now ?? new Date();
  const watches = await input.repo.listActiveWatches();
  const searchCache = new Map<string, FareSearchResult>();
  let claimed = 0;
  let completed = 0;
  let skippedDuplicate = 0;

  for (const watch of watches) {
    if (
      shouldCompleteWatch({
        now,
        monitorEndAt: watch.monitorEndAt ? new Date(watch.monitorEndAt) : null,
        desiredTravelDate: watch.desiredTravelDate,
        flexibilityDays: watch.dateFlexibilityDays,
        timeZone: watch.timezone,
      })
    ) {
      await input.repo.updateWatch(watch.id, { status: "COMPLETED" });
      completed += 1;
      continue;
    }

    const due = dueSlotsAt(now, watch.timezone);
    for (const slot of due) {
      const run = await input.repo.claimScheduledRun({
        id: crypto.randomUUID(),
        watchId: watch.id,
        localCheckDate: slot.localDate,
        checkSlot: slot.slot,
        cycleId: "pending",
        createdAt: now.toISOString(),
      });
      if (!run) {
        skippedDuplicate += 1;
        continue;
      }
      claimed += 1;
      const result = await runWatchCycle({
        watch,
        trigger: "SCHEDULED",
        checkSlot: slot.slot,
        localCheckDate: slot.localDate,
        now,
        repo: input.repo,
        provider: input.provider,
        mailer: input.mailer,
        searchCache,
      });
      run.cycleId = result.cycle.id;
    }
  }

  logger.info("dispatcher.finished", {
    considered: watches.length,
    claimed,
    completed,
    skippedDuplicate,
  });

  return { considered: watches.length, claimed, completed, skippedDuplicate };
}

export function previewNextChecks(timeZone: string, now = new Date()) {
  return nextSlotAfter(now, timeZone);
}
