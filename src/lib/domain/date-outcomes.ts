import type { FarePreview } from "@/lib/fares/preview-fares";

/* What happened to each date in the window, as a partition.
 *
 * Every date the search asked about ended in exactly one of four states, and
 * the colophon prints them as counts under "Dates requested". They have to
 * add up, because the one thing the colophon is for is letting a reader check
 * that the page is accounting for everything it looked at.
 *
 * They did not add up. `unreadableDates` was also pushed into `failedDates`,
 * so one bad date out of three rendered as "Answered 2 · Not answered 1 ·
 * Unreadable 1" — four outcomes for three dates, the same date claimed twice,
 * and claimed as two things that are opposites. Separately, a date the
 * provider answered for with an empty board appeared in no array at all and
 * so appeared in no row: the reader subtracted and got an unexplained date.
 *
 * The distinction this preserves is the one the methodology page stakes the
 * product on: a date nobody could reach, a date that was reached and could
 * not be parsed, and a date that was read clearly and had nothing for sale
 * are three different facts. Only the last one means "no fares".
 */
export interface DateOutcomes {
  /** Dates that produced at least one eligible fare. */
  answered: number;
  /** Read cleanly, nothing for sale. Not the same as a failure. */
  empty: number;
  /** Never reached: a refusal, a timeout, a provider that did not reply. */
  failed: number;
  /** Reached, and the page could not be trusted once parsed. */
  unreadable: number;
}

export function dateOutcomes(preview: {
  dates: readonly string[];
  byDate: ReadonlyArray<readonly [string, unknown]>;
  failedDates: readonly string[];
  unreadableDates: readonly string[];
}): DateOutcomes {
  const withFares = new Set(preview.byDate.map(([date]) => date));
  const unreadable = new Set(preview.unreadableDates);
  const failed = new Set(preview.failedDates);

  /* One pass, one outcome each, in precedence order — so the counts add up
     even if a caller hands us overlapping sets, which is exactly how this
     went wrong the first time. A date that produced fares was plainly read,
     whatever else it was recorded as; after that, "we could not parse it"
     is more specific than "we did not get it". */
  const counts: DateOutcomes = { answered: 0, empty: 0, failed: 0, unreadable: 0 };
  for (const date of preview.dates) {
    if (withFares.has(date)) counts.answered += 1;
    else if (unreadable.has(date)) counts.unreadable += 1;
    else if (failed.has(date)) counts.failed += 1;
    else counts.empty += 1;
  }
  return counts;
}

/** Whether part of the window went unread, so a "cheapest" claim is partial. */
export function windowWasPartial(outcomes: DateOutcomes): boolean {
  return outcomes.failed > 0 || outcomes.unreadable > 0;
}

export type { FarePreview };
