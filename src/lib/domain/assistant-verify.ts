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

export function findPriceMentions(answer: string): PriceMention[] {
  const out: PriceMention[] = [];
  for (const match of answer.matchAll(MONEY)) {
    const whole = Number.parseInt((match[1] ?? "0").replace(/,/g, ""), 10);
    // "$5.5" is five dollars fifty, not five dollars five cents.
    const fraction = match[2] ? Number.parseInt(match[2].padEnd(2, "0"), 10) : 0;
    if (!Number.isFinite(whole)) continue;
    out.push({
      text: match[0],
      cents: whole * 100 + fraction,
      index: match.index ?? 0,
    });
  }
  return out;
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
