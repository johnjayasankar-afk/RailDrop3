import { formatCents } from '@/lib/domain/money';

export interface PricePoint {
  /** ISO timestamp of the check. */
  at: string;
  /** Best price found, or null when that check could not reach the provider. */
  cents: number | null;
}

/**
 * Price history since the watch was created.
 *
 * A check that FAILED is a gap in the line, never an interpolated segment —
 * drawing straight through a failure would assert a price we never observed.
 */
export function PriceSparkline({
  points,
  benchmarkCents,
  width = 220,
  height = 44,
  className = '',
}: {
  points: PricePoint[];
  benchmarkCents: number;
  width?: number;
  height?: number;
  className?: string;
}) {
  const priced = points.filter((p) => p.cents !== null);
  if (priced.length < 2) return null;

  const values = priced.map((p) => p.cents as number);
  const lo = Math.min(...values, benchmarkCents);
  const hi = Math.max(...values, benchmarkCents);
  const span = hi - lo || 1;

  const padY = 5;
  const x = (i: number) => (points.length === 1 ? 0 : (i / (points.length - 1)) * width);
  const y = (cents: number) => padY + (1 - (cents - lo) / span) * (height - padY * 2);

  // Break the path wherever a check failed.
  const segments: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [];
  points.forEach((point, index) => {
    if (point.cents === null) {
      if (current.length > 1) segments.push(current);
      current = [];
      return;
    }
    current.push([x(index), y(point.cents)]);
  });
  if (current.length > 1) segments.push(current);

  const last = points.reduce<{ i: number; cents: number } | null>(
    (acc, p, i) => (p.cents !== null ? { i, cents: p.cents } : acc),
    null,
  );
  const benchmarkY = y(benchmarkCents);
  const lowest = Math.min(...values);
  const gaps = points.length - priced.length;

  return (
    <figure className={`m-0 ${className}`}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className="overflow-visible"
        role="img"
        aria-label={`Price history: ${priced.length} checks, from ${formatCents(values[0] as number)} to ${formatCents(last?.cents ?? (values[values.length - 1] as number))}, lowest ${formatCents(lowest)}, against ${formatCents(benchmarkCents)} paid${gaps > 0 ? `, ${gaps} check${gaps > 1 ? 's' : ''} could not be completed` : ''}`}
      >
        {/* What you paid — everything below this line is a saving. */}
        <line
          x1="0"
          x2={width}
          y1={benchmarkY}
          y2={benchmarkY}
          stroke="var(--rd-line-strong)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
        {segments.map((segment, index) => (
          <polyline
            key={index}
            points={segment.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ')}
            fill="none"
            stroke="var(--rd-rust)"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {last ? (
          <circle
            cx={x(last.i)}
            cy={y(last.cents)}
            r="2.75"
            fill="var(--rd-surface)"
            stroke={last.cents < benchmarkCents ? 'var(--rd-save)' : 'var(--rd-rust)'}
            strokeWidth="2"
          />
        ) : null}
      </svg>
    </figure>
  );
}
