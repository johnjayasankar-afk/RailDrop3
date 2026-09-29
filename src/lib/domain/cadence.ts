/* How often we actually look, stated once.
 *
 * The product told travelers, in three places, that it checks three times a
 * day. `vercel.json` ships one cron. One run a day is the Hobby plan's limit,
 * so the sentence was never true on this deployment — and it was not a
 * marketing overstatement, it was load-bearing. `waitOrBook`'s volatile branch
 * says "if you can hold, we check three times a day and will write the moment
 * it drops", which is the product advising someone to keep their money on the
 * table on the strength of a cadence it does not have.
 *
 * Every confidence claim the app makes is a claim about a sampling process.
 * "We have seen this corridor move between $47 and $133", "volatility",
 * "recent direction", the twelve-observation evidence floor — all of them
 * describe a sample, and a misstated sampling rate misdescribes every one.
 *
 * So the cadence is a value, not prose, and `tests/unit/cadence.test.ts` reads
 * `vercel.json` and fails if this disagrees with what the deployment actually
 * schedules, or if any string in `src/` claims a different number. Copy cannot
 * drift away from the crontab, because nobody edits both.
 *
 * Raising this means adding crons to vercel.json first. It is not a dial.
 */

/**
 * Scheduled wakes per day, from `vercel.json`.
 *
 * Not "slots". The app models three daily slots — morning, afternoon, evening
 * — and `dueSlotsAt` still answers which of them have passed, because that is
 * the right question for a deployment that wakes more than once. This is the
 * number of times anything actually asks.
 */
export const SCHEDULED_WAKES_PER_DAY = 1;

const TIMES: Record<number, string> = {
  1: "once a day",
  2: "twice a day",
  3: "three times a day",
  4: "four times a day",
  6: "six times a day",
  8: "eight times a day",
  12: "twelve times a day",
  24: "every hour",
};

/** "once a day", "three times a day" — for the middle of a sentence. */
export function cadencePhrase(wakes: number = SCHEDULED_WAKES_PER_DAY): string {
  return TIMES[wakes] ?? `${wakes} times a day`;
}

/**
 * The methodology page's answer to "how often do you check?".
 *
 * It says what we do and, when the two differ, that we would rather do more —
 * because a reader deciding whether to trust a fare history is entitled to
 * know the sample is thinner than the design intends, and finding that out
 * later is the thing that costs trust.
 */
export function cadenceSentence(wakes: number = SCHEDULED_WAKES_PER_DAY): string {
  // Sentence-initial: this opens the "How often we look" paragraph, and the
  // phrase is lowercase because its other callers use it mid-sentence.
  const opening = cadencePhrase(wakes).charAt(0).toUpperCase() + cadencePhrase(wakes).slice(1);
  if (wakes >= 3) {
    return `${opening} — morning, afternoon and evening in the timezone of your trip.`;
  }
  return (
    `${opening}, in the morning, wherever in the country your trip starts. ` +
    `The board is built for three checks a day and the hosting plan allows one scheduled run, ` +
    `so that is what it does — and every fare history and confidence figure here describes a ` +
    `once-daily sample rather than a three-times-daily one. Press C on a trip to check right now.`
  );
}

/**
 * What `waitOrBook` may promise someone who holds.
 *
 * The old sentence ended "and will write the moment it drops". At one check a
 * day that is false twice over: we will not see a drop that happens and
 * reverses between wakes, and "the moment" is up to twenty-four hours.
 */
export function holdPromise(wakes: number = SCHEDULED_WAKES_PER_DAY): string {
  if (wakes >= 3) {
    return `If you can hold, we check ${cadencePhrase(wakes)} and will write the moment it drops.`;
  }
  return (
    `If you can hold, we check ${cadencePhrase(wakes)} and will write when we next see it lower — ` +
    `a drop that comes and goes between checks is one we will miss.`
  );
}
