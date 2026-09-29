import { ZodError } from "zod";
import { diagnoseDatabase, looksLikeTransport } from "@/lib/db/diagnosis";

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
/* The unresolved/refused/timeout split moved to src/lib/db/diagnosis.ts, which
   is where the decision that depends on it now lives. TRANSPORT_SIGNS stays
   here because isTransportFailure answers a coarser question — did this ever
   reach the database — which route status codes and page guards both need
   without caring which way it failed. */

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

/**
 * Set on an Error this function has already produced.
 *
 * Translating twice was destroying the diagnosis. createWatchAndScan wraps a
 * failure with toAppError, which correctly read ECONNREFUSED out of the
 * Supabase error's `details` and produced "the database is not accepting
 * connections — on our hosting that usually means it has been paused". The
 * route then called errorMessage() on that Error, which called toAppError
 * again — and the second pass had only the sentence to work from, which
 * contains no errno, so it fell through to "we could not tell whether it is a
 * passing glitch" and told the reader to try again.
 *
 * Both messages are in the same log line, which is what gave it away: `detail`
 * held the right answer and `message` held the wrong one.
 */
const TRANSLATED = Symbol.for("raildrop.translatedError");

/** Normalize Supabase / Zod / unknown failures into a user-facing Error. */
export function toAppError(error: unknown): Error {
  if (
    error instanceof Error &&
    (error as unknown as Record<symbol, unknown>)[TRANSLATED] === true
  ) {
    return error;
  }
  if (error instanceof ZodError) {
    const detail = error.issues.map((issue) => issue.message).join("; ");
    return markTranslated(new Error(detail || "Invalid watch details"));
  }
  if (error instanceof Error) {
    const rewritten = markTranslated(
      new Error(friendlyDbMessage(error.message, "", errorDetail(error))),
    );
    return isTransportFailure(error) ? markTransport(rewritten, error) : rewritten;
  }
  if (typeof error === "object" && error && "message" in error) {
    const message = String((error as { message: unknown }).message ?? "");
    const code =
      "code" in error && (error as { code: unknown }).code != null
        ? String((error as { code: unknown }).code)
        : "";
    const rewritten = markTranslated(
      new Error(friendlyDbMessage(message, code, errorDetail(error))),
    );
    return isTransportFailure(error) ? markTransport(rewritten, error) : rewritten;
  }
  return markTranslated(new Error("Could not create watch"));
}

/** Stamp an Error as already translated, so a second pass leaves it alone. */
function markTranslated(error: Error): Error {
  Object.defineProperty(error, TRANSLATED, { value: true, enumerable: false });
  return error;
}

/* One classifier, in src/lib/db/diagnosis.ts.
 *
 * This function used to hold the whole decision, and it had two branches for
 * transport: a hostname that does not resolve, and everything else, where
 * "everything else" ended "try again in a minute". A paused Supabase project
 * — the free tier's default after a week of quiet — keeps its DNS record and
 * refuses the connection, so it landed in "everything else" and told people
 * to wait for something that only comes back when a person restores it.
 *
 * `diagnoseDatabase` separates six causes and, more importantly, carries
 * `retryWorks`, so no branch can promise recovery by accident. /api/health
 * reads the same classifier, which is the other reason it moved: the page a
 * reader sees and the endpoint an operator curls now cannot disagree about
 * what is wrong.
 */
function friendlyDbMessage(message: string, code = "", diagnostic = message): string {
  const carrier = { message, code, details: diagnostic };
  const { fault, message: friendly } = diagnoseDatabase(carrier);
  /* A message we could not place is left alone rather than replaced.
   *
   * Validation failures arrive here too — "Enter the actual total you paid" is
   * not a database fault — and a house sentence about the database would be a
   * worse answer than the accurate one the caller already wrote. */
  if (fault === "unknown" && !looksLikeTransport(carrier)) {
    return message || "Could not create watch";
  }
  return friendly;
}

/** The full diagnosis, for callers that want the remedy as well as the sentence. */
export function databaseDiagnosis(error: unknown, configured = true) {
  return diagnoseDatabase(error, { configured });
}

export function errorMessage(error: unknown): string {
  return toAppError(error).message;
}
