import { ZodError } from "zod";

/* What a person is told when something fails, and what the logs get instead.
 *
 * These are different strings and conflating them is how "TypeError: fetch
 * failed" ended up rendered in red under a button. That is the text Node's
 * undici produces when a host does not answer; a client catches it and puts
 * `String(err)` into `error.message`, and this module used to pass anything
 * it did not recognise straight through to the UI.
 *
 * A reader cannot act on "fetch failed". They can act on "we could not reach
 * the fare board". The operator needs the opposite: the raw string, in the
 * log, with the hostname still in it. So `errorMessage` is for people and
 * `errorDetail` is for logs, and every route uses both.
 *
 * This file used to carry a six-way database diagnosis as well — a deleted
 * project, a paused one, a missing schema, a rejected key. There is no
 * database now. What is left is the one distinction that still matters: did
 * the request reach the fare provider at all?
 */

const TRANSPORT_SIGNS = [
  "fetch failed",
  "failed to fetch",
  "network request failed",
  "enotfound",
  "eai_again",
  "econnrefused",
  "econnreset",
  "epipe",
  "socket hang up",
  "terminated",
  "etimedout",
  "timeout",
  "timed out",
  "und_err",
  "unable to get local issuer",
  "self-signed certificate",
];

const TRANSPORT = Symbol.for("raildrop.transportError");
const TRANSLATED = Symbol.for("raildrop.translatedError");
const SOURCE = Symbol.for("raildrop.originalError");

function rawMessage(error: unknown): string {
  if (!error) return "";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    if ("message" in error) return String((error as { message: unknown }).message ?? "");
    // String({}) is "[object Object]", which in a log is a mystery wearing
    // the costume of a diagnosis. The shape is what is useful here.
    try {
      const shape = JSON.stringify(error);
      return shape && shape !== "{}" ? shape.slice(0, 500) : "";
    } catch {
      return "";
    }
  }
  return String(error);
}

/** Transport-level failure: the request never reached anything. */
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
  // undici keeps the errno on the cause, and some clients rethrow with only
  // a generic message on top.
  if (typeof error === "object" && error && "cause" in error) {
    const cause = rawMessage((error as { cause: unknown }).cause).toLowerCase();
    return Boolean(cause) && TRANSPORT_SIGNS.some((sign) => cause.includes(sign));
  }
  return false;
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
  ]
    // A stack trace in a log line is noise; the hostname and errno lead it.
    .map((part) => part.replace(/\s+/g, " ").trim().slice(0, 300))
    .filter((part) => part && !raw.includes(part));
  return extra.length > 0 ? `${raw} (${extra.join("; ")})` : raw;
}

/** The failure as it arrived, before any rewriting. */
export function originalError(error: unknown): unknown {
  if (typeof error === "object" && error) {
    const source = (error as Record<symbol, unknown>)[SOURCE];
    if (source !== undefined) return source;
  }
  return error;
}

function mark(error: Error, original: unknown, transport: boolean): Error {
  Object.defineProperty(error, TRANSLATED, { value: true, enumerable: false });
  Object.defineProperty(error, SOURCE, { value: original, enumerable: false });
  if (transport) {
    Object.defineProperty(error, TRANSPORT, { value: true, enumerable: false });
  }
  return error;
}

const UNREACHED =
  "We could not reach the fare board, so there is nothing to show for this search. " +
  "No price here is ever a guess, so we would rather show you none than one we did not see. " +
  "Trying again in a moment usually works.";

/**
 * Normalize a failure into something a reader can act on.
 *
 * Translating twice used to destroy the diagnosis, so a translated error is
 * returned unchanged and keeps its source for anyone who needs to classify
 * it afterwards. Diagnose the cause, never the copy.
 */
export function toAppError(error: unknown): Error {
  if (
    error instanceof Error &&
    (error as unknown as Record<symbol, unknown>)[TRANSLATED] === true
  ) {
    return error;
  }
  if (error instanceof ZodError) {
    const detail = error.issues.map((issue) => issue.message).join("; ");
    return mark(new Error(detail || "Check the route and date and try again"), error, false);
  }
  if (isTransportFailure(error)) {
    return mark(new Error(UNREACHED), error, true);
  }
  const raw = rawMessage(error);
  return mark(new Error(raw || "Something went wrong reading the fare board"), error, false);
}

export function errorMessage(error: unknown): string {
  return toAppError(error).message;
}
