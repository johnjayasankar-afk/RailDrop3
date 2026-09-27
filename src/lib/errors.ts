import { ZodError } from "zod";

/* What a person is told when something fails, and what the logs get instead.
 *
 * These are different strings and conflating them is how "TypeError: fetch
 * failed" ended up rendered in red under a Start watching button. That is the
 * text Node's undici produces when a hostname does not resolve; supabase-js
 * catches it and puts `String(err)` into `error.message`, and this module used
 * to pass anything it did not recognise straight through to the UI.
 *
 * A reader cannot act on "fetch failed". They can act on "we could not reach
 * the database, nothing was saved, try again". The operator needs the opposite:
 * the raw string, in the log, with the hostname still in it. So `errorMessage`
 * is for people and `errorDetail` is for logs, and every route uses both.
 */

/** Transport-level failure: the request never reached anything. */
/**
 * Transport failures that mean the name itself has no answer.
 *
 * A subset of TRANSPORT_SIGNS, and the reason the two are separate: these do not
 * get better by waiting. A Supabase project that has been deleted resolves to
 * NXDOMAIN forever.
 */
const UNRESOLVED_SIGNS = ["enotfound", "eai_again", "getaddrinfo", "nxdomain"];

const TRANSPORT_SIGNS = [
  "fetch failed",
  "failed to fetch",
  "network request failed",
  "enotfound",
  "eai_again",
  "econnrefused",
  "econnreset",
  "etimedout",
  "epipe",
  "socket hang up",
  "getaddrinfo",
  "unable to get local issuer",
  "self-signed certificate",
  "terminated",
];

/**
 * Set on the Error `toAppError` produces, so the classification survives being
 * rewritten into something readable.
 *
 * Without it the translation destroyed the evidence: createWatchAndScan wrapped
 * the failure into "We could not reach the database", the route then asked "is
 * this a transport failure?", that sentence contains none of the signs, and an
 * outage answered 400 Bad Request — telling every client that the caller had
 * sent something wrong.
 */
const TRANSPORT = Symbol.for("raildrop.transportFailure");

export function isTransportFailure(error: unknown): boolean {
  if (
    typeof error === "object" &&
    error &&
    (error as Record<symbol, unknown>)[TRANSPORT] === true
  ) {
    return true;
  }
  const raw = rawMessage(error).toLowerCase();
  if (raw && TRANSPORT_SIGNS.some((sign) => raw.includes(sign))) return true;
  // undici keeps the errno on the cause, and some clients rethrow with only a
  // generic message on top.
  if (typeof error === "object" && error && "cause" in error) {
    const cause = rawMessage((error as { cause: unknown }).cause).toLowerCase();
    return Boolean(cause) && TRANSPORT_SIGNS.some((sign) => cause.includes(sign));
  }
  return false;
}

/** Tag a rewritten error so the classification travels with it. */
function markTransport(error: Error, original: unknown): Error {
  Object.defineProperty(error, TRANSPORT, { value: true, enumerable: false });
  // Keep the original reachable for the log.
  if (!("cause" in error) || error.cause === undefined) {
    Object.defineProperty(error, "cause", { value: original, enumerable: false });
  }
  return error;
}

/** The untouched text, for logs. Never rendered to a reader. */
export function errorDetail(error: unknown): string {
  const raw = rawMessage(error);
  if (!raw) return "unknown error";
  const extra = [
    // undici puts the useful half — the hostname, the errno — on the cause.
    typeof error === "object" && error && "cause" in error
      ? rawMessage((error as { cause: unknown }).cause)
      : "",
    /* supabase-js does not use `cause`. It rejects with a plain object and puts
     * the same information in `details`, so this function — whose whole job is
     * to keep the hostname in the log — was dropping it for the one client that
     * actually reads the database. A real outage logged
     * `page.records_unreachable ... detail: "TypeError: fetch failed"` and named
     * no host, which is the mystery log line the split exists to prevent. */
    typeof error === "object" && error && "details" in error
      ? String((error as { details: unknown }).details ?? "")
      : "",
  ]
    // A stack trace in a log line is noise; the hostname and errno lead it.
    .map((part) => part.replace(/\s+/g, " ").trim().slice(0, 300))
    .filter((part) => part && !raw.includes(part));
  return extra.length > 0 ? `${raw} (${extra.join("; ")})` : raw;
}

function rawMessage(error: unknown): string {
  if (!error) return "";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    if ("message" in error) return String((error as { message: unknown }).message ?? "");
    // String({}) is "[object Object]", which in a log is a mystery wearing the
    // costume of a diagnosis. The shape is what is useful here.
    try {
      const shape = JSON.stringify(error);
      return shape && shape !== "{}" ? shape.slice(0, 500) : "";
    } catch {
      return "";
    }
  }
  return String(error);
}

/** Normalize Supabase / Zod / unknown failures into a user-facing Error. */
export function toAppError(error: unknown): Error {
  if (error instanceof ZodError) {
    const detail = error.issues.map((issue) => issue.message).join("; ");
    return new Error(detail || "Invalid watch details");
  }
  if (error instanceof Error) {
    const rewritten = new Error(friendlyDbMessage(error.message, "", errorDetail(error)));
    return isTransportFailure(error) ? markTransport(rewritten, error) : rewritten;
  }
  if (typeof error === "object" && error && "message" in error) {
    const message = String((error as { message: unknown }).message ?? "");
    const code =
      "code" in error && (error as { code: unknown }).code != null
        ? String((error as { code: unknown }).code)
        : "";
    const rewritten = new Error(friendlyDbMessage(message, code, errorDetail(error)));
    return isTransportFailure(error) ? markTransport(rewritten, error) : rewritten;
  }
  return new Error("Could not create watch");
}

/**
 * @param diagnostic The untouched text including any cause, used only to classify.
 *   undici puts "fetch failed" on the message and the errno on the cause, so
 *   deciding from `message` alone could not tell a name that does not resolve
 *   from a connection that was reset — and got it wrong in the direction that
 *   told people to wait for something permanent.
 */
function friendlyDbMessage(message: string, code = "", diagnostic = message): string {
  const lower = `${message} ${diagnostic}`.toLowerCase();
  if (TRANSPORT_SIGNS.some((sign) => lower.includes(sign))) {
    /* Two different failures were wearing one sentence.
     *
     * "Try again in a minute" is right for a reset connection or a timeout: the
     * database is there and the request was unlucky. It is false for a hostname
     * that does not resolve, which is what a deleted Supabase project looks
     * like — that cannot come back on its own, and no number of attempts will
     * change it. Telling someone to wait a minute for a permanent
     * misconfiguration is the same class of claim as inventing a price: a
     * confident sentence about something we did not observe.
     *
     * The distinction is available in the error itself. getaddrinfo ENOTFOUND
     * and EAI_AGAIN mean DNS had no answer; ECONNRESET, ETIMEDOUT and the rest
     * mean something answered and the exchange failed. */
    return UNRESOLVED_SIGNS.some((sign) => lower.includes(sign))
      ? "We could not reach the RailDrop database, so nothing was saved. Its address does not resolve, so this is a setting that needs fixing rather than a passing glitch — trying again will not help until it is. Live fare search does not use the database and still works."
      : "We could not reach the RailDrop database, so nothing was saved. This is a problem on our side — try again in a minute.";
  }
  if (
    code === "23503" ||
    lower.includes("profiles_id_fkey") ||
    (lower.includes("foreign key") && lower.includes("profiles"))
  ) {
    /* Points at the whole schema, not one migration. Naming a single file is how
       a database ends up with two of the nine applied — which is what the setup
       instructions used to produce, and it fails later against a column that
       does not exist rather than at setup. */
    return "The database is missing part of its schema: in the Supabase SQL Editor, run supabase/SETUP_ALL.sql, then try again.";
  }
  if (lower.includes("service role") || lower.includes("supabase is not configured")) {
    return message;
  }
  return message || "Could not create watch";
}

export function errorMessage(error: unknown): string {
  return toAppError(error).message;
}
