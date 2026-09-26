/* What the corridor has actually done, from what we actually saw.
 *
 * The board checks three times a day and, until the cycle started recording its
 * cheapest observation, kept only the latest one. The panel headed "Price
 * history" plotted booking_price_events — the traveler's own benchmark, which
 * changes only when they press "I rebooked" — so for almost every watch it was
 * a single point, and for none of them was it a history of fares.
 *
 * Everything here is derived from observations the product made and stored. It
 * states what was seen and when. It does not interpolate between checks, it
 * does not smooth, and nothing in this file predicts a price — a gap in the
 * data is drawn as a gap, because "we did not look" and "it was that price" are
 * different claims and only one of them is ours to make.
 */

/** One look at the market. `cents` null means it looked and saw nothing. */
export interface Observation {
  at: string;
  cents: number | null;
  travelDate?: string | null;
}

export interface FarePoint {
  at: string;
  /** Epoch ms, for positioning. */
  t: number;
  cents: number;
  travelDate: string | null;
}

export interface Move {
  from: number;
  to: number;
  at: string;
  deltaCents: number;
  direction: "down" | "up";
}

export interface FareHistory {
  /** Only the checks that saw a price, oldest first. */
  points: FarePoint[];
  /** Every check, including the blind ones — the denominator for "how often". */
  checks: number;
  lowest: FarePoint | null;
  highest: FarePoint | null;
  latest: FarePoint | null;
  /** Changes between consecutive observations, oldest first. */
  moves: Move[];
  spanHours: number;
}

/**
 * The series, cleaned but not smoothed.
 *
 * Sorted by time because cycle order is not guaranteed by any query, and a
 * chart drawn from unsorted points is a scribble.
 */
export function buildHistory(observations: readonly Observation[]): FareHistory {
  const points: FarePoint[] = [];
  for (const observation of observations) {
    const t = Date.parse(observation.at);
    if (!Number.isFinite(t)) continue;
    if (observation.cents === null || observation.cents === undefined) continue;
    if (!Number.isFinite(observation.cents) || observation.cents <= 0) continue;
    points.push({
      at: observation.at,
      t,
      cents: observation.cents,
      travelDate: observation.travelDate ?? null,
    });
  }
  points.sort((a, b) => a.t - b.t);

  const moves: Move[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    if (current.cents === previous.cents) continue;
    moves.push({
      from: previous.cents,
      to: current.cents,
      at: current.at,
      deltaCents: current.cents - previous.cents,
      direction: current.cents < previous.cents ? "down" : "up",
    });
  }

  let lowest: FarePoint | null = null;
  let highest: FarePoint | null = null;
  for (const point of points) {
    // Strict comparisons: on a tie the earlier sighting wins, because "the
    // cheapest was on Tuesday" should name the first time it was that cheap.
    if (!lowest || point.cents < lowest.cents) lowest = point;
    if (!highest || point.cents > highest.cents) highest = point;
  }

  const first = points[0];
  const last = points[points.length - 1];
  const spanHours = first && last ? Math.max(0, (last.t - first.t) / 3_600_000) : 0;

  return {
    points,
    checks: observations.filter((o) => Number.isFinite(Date.parse(o.at))).length,
    lowest,
    highest,
    latest: last ?? null,
    moves,
    spanHours,
  };
}

/**
 * "This corridor moved 6 times in 48h, range $47–$133."
 *
 * Null until there is enough to say anything: two points is a line, not a
 * pattern, and a volatility claim from one move would be a number dressed up as
 * a finding.
 */
export function volatilityNote(history: FareHistory): string | null {
  if (history.moves.length < 2 || !history.lowest || !history.highest) return null;
  if (history.lowest.cents === history.highest.cents) return null;
  const hours = Math.round(history.spanHours);
  const window =
    hours < 1 ? "under an hour" : hours < 48 ? `${hours}h` : `${Math.round(hours / 24)} days`;
  return `${history.moves.length} price changes in ${window}, between ${usd(history.lowest.cents)} and ${usd(history.highest.cents)}.`;
}

/**
 * "The cheapest we saw was $47, 14 hours ago."
 *
 * Deliberately not "you missed it by 14 hours" unless it is actually gone: the
 * brief asked for an honest missed-it marker, and telling someone they missed
 * a fare that is still available would be a lie that costs them money.
 */
export function bestEverNote(history: FareHistory, nowMs: number | null): string | null {
  const { lowest, latest } = history;
  if (!lowest || !latest) return null;
  if (history.points.length < 2) return null;
  const price = usd(lowest.cents);
  if (lowest.cents >= latest.cents) {
    return `The cheapest we have seen is ${price}, and that is what is listed now.`;
  }
  // No clock yet — on the server, and on the first client render, where reading
  // one would hydrate a different tree than was sent. The sentence is true
  // without the "ago"; the relative time is the enhancement.
  const when = nowMs ? `, ${describeAgo(nowMs - lowest.t)}` : "";
  return `The cheapest we have seen was ${price}${when}. It is ${usd(latest.cents)} now — ${usd(latest.cents - lowest.cents)} more.`;
}

/** Whether the last few observations moved consistently, and which way. */
export function recentDirection(
  history: FareHistory,
  sample = 3,
): { direction: "down" | "up" | "mixed" | "flat"; moves: Move[] } {
  const moves = history.moves.slice(-sample);
  if (moves.length === 0) return { direction: "flat", moves };
  const down = moves.filter((move) => move.direction === "down").length;
  if (down === moves.length) return { direction: "down", moves };
  if (down === 0) return { direction: "up", moves };
  return { direction: "mixed", moves };
}

/**
 * How much the price swings, as a fraction of its own middle.
 *
 * Relative rather than absolute so a $300 corridor and a $40 one are comparable:
 * a $20 swing is noise on one and a third of the fare on the other. Returns 0
 * when there is nothing to measure, which callers read as "no evidence" and not
 * as "stable".
 */
export function volatility(history: FareHistory): number {
  const { lowest, highest } = history;
  if (!lowest || !highest || history.points.length < 2) return 0;
  const mid = (lowest.cents + highest.cents) / 2;
  if (mid <= 0) return 0;
  return (highest.cents - lowest.cents) / mid;
}

/* ── the chart ─────────────────────────────────────────────────────────────
 * Geometry only, so the SVG in the component is markup and this is tested.
 */

export interface ChartPoint {
  x: number;
  y: number;
  cents: number;
  at: string;
}

export interface ChartGeometry {
  width: number;
  height: number;
  points: ChartPoint[];
  /** Polyline segments. Separate arrays so a gap in the data is a gap. */
  segments: ChartPoint[][];
  /** Where the traveler's booking sits, or null when it is off the scale. */
  benchmarkY: number | null;
  low: number;
  high: number;
}

/**
 * Lay the series out in an SVG box.
 *
 * `gapMs` splits the line: two checks a week apart should not be joined by a
 * confident straight line implying we watched the price slide between them. We
 * did not look. The chart says so by not drawing there.
 */
export function chartGeometry(
  history: FareHistory,
  options: {
    width: number;
    height: number;
    benchmarkCents?: number | null;
    padding?: number;
    gapMs?: number;
  },
): ChartGeometry {
  const { width, height } = options;
  const padding = options.padding ?? 4;
  const gapMs = options.gapMs ?? 26 * 3_600_000;
  const points = history.points;

  const values = points.map((point) => point.cents);
  if (options.benchmarkCents && options.benchmarkCents > 0) values.push(options.benchmarkCents);
  let low = values.length ? Math.min(...values) : 0;
  let high = values.length ? Math.max(...values) : 0;
  if (high === low) {
    // A flat series would divide by zero and draw on the top edge. Give it a
    // little room so it reads as a flat line in the middle, which it is.
    low = Math.max(0, low - 100);
    high = high + 100;
  }

  const innerH = Math.max(1, height - padding * 2);
  const toY = (cents: number) => padding + (1 - (cents - low) / (high - low)) * innerH;

  const firstT = points[0]?.t ?? 0;
  const lastT = points[points.length - 1]?.t ?? 0;
  const spanT = Math.max(1, lastT - firstT);
  const innerW = Math.max(1, width - padding * 2);

  const laid: ChartPoint[] = points.map((point) => ({
    // A single point sits at the right edge, where "now" is.
    x: points.length === 1 ? width - padding : padding + ((point.t - firstT) / spanT) * innerW,
    y: toY(point.cents),
    cents: point.cents,
    at: point.at,
  }));

  const segments: ChartPoint[][] = [];
  let run: ChartPoint[] = [];
  for (let index = 0; index < laid.length; index += 1) {
    if (index > 0 && points[index]!.t - points[index - 1]!.t > gapMs) {
      if (run.length) segments.push(run);
      run = [];
    }
    run.push(laid[index]!);
  }
  if (run.length) segments.push(run);

  const benchmark = options.benchmarkCents ?? null;
  const benchmarkY =
    benchmark && benchmark > 0 && benchmark >= low && benchmark <= high ? toY(benchmark) : null;

  return { width, height, points: laid, segments, benchmarkY, low, high };
}

function usd(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars)
    ? `$${dollars.toLocaleString("en-US")}`
    : `$${dollars.toFixed(2)}`;
}

function describeAgo(ms: number): string {
  if (ms < 0) return "just now";
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60_000))} minutes ago`;
  if (hours < 24) return `${Math.round(hours)} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
