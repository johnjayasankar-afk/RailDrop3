import { describe, expect, it } from "vitest";
import { sendFareDropEmail, sendOpportunityLostEmail } from "@/lib/notifications/send-alert";
import type { Mailer } from "@/lib/notifications/send-alert";
import type { WatchRecord } from "@/lib/db/models";
import type { RankedCandidate } from "@/lib/domain/types";
import { decodeBoardState } from "@/lib/domain/board-url";

/* Structural guards on the alert emails.
 *
 * Not pixel snapshots — those break on every copy edit and teach people to
 * regenerate without reading. These assert the things that are invisible when
 * you look at the template and expensive when they break: the preview line,
 * layout tables announced as layout, a timestamp a person can read, and a way
 * out of the mail.
 */

function captureMailer() {
  const sent: Array<{
    to: string;
    subject: string;
    html: string;
    text: string;
    headers?: Record<string, string>;
  }> = [];
  const mailer: Mailer = {
    async send(input) {
      sent.push(input);
      return { status: "ACCEPTED", providerMessageId: "m1", errorMessage: null };
    },
  };
  return { mailer, sent };
}

const watch = {
  id: "11111111-2222-3333-4444-555555555555",
  originCode: "BOS",
  destinationCode: "NYP",
  desiredTravelDate: "2026-10-09",
  currentBookedPriceCents: 12_800,
  bookedTrainNumber: null,
  timezone: "America/New_York",
} as unknown as WatchRecord;

const candidate = {
  totalPartyPriceCents: 4_700,
  savingsCents: 8_100,
  dateOffsetDays: 0,
  journey: {
    searchedTravelDate: "2026-10-09",
    departureAt: "2026-10-09T11:05:00.000Z",
    arrivalAt: "2026-10-09T15:14:00.000Z",
    trainNumber: "179",
    serviceName: "Northeast Regional",
    durationMinutes: 249,
    originCode: "BOS",
    destinationCode: "NYP",
    legs: [],
  },
  fare: { fareFamily: "FLEXIBLE", travelClass: "COACH" },
} as unknown as RankedCandidate;

const withKey = async <T>(run: () => Promise<T>): Promise<T> => {
  const prev = process.env.UNSUBSCRIBE_SECRET;
  process.env.UNSUBSCRIBE_SECRET = "template-test-key";
  try {
    return await run();
  } finally {
    if (prev === undefined) delete process.env.UNSUBSCRIBE_SECRET;
    else process.env.UNSUBSCRIBE_SECRET = prev;
  }
};

async function renderDrop() {
  const { mailer, sent } = captureMailer();
  await withKey(() =>
    sendFareDropEmail({
      mailer,
      to: "traveler@example.com",
      watch,
      best: candidate,
      others: [],
      byDate: new Map(),
      appUrl: "https://rail.example/watches/11111111-2222-3333-4444-555555555555",
      checkedAt: new Date("2026-09-26T16:00:00.000Z"),
      cycleStatus: "SUCCESS",
      skippedPastDates: [],
    }),
  );
  return sent[0]!;
}

describe("fare drop email", () => {
  it("leads the inbox preview with the offer, not the wordmark", async () => {
    const mail = await renderDrop();
    const preheader = mail.html.match(/display:none;max-height:0[^>]*>([^<]+)</)?.[1] ?? "";
    expect(preheader).toContain("$47");
    expect(preheader).not.toMatch(/^RailDrop$/);
  });

  it("marks layout tables as layout", async () => {
    // A screen reader otherwise announces them as data tables with rows and
    // columns that mean nothing.
    const mail = await renderDrop();
    for (const tag of mail.html.match(/<table[^>]*>/g) ?? []) {
      expect(tag).toContain('role="presentation"');
    }
  });

  it("shows a timestamp a person can read, in the trip's timezone", async () => {
    const mail = await renderDrop();
    // 16:00 UTC is midday in New York.
    expect(mail.html).toMatch(/Checked Sep 26, 12:00\s?PM EDT/);
    expect(mail.html).not.toContain("2026-09-26T16:00:00.000Z");
    expect(mail.text).not.toContain("T16:00:00");
  });

  it("declares dark-mode support rather than inverting badly", async () => {
    const mail = await renderDrop();
    expect(mail.html).toContain('name="color-scheme"');
    expect(mail.html).toContain("prefers-color-scheme: dark");
  });

  it("offers a way out, in the body and in the headers", async () => {
    const mail = await renderDrop();
    expect(mail.html).toContain("/unsubscribe?");
    expect(mail.text).toContain("/unsubscribe?");
    expect(mail.headers?.["List-Unsubscribe"]).toMatch(/^<https:\/\//);
    expect(mail.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("deep-links to the board already showing the day of the drop", async () => {
    // The generic watch link made the reader re-do the filtering: a ±3 window
    // opens at sixty rows and the fare the email is about is somewhere in them.
    const mail = await renderDrop();
    const href = /href="([^"]*\?b=[^"]*)"/.exec(mail.html)?.[1] ?? "";
    const state = decodeBoardState(new URL(href.replaceAll("&amp;", "&")).searchParams.get("b"));
    expect(state.dateFilter).toBe("2026-10-09");
    expect(state.sort).toBe("price");
    expect(state.showAll).toBe(true);
    // And the plain-text part gets the same link, not the bare board.
    expect(mail.text).toContain("?b=");
  });

  it("does not pin the fare it is about", async () => {
    // It may have sold out by the time the mail is opened. A link pinning it
    // would open on an empty board and read as broken rather than as sold out.
    const mail = await renderDrop();
    const href = /href="([^"]*\?b=[^"]*)"/.exec(mail.html)?.[1] ?? "";
    const state = decodeBoardState(new URL(href.replaceAll("&amp;", "&")).searchParams.get("b"));
    expect(state.pins).toEqual([]);
    expect(state.focusKey).toBeNull();
  });

  it("says who it is from and that it is not Amtrak", async () => {
    const mail = await renderDrop();
    expect(mail.html).toMatch(/not affiliated with Amtrak/i);
  });
});

describe("opportunity lost email", () => {
  it("names the price that went and the one available now", async () => {
    const { mailer, sent } = captureMailer();
    await withKey(() =>
      sendOpportunityLostEmail({
        mailer,
        to: "traveler@example.com",
        watch,
        lostPriceCents: 4_700,
        currentCheapestCents: 9_900,
        appUrl: "https://rail.example/watches/11111111-2222-3333-4444-555555555555",
        checkedAt: new Date("2026-09-26T16:00:00.000Z"),
      }),
    );
    const mail = sent[0]!;
    expect(mail.subject).toMatch(/Sold out/i);
    expect(mail.html).toContain("$47");
    expect(mail.html).toContain("$99");
    expect(mail.headers?.["List-Unsubscribe"]).toBeTruthy();
  });

  it("does not imply a cheaper fare exists when none does", async () => {
    const { mailer, sent } = captureMailer();
    await withKey(() =>
      sendOpportunityLostEmail({
        mailer,
        to: "traveler@example.com",
        watch,
        lostPriceCents: 4_700,
        currentCheapestCents: null,
        appUrl: "https://rail.example/watches/x",
        checkedAt: new Date("2026-09-26T16:00:00.000Z"),
      }),
    );
    expect(sent[0]!.html).toMatch(/Nothing cheaper than your booking is listed/i);
  });
});
