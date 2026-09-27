"use client";

import { useId, useMemo } from "react";
import {
  bestEverNote,
  buildHistory,
  chartGeometry,
  volatilityNote,
  type Observation,
} from "@/lib/domain/fare-history";
import { waitOrBook } from "@/lib/domain/wait-or-book";
import { fareStanding, type CorridorStats } from "@/lib/domain/corridor-stats";
import { formatUsdCompact } from "@/lib/domain/money";
import { formatBoardStamp } from "@/lib/domain/timezone";
import { useClientNow } from "@/components/relative-time";

/* What this corridor has done, and whether to act on it.
 *
 * The panel this replaces was headed "Price history" and plotted
 * booking_price_events — the traveler's own benchmark, which changes only when
 * they press "I rebooked". For almost every watch it was one point.
 *
 * The chart is inline SVG on purpose: it is a polyline and two rules, the
 * geometry is computed by a tested pure function, and a charting library would
 * be a runtime dependency for something that is forty lines of markup.
 *
 * Nothing here draws between checks. A gap in the data is a gap in the line,
 * because "we did not look" and "it held that price" are different claims and
 * only one of them is ours to make.
 */
export function FareHistory({
  observations,
  bookedCents,
  bestCents,
  changeFeeCents,
  hoursToDeparture,
  corridor,
  timezone,
}: {
  observations: Observation[];
  bookedCents: number;
  bestCents: number | null;
  changeFeeCents: number;
  hoursToDeparture: number | null;
  /** What this route costs across every watch. Null below the evidence floor. */
  corridor: CorridorStats | null;
  timezone: string;
}) {
  const gradientId = useId();
  const history = useMemo(() => buildHistory(observations), [observations]);
  const geometry = useMemo(
    () => chartGeometry(history, { width: 560, height: 120, benchmarkCents: bookedCents }),
    [history, bookedCents],
  );
  const call = useMemo(
    () =>
      waitOrBook({ bestCents, bookedCents, changeFeeCents, hoursToDeparture, history, corridor }),
    [bestCents, bookedCents, changeFeeCents, hoursToDeparture, history, corridor],
  );
  /* Where their own fare sits in what this route has actually cost — the
     question every traveler has and the product has never once answered. */
  const standing = useMemo(
    () => (corridor ? fareStanding(bookedCents, corridor) : null),
    [corridor, bookedCents],
  );
  const volatility = volatilityNote(history);
  // Not Date.now() in render: same hydration hazard as RelativeTime, and the
  // compiler lint rightly refuses it. 0 until the client has a clock.
  const nowMs = useClientNow();
  const bestEver = useMemo(() => bestEverNote(history, nowMs || null), [history, nowMs]);

  const tone = call.call === "BOOK_NOW" ? "is-book" : call.call === "HOLD" ? "is-hold" : "is-watch";

  return (
    <section className="fare-history panel p-4" aria-labelledby="fare-history-title">
      <div className="fh-head">
        <h2 id="fare-history-title" className="eyebrow">
          Price history
        </h2>
        <p className="fh-checks">
          {history.checks === 0
            ? "No checks yet"
            : `${history.checks} ${history.checks === 1 ? "check" : "checks"}`}
        </p>
      </div>

      <div className={`fh-call ${tone}`} role="status">
        <p className="fh-call-label">{call.label}</p>
        <p className="fh-call-reason">{call.reason}</p>
        <p className="fh-call-basis">
          <span className={`fh-confidence fh-confidence-${call.confidence}`}>
            {call.confidence} confidence
          </span>{" "}
          · {call.basis}
        </p>
      </div>

      {history.points.length === 0 ? (
        <p className="fh-empty">
          Nothing charted yet. The first check writes the first point, and we look three times a
          day.
        </p>
      ) : (
        <>
          <figure className="fh-figure">
            <div className="fh-plot">
              <svg
                viewBox={`0 0 ${geometry.width} ${geometry.height}`}
                className="fh-chart"
                role="img"
                preserveAspectRatio="none"
                aria-label={chartLabel(history.points.length, geometry.low, geometry.high)}
              >
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--save)" stopOpacity="0.22" />
                    <stop offset="100%" stopColor="var(--save)" stopOpacity="0" />
                  </linearGradient>
                </defs>

                {/* What they paid, as a rule across the whole chart. Everything
                  below it is a saving; everything above it is not. */}
                {geometry.benchmarkY !== null ? (
                  <g>
                    <line
                      x1="0"
                      x2={geometry.width}
                      y1={geometry.benchmarkY}
                      y2={geometry.benchmarkY}
                      className="fh-benchmark"
                    />
                    {/* Right-anchored and clear of its own line — it used to sit
                      on top of the dashes at the left edge, where the line it
                      labels ran straight through the text. */}
                    <text
                      x={geometry.width - 2}
                      y={
                        geometry.benchmarkY < 14
                          ? geometry.benchmarkY + 12
                          : geometry.benchmarkY - 5
                      }
                      textAnchor="end"
                      className="fh-benchmark-tag"
                    >
                      you paid {formatUsdCompact(bookedCents)}
                    </text>
                  </g>
                ) : null}

                {geometry.segments.map((segment, index) =>
                  segment.length > 1 ? (
                    <g key={index}>
                      {/* No fill under a segment too narrow to read as an area.
                          Two checks four hours apart inside an eight-day window
                          are two pixels wide, and the gradient under them drew
                          a stray vertical bar that looked like a rendering
                          fault rather than data. The line still shows them. */}
                      {segment[segment.length - 1]!.x - segment[0]!.x >= geometry.width * 0.02 ? (
                        <polygon
                          className="fh-area"
                          fill={`url(#${gradientId})`}
                          points={`${segment[0]!.x},${geometry.height} ${segment
                            .map((p) => `${p.x},${p.y}`)
                            .join(" ")} ${segment[segment.length - 1]!.x},${geometry.height}`}
                        />
                      ) : null}
                      <polyline
                        className="fh-line"
                        points={segment.map((p) => `${p.x},${p.y}`).join(" ")}
                      />
                    </g>
                  ) : null,
                )}

                {geometry.points.map((point) => (
                  <circle
                    key={point.at}
                    cx={point.x}
                    cy={point.y}
                    r={point === geometry.points[geometry.points.length - 1] ? 3.5 : 2}
                    className={
                      point.cents === history.lowest?.cents ? "fh-dot fh-dot-low" : "fh-dot"
                    }
                    /* aria-label, not <title>: React 19 treats <title> as
                     document metadata and hoists it, so these rendered empty on
                     the server and full on the client — a hydration mismatch
                     that regenerated the whole subtree. The numbers are also in
                     the stats list below, which is where a screen reader and a
                     reader without a pointer will find them. */
                    aria-label={`${formatUsdCompact(point.cents)} on ${formatBoardStamp(point.at, timezone)}`}
                  />
                ))}
              </svg>
            </div>
            {/* A value axis, on the left, high at the top.
                It used to be a flex row with the low at the left end and the
                high at the right — on a chart whose x axis is time, that reads
                as "it went from $47 to $133", which is backwards. */}
            <figcaption className="fh-axis" aria-hidden>
              <span className="fh-axis-high">{formatUsdCompact(geometry.high)}</span>
              <span className="fh-axis-low">{formatUsdCompact(geometry.low)}</span>
            </figcaption>
          </figure>

          {/* The same numbers as text, because a chart is not readable by
              everyone and a screen reader should not get "img". */}
          <dl className="fh-stats">
            <div>
              <dt>Lowest seen</dt>
              <dd>{history.lowest ? formatUsdCompact(history.lowest.cents) : "—"}</dd>
            </div>
            <div>
              <dt>Highest seen</dt>
              <dd>{history.highest ? formatUsdCompact(history.highest.cents) : "—"}</dd>
            </div>
            <div>
              <dt>Listed now</dt>
              <dd>{history.latest ? formatUsdCompact(history.latest.cents) : "—"}</dd>
            </div>
          </dl>

          {bestEver ? <p className="fh-note">{bestEver}</p> : null}
          {volatility ? <p className="fh-note">{volatility}</p> : null}
        </>
      )}

      {standing ? (
        <section className={`fh-corridor is-${standing.standing}`} aria-label="This route">
          <div className="fh-corridor-head">
            <h3 className="eyebrow">What this route costs</h3>
            <span className="fh-corridor-pct">{standing.percentile}th percentile</span>
          </div>
          {/* The distribution as a bar, with their fare marked on it. A range of
              numbers in a sentence is a range of numbers; a mark on a line is a
              position, which is the thing being said. */}
          <div className="fh-range" aria-hidden>
            <span
              className="fh-range-band"
              style={{
                left: `${pct(corridor!.p25, corridor!)}%`,
                right: `${100 - pct(corridor!.p75, corridor!)}%`,
              }}
            />
            <span
              className="fh-range-median"
              style={{ left: `${pct(corridor!.median, corridor!)}%` }}
            />
            <span
              className="fh-range-you"
              style={{ left: `${Math.min(100, Math.max(0, standing.percentile))}%` }}
            />
          </div>
          <div className="fh-range-scale" aria-hidden>
            <span>{formatUsdCompact(corridor!.low)}</span>
            <span>{formatUsdCompact(corridor!.high)}</span>
          </div>
          <p className="fh-corridor-verdict">{standing.verdict}</p>
          <p className="fh-corridor-basis">{standing.basis}</p>
        </section>
      ) : null}

      <p className="fh-footnote">
        Every point is a fare we saw at the time we looked. We never draw between checks and we
        never estimate a price we have not observed.
      </p>
    </section>
  );
}

function chartLabel(count: number, low: number, high: number): string {
  return `Cheapest fare observed at each of ${count} checks, between ${formatUsdCompact(low)} and ${formatUsdCompact(high)}. The figures are listed below the chart.`;
}

/** Where a price sits on the low–high axis, as a percentage. */
function pct(cents: number, stats: CorridorStats): number {
  const span = stats.high - stats.low;
  if (span <= 0) return 50;
  return Math.min(100, Math.max(0, ((cents - stats.low) / span) * 100));
}
