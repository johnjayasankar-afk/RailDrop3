import { describe, expect, it } from "vitest";
import {
  findPriceMentions,
  supportedAmounts,
  unsupportedAnswerNotice,
  verifyAnswer,
} from "@/lib/domain/assistant-verify";

/* Holding a language model to the same rule as everything else.
 *
 * The product's one promise is that it never states a price it did not
 * observe. A model writes fluent sentences, and "$89" inside a fluent sentence
 * is indistinguishable to a reader from a fare that was actually listed — so
 * the prompt asking it not to is a request, and this is the constraint.
 */

// A real BOS→NYP board: $50, $91, $123, $126.
const observed = [5_000, 9_100, 12_300, 12_600];

describe("reading prices out of an answer", () => {
  it("finds the plain ones", () => {
    expect(findPriceMentions("It is $50 today.").map((m) => m.cents)).toEqual([5_000]);
  });

  it("reads cents, and reads a single decimal as tenths of a dollar", () => {
    // "$5.5" is five dollars fifty, not five dollars and five cents.
    expect(findPriceMentions("$12.34 and $5.5").map((m) => m.cents)).toEqual([1_234, 550]);
  });

  it("reads thousands separators", () => {
    expect(findPriceMentions("$1,234.50").map((m) => m.cents)).toEqual([123_450]);
  });

  it("ignores numbers that are not money", () => {
    /* The check has to stay narrow to stay switched on. Flagging every number
       would flag train numbers and clock times, and a check that fires on
       "Northeast Regional 169" is one somebody turns off. */
    const text = "Northeast Regional 169 departs 07:55 on Oct 4 with 2 seats left.";
    expect(findPriceMentions(text)).toEqual([]);
  });
});

describe("what the assistant is allowed to say", () => {
  it("allows a fare that was observed", () => {
    expect(verifyAnswer("The cheapest is $50.", observed).ok).toBe(true);
  });

  it("allows the difference between two observed fares", () => {
    // "$76 cheaper" is 12,600 − 5,000. Subtraction of two things we saw is a
    // fact we can stand behind, and it is the answer the product exists to give.
    expect(verifyAnswer("Switching saves you $76.", observed).ok).toBe(true);
  });

  it("allows a rounded restatement", () => {
    // Prose rounds. "About $123" for 12,300 is not an invented number.
    expect(verifyAnswer("About $123 on the 5th.", observed).ok).toBe(true);
  });

  it("refuses a fare that was never listed", () => {
    const verdict = verifyAnswer("Acela is running at $89.", observed);
    expect(verdict.ok).toBe(false);
    expect(verdict.unsupported.map((m) => m.text)).toEqual(["$89"]);
  });

  it("refuses the invented one while still seeing the real one", () => {
    const verdict = verifyAnswer("Regional is $50 but Acela is $212.", observed);
    expect(verdict.mentions).toHaveLength(2);
    expect(verdict.unsupported.map((m) => m.text)).toEqual(["$212"]);
  });

  it("says nothing is supported when nothing was observed", () => {
    /* An empty board must not become a licence to make things up — with no
       observations, every amount is unsupported. */
    expect(verifyAnswer("It is about $60.", []).ok).toBe(false);
  });

  it("allows an answer with no prices in it at all", () => {
    expect(verifyAnswer("Acela is usually faster than Regional.", []).ok).toBe(true);
  });
});

describe("the allowed set", () => {
  it("contains the observations and the gaps between them", () => {
    const allowed = supportedAmounts([5_000, 12_600]);
    expect(allowed.has(5_000)).toBe(true);
    expect(allowed.has(12_600)).toBe(true);
    expect(allowed.has(7_600)).toBe(true);
  });

  it("does not contain sums, which are not a fact about anything", () => {
    // 5,000 + 12,600 is not a fare, a saving, or a total anybody would pay.
    expect(supportedAmounts([5_000, 12_600]).has(17_600)).toBe(false);
  });
});

describe("what the reader is shown instead", () => {
  it("names the amount rather than quietly deleting it", () => {
    /* A sentence with the number silently removed still reads as an answer,
       and the reader cannot tell a claim was taken out of it. */
    const verdict = verifyAnswer("Acela is $89.", observed);
    const notice = unsupportedAnswerNotice(verdict);
    expect(notice).toContain("$89");
    expect(notice).toMatch(/observed/i);
    expect(notice).not.toContain("Acela is $89");
  });
});
