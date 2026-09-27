import { existsSync, readFileSync } from "node:fs";
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

  it("has exactly one of them, so the routing rules are not silently absent", () => {
    /* Zero is its own failure and a quieter one. The proxy is what protects
       /dashboard, /settings, /usage and /watches; with no file at all the build
       succeeds and every protected route becomes public. */
    expect([...locate("middleware"), ...locate("proxy")]).toHaveLength(1);
  });
});
