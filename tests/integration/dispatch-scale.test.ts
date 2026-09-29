import { describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "@/lib/db/memory-store";
import { RecordingMailer } from "@/lib/notifications/resend-mailer";
import { FixtureFareProvider } from "@/lib/providers/fixture-fare-provider";
import { createWatchAndScan } from "@/lib/watches/create-watch";
import {
  dispatchScheduledChecks,
  reapExpiredRuns,
  runLeasedWatch,
} from "@/lib/orchestration/dispatcher";
import { LEASE_MS, MAX_ATTEMPTS } from "@/lib/domain/run-lease";

/* The bug this file exists to prevent.
 *
 * Dispatch used to claim a slot by inserting a row and then run the whole
 * 165-second check inline, sequentially, for every active watch. Past the
 * second or third watch the 300-second ceiling killed the invocation — and the
 * rows were already there, so the next wake counted them as duplicates. Every
 * watch the timeout never reached was never checked, and nothing said so.
 *
 * These tests run many watches through successive wakes and assert the thing
 * that was silently false before: everybody eventually gets checked, and no
 * slot is consumed without work behind it.
 */

const CREATED_AT = new Date("2026-09-05T02:00:00.000Z");

async function seed(repo: MemoryRepository, count: number, usersOf: (i: number) => string) {
  const provider = new FixtureFareProvider();
  for (let i = 0; i < count; i += 1) {
    await createWatchAndScan({
      userId: usersOf(i),
      email: `traveler${i}@example.com`,
      body: {
        originCode: "BOS",
        destinationCode: "NYP",
        desiredTravelDate: "2026-09-20",
        dateFlexibilityDays: 1,
        currentBookedPriceCents: 12800,
      },
      repo,
      provider,
      mailer: new RecordingMailer(),
      now: CREATED_AT,
    });
  }
}

/** Counts the distinct watches that have a completed scheduled run. */
async function checkedWatchIds(repo: MemoryRepository): Promise<Set<string>> {
  const watches = await repo.listActiveWatches();
  const done = new Set<string>();
  for (const watch of watches) {
    const runs = await repo.listScheduledRuns(watch.id);
    if (runs.some((run) => run.status === "DONE")) done.add(watch.id);
  }
  return done;
}

describe("dispatch at scale", () => {
  /* These drive fifty watches through the real cycle machinery, which is slow
     on purpose — it is what the test is about. The default 5s is a bet that the
     machine is idle, and it loses on a busy laptop or a shared CI box. A test
     that fails because something else was compiling is not telling anyone
     anything about dispatch. */
  vi.setConfig({ testTimeout: 30_000 });
  it("eventually checks all 50 watches across successive wakes, with no burned slots", async () => {
    const repo = new MemoryRepository();
    const provider = new FixtureFareProvider();
    await seed(repo, 50, (i) => `user-${i}`);

    // A wake that can only start eight watches, so 50 cannot be done at once.
    const wake = (now: Date) =>
      dispatchScheduledChecks({
        repo,
        now,
        batchLimit: 8,
        invokeWorker: (job) =>
          runLeasedWatch({ repo, provider, ...job, now }).then(() => undefined),
      });

    let executed = 0;
    for (let hour = 0; hour < 12; hour += 1) {
      const now = new Date(Date.UTC(2026, 8, 6, 13 + hour, 5));
      const counts = await wake(now);
      executed += counts.executed;
      // Nothing is ever abandoned on the happy path.
      expect(counts.abandoned).toBe(0);
    }

    const checked = await checkedWatchIds(repo);
    expect(checked.size).toBe(50);
    expect(executed).toBeGreaterThanOrEqual(50);

    // No slot is consumed without a cycle behind it. This is the assertion the
    // old dispatcher would have failed: it left rows with cycle_id "pending"
    // and no work done.
    for (const watchId of checked) {
      for (const run of await repo.listScheduledRuns(watchId)) {
        if (run.status !== "DONE") continue;
        expect(run.cycleId, `run ${run.id} finished with no cycle`).toBeTruthy();
        expect(run.cycleId).not.toBe("pending");
        expect(run.finishedAt).toBeTruthy();
      }
    }
  });

  it("gives a slot back when the worker dies, instead of silently eating it", async () => {
    const repo = new MemoryRepository();
    const provider = new FixtureFareProvider();
    await seed(repo, 3, () => "solo");

    const crashed = new Date("2026-09-06T13:05:00.000Z");
    // Every worker dies without closing its lease — the shape of a function
    // killed by the platform mid-flight.
    const counts = await dispatchScheduledChecks({
      repo,
      now: crashed,
      invokeWorker: async () => {
        throw new Error("function killed");
      },
    });
    expect(counts.leased).toBe(3);
    expect(counts.executed).toBe(0);
    expect(counts.failed).toBe(3);
    expect(await checkedWatchIds(repo)).toEqual(new Set());

    // Before the lease expires the slot is genuinely held: a second wake must
    // not double-run it.
    const during = await dispatchScheduledChecks({
      repo,
      now: new Date(crashed.getTime() + LEASE_MS / 2),
      invokeWorker: (job) =>
        runLeasedWatch({ repo, provider, ...job, now: crashed }).then(() => undefined),
    });
    expect(during.leased).toBe(0);

    // Once it expires the reaper hands it back and the next wake succeeds.
    const later = new Date(crashed.getTime() + LEASE_MS + 1000);
    const recovered = await dispatchScheduledChecks({
      repo,
      now: later,
      invokeWorker: (job) =>
        runLeasedWatch({ repo, provider, ...job, now: later }).then(() => undefined),
    });
    expect(recovered.reclaimed).toBe(3);
    expect(recovered.executed).toBe(3);
    expect((await checkedWatchIds(repo)).size).toBe(3);
  });

  it("gives up on a slot that keeps failing, loudly rather than forever", async () => {
    const repo = new MemoryRepository();
    await seed(repo, 1, () => "solo");

    let now = new Date("2026-09-06T13:05:00.000Z");
    for (let attempt = 0; attempt < MAX_ATTEMPTS + 1; attempt += 1) {
      await dispatchScheduledChecks({
        repo,
        now,
        invokeWorker: async () => {
          throw new Error("still broken");
        },
      });
      now = new Date(now.getTime() + LEASE_MS + 1000);
      await reapExpiredRuns(repo, now);
    }

    const [watch] = await repo.listActiveWatches();
    const runs = await repo.listScheduledRuns(watch!.id);
    const abandoned = runs.find((run) => run.status === "ABANDONED");
    expect(abandoned, "a permanently failing slot must end up ABANDONED").toBeTruthy();
    // And it must say why, so "we never checked this" is answerable.
    expect(abandoned?.failureReason).toBeTruthy();
  });

  it("does not let one heavy user starve everyone else in a wake", async () => {
    const repo = new MemoryRepository();
    const provider = new FixtureFareProvider();
    // One user with 20 watches, then ten users with one each.
    await seed(repo, 20, () => "heavy");
    await seed(repo, 10, (i) => `light-${i}`);

    const now = new Date("2026-09-06T13:05:00.000Z");
    await dispatchScheduledChecks({
      repo,
      now,
      batchLimit: 10,
      invokeWorker: (job) => runLeasedWatch({ repo, provider, ...job, now }).then(() => undefined),
    });

    const checked = await checkedWatchIds(repo);
    const watches = await repo.listActiveWatches();
    const lightChecked = watches.filter(
      (w) => w.userId.startsWith("light-") && checked.has(w.id),
    ).length;
    // With round-robin the single-watch users are served in the first round.
    expect(lightChecked).toBeGreaterThanOrEqual(9);
  });
});

/* The travelers the only cron of the day never reached.
 *
 * vercel.json ships one cron, at 12:05 UTC, because one run a day is the Hobby
 * limit. `dueSlotsAt` answers "which of the 8am/2pm/8pm slots are in the past
 * where this traveler is" — the right question for a deployment that wakes
 * several times a day, and the wrong one for a deployment that wakes once.
 *
 * 12:05 UTC is 08:05 in New York, so an Eastern watch just clears its morning
 * slot. It is 07:05 in Chicago, 06:05 in Denver, 05:05 in Los Angeles, 04:05
 * in Anchorage — before every slot. So for every traveler outside Eastern time
 * the enqueue loop pushed nothing, on the only occasion all day that anything
 * asks, and the watch was never checked again after the scan that created it.
 *
 * Not "checked less often than promised". Never checked. Meanwhile
 * how-it-works says "Three times a day — morning, afternoon and evening in the
 * timezone of your trip", and wait-or-book tells them "if you can hold, we
 * check three times a day and will write the moment it drops."
 *
 * The file's own dispatcher already states the principle: "a traveler who is
 * never checked at all is failed in a way that a traveler who gets two of
 * their three slots is not."
 */
describe("the one wake of the day reaches every timezone", () => {
  const ZONES = [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu",
  ];

  async function seedAcrossZones(repo: MemoryRepository) {
    const provider = new FixtureFareProvider();
    for (const timezone of ZONES) {
      await createWatchAndScan({
        userId: `traveler-${timezone}`,
        email: `${timezone.replace(/\W/g, "-")}@example.com`,
        body: {
          originCode: "BOS",
          destinationCode: "NYP",
          desiredTravelDate: "2026-09-20",
          dateFlexibilityDays: 1,
          currentBookedPriceCents: 12800,
          timezone,
        },
        repo,
        provider,
        mailer: new RecordingMailer(),
        now: CREATED_AT,
      });
    }
  }

  it("checks a watch in every timezone, not only Eastern", async () => {
    const repo = new MemoryRepository();
    await seedAcrossZones(repo);
    const provider = new FixtureFareProvider();

    // The actual deployed cron time, on a day inside the monitor window. The
    // first version of this test used 2026-09-08, three days after creation,
    // by which point the default 72h preset had completed every watch — so
    // listActiveWatches returned nothing and "nobody was missed" was true of
    // an empty set. A vacuous pass is the failure mode this whole file exists
    // to prevent, so the count is asserted before the absence is.
    const wake = new Date("2026-09-06T12:05:00.000Z");
    await dispatchScheduledChecks({
      repo,
      now: wake,
      invokeWorker: async (job) => {
        await runLeasedWatch({
          repo,
          provider,
          mailer: new RecordingMailer(),
          watchId: job.watchId,
          runId: job.runId,
          now: wake,
        });
      },
    });

    const watches = await repo.listActiveWatches();
    expect(watches).toHaveLength(ZONES.length);

    const checked = await checkedWatchIds(repo);
    const missed = watches
      .filter((watch) => !checked.has(watch.id))
      .map((watch) => watch.timezone)
      .sort();
    // Before the fix this was every zone except America/New_York.
    expect(missed).toEqual([]);
  });

  it("does not check the same watch twice in one local day", async () => {
    const repo = new MemoryRepository();
    await seedAcrossZones(repo);
    const provider = new FixtureFareProvider();

    // Two wakes an hour apart. The second must find everything settled: an
    // early booking is a substitute for the slot, not an extra check.
    let ran = 0;
    for (const wake of [
      new Date("2026-09-06T12:05:00.000Z"),
      new Date("2026-09-06T13:05:00.000Z"),
    ]) {
      await dispatchScheduledChecks({
        repo,
        now: wake,
        invokeWorker: async (job) => {
          ran += 1;
          await runLeasedWatch({
            repo,
            provider,
            mailer: new RecordingMailer(),
            watchId: job.watchId,
            runId: job.runId,
            now: wake,
          });
        },
      });
    }

    // Six watches, six runs — not twelve. Honolulu is still before its morning
    // slot on the second wake, and must not be booked a second time.
    expect(ran).toBe(ZONES.length);
  });
});
