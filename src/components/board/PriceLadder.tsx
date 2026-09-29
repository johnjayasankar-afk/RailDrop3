import { ladderPercent } from "@/lib/domain/board-act";
import { formatUsdCompact } from "@/lib/domain/money";

/* Where this trip's fares sit, as one line.
 *
 * This was a 200px panel holding a 2px rule: a 3.1rem track, a floating "You"
 * tag, and then a sentence underneath repeating the two numbers the track had
 * just drawn without labelling them — "Listed from $74 to $128 · you paid
 * $128". Measured, the panel was about 85% empty, which is what makes a page
 * read as unfinished rather than airy.
 *
 * The numbers belong on the scale. Direct labelling costs nothing here —
 * there are exactly two ends — and it removes both the caption and the
 * reader's job of matching a figure in prose to a dot on a rule. Every mark
 * is an observation; the marks below what they paid are the saving, which is
 * why they are the only ones that carry colour.
 */
export function PriceLadder({
  ladder,
}: {
  ladder: { min: number; max: number; booked: number; marks: number[] };
}) {
  if (ladder.marks.length === 0) return null;
  const you = ladderPercent(ladder.booked, ladder.min, ladder.max);
  const cheaper = ladder.marks.filter((cents) => cents < ladder.booked).length;
  /* Paying the most observed puts the tick on the right end of the scale,
     where its label ran into the end label — the overlap audit caught it at
     all three widths. At an end the tick's label is pulled back inside the
     rail rather than staying centred on a mark that has nothing beyond it. */
  const shift = you > 88 ? "-42%" : you < 12 ? "42%" : "0";

  return (
    <section className="panel ladder-panel mt-4" aria-labelledby="ladder-title">
      <p id="ladder-title" className="micro">
        Where you sit
      </p>
      <div className="ladder-line">
        <span className="ladder-end">{formatUsdCompact(ladder.min)}</span>
        <span className="ladder" role="img" aria-label={ladderLabel(ladder, cheaper)}>
          <span className="ladder-rail" />
          {ladder.marks.map((cents) => (
            <i
              key={cents}
              className={`ladder-dot ${cents < ladder.booked ? "is-save" : ""}`}
              style={{ left: `${ladderPercent(cents, ladder.min, ladder.max)}%` }}
            />
          ))}
          <span
            className="ladder-you"
            style={{ left: `${you}%`, "--label-shift": shift } as React.CSSProperties}
          >
            <i aria-hidden />
            <em>you paid</em>
          </span>
        </span>
        <span className="ladder-end">{formatUsdCompact(ladder.max)}</span>
      </div>
    </section>
  );
}

/* The rule the picture draws, in a sentence, for anyone who cannot see it.
   It used to be announced as an unlabelled image with the figures in a
   separate paragraph a screen reader reached afterwards. */
function ladderLabel(
  ladder: { min: number; max: number; booked: number; marks: number[] },
  cheaper: number,
): string {
  return (
    `${ladder.marks.length} fares observed, from ${formatUsdCompact(ladder.min)} to ` +
    `${formatUsdCompact(ladder.max)}. You paid ${formatUsdCompact(ladder.booked)}, and ` +
    `${cheaper === 0 ? "none is" : cheaper === 1 ? "one is" : `${cheaper} are`} below that.`
  );
}
