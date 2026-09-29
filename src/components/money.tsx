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
/* Where a number came from.
 *
 * The product's one rule is that it never invents a price, and until now that
 * rule was enforced in the data layer and then ASSERTED to the reader, in
 * sentences, at the bottom of pages: "we never invent a fare". A sentence is
 * the weakest possible place to put a guarantee, because the reader has to
 * have read it, remembered it, and be applying it to the figure in front of
 * them.
 *
 * Every price on a RailDrop screen is one of exactly three things, and they
 * are currently indistinguishable:
 *
 *   observed  a provider was seen listing it. The only kind we stand behind.
 *   entered   the traveller typed it — what they paid, their fee estimate.
 *   unknown   nobody has said it, and we are not going to guess.
 *
 * On the board today, "You paid $128" and "Best now $91" are set identically,
 * so the number the user typed and the number we scraped look equally
 * authoritative. They are not. Making the difference visible is the honest
 * version of the claim the footer was making in prose.
 *
 * Deliberately quiet. A loud treatment would turn eighteen figures into
 * eighteen badges, and the distinction only has to be available — noticed
 * when looked for — not shouted. An underline you can see when you look at
 * it, and a real sentence for anyone not looking at it at all.
 */
export type MoneySource = "observed" | "entered" | "unknown";

const SAID: Record<MoneySource, string> = {
  observed: "",
  entered: " (the amount you told us)",
  unknown: " (not observed)",
};

export function Money({
  cents,
  className,
  signed = false,
  source = "observed",
}: {
  cents: number;
  className?: string;
  /* Render an explicit sign. Off by default: most figures on the board are
     magnitudes, and a sign on a magnitude is noise. On for a difference,
     where the direction is the whole content. */
  signed?: boolean;
  source?: MoneySource;
}) {
  const text = formatUsdCompact(Math.abs(cents));
  const classes = ["readout", `is-${source}`, className].filter(Boolean).join(" ");

  /* Nothing said it, so there is nothing to set. An em dash is not a zero:
     zero is a claim that the amount is nothing, and we do not know that. */
  if (source === "unknown") {
    return (
      <span className={classes}>
        <span aria-hidden>—</span>
        <span className="sr-only">not observed</span>
      </span>
    );
  }

  return (
    <span className={classes}>
      {signed ? (cents < 0 ? "−" : "+") : null}
      <span className="readout-mark">$</span>
      {text.slice(1)}
      {SAID[source] ? <span className="sr-only">{SAID[source]}</span> : null}
    </span>
  );
}
