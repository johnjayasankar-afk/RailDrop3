import { formatMediumDate, describeDisplacement } from '@/lib/domain/dates';
import { formatCents } from '@/lib/domain/money';
import type { DateStripEntry } from '@/lib/queries';

/**
 * Fares across the travel window, with a comparative bar so the shape of the
 * three days is legible at a glance.
 *
 * A date that could not be checked shows "Not checked" and the reason — never a
 * dash, a zero, or an empty bar that could read as "cheapest".
 */
export function FareStrip({
  strip,
  benchmarkCents,
}: {
  strip: DateStripEntry[];
  benchmarkCents: number;
}) {
  if (strip.length === 0) {
    return (
      <div className="rd-card px-5 py-6 text-center text-[14px] text-muted">
        No check has completed yet.
      </div>
    );
  }

  const priced = strip
    .map((e) => e.cheapestTotalCents)
    .filter((v): v is number => typeof v === 'number');
  const cheapest = priced.length > 0 ? Math.min(...priced) : null;
  // Scale bars against the dearest of the paid price and the dearest observed
  // fare, so the bar is always readable as "relative to what you paid".
  const ceiling = Math.max(benchmarkCents, ...(priced.length > 0 ? priced : [benchmarkCents]));

  return (
    <ul className="grid gap-2 sm:grid-cols-3" role="list">
      {strip.map((entry) => {
        const failed = entry.status === 'FAILED';
        const price = entry.cheapestTotalCents;
        const isCheapest = price !== null && price === cheapest;
        const pct = price !== null ? Math.max(4, Math.round((price / ceiling) * 100)) : 0;
        const saving = price !== null ? benchmarkCents - price : null;

        return (
          <li
            key={entry.travelDate}
            data-testid="fare-strip-day"
            data-status={entry.status}
            className={`rd-card flex flex-col px-4 py-3.5 transition-colors ${
              isCheapest ? 'border-save-line bg-save-soft' : ''
            } ${failed ? 'border-warn-line bg-warn-soft' : ''}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12.5px] font-bold uppercase tracking-wide text-ink">
                {formatMediumDate(entry.travelDate)}
              </span>
              <span className="text-[10.5px] text-faint">
                {entry.displacementDays === 0
                  ? 'Your date'
                  : describeDisplacement(entry.displacementDays)}
              </span>
            </div>

            {failed ? (
              <>
                <p className="mt-2 text-[15px] font-semibold text-warn">Not checked</p>
                <p className="mt-0.5 text-[11.5px] leading-snug text-warn/85">
                  {friendlyError(entry.errorKind)}
                </p>
              </>
            ) : price === null ? (
              <>
                <p className="mt-2 text-[15px] font-semibold text-muted">No availability</p>
                <p className="mt-0.5 text-[11.5px] text-faint">
                  {entry.journeysReturned === 0
                    ? 'No services returned'
                    : 'No fares matched your filters'}
                </p>
              </>
            ) : (
              <>
                <div className="mt-1.5 flex items-baseline gap-1.5">
                  <span className="text-[11px] text-faint">from</span>
                  <span
                    className={`tnum text-[25px] font-bold leading-none tracking-tight ${
                      isCheapest ? 'text-save' : 'text-ink'
                    }`}
                  >
                    {formatCents(price)}
                  </span>
                </div>

                {/* Bar length is the fare relative to the dearest thing on screen. */}
                <div
                  className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-line"
                  aria-hidden="true"
                >
                  <div
                    className={`h-full rounded-full ${isCheapest ? 'bg-save' : 'bg-line-strong'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <p className="mt-1.5 text-[11px] text-faint">
                  {saving !== null && saving > 0
                    ? `${formatCents(saving)} below what you paid`
                    : saving !== null && saving < 0
                      ? `${formatCents(Math.abs(saving))} above what you paid`
                      : 'Same as what you paid'}
                </p>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function friendlyError(kind: string | null): string {
  switch (kind) {
    case 'RATE_LIMIT':
      return 'Provider rate limit — we will retry on the next check.';
    case 'AUTH':
      return 'Fare provider credentials rejected.';
    case 'STALE_INPUT':
      return 'The provider did not recognise this route or date.';
    case 'TIMEOUT':
      return 'The provider timed out.';
    case 'SCHEMA':
      return 'The provider response could not be read.';
    case 'BUDGET':
      return 'Skipped to stay inside the credit budget.';
    case 'CIRCUIT_OPEN':
      return 'Paused after repeated provider failures.';
    case 'BLOCKED':
    case 'UPSTREAM':
    case 'PROVIDER_FAULT':
      return 'The fare provider was unavailable.';
    default:
      return 'We will try again on the next check.';
  }
}
