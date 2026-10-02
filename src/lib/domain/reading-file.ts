import { formatDurationMinutes } from "./calendar";
import { buildIcs } from "./ics";
import { centsPerHour } from "./board-tools";
import { trainLabel } from "./board-decision";
import type { FarePreview } from "@/lib/fares/preview-fares";
import type { RankedCandidate } from "./types";

/* A reading you can keep, because the product keeps nothing.
 *
 * "Nothing is saved anywhere" is a promise printed on the page, and it has a
 * cost: the reader who wanted to compare today's board against tomorrow's,
 * or send it to the person they are travelling with, had no way to hold on
 * to it. A file they download is theirs, on their machine, and costs this
 * product no storage and no claim.
 *
 * The file carries its own provenance, in rows, before the table. A detached
 * CSV of prices with no date, no route and no source on it becomes an
 * unlabelled price list the moment it leaves the page — which is the same
 * failure as a sample board captioned "read from live inventory", committed
 * in a format that outlives the tab. Every row of the preamble is something
 * the search did.
 *
 * The old boardCsv had a "Savings" column, left from when a saved watch
 * compared against a booked price. There is no booked price any more, so the
 * column was a zero on every row.
 */

/* FNV-1a, 32-bit. Not a security hash — it is here to turn a long, punctuated
   provider id into something short and stable that a calendar can key on. */
function stableId(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0");
}

function cell(value: string): string {
  /* Quote anything a spreadsheet would mis-split, and double the quotes
     inside, per RFC 4180. A train name is "Acela 2155"; a station is
     "New York, NY" and that comma has split a column before. */
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

const COLUMNS = [
  "Date",
  "Departs",
  "Arrives",
  "Train",
  "Duration",
  "Transfers",
  "Price (party total)",
  "Per hour aboard",
  "Service",
  "Availability when read",
] as const;

export function readingCsv(preview: FarePreview, passengers: number): string {
  const rows: string[] = [
    [cell("RailDrop reading — listed fares, not a booking. Confirm on Amtrak.")].join(","),
    [cell("Route"), cell(`${preview.originCode} to ${preview.destinationCode}`)].join(","),
    [cell("Travel date asked for"), cell(preview.desiredTravelDate)].join(","),
    [cell("Dates searched"), cell(preview.dates.join(" "))].join(","),
    [cell("Travellers"), cell(String(passengers))].join(","),
    [cell("Read at"), cell(preview.checkedAt)].join(","),
    [cell("Fares listed"), cell(String(preview.ranked.length))].join(","),
    ...(preview.failedDates.length > 0
      ? [[cell("Dates not answered"), cell(preview.failedDates.join(" "))].join(",")]
      : []),
    ...(preview.unreadableDates.length > 0
      ? [[cell("Dates unreadable"), cell(preview.unreadableDates.join(" "))].join(",")]
      : []),
    "",
    COLUMNS.map(cell).join(","),
  ];

  for (const candidate of preview.ranked) {
    const perHour = centsPerHour(candidate.totalPartyPriceCents, candidate.journey.durationMinutes);
    rows.push(
      [
        candidate.journey.searchedTravelDate,
        candidate.journey.departureAt,
        candidate.journey.arrivalAt,
        trainLabel(candidate),
        formatDurationMinutes(candidate.journey.durationMinutes) ?? "unknown",
        String(candidate.journey.transferCount),
        /* Plain digits, no currency symbol and no thousands separator: a
           spreadsheet should be able to add these up, and "$1,234" is text. */
        (candidate.totalPartyPriceCents / 100).toFixed(2),
        perHour === null ? "" : String(Math.round(perHour / 100)),
        candidate.journey.serviceType,
        candidate.fare.availability,
      ]
        .map((value) => cell(String(value)))
        .join(","),
    );
  }

  return `${rows.join("\n")}\n`;
}

export function readingCsvFilename(preview: FarePreview): string {
  return `raildrop-${preview.originCode}-${preview.destinationCode}-${preview.desiredTravelDate}.csv`.toLowerCase();
}

/* One train, as a calendar entry.
 *
 * Only the observed facts go in: the train, the stations, the two times, and
 * the fare that was listed when we read it — with the reading's timestamp
 * beside it, because by the time the event fires the fare will be a
 * historical note rather than a price. No booking link, because no verified
 * stable link to a specific Amtrak itinerary exists and inventing one is the
 * thing this product does not do.
 */
export function journeyIcs(
  candidate: RankedCandidate,
  preview: FarePreview,
  passengers: number,
): string {
  const price = (candidate.totalPartyPriceCents / 100).toFixed(2);
  return buildIcs([
    {
      /* A short, stable identifier. The provider's own journey id is a
         comma-separated list of station and time codes about 90 characters
         long; dropped into a UID it folded across three lines and read like
         a parse error. Hashed, so the same train in the same reading always
         produces the same event and a calendar can replace rather than
         duplicate it. */
      uid: `${stableId(`${candidate.journey.id}|${candidate.fare.id}`)}@raildrop.app`,
      startsAt: candidate.journey.departureAt,
      endsAt: candidate.journey.arrivalAt,
      title: `${trainLabel(candidate)} · ${preview.originCode} → ${preview.destinationCode}`,
      description:
        `Listed at $${price}` +
        (passengers > 1 ? ` for ${passengers} travellers` : "") +
        ` when RailDrop read the board at ${preview.checkedAt}. ` +
        `A listed fare is not a booking and this is not a reservation — book on Amtrak.`,
      location: `${preview.originCode} station`,
      stamp: preview.checkedAt,
    },
  ]);
}

export function journeyIcsFilename(candidate: RankedCandidate, preview: FarePreview): string {
  return `raildrop-${preview.originCode}-${preview.destinationCode}-${candidate.journey.searchedTravelDate}.ics`.toLowerCase();
}
