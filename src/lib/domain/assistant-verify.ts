/* The other half of "we never invent a price", applied to a language model.
 *
 * Everywhere else in this codebase a price reaches a reader only if a provider
 * was observed saying it. An assistant breaks that guarantee by construction: it
 * writes fluent sentences, and a fluent sentence containing "$89" is
 * indistinguishable, to the reader, from a fare we actually saw. Being careful
 * in the prompt is not enough — a prompt is a request, not a constraint.
 *
 * So the answer is checked before anyone sees it. Every currency amount in the
 * text must be one we observed, or something arithmetic on what we observed:
 * the difference between two fares is a fact we can stand behind ("that is $81
 * cheaper"), a fare we never saw is not.
 *
 * Deliberately narrow. It reads currency-formatted amounts only, because those
 * are the claims that matter and the ones a reader will act on. Train numbers,
 * clock times, seat counts and dates are left alone — widening this to every
 * number in the text would flag "Northeast Regional 169" and make the check
 * useless, which is how a safety check ends up switched off.
 */

/** Cents, so comparisons are exact. Floating dollars would make 89.10 ≠ 89.1. */
export interface PriceMention {
  /** As written, e.g. "$1,234.50". */
  text: string;
  cents: number;
  index: number;
}

export interface Verdict {
  ok: boolean;
  /** Amounts in the answer that we never observed and cannot derive. */
  unsupported: PriceMention[];
  mentions: PriceMention[];
}

/* $50 · $50.00 · $1,234 · $1,234.50.
 * Requires the symbol: a bare "50" is a train number as often as a fare. */
const MONEY = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g;

/* 50 dollars · 1,234.50 dollars · 12 bucks.
 *
 * The symbol was the only thing this looked for, so every amount written as a
 * word walked past the whitelist untouched — and "it is 74 dollars" is at
 * least as natural a sentence for a model to produce as "it is $74". The
 * guard that exists to stop the assistant stating a fare nobody observed had
 * a hole exactly the width of the most ordinary phrasing in English. */
const MONEY_WORDS = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s?(?:dollars?|bucks)\b/gi;

/* seventy-four dollars.
 *
 * Rarer, and the same hole. Bounded at "ninety-nine hundred" on purpose: a
 * spelled-out fare above that is not a sentence anyone writes, and parsing
 * arbitrary English numerals would be a parser to maintain rather than a
 * guard. Anything it cannot read stays unmatched, which fails open — so the
 * digit forms above are the ones doing the work. */
const UNITS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const SPELLED =
  /\b((?:one|two|three|four|five|six|seven|eight|nine)\s+hundred(?:\s+and)?\s+)?((?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\s](?:one|two|three|four|five|six|seven|eight|nine))?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\s+(?:dollars?|bucks)\b/gi;

function spelledToNumber(hundreds: string | undefined, rest: string): number | null {
  let total = 0;
  if (hundreds) {
    const word = hundreds.trim().split(/\s+/)[0]!.toLowerCase();
    if (UNITS[word] === undefined) return null;
    total += UNITS[word] * 100;
  }
  const parts = rest.toLowerCase().split(/[-\s]+/);
  for (const part of parts) {
    if (TENS[part] !== undefined) total += TENS[part];
    else if (UNITS[part] !== undefined) total += UNITS[part];
    else return null;
  }
  return total;
}

export function findPriceMentions(answer: string): PriceMention[] {
  const out: PriceMention[] = [];
  const push = (text: string, cents: number, index: number) => {
    if (!Number.isFinite(cents)) return;
    // The same amount written twice in one answer is one claim to check.
    if (out.some((m) => m.index === index)) return;
    out.push({ text, cents, index });
  };

  for (const match of answer.matchAll(MONEY)) {
    const whole = Number.parseInt((match[1] ?? "0").replace(/,/g, ""), 10);
    // "$5.5" is five dollars fifty, not five dollars five cents.
    const fraction = match[2] ? Number.parseInt(match[2].padEnd(2, "0"), 10) : 0;
    push(match[0], whole * 100 + fraction, match.index ?? 0);
  }

  for (const match of answer.matchAll(MONEY_WORDS)) {
    const whole = Number.parseInt((match[1] ?? "0").replace(/,/g, ""), 10);
    const fraction = match[2] ? Number.parseInt(match[2].padEnd(2, "0"), 10) : 0;
    push(match[0], whole * 100 + fraction, match.index ?? 0);
  }

  for (const match of answer.matchAll(SPELLED)) {
    const value = spelledToNumber(match[1], match[2] ?? "");
    if (value === null) continue;
    push(match[0], value * 100, match.index ?? 0);
  }

  return out.sort((a, b) => a.index - b.index);
}

/**
 * Every amount the assistant is allowed to write.
 *
 * The observed prices, and the gaps between them. A saving is the subtraction
 * of two things we saw, so it is as well-founded as either — and refusing to
 * let the assistant say "that is $81 cheaper" would make it unable to answer
 * the question the product exists to answer.
 */
export function supportedAmounts(observedCents: readonly number[]): Set<number> {
  const allowed = new Set<number>();
  const clean = observedCents.filter((cents) => Number.isFinite(cents) && cents >= 0);
  for (const cents of clean) allowed.add(cents);
  for (const a of clean) {
    for (const b of clean) {
      const gap = Math.abs(a - b);
      if (gap > 0) allowed.add(gap);
    }
  }
  // Zero is never a fare, but "$0 difference" is a sentence about no change.
  allowed.add(0);
  return allowed;
}

/**
 * Check an answer against what we observed.
 *
 * `toleranceCents` exists because a model writing prose rounds: "about $130"
 * for 12,950 is a reasonable way to say it and not an invented number. The
 * default is one dollar, which is small enough that no real fare is reachable
 * from a different real fare by rounding.
 */
export function verifyAnswer(
  answer: string,
  observedCents: readonly number[],
  toleranceCents = 100,
): Verdict {
  const mentions = findPriceMentions(answer);
  const allowed = supportedAmounts(observedCents);
  const unsupported = mentions.filter((mention) => {
    for (const candidate of allowed) {
      if (Math.abs(candidate - mention.cents) <= toleranceCents) return false;
    }
    return true;
  });
  return { ok: unsupported.length === 0, unsupported, mentions };
}

/**
 * What to show instead when an answer states a price we cannot support.
 *
 * Not a silent redaction. A sentence with the number quietly removed still
 * reads as an answer, and the reader has no way to know a claim was taken out
 * of it — so the whole answer goes, and it says why.
 */
export function unsupportedAnswerNotice(verdict: Verdict): string {
  const amounts = [...new Set(verdict.unsupported.map((mention) => mention.text))];
  const list = amounts.slice(0, 3).join(", ");
  return (
    `That answer quoted ${amounts.length === 1 ? "a price" : "prices"} (${list}) that ` +
    "does not appear anywhere in what the board actually observed, so it is not being shown. " +
    "Everything RailDrop tells you about a fare comes from a listing it saw. Ask again, or " +
    "read the board above — those numbers are the observed ones."
  );
}
