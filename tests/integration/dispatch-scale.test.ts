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
