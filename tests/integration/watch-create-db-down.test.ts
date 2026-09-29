import { beforeEach, describe, expect, it, vi } from "vitest";

/* No reader is ever shown a transport string.
 *
 * A screenshot from the live site, 2026-09-29: "TypeError: fetch failed" in
 * red under the Start watching button, with the traveller's whole trip typed
 * into the form above it. That is Node's undici wording for a hostname that
 * did not resolve — supabase-js catches it and puts `String(err)` into
 * `error.message` — and it is not a sentence anybody can act on.
 *
 * src/lib/errors.ts was written for exactly this and its header says so. What
 * it did not have was a test that drives the ROUTE, rather than the helper.
 * The helper being correct is not the property that matters: the property that
 * matters is that no assembly of route code can put the raw string in a
 * response body. A route that computes a diagnosis and then sends
 * `errorMessage(error)` beside it would pass every existing test in this repo.
 *
 * So this drives the real POST handler with a repository that fails in each
 * way a database actually fails, and asserts three things about what comes
 * back: it never contains a transport token, it always contains a sentence
 * about the database, and its `retryWorks` is honest about whether waiting
 * could help.
 */

const BODY = {
  originCode: "BOS",
  destinationCode: "NYP",
  desiredTravelDate: "2026-10-09",
  dateFlexibilityDays: 1,
  currentBookedPriceCents: 12_800,
  passengerCount: 1,
  monitorPreset: "48h",
  minimumSavingsCents: 100,
  timezone: "America/New_York",
};

/** Raw strings that mean nothing to a traveller. None may reach a response. */
const LEAKS = [
  "fetch failed",
  "typeerror",
  "enotfound",
  "econnrefused",
  "etimedout",
  "getaddrinfo",
  "supabase.co",
  "undici",
  "socket hang up",
  "[object object]",
  "pgrst",
  "und_err",
];

/** The shapes a failing Supabase call actually produces in Node. */
function shapes(): { name: string; error: unknown; retryWorks: boolean }[] {
  const undici = (code: string, text: string) =>
    Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error(text), { code, errno: -61 }),
    });
  return [
    {
      name: "hostname does not resolve (project deleted)",
      error: undici("ENOTFOUND", "getaddrinfo ENOTFOUND db.abcdef.supabase.co"),
      retryWorks: false,
    },
    {
      name: "connection refused (project paused)",
      error: undici("ECONNREFUSED", "connect ECONNREFUSED 1.2.3.4:5432"),
      retryWorks: false,
    },
    {
      name: "connect timeout",
      error: undici("UND_ERR_CONNECT_TIMEOUT", "Connect Timeout Error"),
      retryWorks: true,
    },
    {
      // What the live screenshot showed: supabase-js flattens the TypeError.
      name: "supabase-js flattened, no detail",
      error: { message: "TypeError: fetch failed", details: "", hint: "", code: "" },
      retryWorks: true,
    },
    {
      name: "supabase-js flattened, detail kept",
      error: {
        message: "TypeError: fetch failed",
        details: "getaddrinfo ENOTFOUND db.abcdef.supabase.co",
        hint: "",
        code: "",
      },
      retryWorks: false,
    },
    {
      name: "bare TypeError with no cause at all",
      error: new TypeError("fetch failed"),
      retryWorks: true,
    },
    {
      name: "schema never applied",
      error: {
        message: 'relation "public.watches" does not exist',
        code: "42P01",
        details: "",
        hint: "",
      },
      retryWorks: false,
    },
    {
      name: "row-level security refusing the service role",
      error: {
        message: "new row violates row-level security policy",
        code: "42501",
        details: "",
        hint: "",
      },
      retryWorks: false,
    },
  ];
}

let failWith: unknown = null;

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => ({ id: "u1", email: "t@example.com", isGuest: true }),
  guestEntryHref: (next: string) => next,
}));

vi.mock("@/lib/services", () => ({
  getRepository: () => ({
    upsertProfile: async () => {
      throw failWith;
    },
    createWatch: async () => {
      throw failWith;
    },
  }),
  getFareProvider: () => ({ search: async () => [] }),
  getMailer: () => ({ send: async () => undefined }),
}));

const { POST } = await import("@/app/api/watches/route");

async function create(): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await POST(
    new Request("http://localhost/api/watches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(BODY),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe("POST /api/watches when the database is unreachable", () => {
  beforeEach(() => {
    failWith = null;
  });

  it("is actually exercising the failure path", async () => {
    // A mock that never throws would make every assertion below vacuous.
    failWith = new TypeError("fetch failed");
    const { status } = await create();
    expect(status).toBeGreaterThanOrEqual(400);
  });

  for (const shape of shapes()) {
    it(`says something a person can act on: ${shape.name}`, async () => {
      failWith = shape.error;
      const { status, body } = await create();
      const text = String(body.error ?? "");

      expect(status).toBeGreaterThanOrEqual(400);

      const leaked = LEAKS.filter((token) => text.toLowerCase().includes(token));
      expect(leaked, `raw transport string reached the reader in: ${text}`).toEqual([]);

      // And it is a real sentence about the thing that failed, not a shrug.
      expect(text.length).toBeGreaterThan(40);
      expect(text.toLowerCase()).toMatch(/database|saved|tables/);
    });

    it(`is honest about whether waiting helps: ${shape.name}`, async () => {
      failWith = shape.error;
      const { body } = await create();
      /* The one that matters most. Five of the six database faults are
         permanent until a person does something, and telling somebody to
         wait for one of those is the same class of failure as inventing a
         price: a confident sentence about a state nobody observed. */
      expect(body.retryWorks, `wrong advice for ${shape.name}: ${String(body.error)}`).toBe(
        shape.retryWorks,
      );
    });
  }

  it("never loses what the traveller typed", async () => {
    failWith = new TypeError("fetch failed");
    const { status, body } = await create();
    // A 4xx would tell the form the request was wrong and invite them to edit
    // it; nothing they could change about this request would have worked.
    expect(status).toBe(503);
    expect(body.fault).toBeTruthy();
  });
});
