import { describe, expect, it } from "vitest";
import {
  buildIcs,
  escapeIcsText,
  foldIcsLine,
  icsFilename,
  toIcsInstant,
  type CalendarEvent,
} from "@/lib/domain/ics";

/* A calendar file gets trusted at 6am on a platform, which is a worse place to
 * discover a guess than a screen is. Everything in it comes from an observed
 * journey, and the three fussy parts of RFC 5545 — CRLF, folding at 75 octets,
 * escaping — are the ones that are invisible until a calendar refuses the file.
 */

const event: CalendarEvent = {
  uid: "watch-1@raildrop",
  startsAt: "2026-10-09T11:05:00.000Z",
  endsAt: "2026-10-09T15:14:00.000Z",
  title: "Northeast Regional 179 · BOS → NYP",
  description: "Listed at $74. Confirm on Amtrak; RailDrop never books.",
  location: "Boston South Station",
  stamp: "2026-09-28T12:00:00.000Z",
  url: "https://www.amtrak.com/home.html",
};

describe("instants", () => {
  it("writes a zoned time as an absolute UTC instant", () => {
    expect(toIcsInstant("2026-10-09T11:05:00.000Z")).toBe("20261009T110500Z");
    expect(toIcsInstant("2026-10-09T07:05:00-04:00")).toBe("20261009T110500Z");
  });

  it("writes a zone-less time as a floating one, unchanged", () => {
    /* A departure in this app is the station's wall clock with no zone on it.
       Floating is RFC 5545's word for "show this clock reading, wherever you
       are", which is exactly what a platform sign means. */
    expect(toIcsInstant("2026-10-09T07:05:00")).toBe("20261009T070500");
    expect(toIcsInstant("2026-10-09T07:05")).toBe("20261009T070500");
  });

  it("does not depend on the timezone the server happens to run in", () => {
    /* The bug this replaced. Parsing a zone-less string with `new Date` reads
       it in the server's zone, so the same journey became a different instant
       depending on where the code ran — right on a laptop in New York, four
       hours out on Vercel, which runs UTC, and nothing about the file looked
       wrong. The output for a wall clock must be a pure string transform. */
    const original = process.env.TZ;
    const seen = new Set<string>();
    for (const zone of ["UTC", "America/New_York", "Asia/Tokyo"]) {
      process.env.TZ = zone;
      seen.add(toIcsInstant("2026-10-09T07:05:00") ?? "");
    }
    process.env.TZ = original;
    expect([...seen]).toEqual(["20261009T070500"]);
  });

  it("refuses a date it cannot read rather than writing a broken one", () => {
    expect(toIcsInstant("not a date")).toBeNull();
  });
});

describe("escaping", () => {
  it("escapes the four characters the spec reserves", () => {
    expect(escapeIcsText("a,b;c\\d")).toBe("a\\,b\;c\\\\d");
    expect(escapeIcsText("one\ntwo")).toBe("one\\ntwo");
  });

  it("escapes the backslash first, so an escape is not itself escaped twice", () => {
    // Getting this order wrong turns \, into \\, and the comma reappears.
    expect(escapeIcsText("\\,")).toBe("\\\\\\,");
  });
});

describe("folding", () => {
  it("leaves a short line alone", () => {
    expect(foldIcsLine("SUMMARY:short")).toBe("SUMMARY:short");
  });

  it("folds a long line with a leading space on the continuation", () => {
    const folded = foldIcsLine(`SUMMARY:${"x".repeat(200)}`);
    expect(folded).toContain("\r\n ");
    for (const line of folded.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it("counts octets, not characters", () => {
    /* The text here is full of en dashes and arrows. Folding by .length gives
       lines that pass a character count and are too long on the wire. */
    const line = `SUMMARY:${"—".repeat(40)}`; // 40 chars, 120 octets
    const folded = foldIcsLine(line);
    expect(folded).toContain("\r\n ");
    for (const part of folded.split("\r\n")) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    }
  });

  it("never splits a multi-byte character", () => {
    const folded = foldIcsLine(`X:${"→".repeat(60)}`);
    // A split inside a character decodes to U+FFFD.
    expect(folded).not.toContain("�");
    expect(folded.replace(/\r\n /g, "")).toBe(`X:${"→".repeat(60)}`);
  });
});

describe("the file", () => {
  const ics = buildIcs([event]);

  it("is a calendar with one event", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it("uses CRLF throughout, including the last line", () => {
    const bare = ics.replace(/\r\n/g, "");
    expect(bare).not.toContain("\n");
  });

  it("carries the observed times and train", () => {
    expect(ics).toContain("DTSTART:20261009T110500Z");
    expect(ics).toContain("DTEND:20261009T151400Z");
    expect(ics).toContain("Northeast Regional 179");
  });

  it("skips an event with no usable start rather than writing a broken file", () => {
    /* One bad entry makes a calendar reject the whole file, so the rest of the
       trips are worth more than the one that cannot be represented. */
    const mixed = buildIcs([{ ...event, startsAt: "nonsense" }, event]);
    expect(mixed.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it("does not put a price in the summary", () => {
    // The summary is what a phone shows on a lock screen. A fare that moved
    // after the file was saved would be read there as current.
    const summary = ics.split("\r\n").find((line) => line.startsWith("SUMMARY:"));
    expect(summary).toBeDefined();
    expect(summary).not.toMatch(/\$\d/);
  });
});

describe("the filename", () => {
  it("is findable in a downloads folder", () => {
    expect(icsFilename("BOS", "NYP", "2026-10-09")).toBe("raildrop-bos-nyp-2026-10-09.ics");
  });
});
