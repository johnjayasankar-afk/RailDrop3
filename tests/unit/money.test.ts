import { describe, expect, it } from "vitest";
import {
  dollarsToCents,
  formatUsd,
  formatUsdCompact,
  formatUsdPerHour,
  meetsSavingsThreshold,
  partyTotalCents,
} from "@/lib/domain/money";

describe("money", () => {
  it("converts dollars to integer cents", () => {
    expect(dollarsToCents("74.00")).toBe(7400);
    expect(dollarsToCents(74)).toBe(7400);
    expect(dollarsToCents("$1,128.50")).toBe(112850);
  });

  it("never uses floating multiplication for party totals", () => {
    expect(partyTotalCents(7400, 2)).toBe(14800);
  });

  it("applies savings thresholds in cents", () => {
    expect(meetsSavingsThreshold(12800, 7400, 100)).toBe(true);
    expect(meetsSavingsThreshold(12800, 12750, 100)).toBe(false);
    expect(meetsSavingsThreshold(12800, 12700, 100)).toBe(true);
  });

  it("formats compact whole-dollar amounts", () => {
    expect(formatUsdCompact(7400)).toBe("$74");
    expect(formatUsd(7450)).toBe("$74.50");
  });
});

describe("a rate, not an amount", () => {
  it("renders cost-per-hour to the dollar", () => {
    /* It rendered as $29.42/hr: two decimals on a quotient, which reads as a
       measured sum of money rather than a comparison. */
    expect(formatUsdPerHour(2942)).toBe("$29");
    expect(formatUsdPerHour(5885)).toBe("$59");
    expect(formatUsdPerHour(1100)).toBe("$11");
  });

  it("rounds rather than truncates, so a rate never reads low", () => {
    // $29.99/hr floored is $29, which understates what the train costs.
    expect(formatUsdPerHour(2999)).toBe("$30");
    expect(formatUsdPerHour(2950)).toBe("$30");
    expect(formatUsdPerHour(2949)).toBe("$29");
  });
});
