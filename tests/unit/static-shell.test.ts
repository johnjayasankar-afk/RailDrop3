import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/* No page reads the request before it renders anything.
 *
 * Under Cache Components the shell is whatever a route can produce without
 * knowing who is asking or what time it is. A session read, a repository call
 * or a `new Date()` in the default-exported component does not make that
 * component dynamic — it makes the entire ROUTE dynamic, shell included, and
 * the header, the footer and the layout stop being served from the edge.
 *
 * Three routes were still doing this, and the reason it survived a green
 * build is worth stating: the offline branch of getSessionUser read the clock
 * and `next build` never takes that branch. The dev server logged 107 errors
 * across /watches/[id], /watches/new and /dashboard; `next build` printed a
 * clean route table. Nothing in the toolchain reconciled the two.
 *
 * So the invariant is asserted on the source instead. The default export may
 * render; the reads happen below a <Suspense>.
 */

const APP = path.resolve(__dirname, "../../src/app");

/** Every route file under src/app, as a path relative to it. */
function pagesUnder(dir: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...pagesUnder(path.join(dir, entry.name), rel));
    else if (entry.name === "page.tsx") found.push(rel);
  }
  return found;
}

const PAGES = pagesUnder(APP).sort();

/** Request reads that pull the whole route out of the static shell. */
const REQUEST_READS = [
  ["getSessionUser(", "reads the session"],
  ["getRepository(", "reaches the database"],
  ["connection(", "declares itself request-time"],
  ["new Date(", "reads the clock"],
  ["cookies(", "reads cookies"],
  ["headers(", "reads headers"],
] as const;

/**
 * The default-exported component's body.
 *
 * Top-level functions close on a lone `}` at column zero, which prettier
 * enforces and `npm run verify` checks before this test ever runs. Anything
 * defined below that line — the streamed body, the skeleton — is not the
 * shell and is free to read whatever it needs.
 */
function shellOf(source: string): string | null {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const start = code.search(/^export default (?:async )?function /m);
  if (start === -1) return null;
  const end = code.indexOf("\n}", start);
  return end === -1 ? code.slice(start) : code.slice(start, end);
}

describe("every page has a static shell", () => {
  it("found the pages it is supposed to be checking", () => {
    // A glob that matches nothing passes every assertion below it.
    expect(PAGES.length).toBeGreaterThanOrEqual(9);
    expect(PAGES).toContain("page.tsx");
    expect(PAGES).toContain("dashboard/page.tsx");
  });

  it("can actually read a shell out of a page", () => {
    // Otherwise the sweep below passes by extracting empty strings.
    const board = shellOf(readFileSync(path.join(APP, "watches/[id]/page.tsx"), "utf8"));
    expect(board).toContain("<Suspense");
    expect(board).not.toContain("getSessionUser(");
    // And the read it used to do is still in the file, one level down.
    expect(readFileSync(path.join(APP, "watches/[id]/page.tsx"), "utf8")).toContain(
      "getSessionUser(",
    );
  });

  it("has no request read above the boundary", () => {
    const offences: string[] = [];
    for (const page of PAGES) {
      const shell = shellOf(readFileSync(path.join(APP, page), "utf8"));
      if (shell === null) {
        offences.push(`${page} has no default-exported function component`);
        continue;
      }
      for (const [token, what] of REQUEST_READS) {
        if (shell.includes(token)) {
          offences.push(`${page} ${what} in its shell — move it below a <Suspense>`);
        }
      }
    }
    expect(offences).toEqual([]);
  });
});

/* The write that a render was doing.
 *
 * getSessionUser's offline branch upserted a profile row on every read,
 * stamped from the render clock, into a field with no reader anywhere in the
 * codebase. The clock was what the framework complained about; the write was
 * the actual defect, and it is the kind that comes back because it looks
 * helpful. */
describe("reading the session does not write", () => {
  const SESSION = readFileSync(path.resolve(__dirname, "../../src/lib/auth/session.ts"), "utf8");
  const CODE = SESSION.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("is reading the file it is supposed to be checking", () => {
    expect(CODE).toContain("export async function getSessionUser");
  });

  it("does not reach the repository at all", () => {
    // Reading a cookie needs no rows. Importing the repository here is what
    // made a write possible in the first place.
    expect(CODE).not.toContain("@/lib/services");
    expect(CODE).not.toMatch(/\bupsert[A-Z]/);
  });

  it("reads no clock", () => {
    expect(CODE).not.toContain("new Date(");
  });
});
