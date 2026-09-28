import type { CorridorStats } from "./corridor-stats";
import type { RankedCandidate } from "./types";
import { formatDisplayDate } from "./calendar";
import { formatUsdCompact } from "./money";

/* What the assistant is allowed to know.
 *
 * The model gets a fact sheet and nothing else — no database handle, no
 * provider, no ability to look anything up. Everything it can say about a fare
 * has to come from here, which makes the question "could it invent a price"
 * answerable by reading one function instead of by trusting a prompt.
 *
 * The other half is the absences. A model handed a partial picture will fill
 * the gap plausibly, so the briefing states what is missing as explicitly as
 * what is present: no history yet, no fares on this date, the window was never
 * searched. Naming a gap is what stops it being guessed.
 */

export interface AssistantFacts {
  /** The prose the model reads. Deterministic for a given input. */
  briefing: string;
  /**
   * Every amount, in cents, the answer may contain — see assistant-verify.
   * Collected here rather than parsed back out of the briefing so the two
   * cannot drift.
   */
  observedCents: number[];
}

export interface GroundingInput {
  trip: {
    originCode: string;
    destinationCode: string;
    desiredTravelDate: string;
    dateFlexibilityDays: number;
    passengerCount: number;
    /** What they already paid, if this is a watch rather than a search. */
    bookedPriceCents: number | null;
  };
  /** The board as ranked, cheapest first. Already screened. */
  board: readonly RankedCandidate[];
  /** Thirty days of this corridor, when there is enough of it to describe. */
  corridor: CorridorStats | null;
  /** Dates in the window the provider could not answer for. */
  failedDates: readonly string[];
  /** Today, in the watch's timezone. */
  today: string;
  /** How many times this trip has been checked. */
  scanCount: number;
}

const MAX_BOARD_ROWS = 12;

export function buildAssistantFacts(input: GroundingInput): AssistantFacts {
  const observed: number[] = [];
  const lines: string[] = [];
  const { trip, board, corridor } = input;

  lines.push("## The trip");
  lines.push(
    `${trip.originCode} to ${trip.destinationCode}, ${formatDisplayDate(trip.desiredTravelDate)}` +
      `${trip.dateFlexibilityDays > 0 ? ` (flexible ±${trip.dateFlexibilityDays} day${trip.dateFlexibilityDays === 1 ? "" : "s"})` : " (exact date only)"}` +
      `, ${trip.passengerCount} passenger${trip.passengerCount === 1 ? "" : "s"}.`,
  );
  lines.push(`Today is ${formatDisplayDate(input.today)}.`);
  if (trip.bookedPriceCents !== null && trip.bookedPriceCents > 0) {
    observed.push(trip.bookedPriceCents);
    lines.push(
      `They have already booked this trip and paid ${formatUsdCompact(trip.bookedPriceCents)} in total.`,
    );
  } else {
    lines.push(
      "They have not told us what they paid, so there is nothing to compare against — do not describe any fare as a saving.",
    );
  }

  lines.push("");
  lines.push("## Fares currently on the board");
  if (board.length === 0) {
    lines.push(
      "None. The board is empty for this window, so there is no fare to quote. Say that plainly rather than estimating one.",
    );
  } else {
    lines.push(
      `${board.length} listed fare${board.length === 1 ? "" : "s"}, cheapest first. These are the only fares that exist for this question.`,
    );
    for (const candidate of board.slice(0, MAX_BOARD_ROWS)) {
      observed.push(candidate.totalPartyPriceCents);
      const train =
        candidate.journey.trainNumber != null
          ? `${candidate.journey.serviceName ?? "Train"} ${candidate.journey.trainNumber}`
          : (candidate.journey.serviceName ?? "Train");
      const saving =
        candidate.savingsCents > 0
          ? `, ${formatUsdCompact(candidate.savingsCents)} below what they paid`
          : "";
      lines.push(
        `- ${formatUsdCompact(candidate.totalPartyPriceCents)} — ${train}, ` +
          `${formatDisplayDate(candidate.journey.searchedTravelDate)}, departs ${clock(candidate.journey.departureAt)}${saving}.`,
      );
    }
    if (board.length > MAX_BOARD_ROWS) {
      lines.push(
        `- (${board.length - MAX_BOARD_ROWS} further fares, all dearer than those above.)`,
      );
    }
  }

  if (input.failedDates.length > 0) {
    lines.push("");
    lines.push(
      `Dates in the window that could not be searched: ${input.failedDates.join(", ")}. ` +
        "Those are unknown, not empty — do not say there are no fares on them.",
    );
  }

  lines.push("");
  lines.push("## What this route has cost");
  if (!corridor) {
    lines.push(
      "Not enough history yet to describe this corridor. Do not characterise the fare as high or low — there is nothing to compare it with.",
    );
  } else {
    observed.push(corridor.low, corridor.p25, corridor.median, corridor.p75, corridor.high);
    lines.push(
      `From ${corridor.count} checks across ${corridor.dates} travel dates over the last ${corridor.spanDays} days: ` +
        `cheapest seen ${formatUsdCompact(corridor.low)}, typical ${formatUsdCompact(corridor.median)}, ` +
        `dearest seen ${formatUsdCompact(corridor.high)} ` +
        `(middle half ${formatUsdCompact(corridor.p25)}–${formatUsdCompact(corridor.p75)}).`,
    );
  }

  lines.push("");
  lines.push(
    `This trip has been checked ${input.scanCount} time${input.scanCount === 1 ? "" : "s"}.`,
  );

  return { briefing: lines.join("\n"), observedCents: observed };
}

function clock(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "an unknown time";
  return at.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}
