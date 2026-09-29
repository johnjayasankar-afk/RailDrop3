/* What is actually wrong with the database, and whether waiting will fix it.
 *
 * Every failure to reach Supabase used to arrive at the reader as one of two
 * sentences, and the one almost everybody got ended "this is a problem on our
 * side — try again in a minute."
 *
 * That is true of exactly one cause. A reset connection or a timeout is bad
 * luck and a minute may well fix it. None of the others can:
 *
 *   no credentials       nothing is configured; a minute changes nothing
 *   name does not resolve  the project was deleted; NXDOMAIN is forever
 *   connection refused   the project is paused, which is the free tier's
 *                        default after a week of quiet — the DNS record stays,
 *                        so this is NOT the resolve case, and it comes back
 *                        only when somebody opens the dashboard and restores it
 *   key rejected         the service role key is wrong or rotated
 *   schema missing       the project is up and empty; SETUP_ALL.sql never ran
 *   permission denied    row-level security is refusing the service role
 *
 * Five of those six are permanent until a person does something, and the app
 * was telling people to wait for all of them. Someone watching that message
 * retries, sees it again, retries, and concludes the product is broken —
 * which, from where they are standing, is a fair reading of what it said.
 *
 * Telling someone to wait for something that will never happen is the same
 * class of failure as inventing a price: a confident sentence about a state
 * nobody observed. So every branch here says what was observed, what it means,
 * and what would actually change it — and `retryWorks` is false unless
 * retrying genuinely might.
 *
 * `operatorHint` is the other half. The reader cannot fix a service role key;
 * the person who deployed it can, and they are usually the same person on a
 * project this size. It is never shown to a traveler — it goes to /api/health
 * and the logs.
 */

export type DatabaseFault =
  | "ok"
  | "not-configured"
  | "name-does-not-resolve"
  | "refused"
  | "timeout"
  | "key-rejected"
  | "schema-missing"
  | "permission-denied"
  | "unknown";

export interface DatabaseDiagnosis {
  fault: DatabaseFault;
  /** What a traveler is told. Never names a host, a key or a table. */
  message: string;
  /** Whether trying the same thing again could plausibly succeed. */
  retryWorks: boolean;
  /** What would actually fix it, for whoever deployed this. Not shown to travelers. */
  operatorHint: string;
}

/** Names with no answer. A deleted project resolves to NXDOMAIN forever. */
const UNRESOLVED = ["enotfound", "eai_again", "getaddrinfo", "nxdomain"];

/** Something was there and the exchange failed. These can be luck. */
const TRANSIENT = ["econnreset", "epipe", "socket hang up", "terminated", "aborted"];

/** Nothing is listening. On Supabase this is overwhelmingly a paused project. */
const REFUSED = ["econnrefused", "econnaborted", "ehostunreach", "enetunreach"];

const TIMEOUT = ["etimedout", "timeout", "timed out", "connect_timeout", "und_err_connect_timeout"];

const TRANSPORT = [
  "fetch failed",
  "failed to fetch",
  "network request failed",
  "unable to get local issuer",
  "self-signed certificate",
  ...UNRESOLVED,
  ...TRANSIENT,
  ...REFUSED,
  ...TIMEOUT,
];

const REACH_PREFIX = "We could not reach the RailDrop database, so nothing was saved.";
const SEARCH_STILL_WORKS = "Live fare search does not use the database and still works.";

function haystack(error: unknown): string {
  const parts: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || value == null) return;
    if (typeof value === "string") {
      parts.push(value);
      return;
    }
    if (typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    for (const key of ["message", "code", "details", "hint", "errno", "name", "status"]) {
      const found = record[key];
      if (typeof found === "string" || typeof found === "number") parts.push(String(found));
    }
    visit(record.cause, depth + 1);
  };
  visit(error, 0);
  if (error instanceof Error) parts.push(error.message);
  return parts.join(" ").toLowerCase();
}

function statusOf(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const raw = (error as { status?: unknown }).status;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Classify a failure that came from the database layer.
 *
 * Order matters. The specific Postgres conditions are checked before the
 * transport signs, because a PostgrestError's `details` can contain the word
 * "connection" and would otherwise be read as an outage — which is how a
 * missing table gets reported as something a minute will fix.
 */
export function diagnoseDatabase(
  error: unknown,
  options: { configured?: boolean } = {},
): DatabaseDiagnosis {
  if (options.configured === false) {
    return {
      fault: "not-configured",
      message:
        `${REACH_PREFIX} This is a problem on our side: the deployment has no database ` +
        `configured at all, so saving cannot work until one is, and trying again will not ` +
        `help. ${SEARCH_STILL_WORKS}`,
      retryWorks: false,
      operatorHint:
        "Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY " +
        "for this environment, then redeploy.",
    };
  }

  const text = haystack(error);
  const status = statusOf(error);

  if (!text && status === null) {
    return {
      fault: "unknown",
      message: `${REACH_PREFIX} This is a problem on our side — try again in a minute. ${SEARCH_STILL_WORKS}`,
      retryWorks: true,
      operatorHint: "No diagnosable detail on the error. Check the function logs.",
    };
  }

  // ── Postgres and PostgREST conditions ────────────────────────────────────
  // 42P01 undefined_table, 42703 undefined_column: the project is up and the
  // schema was never applied. PGRST205 is PostgREST's "not in schema cache".
  if (
    text.includes("42p01") ||
    text.includes("42703") ||
    text.includes("pgrst205") ||
    text.includes("does not exist") ||
    text.includes("could not find the table") ||
    text.includes("schema cache")
  ) {
    return {
      fault: "schema-missing",
      message:
        "The database is reachable but its tables are missing, so nothing was saved. " +
        "In the Supabase SQL Editor, run supabase/SETUP_ALL.sql once — this will not fix " +
        "itself and trying again will not help. " +
        SEARCH_STILL_WORKS,
      retryWorks: false,
      operatorHint:
        "Open the Supabase SQL Editor for this project and run supabase/SETUP_ALL.sql once.",
    };
  }

  // 23503: a foreign key into profiles — half a schema, which is what applying
  // the migrations one at a time and stopping produces.
  if (
    text.includes("23503") ||
    text.includes("profiles_id_fkey") ||
    (text.includes("foreign key") && text.includes("profiles"))
  ) {
    return {
      fault: "schema-missing",
      message:
        "The database is missing part of its schema, so nothing was saved. " +
        "In the Supabase SQL Editor, run supabase/SETUP_ALL.sql — it is safe to re-run, and " +
        "trying again will not help until it has been. " +
        SEARCH_STILL_WORKS,
      retryWorks: false,
      operatorHint:
        "Part of the schema is applied and part is not. Run the whole of " +
        "supabase/SETUP_ALL.sql in the Supabase SQL Editor — it is safe to re-run.",
    };
  }

  if (text.includes("42501") || text.includes("permission denied") || text.includes("row-level")) {
    return {
      fault: "permission-denied",
      message:
        "The database refused the save. This is a permission setting on our side, " +
        "and trying again will not change it. " +
        SEARCH_STILL_WORKS,
      retryWorks: false,
      operatorHint:
        "Row-level security is rejecting the service role. Confirm SUPABASE_SERVICE_ROLE_KEY is " +
        "the service role key and not the anon key, and re-run SETUP_ALL.sql for the policies.",
    };
  }

  if (
    status === 401 ||
    status === 403 ||
    text.includes("invalid api key") ||
    text.includes("jwt") ||
    text.includes("invalid authentication")
  ) {
    return {
      fault: "key-rejected",
      message:
        `${REACH_PREFIX} The database rejected our credentials, which is a setting that needs ` +
        `fixing rather than a passing glitch. ${SEARCH_STILL_WORKS}`,
      retryWorks: false,
      operatorHint:
        "SUPABASE_SERVICE_ROLE_KEY is wrong, rotated, or from a different project. Copy it again " +
        "from Project Settings → API and redeploy.",
    };
  }

  // ── Transport ────────────────────────────────────────────────────────────
  if (UNRESOLVED.some((sign) => text.includes(sign))) {
    return {
      fault: "name-does-not-resolve",
      message:
        `${REACH_PREFIX} Its address does not resolve, so this is a setting that needs fixing ` +
        `rather than a passing glitch — trying again will not help until it is. ` +
        SEARCH_STILL_WORKS,
      retryWorks: false,
      operatorHint:
        "The hostname has no DNS record, which is what a deleted Supabase project looks like. " +
        "Check NEXT_PUBLIC_SUPABASE_URL against the project in the dashboard.",
    };
  }

  /* A paused project, almost always.
   *
   * Supabase pauses a free project after a week without traffic. The DNS
   * record stays, so this is not the unresolved case — the name answers and
   * nothing is listening behind it. It comes back when somebody opens the
   * dashboard and presses restore, and not before, which is exactly why
   * "try again in a minute" was the wrong thing to say to it. */
  if (REFUSED.some((sign) => text.includes(sign)) || status === 540 || status === 503) {
    return {
      fault: "refused",
      message:
        `${REACH_PREFIX} The database is not accepting connections — on our hosting that usually ` +
        `means it has been paused for inactivity, which someone has to undo. Waiting will not ` +
        `do it. ${SEARCH_STILL_WORKS}`,
      retryWorks: false,
      operatorHint:
        "Nothing is listening on the Supabase host. A free project pauses after ~7 days idle: " +
        "open the Supabase dashboard and restore it. If it is already active, check the project " +
        "is not mid-restart and that the URL points at the right one.",
    };
  }

  if (TIMEOUT.some((sign) => text.includes(sign))) {
    return {
      fault: "timeout",
      message: `${REACH_PREFIX} It did not answer in time. This is a problem on our side and it may well pass — try again in a minute. ${SEARCH_STILL_WORKS}`,
      retryWorks: true,
      operatorHint:
        "The connection timed out. If it persists, the project is likely paused or overloaded " +
        "rather than briefly slow.",
    };
  }

  if (TRANSIENT.some((sign) => text.includes(sign))) {
    return {
      fault: "timeout",
      message: `${REACH_PREFIX} The connection dropped part way. This is a problem on our side and it may well pass — try again in a minute. ${SEARCH_STILL_WORKS}`,
      retryWorks: true,
      operatorHint: "The connection was reset mid-exchange. Usually luck; check for a pattern.",
    };
  }

  if (TRANSPORT.some((sign) => text.includes(sign))) {
    /* "fetch failed" with nothing under it.
     *
     * supabase-js flattens undici's error and the errno is sometimes gone by
     * the time it gets here, so this is the genuinely unclassified transport
     * case. It says both possibilities rather than picking one, because
     * picking one is how the original message came to be wrong. */
    return {
      fault: "unknown",
      message:
        `${REACH_PREFIX} This is a problem on our side, and we could not tell whether it is a ` +
        `passing glitch or a setting that needs fixing — try again once, and if it happens ` +
        `again it is ours to fix rather than yours to wait out. ${SEARCH_STILL_WORKS}`,
      retryWorks: true,
      operatorHint:
        "Transport failure with no errno on the error or its cause. Check /api/health, which " +
        "probes the same path and reports the host.",
    };
  }

  if (text.includes("service role") || text.includes("supabase is not configured")) {
    return {
      fault: "not-configured",
      message:
        `${REACH_PREFIX} This is a problem on our side: the deployment has no database ` +
        `configured, so saving cannot work until one is. ${SEARCH_STILL_WORKS}`,
      retryWorks: false,
      operatorHint:
        "createAdminClient threw: SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL is unset.",
    };
  }

  return {
    fault: "unknown",
    message: `${REACH_PREFIX} This is a problem on our side — try again in a minute. ${SEARCH_STILL_WORKS}`,
    retryWorks: true,
    operatorHint: "Unrecognised database error. The raw detail is in the log line beside this.",
  };
}

/** Whether an error looks like it never reached the database at all. */
export function looksLikeTransport(error: unknown): boolean {
  const text = haystack(error);
  return Boolean(text) && TRANSPORT.some((sign) => text.includes(sign));
}
