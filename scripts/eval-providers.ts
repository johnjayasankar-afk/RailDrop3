/* Score the fare providers against live Amtrak inventory.
 *
 *   npx tsx scripts/eval-providers.ts                 # every configured provider
 *   npx tsx scripts/eval-providers.ts --provider=wanderu
 *   npx tsx scripts/eval-providers.ts --corridors=BOS-NYP,NYP-WAS --days=7,14
 *
 * Costs real provider credit and takes minutes. It exists because every other
 * accuracy check in this codebase checks our own arithmetic, and none of them
 * can tell you whether the provider read the right number off the page.
 *
 * What it can and cannot claim. There is no ground truth here short of buying
 * a ticket, so this does not score against Amtrak's real price. It measures
 * three things that are checkable: how often a search comes back usable, how
 * many fares fail a plausibility check (which is how you find out the parser
 * has drifted from the page), and — when two providers are configured —
 * whether they agree. Agreement is most useful when it fails: two sources
 * forty per cent apart proves one of them is wrong.
 *
 * The judging lives in src/lib/domain/provider-eval.ts and is unit-tested.
 * This file only runs the queries and prints.
 */

import {
  compareRuns,
  gradeSummary,
  scoreRun,
  summarize,
  type ProviderRun,
  type RunScore,
} from "../src/lib/domain/provider-eval";
import type { FareProvider } from "../src/lib/providers/fare-provider";

/* Same setup as scripts/probe-wanderu.ts: the browsers live in the project so
 * a sandboxed run finds them, and local mode keeps this off any real database.
 * Nothing here writes anywhere — it only searches and scores. */
process.env.PLAYWRIGHT_BROWSERS_PATH ??= `${process.cwd()}/.playwright`;
process.env.RAILDROP_LOCAL ??= "1";

const DEFAULT_CORRIDORS = ["BOS-NYP", "NYP-WAS", "PHL-NYP"];
const DEFAULT_DAYS = [7, 21];

function arg(name: string): string | null {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function isoInDays(days: number): string {
  const at = new Date();
  at.setDate(at.getDate() + days);
  return at.toISOString().slice(0, 10);
}

async function buildProviders(only: string | null): Promise<Array<[string, FareProvider]>> {
  const out: Array<[string, FareProvider]> = [];
  if (!only || only === "wanderu") {
    const { WanderuBrowserProvider } =
      await import("../src/lib/providers/wanderu-browser-provider");
    out.push(["wanderu", new WanderuBrowserProvider()]);
  }
  if ((!only || only === "parse") && process.env.PARSE_API_KEY) {
    const { ParseFareProvider } = await import("../src/lib/providers/parse-fare-provider");
    out.push(["parse", new ParseFareProvider()]);
  }
  return out;
}

async function main(): Promise<void> {
  const corridors = (arg("corridors") ?? DEFAULT_CORRIDORS.join(",")).split(",").filter(Boolean);
  const days = (arg("days") ?? DEFAULT_DAYS.join(","))
    .split(",")
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value));
  const providers = await buildProviders(arg("provider"));

  if (providers.length === 0) {
    console.error("No providers available. Wanderu needs Playwright; Parse needs PARSE_API_KEY.");
    process.exitCode = 1;
    return;
  }

  console.log(
    `Evaluating ${providers.map(([name]) => name).join(", ")} over ${corridors.length} corridors x ${days.length} dates.`,
  );
  console.log("This hits the live site and costs provider credit.\n");

  const byProvider = new Map<string, RunScore[]>();
  /** Keyed corridor+date, so two providers on the same query can be compared. */
  const byQuery = new Map<string, RunScore[]>();

  for (const corridor of corridors) {
    const [originCode, destinationCode] = corridor.split("-");
    if (!originCode || !destinationCode) {
      console.warn(`Skipping "${corridor}" — expected the form BOS-NYP.`);
      continue;
    }
    for (const offset of days) {
      const travelDate = isoInDays(offset);
      for (const [name, provider] of providers) {
        const startedAt = Date.now();
        let run: ProviderRun;
        try {
          const result = await provider.searchTrips({
            originCode,
            destinationCode,
            travelDate,
            passengers: { adultCount: 1 },
          });
          run = {
            provider: name,
            travelDate,
            ok: result.status !== "PROVIDER_ERROR",
            latencyMs: Date.now() - startedAt,
            journeys: result.journeys,
            error: result.providerError?.message,
          };
        } catch (error) {
          run = {
            provider: name,
            travelDate,
            ok: false,
            latencyMs: Date.now() - startedAt,
            journeys: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }

        const score = scoreRun(run, {
          originCode,
          destinationCode,
          travelDate,
          passengerCount: 1,
        });
        byProvider.set(name, [...(byProvider.get(name) ?? []), score]);
        const key = `${corridor}:${travelDate}`;
        byQuery.set(key, [...(byQuery.get(key) ?? []), score]);

        const price =
          score.cheapestCents === null ? "—" : `$${(score.cheapestCents / 100).toFixed(0)}`;
        const rejected = score.rejected.reduce((sum, entry) => sum + entry.count, 0);
        console.log(
          `  ${name.padEnd(8)} ${corridor} ${travelDate}  ${String(Math.round(run.latencyMs / 100) / 10).padStart(5)}s  ` +
            `${String(score.trains).padStart(2)} trains  ${price.padStart(5)}` +
            `${rejected > 0 ? `  ${rejected} implausible (${score.rejected.map((r) => r.code).join(", ")})` : ""}` +
            `${run.ok ? "" : `  FAILED: ${run.error ?? "unknown"}`}`,
        );
      }
    }
  }

  console.log("");
  let failed = false;
  for (const [name, scores] of byProvider) {
    const summary = summarize(scores);
    console.log(`── ${name} ──`);
    console.log(`   usable      ${summary.usable}/${summary.runs}   failed ${summary.failed}`);
    console.log(
      `   latency     p50 ${Math.round(summary.p50LatencyMs / 100) / 10}s   p95 ${Math.round(summary.p95LatencyMs / 100) / 10}s`,
    );
    console.log(
      `   fares       ${summary.believableFares} believable, ${summary.rejectedFares} rejected` +
        (summary.topRejections.length > 0
          ? ` (${summary.topRejections.map((r) => `${r.code}x${r.count}`).join(", ")})`
          : ""),
    );
    console.log(`   coverage    median ${summary.medianTrains} trains per search`);
    const problems = gradeSummary(summary);
    if (problems.length === 0) {
      console.log("   verdict     PASS\n");
    } else {
      failed = true;
      console.log("   verdict     FAIL");
      for (const problem of problems) console.log(`               - ${problem}`);
      console.log("");
    }
  }

  const comparable = [...byQuery.values()].filter((scores) => scores.length > 1);
  if (comparable.length > 0) {
    console.log("── agreement between providers ──");
    for (const scores of comparable) {
      const agreement = compareRuns(scores[0]!, scores[1]!);
      console.log(`   ${scores[0]!.travelDate}  ${agreement.verdict.padEnd(12)} ${agreement.note}`);
      if (agreement.verdict === "diverge") failed = true;
    }
    console.log("");
  } else if (byProvider.size === 1) {
    console.log(
      "Only one provider configured, so nothing to cross-check. Set PARSE_API_KEY to compare two.\n",
    );
  }

  process.exitCode = failed ? 1 : 0;
}

void main();
