import Link from "next/link";
import type { Route } from "next";
import { Flap } from "@/components/flap";

/* What a page shows when our own storage is unreachable.
 *
 * Deliberately not app/error.tsx. That screen says "The board could not load"
 * and offers "Try again: this is usually a brief hitch" — three claims we
 * cannot support when the database host does not resolve. The board is fine,
 * the hitch is not brief, and a retry changes nothing.
 *
 * So this one says which half is down and which half still works, and sends the
 * reader to the half that works. Live fares come from the corridor, not from
 * us: a search needs no database and answers in seconds. That is the whole
 * point of the product, and it stays available while this is broken.
 *
 * Retry is offered second, not first. A reader who came here to see a price
 * should leave with a price, not with a button that shows them this page again.
 */
export function RecordsUnreachable({
  what,
  retryHref,
}: {
  what: "watches" | "board";
  retryHref: Route;
}) {
  return (
    <div className="ticket mt-12 p-8">
      <div className="depart-strip">
        <Flap>HOLD</Flap>
        <span className="depart-strip-rule" aria-hidden />
        <Flap>SAVED</Flap>
      </div>
      <p className="kicker mt-8">Records unreachable</p>
      <h2 className="serif mt-3 text-3xl">
        {what === "watches"
          ? "We cannot read your saved trips right now."
          : "We cannot read this watch right now."}
      </h2>
      <p className="mt-3 max-w-lg text-ink-soft">
        This is our storage, not the railroad. Nothing is cancelled and nothing is lost — we simply
        cannot reach the records to show them. Any alert that was due will go out once we can.
      </p>
      <p className="mt-4 max-w-lg text-ink-soft">
        Live fares do not come through storage, so a search still works normally.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link href="/watches/new" className="btn btn-primary">
          Search live fares
        </Link>
        <Link href={retryHref} className="btn btn-ghost" prefetch={false}>
          Try the records again
        </Link>
      </div>
    </div>
  );
}
