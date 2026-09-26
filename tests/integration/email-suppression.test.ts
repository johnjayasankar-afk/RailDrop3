import { describe, expect, it } from "vitest";
import { MemoryRepository } from "@/lib/db/memory-store";
import { RecordingMailer } from "@/lib/notifications/resend-mailer";
import { FixtureFareProvider } from "@/lib/providers/fixture-fare-provider";
import { createWatchAndScan } from "@/lib/watches/create-watch";
import { runWatchCycle } from "@/lib/orchestration/check-cycle";
import { unsubscribeTokenFor, unsubscribeTokenValid } from "@/lib/notifications/unsubscribe";

/* A guest can put an email on a watch with no account. Before this there was
 * no link, no header, and no way for that person to make it stop. These tests
 * assert the mail actually ceases — not that a row was written somewhere. */

const body = {
  originCode: "BOS",
  destinationCode: "NYP",
  desiredTravelDate: "2026-10-09",
  dateFlexibilityDays: 0 as const,
  currentBookedPriceCents: 50_000,
  alertEmail: "guest@example.com",
};

const now = new Date("2026-09-26T12:00:00.000Z");

describe("email suppression", () => {
  it("sends to an address that has not opted out", async () => {
    const repo = new MemoryRepository();
    const mailer = new RecordingMailer();
    await createWatchAndScan({
      userId: "u1",
      email: "guest@example.com",
      body,
      repo,
      provider: new FixtureFareProvider(),
      mailer,
      now,
    });
    expect(mailer.sent.length).toBeGreaterThan(0);
  });

  it("sends nothing at all once the address is suppressed", async () => {
    const repo = new MemoryRepository();
    const mailer = new RecordingMailer();
    await repo.suppressEmail({ email: "guest@example.com", reason: "UNSUBSCRIBED" });

    await createWatchAndScan({
      userId: "u1",
      email: "guest@example.com",
      body,
      repo,
      provider: new FixtureFareProvider(),
      mailer,
      now,
    });

    expect(mailer.sent).toHaveLength(0);
  });

  it("keeps watching the trip — unsubscribing is not deleting", async () => {
    const repo = new MemoryRepository();
    const mailer = new RecordingMailer();
    await repo.suppressEmail({ email: "guest@example.com", reason: "UNSUBSCRIBED" });

    const watch = await createWatchAndScan({
      userId: "u1",
      email: "guest@example.com",
      body,
      repo,
      provider: new FixtureFareProvider(),
      mailer,
      now,
    });

    // The board still has real results behind it; only the mail stopped.
    const cycle = await repo.getCycle(watch.lastCheckCycleId!);
    expect(cycle?.status).toBe("SUCCESS");
    expect(await repo.listJourneysForCycle(cycle!.id)).not.toHaveLength(0);
  });

  it("matches the address case-insensitively", async () => {
    // Someone who unsubscribed as Guest@Example.com must not hear from us
    // again because the watch stored it lowercase.
    const repo = new MemoryRepository();
    const mailer = new RecordingMailer();
    await repo.suppressEmail({ email: "GUEST@Example.COM", reason: "COMPLAINED" });

    await createWatchAndScan({
      userId: "u1",
      email: "guest@example.com",
      body,
      repo,
      provider: new FixtureFareProvider(),
      mailer,
      now,
    });
    expect(mailer.sent).toHaveLength(0);
  });

  it("stops subsequent cycles, not just the first", async () => {
    const repo = new MemoryRepository();
    const mailer = new RecordingMailer();
    const provider = new FixtureFareProvider();

    const watch = await createWatchAndScan({
      userId: "u1",
      email: "guest@example.com",
      body,
      repo,
      provider,
      mailer,
      now,
    });
    const before = mailer.sent.length;

    await repo.suppressEmail({ email: "guest@example.com", reason: "BOUNCED" });
    await runWatchCycle({
      watch: (await repo.getWatch(watch.id))!,
      trigger: "MANUAL",
      repo,
      provider,
      mailer,
      now: new Date(now.getTime() + 7_200_000),
    });

    expect(mailer.sent).toHaveLength(before);
  });

  it("issues a token that only unsubscribes its own watch", async () => {
    const key = "integration-key";
    const mine = unsubscribeTokenFor("watch-a", key)!;
    expect(unsubscribeTokenValid("watch-a", mine, key)).toBe(true);
    expect(unsubscribeTokenValid("watch-b", mine, key)).toBe(false);
  });
});
