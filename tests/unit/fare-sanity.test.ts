import { describe, expect, it } from "vitest";
import {
  checkFare,
  distrustNote,
  fareIsPlausible,
  searchIntegrity,
  type Rejection,
  type SanityContext,
} from "@/lib/domain/fare-sanity";
import type { FareOption, JourneyOption } from "@/lib/domain/types";

/* The half of "we never invent a price" that was not covered.
 *
 * Nothing in the codebase fabricates a fare. But a scraper that misreads a page
 * and reports $0.42 for Boston to New York has invented one just as surely, and
 * the pipeline would have ranked it first, drawn it as a $127 saving, and put
 * it in an email. The only check between a parsed number and a person's inbox
 * was that it was a number.
 */

const context: SanityContext = {
  originCode: "BOS",
  destinationCode: "NYP",
  travelDate: "2026-10-09",
  passengerCount: 1,
};

function journey(patch: Partial<JourneyOption> = {}): JourneyOption {
  return {
    id: "j1",
    searchedTravelDate: "2026-10-09",
    serviceName: "Northeast Regional",
    trainNumber: "179",
    serviceType: "TRAIN",
    originCode: "BOS",
    destinationCode: "NYP",
    departureAt: "2026-10-09T11:05:00.000Z",
    arrivalAt: "2026-10-09T15:14:00.000Z",
    durationMinutes: 249,
    transferCount: 0,
    legs: [],
    fares: [],
    provider: { requestId: "r1", source: "test", latencyMs: 1 },
    ...patch,
  } as unknown as JourneyOption;
}

function fare(patch: Partial<FareOption> = {}): FareOption {
  return {
    id: "f1",
    fareFamily: "FLEXIBLE",
    fareFamilyRaw: null,
    travelClass: "COACH",
    travelClassRaw: null,
    availability: "AVAILABLE",
    observedPriceCents: 4_700,
    priceSemantics: "PER_TRAVELER",
    pricePerTravelerCents: 4_700,
    totalPartyPriceCents: 4_700,
    priceFailureReason: null,
    ...patch,
  } as FareOption;
}

const codes = (rejections: Rejection[]) => rejections.map((r) => r.code).sort();

describe("a fare that is fine", () => {
  it("passes", () => {
    expect(checkFare(journey(), fare(), context)).toEqual([]);
    expect(fareIsPlausible(journey(), fare(), context)).toBe(true);
  });

  it("passes at a genuinely cheap price, which is the entire point", () => {
    // The bounds exist to catch garbage, not surprise. Rejecting a real $12
    // Northeast Regional to protect a promise about accuracy would be the most
    // expensive kind of wrong.
    const cheap = fare({ totalPartyPriceCents: 1_200, pricePerTravelerCents: 1_200 });
    expect(fareIsPlausible(journey(), cheap, context)).toBe(true);
  });

  it("passes a long-distance sleeper at a genuinely large price", () => {
    const sleeper = fare({ totalPartyPriceCents: 210_000, pricePerTravelerCents: 210_000 });
    const long = journey({
      arrivalAt: "2026-10-11T09:00:00.000Z",
      durationMinutes: 46 * 60 - 5,
    });
    expect(checkFare(long, sleeper, context)).toEqual([]);
  });
});

describe("the price", () => {
  it("rejects a fare that is not a fare", () => {
    // $0.42 is a fee, a deposit, or a misread. It is not a train ticket.
    const rejections = checkFare(journey(), fare({ totalPartyPriceCents: 42 }), context);
    expect(codes(rejections)).toContain("price_too_low");
    expect(rejections[0]!.detail).toMatch(/misread/i);
  });

  it("rejects a price that picked up something that is not money", () => {
    const rejections = checkFare(
      journey(),
      fare({ totalPartyPriceCents: 9_999_999, pricePerTravelerCents: 9_999_999 }),
      context,
    );
    expect(codes(rejections)).toContain("price_too_high");
  });

  it("rejects a missing price rather than treating it as free", () => {
    expect(codes(checkFare(journey(), fare({ totalPartyPriceCents: null }), context))).toContain(
      "price_missing",
    );
  });

  it("rejects fractional cents and NaN", () => {
    expect(codes(checkFare(journey(), fare({ totalPartyPriceCents: 47.5 }), context))).toContain(
      "price_not_a_number",
    );
    expect(
      codes(checkFare(journey(), fare({ totalPartyPriceCents: Number.NaN }), context)),
    ).toContain("price_not_a_number");
  });

  it("judges the floor per traveler, not per party", () => {
    // Four people at $47 each is a $188 party total. Neither figure is suspect,
    // and a floor applied to the total would pass a $1.20-per-person misread.
    const party = { ...context, passengerCount: 4 };
    const fine = fare({ totalPartyPriceCents: 18_800, pricePerTravelerCents: 4_700 });
    expect(checkFare(journey(), fine, party)).toEqual([]);

    const misread = fare({ totalPartyPriceCents: 480, pricePerTravelerCents: 120 });
    expect(codes(checkFare(journey(), misread, party))).toContain("price_too_low");
  });

  it("catches a party total that does not match its own per-traveler price", () => {
    /* The board ranks on the total. If the two disagree, it ranks on whichever
       one is wrong. */
    const inconsistent = fare({ pricePerTravelerCents: 4_700, totalPartyPriceCents: 9_400 });
    expect(codes(checkFare(journey(), inconsistent, context))).toContain("party_total_mismatch");
  });

  it("allows rounding of a cent per traveler", () => {
    const party = { ...context, passengerCount: 3 };
    const rounded = fare({ pricePerTravelerCents: 4_700, totalPartyPriceCents: 14_102 });
    expect(codes(checkFare(journey(), rounded, party))).not.toContain("party_total_mismatch");
  });

  it("does not invent a mismatch when only the total is given", () => {
    const totalOnly = fare({ pricePerTravelerCents: null, totalPartyPriceCents: 4_700 });
    expect(checkFare(journey(), totalOnly, context)).toEqual([]);
  });
});

describe("the clock", () => {
  it("rejects a train that arrives before it leaves", () => {
    const backwards = journey({
      departureAt: "2026-10-09T15:14:00.000Z",
      arrivalAt: "2026-10-09T11:05:00.000Z",
      durationMinutes: null,
    });
    expect(codes(checkFare(backwards, fare(), context))).toContain("arrives_before_departs");
  });

  it("rejects a journey with no elapsed time", () => {
    const instant = journey({
      arrivalAt: "2026-10-09T11:05:30.000Z",
      durationMinutes: null,
    });
    expect(codes(checkFare(instant, fare(), context))).toContain("duration_too_short");
  });

  it("rejects a journey longer than any Amtrak route", () => {
    const eternal = journey({
      arrivalAt: "2026-10-15T11:05:00.000Z",
      durationMinutes: null,
    });
    expect(codes(checkFare(eternal, fare(), context))).toContain("duration_too_long");
  });

  it("catches a stated duration that contradicts the timestamps", () => {
    // They come from different fields of the payload. Disagreeing by an hour
    // means one of them describes a different train, and we cannot tell which.
    const contradictory = journey({ durationMinutes: 60 });
    expect(codes(checkFare(contradictory, fare(), context))).toContain("duration_disagrees");
  });

  it("tolerates rounding between the two", () => {
    expect(codes(checkFare(journey({ durationMinutes: 245 }), fare(), context))).not.toContain(
      "duration_disagrees",
    );
  });

  it("says nothing about a duration the provider did not give", () => {
    expect(checkFare(journey({ durationMinutes: null }), fare(), context)).toEqual([]);
  });

  it("does not crash on unparseable timestamps", () => {
    const broken = journey({ departureAt: "soon", arrivalAt: "later", durationMinutes: null });
    expect(() => checkFare(broken, fare(), context)).not.toThrow();
  });
});

describe("did it answer the question we asked", () => {
  it("rejects a journey from somewhere else", () => {
    // The shape of the St. Albans / San Francisco lookup bug: a station code
    // that resolves two ways, and a search that quietly answers about the wrong
    // one.
    const elsewhere = journey({ originCode: "SAC" });
    expect(codes(checkFare(elsewhere, fare(), context))).toContain("wrong_origin");
  });

  it("rejects a journey to somewhere else", () => {
    expect(codes(checkFare(journey({ destinationCode: "PHL" }), fare(), context))).toContain(
      "wrong_destination",
    );
  });

  it("rejects a journey filed under a different date", () => {
    expect(
      codes(checkFare(journey({ searchedTravelDate: "2026-10-11" }), fare(), context)),
    ).toContain("wrong_date");
  });

  it("rejects a departure from well before the day we searched", () => {
    // The signature of a provider answering from a cached or defaulted date.
    const stale = journey({
      departureAt: "2026-10-01T11:05:00.000Z",
      arrivalAt: "2026-10-01T15:14:00.000Z",
    });
    expect(codes(checkFare(stale, fare(), context))).toContain("departs_long_before_search");
  });

  it("allows a sleeper that boards the night before", () => {
    const overnight = journey({
      departureAt: "2026-10-08T23:50:00.000Z",
      arrivalAt: "2026-10-09T07:30:00.000Z",
      durationMinutes: 460,
    });
    expect(codes(checkFare(overnight, fare(), context))).not.toContain(
      "departs_long_before_search",
    );
  });

  it("treats an unknown station as unknown, not as wrong", () => {
    expect(checkFare(journey({ originCode: "" }), fare(), context)).toEqual([]);
  });

  it("is not case- or whitespace-sensitive about station codes", () => {
    expect(checkFare(journey({ originCode: " bos " }), fare(), context)).toEqual([]);
  });
});

describe("every reason, not the first", () => {
  it("reports each independent problem", () => {
    // A row wrong in three ways is worth knowing about in three ways when
    // someone is working out what the provider broke.
    const wrong = journey({ originCode: "SAC", searchedTravelDate: "2026-11-01" });
    const found = codes(checkFare(wrong, fare({ totalPartyPriceCents: 1 }), context));
    expect(found).toContain("wrong_origin");
    expect(found).toContain("wrong_date");
    expect(found).toContain("price_too_low");
  });

  it("gives a human sentence for each, never a number to display", () => {
    for (const rejection of checkFare(journey({ originCode: "SAC" }), fare(), context)) {
      expect(rejection.detail.length).toBeGreaterThan(10);
      expect(rejection.detail).toMatch(/[.!]$/);
    }
  });
});

describe("searchIntegrity", () => {
  const ok = { rejections: [] as Rejection[] };
  const bad = (code: Rejection["code"] = "price_too_low") => ({
    rejections: [{ code, detail: "x." }] as Rejection[],
  });

  it("trusts a clean search", () => {
    const verdict = searchIntegrity([ok, ok, ok, ok, ok]);
    expect(verdict.trustworthy).toBe(true);
    expect(verdict.kept).toBe(5);
    expect(verdict.summary).toBeNull();
  });

  it("trusts a search with one bad row out of many", () => {
    // One bad card is a bad parse of one card.
    const verdict = searchIntegrity([ok, ok, ok, ok, ok, ok, ok, ok, ok, bad()]);
    expect(verdict.trustworthy).toBe(true);
    expect(verdict.rejected).toBe(1);
    expect(verdict.summary).toContain("1 of 10");
  });

  it("stops believing the survivors once too many rows are wrong", () => {
    /* A broken parser does not fail uniformly: some rows are obviously wrong
       and some have errors that land inside the bounds. The second kind is the
       dangerous one and the only signal for it is how many of the first there
       were. */
    const verdict = searchIntegrity([ok, ok, bad(), bad(), bad(), bad()]);
    expect(verdict.trustworthy).toBe(false);
    expect(verdict.kept).toBe(2);
  });

  it("does not call a tiny sample broken", () => {
    // One of two is fifty per cent and means nothing.
    expect(searchIntegrity([ok, bad()]).trustworthy).toBe(true);
    expect(searchIntegrity([bad()]).trustworthy).toBe(true);
  });

  it("counts the reasons, worst first", () => {
    const verdict = searchIntegrity([
      bad("price_too_low"),
      bad("price_too_low"),
      bad("wrong_origin"),
      ok,
    ]);
    expect(verdict.byCode[0]).toEqual({ code: "price_too_low", count: 2 });
    expect(verdict.byCode[1]).toEqual({ code: "wrong_origin", count: 1 });
  });

  it("is empty-safe and trusts nothing-at-all", () => {
    const verdict = searchIntegrity([]);
    expect(verdict.trustworthy).toBe(true);
    expect(verdict.kept).toBe(0);
    expect(verdict.summary).toBeNull();
  });
});

describe("distrustNote", () => {
  it("says nothing when the search was fine", () => {
    expect(distrustNote(searchIntegrity([{ rejections: [] }]))).toBeNull();
  });

  it("blames us, not the corridor", () => {
    /* "No cheaper fares" would be a claim about the market, and we do not have
       one. This is a claim about ourselves. */
    const note = distrustNote(
      searchIntegrity([
        { rejections: [{ code: "price_too_low", detail: "x." }] },
        { rejections: [{ code: "price_too_low", detail: "x." }] },
        { rejections: [{ code: "price_too_low", detail: "x." }] },
        { rejections: [] },
      ]),
    )!;
    expect(note).toMatch(/problem at our end/i);
    expect(note).toMatch(/not a sold-out corridor/i);
    expect(note).not.toMatch(/no cheaper/i);
  });
});
