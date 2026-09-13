'use client';

import { useMemo, useState } from 'react';

import { formatCents } from '@/lib/domain/money';
import type { PricePoint } from '@/lib/queries';
import { formatDateTimeInZone } from '@/lib/format';

export interface AlertMarker {
  at: string;
  savingsCents: number;
}

/**
 * Price history since the watch was created.
 *
 * Two rules this chart does not break:
 *   1. a check that FAILED is a gap, never an interpolated segment — drawing
 *      through it would assert a price nobody observed;
 *   2. the y-axis always includes what you paid, so "below the line" is
 *      literally true rather than a rescaled illusion.
 */
const WIDTH = 720;
const HEIGHT = 190;
const PADDING = { top: 16, right: 16, bottom: 26, left: 54 } as const;

export function PriceHistoryChart({
  points,
  benchmarkCents,
  alerts = [],
  timezone,
}: {
  points: PricePoint[];
  benchmarkCents: number;
  alerts?: AlertMarker[];
  timezone: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const model = useMemo(() => {
    const priced = points.filter((p) => p.cents !== null);
    if (priced.length < 2) return null;

    const values = priced.map((p) => p.cents as number);
    const lo = Math.min(...values, benchmarkCents);
    const hi = Math.max(...values, benchmarkCents);
    // A little headroom so the extremes are not welded to the frame.
    const pad = Math.max(200, Math.round((hi - lo) * 0.12));
    const min = Math.max(0, lo - pad);
    const max = hi + pad;
    const span = max - min || 1;

    const innerW = WIDTH - PADDING.left - PADDING.right;
    const innerH = HEIGHT - PADDING.top - PADDING.bottom;
    const x = (i: number) =>
      PADDING.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
    const y = (cents: number) => PADDING.top + (1 - (cents - min) / span) * innerH;

    const segments: Array<Array<[number, number]>> = [];
    let current: Array<[number, number]> = [];
    points.forEach((point, index) => {
      if (point.cents === null) {
        if (current.length > 0) segments.push(current);
        current = [];
        return;
      }
      current.push([x(index), y(point.cents)]);
    });
    if (current.length > 0) segments.push(current);

    const lowest = Math.min(...values);
    const lowestIndex = points.findIndex((p) => p.cents === lowest);

    return { x, y, min, max, segments, lowest, lowestIndex, innerW, innerH, values };
  }, [points, benchmarkCents]);

  if (!model) {
    return (
      <div className="rd-card px-5 py-8 text-center">
        <p className="text-[14px] font-semibold text-ink">Not enough history yet</p>
        <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-muted">
          The chart appears after two completed checks. RailDrop checks three times a day.
        </p>
      </div>
    );
  }

  const benchmarkY = model.y(benchmarkCents);
  const hovered = hover !== null ? points[hover] : null;
  const gaps = points.filter((p) => p.cents === null).length;
  const latest = [...points].reverse().find((p) => p.cents !== null)?.cents ?? null;

  return (
    <figure className="rd-card m-0 overflow-hidden">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line px-5 py-3">
        <span className="rd-label">Price history</span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
          <Legend swatch="bg-rust">Best fare found</Legend>
          <Legend swatch="bg-line-strong" dashed>
            You paid {formatCents(benchmarkCents)}
          </Legend>
          {alerts.length > 0 ? <Legend swatch="bg-save">Alert sent</Legend> : null}
        </span>
      </figcaption>

      <div className="relative px-2 pt-2">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full"
          role="img"
          aria-label={`Price history over ${points.length} checks. Lowest ${formatCents(model.lowest)}, latest ${latest !== null ? formatCents(latest) : 'unknown'}, against ${formatCents(benchmarkCents)} paid.${gaps > 0 ? ` ${gaps} check${gaps > 1 ? 's' : ''} could not be completed.` : ''}`}
          onMouseLeave={() => setHover(null)}
        >
          {/* y gridlines */}
          {[0, 0.5, 1].map((t) => {
            const value = model.min + (model.max - model.min) * (1 - t);
            const gy = PADDING.top + t * model.innerH;
            return (
              <g key={t}>
                <line
                  x1={PADDING.left}
                  x2={WIDTH - PADDING.right}
                  y1={gy}
                  y2={gy}
                  stroke="var(--rd-line)"
                  strokeWidth="1"
                />
                <text
                  x={PADDING.left - 8}
                  y={gy + 3.5}
                  textAnchor="end"
                  className="fill-[var(--rd-faint)] text-[10px]"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatCents(Math.round(value / 100) * 100, { showCents: false })}
                </text>
              </g>
            );
          })}

          {/* what you paid */}
          <line
            x1={PADDING.left}
            x2={WIDTH - PADDING.right}
            y1={benchmarkY}
            y2={benchmarkY}
            stroke="var(--rd-line-strong)"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />

          {/* the saving, as area under the benchmark */}
          {model.segments.map((segment, i) => {
            const first = segment[0] as [number, number];
            const last = segment[segment.length - 1] as [number, number];
            const d = [
              `M ${first[0]} ${benchmarkY}`,
              ...segment.map(([px, py]) => `L ${px} ${Math.min(py, benchmarkY)}`),
              `L ${last[0]} ${benchmarkY}`,
              'Z',
            ].join(' ');
            return <path key={`area-${i}`} d={d} fill="var(--rd-save)" opacity="0.09" />;
          })}

          {model.segments.map((segment, i) => (
            <polyline
              key={`line-${i}`}
              points={segment.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ')}
              fill="none"
              stroke="var(--rd-rust)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {/* alert markers on the time axis */}
          {alerts.map((alert, i) => {
            const time = new Date(alert.at).getTime();
            let nearest = 0;
            let best = Infinity;
            points.forEach((p, index) => {
              const d = Math.abs(new Date(p.at).getTime() - time);
              if (d < best) {
                best = d;
                nearest = index;
              }
            });
            const point = points[nearest];
            if (!point || point.cents === null) return null;
            return (
              <circle
                key={`alert-${i}`}
                cx={model.x(nearest)}
                cy={model.y(point.cents)}
                r="4.5"
                fill="var(--rd-surface)"
                stroke="var(--rd-save)"
                strokeWidth="2.5"
              >
                <title>Alert sent — save {formatCents(alert.savingsCents)}</title>
              </circle>
            );
          })}

          {/* lowest point */}
          {model.lowestIndex >= 0 ? (
            <circle
              cx={model.x(model.lowestIndex)}
              cy={model.y(model.lowest)}
              r="3"
              fill="var(--rd-rust)"
            />
          ) : null}

          {/* hover crosshair */}
          {hover !== null && points[hover]?.cents !== null ? (
            <line
              x1={model.x(hover)}
              x2={model.x(hover)}
              y1={PADDING.top}
              y2={HEIGHT - PADDING.bottom}
              stroke="var(--rd-line-strong)"
              strokeWidth="1"
            />
          ) : null}

          {/* invisible hit targets */}
          {points.map((point, index) => (
            <rect
              key={`hit-${index}`}
              x={model.x(index) - model.innerW / Math.max(1, points.length) / 2}
              y={PADDING.top}
              width={Math.max(6, model.innerW / Math.max(1, points.length))}
              height={model.innerH}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
            >
              <title>
                {point.cents === null
                  ? 'Check failed — no price observed'
                  : formatCents(point.cents)}
              </title>
            </rect>
          ))}
        </svg>

        {/* readout */}
        <div className="flex min-h-9 items-center justify-between px-3 pb-2 text-[12px]">
          {hovered ? (
            <>
              <span className="tnum text-muted">{formatDateTimeInZone(hovered.at, timezone)}</span>
              <span className="tnum font-semibold text-ink">
                {hovered.cents === null ? 'Check failed' : formatCents(hovered.cents)}
              </span>
            </>
          ) : (
            <>
              <span className="tnum text-faint">
                {points.length} checks
                {gaps > 0 ? ` · ${gaps} could not be completed` : ''}
              </span>
              <span className="tnum text-faint">
                Lowest seen <strong className="text-save">{formatCents(model.lowest)}</strong>
              </span>
            </>
          )}
        </div>
      </div>
    </figure>
  );
}

function Legend({
  swatch,
  dashed,
  children,
}: {
  swatch: string;
  dashed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-faint">
      <span
        aria-hidden="true"
        className={`h-0.5 w-4 rounded-full ${swatch} ${dashed ? 'opacity-70' : ''}`}
      />
      {children}
    </span>
  );
}
