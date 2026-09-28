/* A calendar file for a train that actually exists.
 *
 * Built from an observed journey — its real departure, its real arrival, its
 * real train number — so the same rule applies here as everywhere else: if we
 * did not see it, it does not go in the file. A calendar entry is worse than a
 * screen for guessing, because it outlives the page and gets trusted at 6am on
 * a platform.
 *
 * RFC 5545 is fussy in three ways that are easy to get wrong and invisible
 * until somebody's calendar refuses the file: lines end CRLF, they fold at 75
 * octets (octets, not characters — a multi-byte dash counts for three), and
 * commas, semicolons, backslashes and newlines inside a value are escaped.
 */

export interface CalendarEvent {
  uid: string;
  /** UTC instants, ISO 8601. */
  startsAt: string;
  endsAt: string;
  title: string;
  description: string;
  location: string;
  /** When the file was produced. */
  stamp: string;
  url?: string | null;
}

const CRLF = "\r\n";
/** 75 octets per RFC 5545, and a continuation line starts with one space. */
const FOLD_AT = 75;

/**
 * Preserves whichever kind of time it was given, which is the whole point.
 *
 * A departure in this app is the station's wall clock with no zone on it —
 * "2026-10-09T07:05:00" means the train leaves at 07:05 where the platform is,
 * and formatClock renders it by reading those characters rather than by
 * converting anything. RFC 5545 has exactly the right form for that: a
 * floating time, no Z, which every calendar shows at that clock reading.
 *
 * Parsing it into a Date to "normalise" it is the trap, and one this file fell
 * into first time round. `new Date` reads a zone-less string in the *server's*
 * zone, so the same journey becomes a different instant depending on where the
 * code runs — right on a laptop in New York, four hours out on Vercel, which
 * runs UTC. Nothing about the resulting file would look wrong.
 *
 * So: a string carrying Z or an offset is a real instant and is emitted as UTC;
 * a string without one is a wall clock and is emitted floating. DTSTAMP is
 * always the former, because "when this file was made" is a real instant.
 */
export function toIcsInstant(iso: string): string | null {
  const text = iso.trim();
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(text)) {
    const at = new Date(text);
    if (Number.isNaN(at.getTime())) return null;
    return at
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(text);
  if (!match) return null;
  return `${match[1]}${match[2]}${match[3]}T${match[4]}${match[5]}${match[6] ?? "00"}`;
}

/** Escapes the four characters RFC 5545 reserves inside a TEXT value. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Fold one content line to 75 octets.
 *
 * Counted in octets rather than characters because the encoding is UTF-8 and
 * this text is full of en dashes and arrows: folding by `length` produces lines
 * that are legal by the count and too long on the wire. A fold must also never
 * split a multi-byte character, so the split point walks back to a boundary.
 */
export function foldIcsLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= FOLD_AT) return line;

  const out: string[] = [];
  let cut = 0;
  let limit = FOLD_AT;
  while (cut < bytes.length) {
    let end = Math.min(cut + limit, bytes.length);
    // 0b10xxxxxx is a UTF-8 continuation byte; step back off the middle of one.
    while (end > cut && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end -= 1;
    out.push(new TextDecoder().decode(bytes.slice(cut, end)));
    cut = end;
    // Continuation lines carry a leading space, which costs an octet.
    limit = FOLD_AT - 1;
  }
  return out.join(`${CRLF} `);
}

export function buildIcs(events: readonly CalendarEvent[]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//RailDrop//Fare watch//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const event of events) {
    const start = toIcsInstant(event.startsAt);
    const end = toIcsInstant(event.endsAt);
    const stamp = toIcsInstant(event.stamp);
    // A VEVENT without a start is not an event. Skipping beats emitting a file
    // a calendar will reject wholesale for one bad entry.
    if (!start || !stamp) continue;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${start}`,
      ...(end ? [`DTEND:${end}`] : []),
      `SUMMARY:${escapeIcsText(event.title)}`,
      `DESCRIPTION:${escapeIcsText(event.description)}`,
      `LOCATION:${escapeIcsText(event.location)}`,
      ...(event.url ? [`URL:${escapeIcsText(event.url)}`] : []),
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  // Trailing CRLF: the spec ends the last content line like any other.
  return `${lines.map(foldIcsLine).join(CRLF)}${CRLF}`;
}

/** A filename a person can find again in a downloads folder. */
export function icsFilename(originCode: string, destinationCode: string, date: string): string {
  return `raildrop-${originCode}-${destinationCode}-${date}.ics`.toLowerCase();
}
