import { formatCents } from '@/lib/domain/money';
import {
  MIN_OBSERVATIONS,
  describeVerdict,
  priceStats,
  type PriceVerdict,
} from '@/lib/domain/price-stats';

const TONE: Record<PriceVerdict, { text: string; bg: string; border: string; fill: string }> = {
  BEST_YET: { text: 'text-save', bg: 'bg-save-soft', border: 'border-save-line', fill: 'bg-save' },
  GOOD: { text: 'text-save', bg: 'bg-save-soft', border: 'border-save-line', fill: 'bg-save' },
  TYPICAL: { text: 'text-ink', bg: 'bg-raised', border: 'border-line', fill: 'bg-ink-2' },
  HIGH: { text: 'text-warn', bg: 'bg-warn-soft', border: 'border-warn-line', fill: 'bg-warn' },
  UNKNOWN: { text: 'text-muted', bg: 'bg-raised', border: 'border-line', fill: 'bg-line-strong' },
};

/**
 * "Is this a good price?" — answered from this trip's own observed history.
 *
 * Descriptive, never predictive. It compares today's best fare with every price
 * actually recorded for this trip, and it refuses a verdict until there are
 * enough completed checks to support one. A fare monitor confidently telling
 * you to wait would be guessing; telling you where today sits in the range it
 * has genuinely seen is a fact.
 */
export function PricePosition({
  history,
  currentCents,
  benchmarkCents,
}: {
  history: ReadonlyArray<number | null>;
  currentCents: number | null;
  benchmarkCents: number;
}) {
  const stats = priceStats(history, currentCents);
  const verdict = describeVerdict(stats);
  const tone = TONE[stats.verdict];

  if (stats.observations === 0) return null;

  // Below the confidence floor there is no band to draw and no verdict to
  // give, so this collapses to a single line. A full-height card repeating
  // "not enough history" in three registers looked like a broken panel and
  // took a hundred pixels above the fold to say almost nothing.
  if (!stats.confident) {
    return (
      <p
        data-testid="price-position"
        className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg border border-line bg-raised px-4 py-2.5 text-[12.5px] leading-relaxed text-muted"
      >
        <span className="font-semibold text-ink">Not enough history yet</span>
        <span>
          A verdict needs at least {MIN_OBSERVATIONS} completed checks; {stats.observations} so far.
          Not a forecast either way.
        </span>
      </p>
    );
  }

  const low = stats.lowestCents as number;
  const high = stats.highestCents as number;
  const median = stats.medianCents as number;
  const span = high - low;

  // A flat history has no range to place anything within; the band collapses
  // to a single value rather than pretending to a spread it does not have.
  const at = (cents: number) => (span === 0 ? 50 : ((cents - low) / span) * 100);

  return (
    <section
      data-testid="price-position"
      aria-label="How today's price compares with this trip's history"
      className={`rounded-xl border ${tone.border} ${tone.bg} px-5 py-4`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className={`text-[15px] font-bold tracking-tight ${tone.text}`}>{verdict.label}</h2>
        <span className="tnum text-[12px] text-muted">
          {stats.observations} priced check{stats.observations === 1 ? '' : 's'}
        </span>
      </div>
      <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-muted">{verdict.detail}</p>

      {span > 0 ? (
        <div className="mt-4">
          <div className="relative h-1.5 rounded-full bg-line">
            {/* Everything at or below the current price. */}
            {currentCents !== null ? (
              <div
                className={`absolute inset-y-0 left-0 rounded-full ${tone.fill}`}
                style={{ width: `${Math.max(0, Math.min(100, at(currentCents)))}%` }}
              />
            ) : null}

            {/* Median tick — the "usual" price, so the marker has a reference. */}
            <span
              aria-hidden="true"
              className="absolute -top-1 h-3.5 w-px bg-line-strong"
              style={{ left: `${at(median)}%` }}
            />

            {currentCents !== null ? (
              <span
                aria-hidden="true"
                className={`absolute -top-[5px] size-4 -translate-x-1/2 rounded-full border-[3px] border-paper ${tone.fill}`}
                style={{ left: `${Math.max(0, Math.min(100, at(currentCents)))}%` }}
              />
            ) : null}
          </div>

          <div className="mt-2 flex items-baseline justify-between text-[11px]">
            <span className="tnum text-faint">
              Lowest <strong className="font-semibold text-ink-2">{formatCents(low)}</strong>
            </span>
            <span className="tnum text-faint">
              Usually <strong className="font-semibold text-ink-2">{formatCents(median)}</strong>
            </span>
            <span className="tnum text-faint">
              Highest <strong className="font-semibold text-ink-2">{formatCents(high)}</strong>
            </span>
          </div>
        </div>
      ) : null}

      <p className="mt-3 border-t border-line/60 pt-2.5 text-[11.5px] leading-relaxed text-faint">
        Measured against this trip only, from {formatCents(low)}
        {span > 0 ? `–${formatCents(high)}` : ''} actually observed since you started watching — not
        a forecast, and nothing here says where the price goes next. You paid{' '}
        {formatCents(benchmarkCents)}.
      </p>
    </section>
  );
}
