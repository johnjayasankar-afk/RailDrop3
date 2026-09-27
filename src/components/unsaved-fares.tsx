"use client";

import { formatUsdCompact } from "@/lib/domain/money";
import { formatDisplayDate } from "@/lib/domain/calendar";
import { formatClock } from "@/lib/domain/timezone";
import { trainLabel } from "@/lib/domain/board-decision";
import type { FarePreview } from "@/lib/watches/preview-fares";

/* The fares, when the watch could not be saved.
 *
 * The one thing this must not do is look like a watch. Nothing here is being
 * monitored, no email is coming, and these prices are a snapshot of the moment
 * the lookup ran. So it is drawn as a receipt rather than a board — flat, no
 * actions on the rows, and it says what it is at the top and again at the
 * bottom.
 *
 * It exists because refusing to show a price when the scraper is working
 * perfectly is the worst possible answer to "what does this cost". A database
 * we cannot reach is our problem; it should not also become the traveler's
 * empty screen.
 */
export function UnsavedFares({ preview }: { preview: FarePreview }) {
  const rows = preview.ranked.slice(0, 8);

  return (
    <section className="unsaved" aria-labelledby="unsaved-title">
      <p id="unsaved-title" className="unsaved-stamp">
        Not saved · live fares
      </p>
      <p className="unsaved-lead">
        We could not save this trip, so nothing is being watched and no alert will come. The fare
        search itself worked — this is what {preview.originCode} → {preview.destinationCode} is
        listed at right now.
      </p>

      {rows.length === 0 ? (
        <p className="unsaved-empty">
          {preview.failedDates.length > 0
            ? "The fare search did not get through either. Nothing to show."
            : "No fares are listed for these dates right now."}
        </p>
      ) : (
        <ul className="unsaved-list">
          {rows.map((candidate) => (
            <li key={`${candidate.journey.id}:${candidate.fare.id}`}>
              <span className="unsaved-price">
                {formatUsdCompact(candidate.totalPartyPriceCents)}
              </span>
              <span className="unsaved-when">
                {formatDisplayDate(candidate.journey.searchedTravelDate)} ·{" "}
                {formatClock(candidate.journey.departureAt)}
              </span>
              <span className="unsaved-train">{trainLabel(candidate)}</span>
            </li>
          ))}
        </ul>
      )}

      {preview.failedDates.length > 0 && rows.length > 0 ? (
        <p className="unsaved-note">
          {preview.failedDates.map((date) => formatDisplayDate(date)).join(", ")} could not be
          checked, so the list above may not be the cheapest there is.
        </p>
      ) : null}

      <p className="unsaved-foot">
        Listed fares, not a booking. Confirm on Amtrak. Try saving the trip again in a minute — if
        it works, we will start watching these for you.
      </p>
    </section>
  );
}
