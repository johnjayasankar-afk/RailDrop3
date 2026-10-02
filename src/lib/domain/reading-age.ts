/* How old the reading on screen is.
 *
 * A fare is a reading taken at an instant, and the methodology page stakes
 * the product on saying so: "a reading goes stale the moment it is taken.
 * Every result says when it was read." It said when, in clock time, in the
 * colophon at the very bottom. A reader looking at the headline figure had
 * no idea whether it was read nine seconds or ninety minutes ago, which is
 * the difference between a price and a memory.
 *
 * Phrased in the coarsest unit that is still true, because a counter ticking
 * through "47 seconds ago" implies a precision about a scraped board that
 * nobody has.
 */
export function readingAge(checkedAt: string, now: Date): string {
  const taken = Date.parse(checkedAt);
  if (Number.isNaN(taken)) return "read just now";
  const seconds = Math.max(0, Math.round((now.getTime() - taken) / 1000));
  if (seconds < 45) return "read moments ago";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `read ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  return `read ${hours} hour${hours === 1 ? "" : "s"} ago`;
}

/* Past this, the figures on screen are old enough that showing them without
   saying so would be the product making a claim about now from a reading
   taken then. Five minutes is well inside the time an Amtrak fare can move. */
export const STALE_AFTER_MS = 5 * 60 * 1000;

export function readingIsStale(checkedAt: string, now: Date): boolean {
  const taken = Date.parse(checkedAt);
  if (Number.isNaN(taken)) return false;
  return now.getTime() - taken > STALE_AFTER_MS;
}
