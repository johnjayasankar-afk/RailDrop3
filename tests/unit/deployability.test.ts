import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/* The check that would have saved two weeks.
 *
 * On 13 September a commit added src/proxy.ts and deleted src/middleware.ts,
 * and it deployed. The very next commit brought src/middleware.ts back, and
 * every commit for the next fourteen days carried both files. Next 16 does not
 * warn about that — it throws, in next/dist/build/index.js:
 *
 *   Both middleware.ts file "./src/middleware.ts" and proxy.ts file
 *   "./src/proxy.ts" are detected. Please use "./src/proxy.ts" only.
 *
 * So every production build failed, the live site stayed frozen on the 13
 * September bundle, and fifty-two commits of fixes — including the one that
 * lets the app return a price with no database at all — never reached anyone.
 * The whole time the reported symptoms were about the app being broken, and
 * the app was not broken. It was undeployed.
 *
 * `npm run verify` did run `next build` and would have caught it. The failure
 * was that a build takes minutes, so it was the step that got skipped. This
 * takes a millisecond and fails with the reason attached, which is the only
 * reason to test something the compiler already knows.
 */

const ROOT = path.resolve(__dirname, "../..");
const EXTENSIONS = ["ts", "tsx", "js", "jsx", "mjs"];

/** Read, not imported, so a malformed vercel.json fails here rather than at build. */
const vercelConfig = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8")) as {
  functions?: Record<string, { memory?: number; maxDuration?: number }>;
  crons?: Array<{ path: string; schedule: string }>;
};

/** Every file of a given name under src/app, relative to the repo root. */
function filesNamed(name: string, dir = "src/app"): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(path.join(ROOT, current), { withFileTypes: true })) {
      const next = `${current}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (entry.name === name) found.push(next);
    }
  };
  walk(dir);
  return found;
}

const routeFiles = () => filesNamed("route.ts");
const pageFiles = () => filesNamed("page.tsx");

function locate(base: string): string[] {
  return ["", "src"].flatMap((dir) =>
    EXTENSIONS.map((extension) => path.join(dir, `${base}.${extension}`)).filter((relative) =>
      existsSync(path.join(ROOT, relative)),
    ),
  );
}

describe("the app can actually be built for production", () => {
  it("does not carry both a middleware and a proxy file", () => {
    const middleware = locate("middleware");
    const proxy = locate("proxy");
    expect(
      middleware.length > 0 && proxy.length > 0
        ? `Next 16 refuses to build with both: ${[...middleware, ...proxy].join(" and ")}. ` +
            "middleware is the deprecated name — keep proxy and delete middleware."
        : "ok",
    ).toBe("ok");
  });

  it("does not ask Vercel for more memory than the cheapest plan allows", () => {
    /* The second thing that silently stopped deployments, and the one that was
     * still stopping them after the file collision was fixed.
     *
     * vercel.json asked for `memory: 3008` on four functions. With fluid
     * compute — the default — the ceiling is 2 GB on Hobby and 4 GB on Pro, so
     * the deployment was rejected two seconds after every push, before any
     * build, with the GitHub commit status "Deployment failed." and a
     * target_url that redirects to .../limits#serverless-function-memory. There
     * are no build logs for a deployment that never started, which is why this
     * looked like nothing was deploying at all.
     *
     * 3008 is the old pre-fluid-compute AWS Lambda ceiling, which is why it
     * looks like a legitimate number and why a sibling project on Pro accepted
     * the identical file. Staying inside the smaller ceiling costs nothing here
     * and makes the repo deployable on either plan.
     */
    const MAX_HOBBY_MEMORY_MB = 2_048;
    const MAX_HOBBY_DURATION_S = 300;
    const functions: Record<string, { memory?: number; maxDuration?: number }> =
      (vercelConfig.functions ?? {}) as Record<string, { memory?: number; maxDuration?: number }>;
    const tooBig = Object.entries(functions).filter(
      ([, config]) => (config.memory ?? 0) > MAX_HOBBY_MEMORY_MB,
    );
    expect(tooBig.map(([route, config]) => `${route} wants ${config.memory}MB`)).toEqual([]);
    const tooLong = Object.entries(functions).filter(
      ([, config]) => (config.maxDuration ?? 0) > MAX_HOBBY_DURATION_S,
    );
    expect(tooLong.map(([route, config]) => `${route} wants ${config.maxDuration}s`)).toEqual([]);
  });

  it("does not schedule a cron more often than the cheapest plan allows", () => {
    /* The third thing that silently stopped deployments, and the one left
     * standing after the memory ceiling was fixed.
     *
     * vercel.json scheduled "5 * * * *" — hourly. Hobby is limited to cron jobs
     * that run ONCE PER DAY, and a more frequent expression does not warn or
     * degrade: the deployment fails outright with "Hobby accounts are limited
     * to daily cron jobs. This cron expression would run more than once per
     * day." Like the memory ceiling, it is rejected before any build, so there
     * are no build logs and it reads as nothing deploying at all.
     *
     * The app still needs its hourly wake to claim three slots a day per
     * timezone. That now runs from .github/workflows/fare-checks.yml, and the
     * cron left here is a daily safety net.
     */
    const runsAtMostDaily = (expression: string): boolean => {
      const [minute, hour] = expression.trim().split(/\s+/);
      // A single literal minute AND a single literal hour is once a day at most.
      // Anything else — *, a list, a step, a range — fires more than once.
      const single = (field: string | undefined) => /^\d+$/.test(field ?? "");
      return single(minute) && single(hour);
    };
    const offenders = (vercelConfig.crons ?? []).filter((job) => !runsAtMostDaily(job.schedule));
    expect(offenders.map((job) => `${job.path} runs "${job.schedule}"`)).toEqual([]);
  });

  it("ships the browser binary to every route that launches a browser", async () => {
    /* Why the deployed app never returned a price, for the whole fortnight and
     * before it.
     *
     * serverExternalPackages keeps @sparticuz/chromium out of the bundle so it
     * is required at runtime. Tracing then shipped its JavaScript and none of
     * its bin/*.br archives, because nothing imports those: executablePath()
     * composes the path at runtime and a static trace cannot follow a computed
     * path. Every function got the loader for a browser and no browser, threw
     * "Serverless Chromium missing at ...", recorded PROVIDER_ERROR for every
     * date, and the board said "The fare search did not get through either" —
     * on a corridor that searches fine from a laptop, which is what made it read
     * as a scraper bug rather than a packaging one.
     *
     * Nothing in a normal test run touches this, because locally Playwright's
     * own Chromium is used and the archives are never needed. So the check is
     * static: any route that asks for a fare provider must be covered by an
     * outputFileTracingIncludes key.
     */
    const config = (await import("../../next.config")).default;
    const patterns = Object.keys(config.outputFileTracingIncludes ?? {});

    // Route globs are picomatch; "*" matches one segment and brackets are literal
    // here because Next's own docs escape them for exactly that reason.
    const covers = (pattern: string, route: string): boolean =>
      new RegExp(
        `^${pattern
          .replace(/[.+^${}()|\\]/g, "\\$&")
          .replace(/\[/g, "\\[")
          .replace(/\]/g, "\\]")
          .replace(/\*/g, "[^/]+")}$`,
      ).test(route);

    const needBrowser = routeFiles()
      .filter((relative) =>
        /getFareProvider|createFareProvider/.test(readFileSync(path.join(ROOT, relative), "utf8")),
      )
      .map((relative) => relative.replace(/^src\/app/, "").replace(/\/route\.ts$/, ""));

    expect(needBrowser.length).toBeGreaterThan(0); // the glob still finds routes
    const uncovered = needBrowser.filter(
      (route) => !patterns.some((pattern) => covers(pattern, route)),
    );
    expect(uncovered).toEqual([]);
  });

  it("has no proxy, because there is nothing left to protect", () => {
    /* This used to require exactly one, and the reason was sound: the proxy
       guarded /dashboard, /settings, /usage and /watches, so with no file at
       all the build succeeded and every protected route became public.
       
       Those routes are gone. There are no accounts, no sessions and no
       guests — every surface is public by design, and a proxy running on
       every request to protect nothing is cost without a reader. Zero is
       the right number now, and the pairing rule above still holds: never
       both files, whatever happens next. */
    const routed = [...locate("middleware"), ...locate("proxy")];
    expect(routed).toEqual([]);

    // And the premise is checked, not assumed: no authenticated route exists.
    const pages = pageFiles().map((f) => f.replace(/^src\/app/, "").replace(/\/page\.tsx$/, ""));
    expect(pages.filter((p) => /dashboard|settings|watches|login/.test(p))).toEqual([]);
  });
});

/* A file read at request time is invisible to tracing.
 *
 * The rule this described — a route that reads a repo file at runtime must
 * name it in outputFileTracingIncludes, or it works in dev and throws ENOENT
 * on Vercel — cost a fortnight when the Chromium binary went missing for six
 * routes. The route it guarded applied supabase/SETUP_ALL.sql, and both the
 * route and the SQL are gone with the database.
 *
 * The rule itself is not gone, so the check is not either: it now asserts
 * the general form against whatever routes exist, rather than naming one.
 */
describe("files read at runtime are shipped", () => {
  it("every runtime readFile of a repo path is traced", async () => {
    const config = (await import("../../next.config")).default;
    const includes = (config.outputFileTracingIncludes ?? {}) as Record<string, string[]>;

    const untraced = routeFiles()
      .filter((relative) => {
        const source = readFileSync(path.join(ROOT, relative), "utf8");
        // A path composed from process.cwd() at request time is the shape
        // that tracing cannot follow.
        return /readFile[^\n]*process\.cwd\(\)/.test(source);
      })
      .map((relative) => relative.replace(/^src\/app/, "").replace(/\/route\.ts$/, ""))
      .filter((route) => !(includes[route] ?? []).length);

    expect(untraced).toEqual([]);
  });
});

describe("files read at runtime are shipped", () => {
  it("every runtime readFile of a repo path is covered", () => {
    /* Finds the pattern rather than the one known instance: a `readFile` or
       `readFileSync` whose path is built from process.cwd() inside src/app. */
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const next = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(next);
        else if (/\.tsx?$/.test(entry.name)) {
          const source = readFileSync(path.join(ROOT, next), "utf8");
          if (/read[fF]ile(Sync)?\([^)]*process\.cwd\(\)/.test(source)) offenders.push(next);
        }
      }
    };
    walk("src/app");
    // src/app itself has none: the read lives in src/lib/db/provision.ts and
    // is reached from the route, which is why the route is the traced key.
    expect(offenders).toEqual([]);
  });
});

/* The static shell, and the one line that used to prevent it.
 *
 * Every page carried `export const dynamic = "force-dynamic"` — eight of
 * them — and the build table had no static page in it at all. Several were
 * dynamic for one reason: the header took `email` and `isGuest` as props, so
 * the page had to read a cookie before it could render its own chrome.
 * /how-it-works is a hero and twelve hard-coded FAQ strings and was rendered
 * on demand for every visitor.
 *
 * Cache Components also rejects the `runtime` and `dynamic` segment configs
 * outright, so a single one reintroduced anywhere fails the build rather than
 * quietly opting one route out. This asserts the intent as well, because a
 * build error is a worse place to learn it than a test.
 */
describe("every page keeps its static shell", () => {
  it("has Cache Components and Partial Prefetching on", async () => {
    const config = (await import("../../next.config")).default;
    expect(config.cacheComponents).toBe(true);
    expect(config.partialPrefetching).toBe(true);
  });

  it("has no route segment config that Cache Components forbids", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const next = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(next);
        else if (/\.tsx?$/.test(entry.name)) {
          const source = readFileSync(path.join(ROOT, next), "utf8");
          for (const key of ["dynamic", "runtime", "fetchCache", "revalidate"]) {
            if (new RegExp(`^export const ${key}\\s*=`, "m").test(source)) {
              offenders.push(`${next}: export const ${key}`);
            }
          }
        }
      }
    };
    walk("src/app");
    expect(offenders).toEqual([]);
  });

  it("does not let the page chrome read a session", () => {
    /* The original regression: PageFrame taking the session as props made
       eight pages dynamic. The fix was for the header and footer to resolve
       it themselves behind `use cache: private` boundaries.
       
       There is no session now, so the stronger property holds — the chrome
       reads NOTHING per-request, which is why / and /how-it-works are fully
       static rather than partially prerendered. Asserting the absence keeps
       a future session read from quietly making them dynamic again.
       
       Comments stripped first: these files explain what they used to do,
       and an assertion that fails on its own documentation is one somebody
       deletes. */
    const strip = (file: string) =>
      readFileSync(path.join(ROOT, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");

    for (const file of [
      "src/components/page-frame.tsx",
      "src/components/app-header.tsx",
      "src/components/app-footer.tsx",
    ]) {
      expect(strip(file), `${file} reads the request`).not.toMatch(
        /getSessionUser|cookies\(\)|headers\(\)|use cache: private/,
      );
    }
  });

  it("keeps the frame out of client components", () => {
    /* page-frame reaches the session through its header and footer, so a
       "use client" file importing it pulls lib/auth/session, the Supabase
       server client, playwright and puppeteer-core toward the browser
       bundle. Three components did, and the build said so at length. */
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const next = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(next);
        else if (/\.tsx$/.test(entry.name)) {
          const source = readFileSync(path.join(ROOT, next), "utf8");
          if (
            /^["']use client["']/m.test(source) &&
            /from "@\/components\/page-frame"/.test(source)
          ) {
            offenders.push(next);
          }
        }
      }
    };
    walk("src/components");
    expect(offenders).toEqual([]);
  });
});
