/* Scoring a fare provider against reality, and against the other one.
 *
 * Every accuracy claim in this codebase up to now has been a claim about our
 * own arithmetic: that a party total is the per-traveler price times the
 * party, that a duration matches its timestamps. Those are checkable without
 * leaving the process. The thing that was never checked is the part that
 * actually decides whether a number is right — whether the provider told us
 * the truth, and whether two providers looking at the same train agree.
 *
 * This is the pure half of that: given what each provider returned for the
 * same query, score it. The running of the queries belongs to a script,
 * because it costs money and takes minutes; the judging belongs here, because
 * it is arithmetic and should be tested.
 *
 * What "accurate" means here, precisely, because the word is doing a lot of
 * work: we cannot know Amtrak's true price without buying a ticket, so nothing
 * below claims ground truth. What it measures is *agreement* — between
 * providers, and between a provider and itself over time — plus the internal
 * consistency fare-sanity already checks. Two providers agreeing is not proof;
 * two providers disagreeing by forty per cent is proof that at least one of
 * them is wrong, which is the more useful signal and the one nobody had.
 */

import { checkFare, type Rejection, type SanityContext } from "./fare-sanity";
import type { JourneyOption } from "./types";

export interface ProviderRun {
  provider: string;
  travelDate: string;
  ok: boolean;
  latencyMs: number;
  journeys: JourneyOption[];
  error?: string;
}

export interface RunScore {
  provider: string;
  travelDate: string;
  ok: boolean;
  latencyMs: number;
  /** Journeys returned, before screening. */
  offered: number;
  /** Fares that survived fare-sanity. */
  believable: number;
  /** Fares that did not, by reason. */
  rejected: Array<{ code: Rejection["code"]; count: number }>;
  /** Cheapest believable per-traveler fare, or null. */
  cheapestCents: number | null;
  /** How many distinct trains it saw. Coverage, not just price. */
  trains: number;
}

export function scoreRun(run: ProviderRun, context: SanityContext): RunScore {
  const counts = new Map<Rejection["code"], number>();
  let believable = 0;
  let cheapest: number | null = null;
  const trains = new Set<string>();

  for (const journey of run.journeys) {
    if (journey.trainNumber) trains.add(journey.trainNumber);
    for (const fare of journey.fares) {
      const rejections = checkFare(journey, fare, context);
      if (rejections.length > 0) {
        for (const rejection of rejections) {
          counts.set(rejection.code, (counts.get(rejection.code) ?? 0) + 1);
        }
        continue;
      }
      believable += 1;
      const perTraveler = Math.round(
        (fare.totalPartyPriceCents ?? 0) / Math.max(1, context.passengerCount),
      );
      if (perTraveler > 0 && (cheapest === null || perTraveler < cheapest)) cheapest = perTraveler;
    }
  }

  return {
    provider: run.provider,
    travelDate: run.travelDate,
    ok: run.ok,
    latencyMs: run.latencyMs,
    offered: run.journeys.length,
    believable,
    rejected: [...counts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count),
    cheapestCents: cheapest,
    trains: trains.size,
  };
}

export type AgreementVerdict = "agree" | "close" | "diverge" | "incomparable";

export interface Agreement {
  verdict: AgreementVerdict;
  /** Relative gap between the two cheapest prices, 0–1. Null when incomparable. */
  gap: number | null;
  /** Trains both providers saw, as a share of the union. Null when either is empty. */
  overlap: number | null;
  note: string;
}

/** Within this relative gap, two providers are telling the same story. */
const AGREE = 0.02;
/** Beyond this, at least one of them is wrong and we should not average them. */
const DIVERGE = 0.15;

/**
 * Whether two providers looking at the same train on the same day agree.
 *
 * The only external check available without buying a ticket. It cannot say
 * which one is right — but a forty per cent gap means one of them is wrong,
 * and knowing that is worth more than either number on its own.
 */
export function compareRuns(a: RunScore, b: RunScore): Agreement {
  if (!a.ok || !b.ok || a.cheapestCents === null || b.cheapestCents === null) {
    return {
      verdict: "incomparable",
      gap: null,
      overlap: null,
      note: "One of the two returned nothing usable, so there is nothing to compare.",
    };
  }

  const low = Math.min(a.cheapestCents, b.cheapestCents);
  const high = Math.max(a.cheapestCents, b.cheapestCents);
  // Against the lower price, not the mean: a $40 gap on a $50 fare is a
  // different fact from a $40 gap on a $400 one, and dividing by the mean
  // flatters the first.
  const gap = low === 0 ? 1 : (high - low) / low;

  const verdict: AgreementVerdict = gap <= AGREE ? "agree" : gap <= DIVERGE ? "close" : "diverge";
  const note =
    verdict === "agree"
      ? `Both saw the same cheapest fare, within ${Math.round(AGREE * 100)}%.`
      : verdict === "close"
        ? `Cheapest fares differ by ${Math.round(gap * 100)}% — the usual cause is one source including a fee or a different fare bucket.`
        : `Cheapest fares differ by ${Math.round(gap * 100)}%. At least one of these is wrong; do not average them.`;

  return { verdict, gap, overlap: null, note };
}

export interface EvalSummary {
  runs: number;
  /** Runs that returned at least one believable fare. */
  usable: number;
  /** Runs that failed outright. */
  failed: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  /** Fares dropped by fare-sanity, across every run. */
  rejectedFares: number;
  /** Believable fares, across every run. */
  believableFares: number;
  /** Rejection reasons, worst first — what the provider gets wrong. */
  topRejections: Array<{ code: Rejection["code"]; count: number }>;
  /** Median trains seen per usable run. Coverage. */
  medianTrains: number;
}

export function summarize(scores: readonly RunScore[]): EvalSummary {
  const usable = scores.filter((score) => score.ok && score.believable > 0);
  const latencies = scores.filter((s) => s.ok).map((s) => s.latencyMs);
  const counts = new Map<Rejection["code"], number>();
  let rejectedFares = 0;
  let believableFares = 0;
  for (const score of scores) {
    believableFares += score.believable;
    for (const entry of score.rejected) {
      rejectedFares += entry.count;
      counts.set(entry.code, (counts.get(entry.code) ?? 0) + entry.count);
    }
  }

  return {
    runs: scores.length,
    usable: usable.length,
    failed: scores.filter((score) => !score.ok).length,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    rejectedFares,
    believableFares,
    topRejections: [...counts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
    medianTrains: percentile(
      usable.map((score) => score.trains),
      0.5,
    ),
  };
}

/**
 * Whether a summary is good enough to ship, and why not if it is not.
 *
 * Thresholds, not a score. A number between 0 and 1 invites arguing about the
 * number; a list of what failed invites fixing it. Empty means it passed.
 */
export function gradeSummary(summary: EvalSummary): string[] {
  const problems: string[] = [];
  if (summary.runs === 0) return ["No runs — nothing was measured."];

  const usableShare = summary.usable / summary.runs;
  if (usableShare < 0.9) {
    problems.push(
      `Only ${Math.round(usableShare * 100)}% of searches came back with a usable fare (want 90%).`,
    );
  }
  const total = summary.believableFares + summary.rejectedFares;
  if (total > 0) {
    const rejectShare = summary.rejectedFares / total;
    if (rejectShare > 0.05) {
      problems.push(
        `${Math.round(rejectShare * 100)}% of fares failed a plausibility check (want under 5%) — the parser is drifting from the page.`,
      );
    }
  }
  if (summary.p95LatencyMs > 30_000) {
    problems.push(
      `p95 latency is ${Math.round(summary.p95LatencyMs / 1000)}s (want under 30s) — a cycle of several dates will not finish inside the function timeout.`,
    );
  }
  if (summary.usable > 0 && summary.medianTrains < 3) {
    problems.push(
      `Median of ${summary.medianTrains} trains per search (want 3+) — the search is finding the corridor but not its inventory.`,
    );
  }
  return problems;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction));
  return sorted[index]!;
}
