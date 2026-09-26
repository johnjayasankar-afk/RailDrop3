/* A ceiling on what the product may spend looking things up.
 *
 * The monthly budget existed as a number on the settings page and nothing
 * else: it was projected, displayed, and never enforced. A cron that woke up
 * wrong, a corridor that retried, or simply more travelers than expected could
 * spend without any limit at all.
 *
 * Phase 5.1 made that urgent rather than theoretical. Dispatch used to die
 * after two or three watches, which was a terrible reliability story and an
 * accidental spending cap. Now that every watch reliably gets its own
 * invocation, the accidental cap is gone and a real one has to replace it.
 *
 * Exhausting the budget is a state the product says out loud. The alternative
 * is a board that quietly stops finding cheaper fares, which reads to the
 * traveler exactly like a corridor with no cheaper fares — the one confusion
 * this product exists to avoid.
 */

export type BudgetScope = "ok" | "daily" | "monthly";

export interface BudgetDecision {
  /** May another live provider search be started? */
  allow: boolean;
  /** Which ceiling stopped it. */
  scope: BudgetScope;
  /** Plain wording for a log, a health payload, and the board. */
  reason: string | null;
}

export interface BudgetInput {
  searchesToday: number;
  searchesThisMonth: number;
  /** Zero or less means "no ceiling", which is how a local run behaves. */
  dailyCap: number;
  monthlyCap: number;
}

export function budgetDecision(input: BudgetInput): BudgetDecision {
  const daily = input.dailyCap > 0;
  const monthly = input.monthlyCap > 0;

  if (monthly && input.searchesThisMonth >= input.monthlyCap) {
    return {
      allow: false,
      scope: "monthly",
      reason: `The monthly provider budget of ${input.monthlyCap} searches is spent. Checks resume next month, or when the budget is raised.`,
    };
  }
  if (daily && input.searchesToday >= input.dailyCap) {
    return {
      allow: false,
      scope: "daily",
      reason: `Today's provider budget of ${input.dailyCap} searches is spent. Checks resume tomorrow.`,
    };
  }
  return { allow: true, scope: "ok", reason: null };
}

/**
 * How close to the ceiling, for a meter rather than a cliff.
 *
 * Returns null when no ceiling applies, so the caller shows nothing rather
 * than a bar implying a limit that does not exist.
 */
export function budgetPressure(input: BudgetInput): {
  dailyUsedFraction: number | null;
  monthlyUsedFraction: number | null;
  nearingLimit: boolean;
} {
  const dailyUsedFraction =
    input.dailyCap > 0 ? Math.min(1, input.searchesToday / input.dailyCap) : null;
  const monthlyUsedFraction =
    input.monthlyCap > 0 ? Math.min(1, input.searchesThisMonth / input.monthlyCap) : null;
  const worst = Math.max(dailyUsedFraction ?? 0, monthlyUsedFraction ?? 0);
  return { dailyUsedFraction, monthlyUsedFraction, nearingLimit: worst >= 0.8 };
}

/** First day of the month a date falls in, as an ISO date. */
export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}
