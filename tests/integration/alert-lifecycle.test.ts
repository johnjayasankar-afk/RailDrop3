import { describe, expect, it } from "vitest";
import { MemoryRepository } from "@/lib/db/memory-store";
import { RecordingMailer } from "@/lib/notifications/resend-mailer";
import { FixtureFareProvider } from "@/lib/providers/fixture-fare-provider";
import { createWatchAndScan } from "@/lib/watches/create-watch";
import { runWatchCycle } from "@/lib/orchestration/check-cycle";
import type { FareProvider } from "@/lib/providers/fare-provider";
import type { FareSearchRequest, FareSearchResult } from "@/lib/domain/types";

/* The scenario the brief describes, end to end.
 *
 *   told about $47 → it sells out → $60 appears, still far below the $128
 *   booking → the old comparator asked "is 60 below 47?" → no → silence.
 *
 * The traveler held an email about a fare that no longer existed and was never
 * told about the one that did. These tests drive real cycles and assert that
 * they now hear about both events.
 */

/** A provider whose cheapest fare can be moved between cycles.
 *
 * All three price fields move together. Rewriting only the total left the
 * per-traveler price behind, which fare-sanity now rejects as a
 * party_total_mismatch — correctly: the board ranks on the total, so a provider
 * whose two figures disagree makes it rank on whichever one is wrong. */
function steerableProvider() {
  const inner = new FixtureFareProvider();
  let priceCents: number | null = null;
  const provider: FareProvider = {
    id: inner.id,
    async searchTrips(request: FareSearchRequest): Promise<FareSearchResult> {
      const result = await inner.searchTrips(request);
      if (priceCents === null) {
        // Nothing qualifies: price everything far above the booking.
        return {
          ...result,
          journeys: result.journeys.map((journey) => ({
            ...journey,
            fares: journey.fares.map((fare) => ({
              ...fare,
              totalPartyPriceCents: 50_000,
              pricePerTravelerCents: 50_000,
              observedPriceCents: 50_000,
            })),
          })),
        };
      }
      const target = priceCents;
      let cheapestApplied = false;
      return {
        ...result,
        journeys: result.journeys.map((journey) => ({
          ...journey,
          fares: journey.fares.map((fare) => {
            if (cheapestApplied) {
              return {
                ...fare,
                totalPartyPriceCents: 50_000,
                pricePerTravelerCents: 50_000,
                observedPriceCents: 50_000,
              };
            }
            cheapestApplied = true;
            return {
              ...fare,
              totalPartyPriceCents: target,
              pricePerTravelerCents: target,
              observedPriceCents: target,
            };
          }),
        })),
      };
    },
    getStations: () => inner.getStations(),
    healthCheck: () => inner.healthCheck(),
  };
  return {
    provider,
    set(cents: number | null) {
      priceCents = cents;
    },
  };
}

const body = {
  originCode: "BOS",
  destinationCode: "NYP",
  desiredTravelDate: "2026-10-09",
  dateFlexibilityDays: 0 as const,
  currentBookedPriceCents: 12_800,
  alertEmail: "traveler@example.com",
};

describe("alert lifecycle", () => {
  it("tells the traveler when the fare it quoted sells out, then when a new one appears", async () => {
    const repo = new MemoryRepository();
    const mailer = new RecordingMailer();
    const steer = steerableProvider();
    const base = new Date("2026-09-26T12:00:00.000Z");

    // 1. A $47 option appears and is reported.
    steer.set(4_700);
    const watch = await createWatchAndScan({
      userId: "u1",
      email: "traveler@example.com",
      body,
      repo,
      provider: steer.provider,
      mailer,
      now: base,
    });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.subject).toMatch(/Fare drop/i);

    // 2. It sells out. The traveler is holding a price that no longer exists,
    //    so they are told — once.
    steer.set(null);
    await runWatchCycle({
      watch: (await repo.getWatch(watch.id))!,
      trigger: "MANUAL",
      repo,
      provider: steer.provider,
      mailer,
      now: new Date(base.getTime() + 3_600_000),
    });
    expect(mailer.sent).toHaveLength(2);
    expect(mailer.sent[1]!.subject).toMatch(/Sold out/i);
    expect(mailer.sent[1]!.text).toContain("$47");

    // Saying it again on the next quiet cycle would be noise.
    await runWatchCycle({
      watch: (await repo.getWatch(watch.id))!,
      trigger: "MANUAL",
      repo,
      provider: steer.provider,
      mailer,
      now: new Date(base.getTime() + 7_200_000),
    });
    expect(mailer.sent).toHaveLength(2);

    // 3. A $60 appears. Still $68 below the booking. The old comparator said
    //    "unchanged" here and never spoke again; this is the regression.
    steer.set(6_000);
    await runWatchCycle({
      watch: (await repo.getWatch(watch.id))!,
      trigger: "MANUAL",
      repo,
      provider: steer.provider,
      mailer,
      now: new Date(base.getTime() + 10_800_000),
    });
    expect(mailer.sent).toHaveLength(3);
    expect(mailer.sent[2]!.subject).toMatch(/Fare drop/i);
  });

  it("does not re-open with a duplicate first-drop email after a recovery", async () => {
    const repo = new MemoryRepository();
    const mailer = new RecordingMailer();
    const steer = steerableProvider();
    const base = new Date("2026-09-26T12:00:00.000Z");

    steer.set(4_700);
    const watch = await createWatchAndScan({
      userId: "u1",
      email: "traveler@example.com",
      body,
      repo,
      provider: steer.provider,
      mailer,
      now: base,
    });

    steer.set(null);
    await runWatchCycle({
      watch: (await repo.getWatch(watch.id))!,
      trigger: "MANUAL",
      repo,
      provider: steer.provider,
      mailer,
      now: new Date(base.getTime() + 3_600_000),
    });

    steer.set(6_000);
    await runWatchCycle({
      watch: (await repo.getWatch(watch.id))!,
      trigger: "MANUAL",
      repo,
      provider: steer.provider,
      mailer,
      now: new Date(base.getTime() + 7_200_000),
    });

    // The recovery is a new opportunity, and the stored state must reflect the
    // $60 they were actually told about — not the $47 that is long gone.
    const after = await repo.getWatch(watch.id);
    expect(after?.lastAlertedOpportunity?.bestPriceCents).toBe(6_000);
    expect(after?.opportunityLostNotified).toBe(false);
  });

  it("records the observation as null when nothing qualifies", async () => {
    // Keeping the previous fingerprint here is the original bug. The column
    // must say what was seen, which is nothing.
    const repo = new MemoryRepository();
    const mailer = new RecordingMailer();
    const steer = steerableProvider();
    const base = new Date("2026-09-26T12:00:00.000Z");

    steer.set(4_700);
    const watch = await createWatchAndScan({
      userId: "u1",
      email: "traveler@example.com",
      body,
      repo,
      provider: steer.provider,
      mailer,
      now: base,
    });

    steer.set(null);
    await runWatchCycle({
      watch: (await repo.getWatch(watch.id))!,
      trigger: "MANUAL",
      repo,
      provider: steer.provider,
      mailer,
      now: new Date(base.getTime() + 3_600_000),
    });

    const after = await repo.getWatch(watch.id);
    expect(after?.lastOpportunity).toBeNull();
    // But what we told them is remembered, which is how the lost notice knows
    // which price to name.
    expect(after?.lastAlertedOpportunity?.bestPriceCents).toBe(4_700);
  });
});

describe("alert audit trail", () => {
  it("records why it spoke and why it stayed quiet", async () => {
    const repo = new MemoryRepository();
    const mailer = new RecordingMailer();
    const steer = steerableProvider();
    const base = new Date("2026-09-26T12:00:00.000Z");

    steer.set(4_700);
    const watch = await createWatchAndScan({
      userId: "u1",
      email: "traveler@example.com",
      body,
      repo,
      provider: steer.provider,
      mailer,
      now: base,
    });

    // A silent cycle: still qualifying, not enough better to be worth mail.
    steer.set(4_690);
    await runWatchCycle({
      watch: (await repo.getWatch(watch.id))!,
      trigger: "MANUAL",
      repo,
      provider: steer.provider,
      mailer,
      now: new Date(base.getTime() + 3_600_000),
    });

    const decisions = await repo.listAlertDecisions(watch.id);
    expect(decisions).toHaveLength(2);

    // Newest first: the silence, with a reason a person can read.
    const quiet = decisions[0]!;
    expect(quiet.notified).toBe(false);
    expect(quiet.reason).toBe("unchanged");
    expect(quiet.explanation).toMatch(/\$4[67]/);

    const spoke = decisions[1]!;
    expect(spoke.notified).toBe(true);
    expect(spoke.reason).toBe("first_qualifying");

    // Both fingerprints are kept, so the decision can be re-read later without
    // depending on what the watch looks like by then.
    expect(quiet.observedFingerprint?.bestPriceCents).toBe(4_690);
    expect(quiet.alertedFingerprint?.bestPriceCents).toBe(4_700);
  });
});
