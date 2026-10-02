"use client";

import { useState } from "react";
import {
  journeyIcs,
  journeyIcsFilename,
  readingCsv,
  readingCsvFilename,
} from "@/lib/domain/reading-file";
import type { FarePreview } from "@/lib/fares/preview-fares";
import type { RankedCandidate } from "@/lib/domain/types";

/* Something to take away, from a product that keeps nothing.
 *
 * "Nothing is saved anywhere" is a promise printed on the page, and it has a
 * cost the product was simply absorbing on the reader's behalf: somebody
 * comparing this board against tomorrow's, or sending it to the person they
 * are travelling with, had nowhere to put it. A file on their own machine
 * costs this product no storage and makes no new claim.
 *
 * Built in the page from the reading already on screen — no request, no
 * round trip, nothing leaves the browser.
 */
function download(contents: string, filename: string, type: string) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  /* Revoked on the next turn, not immediately: Safari has not finished with
     the object URL when click() returns and cancels the download. */
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TakeItWithYou({
  preview,
  passengers,
  cheapest,
}: {
  preview: FarePreview;
  passengers: number;
  cheapest: RankedCandidate | undefined;
}) {
  const [took, setTook] = useState<"csv" | "ics" | null>(null);

  const note = (which: "csv" | "ics") => {
    setTook(which);
    window.setTimeout(() => setTook((current) => (current === which ? null : current)), 2500);
  };

  return (
    <div className="takeaway">
      <span className="micro takeaway-label">Keep this reading</span>
      <button
        type="button"
        className="takeaway-go"
        onClick={() => {
          download(
            readingCsv(preview, passengers),
            readingCsvFilename(preview),
            "text/csv;charset=utf-8",
          );
          note("csv");
        }}
      >
        {took === "csv" ? "Downloaded" : `All ${preview.ranked.length} fares as a spreadsheet`}
      </button>
      {cheapest ? (
        <button
          type="button"
          className="takeaway-go"
          onClick={() => {
            download(
              journeyIcs(cheapest, preview, passengers),
              journeyIcsFilename(cheapest, preview),
              "text/calendar;charset=utf-8",
            );
            note("ics");
          }}
        >
          {took === "ics" ? "Downloaded" : "Cheapest train to your calendar"}
        </button>
      ) : null}
      {/* The file outlives the tab, and a fare does not. */}
      <span className="takeaway-note micro">
        Built here, nothing sent. The fare in the file is what was listed when we read it, not a
        reservation.
      </span>
    </div>
  );
}
