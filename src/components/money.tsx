import { formatUsdCompact } from "@/lib/domain/money";

/* How money is set, in one place.
 *
 * Three surfaces were hand-rolling the same markup — a small dollar sign
 * followed by tabular digits — and two of them had marked the sign
 * `aria-hidden`, which left a screen reader announcing "54" where the page
 * said "$54". A currency symbol is not decoration. It is the unit, and the
 * unit is the one part of a figure a reader cannot infer from the rest.
 *
 * The visual treatment is the point of the component: the sign is stepped down
 * to 55% and half opacity so the digits carry the line, which is what makes a
 * price read as a measurement rather than a label. Doing that in three places
 * meant it drifted in three places.
 */
export function Money({
  cents,
  className,
  signed = false,
}: {
  cents: number;
  className?: string;
  /* Render an explicit sign. Off by default: most figures on the board are
     magnitudes, and a sign on a magnitude is noise. On for a difference,
     where the direction is the whole content. */
  signed?: boolean;
}) {
  const text = formatUsdCompact(Math.abs(cents));
  return (
    <span className={className ? `readout ${className}` : "readout"}>
      {signed ? (cents < 0 ? "−" : "+") : null}
      <span className="readout-mark">$</span>
      {text.slice(1)}
    </span>
  );
}
