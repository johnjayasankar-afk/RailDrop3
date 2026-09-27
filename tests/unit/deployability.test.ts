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

    // readdirSync rather than fs.globSync: the latter is not in this @types/node,
    // and vitest would not have told us — it does not typecheck. tsc did.
    const routeFiles: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const next = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(next);
        else if (entry.name === "route.ts") routeFiles.push(next);
      }
    };
    walk("src/app/api");

    const needBrowser = routeFiles
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

  it("has exactly one of them, so the routing rules are not silently absent", () => {
    /* Zero is its own failure and a quieter one. The proxy is what protects
       /dashboard, /settings, /usage and /watches; with no file at all the build
       succeeds and every protected route becomes public. */
    expect([...locate("middleware"), ...locate("proxy")]).toHaveLength(1);
  });
});
