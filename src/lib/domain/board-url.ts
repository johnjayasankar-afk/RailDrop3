/* The way you are looking at the board, written down.
 *
 * "Filters stay on this visit only" was true and it was a shame: the useful
 * thing a person does on this board is narrow sixty options down to the two
 * worth arguing about, and there was no way to hand that to anyone — not to a
 * travelling companion, not to themselves on a phone, not even to themselves
 * after a reload.
 *
 * The scheme is one query parameter holding comma-separated `code:value`
 * fields, so a link is short enough to paste into a message and legible enough
 * to read over someone's shoulder:
 *
 *   ?b=d:2026-10-04,s:price,f:acela,g:za
 *
 * Codes:
 *   d   travel date, or absent for all dates      s   sort
 *   f   service filter                            w   departure-time bucket
 *   q   train-number search                       ta  depart after (HH:MM)
 *   tb  arrive before (HH:MM)                     du  duration cap, minutes
 *   p   pinned row keys, | separated              h   hidden row keys
 *   c   compare selection (at most two)           x   focused row
 *   g   flags: z zen · a show-all · s savings-only
 *       · p pinned-only · d hide-departed · b arrive-buffer
 *
 * Two rules govern everything below.
 *
 * A URL is input from a stranger. Every value is validated against the same
 * union the reducer accepts, lists are length-capped, and anything unrecognised
 * is dropped rather than coerced — a link cannot put the board into a state the
 * UI has no way to leave.
 *
 * Row keys are not durable. A key is `journeyId:fareId`, and a journey id is
 * the provider's trip id or a composite of date, train and departure. A later
 * cycle can legitimately produce different ids for the same train. So pins,
 * hidden rows and the compare pair are carried, but a caller must expect some
 * of them to match nothing and say so out loud rather than dropping them in
 * silence. See `unmatchedKeys`.
 */

import type { BoardSort, ServiceFilter, TimeBucket } from "./board-tools";
import { initialBoardState, type BoardState } from "./board-state";

export const BOARD_STATE_PARAM = "b";

/** Generous for a real board, small enough that a link cannot be a payload. */
const MAX_KEYS = 24;
const MAX_KEY_LENGTH = 200;
const MAX_QUERY_LENGTH = 40;
/** 48h. A cap above this is not a filter, it is the absence of one. */
const MAX_DURATION_CAP = 2_880;

const SORTS: readonly BoardSort[] = ["rank", "price", "depart", "duration", "savings"];
const SERVICES: readonly ServiceFilter[] = ["all", "regional", "acela", "direct"];
const BUCKETS: readonly TimeBucket[] = ["morning", "afternoon", "evening"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Only the three characters that would break the encoding. Colons stay readable. */
function esc(value: string): string {
  return value.replace(/[%,|]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function unesc(value: string): string {
  return value.replace(/%(25|2C|7C)/gi, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

function encodeKeys(keys: readonly string[]): string {
  return keys.slice(0, MAX_KEYS).map(esc).join("|");
}

function decodeKeys(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split("|")) {
    const key = unesc(part).trim();
    // Length-capped, de-duplicated, and empties dropped: a list from a URL is
    // not allowed to be large, repetitive, or full of holes.
    if (!key || key.length > MAX_KEY_LENGTH || out.includes(key)) continue;
    out.push(key);
    if (out.length >= MAX_KEYS) break;
  }
  return out;
}

/**
 * The board state as a query-parameter value, or "" when nothing is off default.
 *
 * An empty string is the signal to remove the parameter entirely rather than
 * write `?b=`, so an untouched board has a clean URL and the localStorage pin
 * fallback stays in charge of it.
 */
export function encodeBoardState(state: BoardState): string {
  const fields: string[] = [];
  const put = (code: string, value: string) => {
    if (value) fields.push(`${code}:${value}`);
  };

  if (state.dateFilter !== "all" && ISO_DATE.test(state.dateFilter)) put("d", state.dateFilter);
  if (state.sort !== "rank") put("s", state.sort);
  if (state.service !== "all") put("f", state.service);
  if (state.bucket !== "all") put("w", state.bucket);
  if (state.trainQuery.trim()) put("q", esc(state.trainQuery.trim().slice(0, MAX_QUERY_LENGTH)));
  put("ta", state.departAfter);
  put("tb", state.arriveBefore);
  if (state.durationCap !== null) put("du", String(state.durationCap));
  put("p", encodeKeys(state.pins));
  put("h", encodeKeys(state.hiddenKeys));
  put("c", encodeKeys(state.picked));
  // Only a row somebody chose. The board focuses one on load, and writing that
  // would give every untouched board a URL parameter and make every "Copy link"
  // claim to be copying a particular view.
  if (state.focusKey && state.focusIntent) put("x", esc(state.focusKey));

  const flags =
    (state.zen ? "z" : "") +
    (state.showAll ? "a" : "") +
    (state.savingsOnly ? "s" : "") +
    (state.pinnedOnly ? "p" : "") +
    (state.hideDeparted ? "d" : "") +
    (state.arriveBuffer ? "b" : "");
  put("g", flags);

  return fields.join(",");
}

/**
 * A board state from a link, with every field it did not carry left at default.
 *
 * Returns a full state rather than a patch: the caller replaces the reducer's
 * initial value with this, so a field absent from the URL must read as the
 * default and not as "unchanged from whatever was there".
 */
export function decodeBoardState(raw: string | null | undefined): BoardState {
  const state: BoardState = { ...initialBoardState };
  if (!raw) return state;

  for (const field of raw.split(",")) {
    const at = field.indexOf(":");
    if (at <= 0) continue;
    const code = field.slice(0, at);
    // Values may contain colons — a row key is `journeyId:fareId` — so only
    // the first one separates.
    const value = field.slice(at + 1);
    if (!value) continue;

    switch (code) {
      case "d":
        if (ISO_DATE.test(value)) state.dateFilter = value;
        break;
      case "s":
        if ((SORTS as readonly string[]).includes(value)) state.sort = value as BoardSort;
        break;
      case "f":
        if ((SERVICES as readonly string[]).includes(value)) state.service = value as ServiceFilter;
        break;
      case "w":
        if ((BUCKETS as readonly string[]).includes(value)) state.bucket = value as TimeBucket;
        break;
      case "q":
        state.trainQuery = unesc(value).slice(0, MAX_QUERY_LENGTH);
        break;
      case "ta":
        if (CLOCK.test(value)) state.departAfter = value;
        break;
      case "tb":
        if (CLOCK.test(value)) state.arriveBefore = value;
        break;
      case "du": {
        const minutes = Number.parseInt(value, 10);
        if (Number.isFinite(minutes) && minutes > 0 && minutes <= MAX_DURATION_CAP) {
          state.durationCap = minutes;
        }
        break;
      }
      case "p":
        state.pins = decodeKeys(value);
        break;
      case "h":
        state.hiddenKeys = decodeKeys(value);
        break;
      case "c":
        // The compare panel is a pair. A link claiming five gets the first two.
        state.picked = decodeKeys(value).slice(0, 2);
        break;
      case "x": {
        const key = unesc(value).trim();
        if (key && key.length <= MAX_KEY_LENGTH) {
          state.focusKey = key;
          // A link naming a row is somebody pointing at it.
          state.focusIntent = true;
        }
        break;
      }
      case "g":
        state.zen = value.includes("z");
        state.showAll = value.includes("a");
        state.savingsOnly = value.includes("s");
        state.pinnedOnly = value.includes("p");
        state.hideDeparted = value.includes("d");
        state.arriveBuffer = value.includes("b");
        break;
      default:
        // An unknown code is a link from a newer or older build. Ignoring it
        // is what lets both keep working.
        break;
    }
  }
  return state;
}

/** Whether a link is carrying anything at all, before deciding to trust it over storage. */
export function hasBoardState(raw: string | null | undefined): boolean {
  return encodeBoardState(decodeBoardState(raw)) !== "";
}

/**
 * The row keys a link asked for that are not on this board.
 *
 * A shared view can name a fare that has since sold out, or one whose provider
 * id changed in a later cycle. The board says so — "2 rows from this link are
 * no longer listed" — because the alternative is a link that silently shows
 * something other than what was shared.
 */
export function unmatchedKeys(state: BoardState, present: readonly string[]): string[] {
  const have = new Set(present);
  const missing = new Set<string>();
  for (const key of [...state.pins, ...state.picked, ...state.hiddenKeys]) {
    if (!have.has(key)) missing.add(key);
  }
  if (state.focusKey && !have.has(state.focusKey)) missing.add(state.focusKey);
  return [...missing];
}

/**
 * An absolute link to this board in this state.
 *
 * `base` is the board's own URL, with or without a query. Any existing `b` is
 * replaced rather than appended, so copying a view twice does not accumulate.
 */
export function boardStateUrl(base: string, state: BoardState): string {
  const encoded = encodeBoardState(state);
  try {
    const url = new URL(base);
    if (encoded) url.searchParams.set(BOARD_STATE_PARAM, encoded);
    else url.searchParams.delete(BOARD_STATE_PARAM);
    return url.toString();
  } catch {
    // A relative base, which is what the browser gives for a path-only link.
    const [path] = base.split("?");
    if (!encoded) return path ?? base;
    return `${path}?${BOARD_STATE_PARAM}=${encodeURIComponent(encoded)}`;
  }
}

/**
 * The link an alert email should point at.
 *
 * Deliberately not the full view: by the time someone opens the mail, the fare
 * we quoted may be gone, and a link that pinned its row would open on an empty
 * board. Date and sort are facts about the search, not about a row, so they
 * survive. The traveler lands on the day we found the drop, cheapest first.
 */
export function alertBoardUrl(base: string, travelDate: string): string {
  return boardStateUrl(base, {
    ...initialBoardState,
    dateFilter: ISO_DATE.test(travelDate) ? travelDate : "all",
    sort: "price",
    // A drop email is about one specific day's cheapest fares; the five-row cap
    // would hide the rest of them behind a click.
    showAll: true,
  });
}

/**
 * A copied string with the link to the view it describes.
 *
 * One helper rather than a `link` parameter on each of the five copy builders:
 * they join their lines with a space, a newline and a blank line respectively,
 * and adding a sixth argument to each would have meant five signature changes
 * and five ways to get the separator wrong. The link goes on its own line at the
 * end, after "Confirm on Amtrak", because that sentence is the point and the
 * link is the reference.
 */
export function withBoardLink(text: string, link: string | null | undefined): string {
  if (!link) return text;
  // Copying twice from a string that already ends in the link must not stack it.
  if (text.includes(link)) return text;
  return `${text}\n${link}`;
}
