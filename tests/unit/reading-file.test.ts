import { describe, expect, it } from "vitest";
import { journeyIcs, readingCsv, readingCsvFilename } from "@/lib/domain/reading-file";
import type { FarePreview } from "@/lib/fares/preview-fares";
import type { RankedCandidate } from "@/lib/domain/types";

/* A reading you can keep, because the product keeps nothing — and a file
 * that cannot be mistaken for something it is not once it has left the page.
 */

const candidate = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    journey: {
      id: "j1",
      searchedTravelDate: "2026-10-09",
      serviceName: "Northeast Regional",
      trainNumber: "179",
      serviceType: "TRAIN",
      departureAt: "2026-10-09T19:47:00",
      arrivalAt: "2026-10-09T23:49:00",
      durationMinutes: 242,
      transferCount: 0,
      ...((over.journey as object) ?? {}),
    },
    fare: { id: "f1", availability: "AVAILABLE" },
    totalPartyPriceCents: 16_700,
    savingsCents: 0,
  }) as unknown as RankedCandidate;

const preview = (over: Partial<FarePreview> = {}): FarePreview =>
  ({
    originCode: "BOS",
    destinationCode: "NYP",
    desiredTravelDate: "2026-10-09",
    dates: ["2026-10-08", "2026-10-09", "2026-10-10"],
    ranked: [candidate()],
    byDate: [],
    failedDates: [],
    unreadableDates: [],
    failureReason: null,
    checkedAt: "2026-10-01T20:12:00.000Z",
    ...over,
  }) as FarePreview;

describe("the reading, as a file", () => {
  it("carries what it is before it carries any price", () => {
    /* A detached CSV of prices with no date, no route and no source becomes
       an unlabelled price list the moment it leaves the page — the same
       failure as a sample board captioned "read from live inventory",
       committed in a format that outlives the tab. */
    const csv = readingCsv(preview(), 1);
    const preamble = csv.slice(0, csv.indexOf("\n\n"));
    expect(preamble).toMatch(/not a booking/i);
    expect(preamble).toContain("BOS to NYP");
    expect(preamble).toContain("2026-10-01T20:12:00.000Z");
    // And it comes before the first fare.
    expect(csv.indexOf("not a booking")).toBeLessThan(csv.indexOf("167.00"));
  });

  it("writes prices a spreadsheet can add up", () => {
    const csv = readingCsv(preview(), 1);
    const header = csv.trim().split("\n").at(-2)!.split(",");
    const row = csv.trim().split("\n").at(-1)!.split(",");
    const price = row[header.indexOf("Price (party total)")];
    // "$1,234" is text to a spreadsheet; 1234.00 is a number.
    expect(price).toBe("167.00");
    expect(price).not.toMatch(/[$,]/);
  });

  it("has no Savings column, because there is nothing to save against", () => {
    // It was left from the deleted watch feature and was 0 on every row.
    expect(readingCsv(preview(), 1)).not.toMatch(/savings/i);
  });

  it("quotes a value that would split a column", () => {
    const csv = readingCsv(
      preview({ ranked: [candidate({ journey: { serviceName: "Acela, Express" } })] }),
      1,
    );
    expect(csv).toContain('"Acela, Express 179"');
  });

  it("records the dates it could not read, where it has any", () => {
    const csv = readingCsv(preview({ failedDates: ["2026-10-08"] }), 1);
    expect(csv).toContain("Dates not answered");
    expect(csv).toContain("2026-10-08");
  });

  it("makes a calendar entry that does not pretend to be a reservation", () => {
    const ics = journeyIcs(candidate(), preview(), 2);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("DTSTART:");
    expect(ics).toMatch(/not a (reservation|booking)/i);
    // The fare is stated with the moment it was read, never on its own.
    expect(ics).toContain("2026-10-01T20:12:00.000Z");
    // And it never links to an itinerary nobody can verify.
    expect(ics).not.toMatch(/amtrak\.com/i);
  });

  it("gives the event a short, stable id a calendar can key on", () => {
    /* The provider's journey id is a comma-separated list of station and
       time codes about ninety characters long. Dropped into a UID it folded
       across three lines and read like a parse error. */
    const ics = journeyIcs(candidate(), preview(), 1);
    const uid = /UID:(.+)/.exec(ics)![1]!.trim();
    expect(uid).toMatch(/^[0-9a-z]+@raildrop\.app$/);
    expect(uid.length).toBeLessThan(32);
    // Same train, same reading, same id — so a calendar replaces rather than
    // duplicates it.
    expect(/UID:(.+)/.exec(journeyIcs(candidate(), preview(), 1))![1]).toBe(
      /UID:(.+)/.exec(ics)![1],
    );
  });

  it("does not still call itself a fare watch", () => {
    expect(journeyIcs(candidate(), preview(), 1)).not.toMatch(/fare watch/i);
  });

  it("names the file so it can be found again", () => {
    expect(readingCsvFilename(preview())).toBe("raildrop-bos-nyp-2026-10-09.csv");
  });
});
