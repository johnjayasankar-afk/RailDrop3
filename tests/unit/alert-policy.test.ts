import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMPROVEMENT_CENTS,
  decideAlert,
  initialAlertState,
  type AlertState,
} from "@/lib/domain/alert-policy";
import type { OpportunityFingerprint } from "@/lib/domain/types";

const fp = (cents: number, date = "2026-10-09"): OpportunityFingerprint => ({
  bestJourneyKey: `${date}|NER|${cents}`,
  bestPriceCents: cents,
  bestTravelDate: date,
  sameDayBestPriceCents: null,
  sameDayJourneyKey: null,
  qualifyingCount: 1,
});

const told = (cents: number): AlertState => ({
  lastAlerted: fp(cents),
  lostNotified: false,
  imminentNotified: false,
});

const decide = (over: Partial<Parameters<typeof decideAlert>[0]> = {}) =>
  decideAlert({ state: initialAlertState(), observed: null, hoursToDeparture: 200, ...over });

describe("NONE → QUALIFYING", () => {
  it("notifies the first time something qualifies", () => {
    const d = decide({ observed: fp(4700) });
    expect(d.notify).toBe(true);
    expect(d.reason).toBe("first_qualifying");
    expect(d.nextAlerted?.bestPriceCents).toBe(4700);
  });

  it("stays quiet when nothing has ever qualified", () => {
    const d = decide({ observed: null });
    expect(d.notify).toBe(false);
    expect(d.reason).toBe("no_qualifying");
  });
});

describe("QUALIFYING → BETTER", () => {
  it("notifies on a meaningful improvement", () => {
    const d = decide({ state: told(4700), observed: fp(4500) });
    expect(d.notify).toBe(true);
    expect(d.reason).toBe("better_price");
  });

  it("stays quiet below the threshold", () => {
    const d = decide({ state: told(4700), observed: fp(4650) });
    expect(d.notify).toBe(false);
    expect(d.reason).toBe("unchanged");
  });

  it("honours a per-watch threshold", () => {
    const loose = decide({ state: told(4700), observed: fp(4650), improvementCents: 25 });
    expect(loose.notify).toBe(true);
    const strict = decide({ state: told(4700), observed: fp(4500), improvementCents: 5000 });
    expect(strict.notify).toBe(false);
  });

  it("measures against what we told them, not the last thing we saw", () => {
    // The distinction, in one test. They were told $47. The market drifted to
    // $60 with no email (each step too small to report). Now $59 is listed.
    // Against the last *observation* that is a $1 improvement and the old
    // comparator would have sent mail. Against what they were actually told it
    // is $12 worse, and there is nothing here worth their attention.
    const d = decide({ state: told(4700), observed: fp(5900), hoursToDeparture: 400 });
    expect(d.notify).toBe(false);
    expect(d.reason).toBe("unchanged");
  });

  it("treats an improvement exactly at the threshold as worth saying", () => {
    const d = decide({ state: told(4700), observed: fp(4600) });
    expect(d.notify).toBe(true);
    expect(d.reason).toBe("better_price");
  });
});

describe("QUALIFYING → GONE", () => {
  it("says the fare we quoted has gone, once", () => {
    const first = decide({ state: told(4700), observed: null });
    expect(first.notify).toBe(true);
    expect(first.reason).toBe("opportunity_lost");
    expect(first.nextLostNotified).toBe(true);
    expect(first.explanation).toContain("$47");

    const again = decide({
      state: { lastAlerted: fp(4700), lostNotified: true, imminentNotified: false },
      observed: null,
    });
    expect(again.notify).toBe(false);
    expect(again.reason).toBe("no_qualifying");
  });
});

describe("GONE → QUALIFYING", () => {
  it("calls it a new opportunity, not a first one", () => {
    // Wording matters: "we found your first cheaper fare" would be false.
    const d = decide({
      state: { lastAlerted: fp(4700), lostNotified: true, imminentNotified: false },
      observed: fp(6000),
    });
    expect(d.notify).toBe(true);
    expect(d.reason).toBe("new_opportunity");
    expect(d.nextLostNotified).toBe(false);
  });

  it("rescues the exact scenario that used to go silent", () => {
    // Told $47 → sells out → $60 appears, still far below the $128 booking.
    const lost = decide({ state: told(4700), observed: null });
    expect(lost.reason).toBe("opportunity_lost");

    const back = decide({
      state: {
        lastAlerted: lost.nextAlerted,
        lostNotified: lost.nextLostNotified,
        imminentNotified: lost.nextImminentNotified,
      },
      observed: fp(6000),
    });
    // The old comparator said "unchanged" here and never spoke again.
    expect(back.notify).toBe(true);
    expect(back.reason).toBe("new_opportunity");
  });
});

describe("QUALIFYING → WORSE_BUT_QUALIFYING", () => {
  it("speaks only when it is materially worse and departure is close", () => {
    const near = decide({ state: told(4700), observed: fp(6000), hoursToDeparture: 10 });
    expect(near.notify).toBe(true);
    expect(near.reason).toBe("worse_but_qualifying");
  });

  it("stays quiet when departure is far off", () => {
    const far = decide({ state: told(4700), observed: fp(6000), hoursToDeparture: 400 });
    expect(far.notify).toBe(false);
    expect(far.reason).toBe("unchanged");
  });

  it("stays quiet when the rise is small, even close to departure", () => {
    const d = decide({ state: told(4700), observed: fp(4750), hoursToDeparture: 5 });
    expect(d.reason).not.toBe("worse_but_qualifying");
  });

  it("does nothing special when departure is unknown", () => {
    const d = decide({ state: told(4700), observed: fp(6000), hoursToDeparture: null });
    expect(d.notify).toBe(false);
  });
});

describe("DEPARTURE_IMMINENT", () => {
  it("gives one last call when a qualifying fare is still standing", () => {
    const d = decide({ state: told(4700), observed: fp(4700), hoursToDeparture: 6 });
    expect(d.notify).toBe(true);
    expect(d.reason).toBe("departure_imminent");
    expect(d.nextImminentNotified).toBe(true);
  });

  it("only ever calls last once", () => {
    const d = decide({
      state: { lastAlerted: fp(4700), lostNotified: false, imminentNotified: true },
      observed: fp(4700),
      hoursToDeparture: 6,
    });
    expect(d.notify).toBe(false);
    expect(d.reason).toBe("unchanged");
  });

  it("does not last-call outside the window", () => {
    const d = decide({ state: told(4700), observed: fp(4700), hoursToDeparture: 48 });
    expect(d.notify).toBe(false);
  });
});

describe("the record it leaves", () => {
  it("explains every decision, including the silences", () => {
    // "Why didn't you tell me?" has to be answerable precisely.
    for (const d of [
      decide({ observed: fp(4700) }),
      decide({ state: told(4700), observed: fp(4690) }),
      decide({ state: told(4700), observed: null }),
      decide({ observed: null }),
    ]) {
      expect(d.explanation.length).toBeGreaterThan(10);
    }
  });

  it("never advances the alerted fingerprint on a silent cycle", () => {
    // If silence moved the baseline, a slow drift upward would never be
    // reported — each step too small, the total large.
    const d = decide({ state: told(4700), observed: fp(4690) });
    expect(d.notify).toBe(false);
    expect(d.nextAlerted?.bestPriceCents).toBe(4700);
  });

  it("uses a sane default threshold", () => {
    expect(DEFAULT_IMPROVEMENT_CENTS).toBe(100);
  });
});
