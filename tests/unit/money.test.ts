import { describe, expect, it } from "vitest";
import {
  dollarsToCents,
  formatUsd,
  formatUsdCompact,
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
