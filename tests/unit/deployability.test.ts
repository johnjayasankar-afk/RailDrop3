import { existsSync } from "node:fs";
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

  it("has exactly one of them, so the routing rules are not silently absent", () => {
    /* Zero is its own failure and a quieter one. The proxy is what protects
       /dashboard, /settings, /usage and /watches; with no file at all the build
       succeeds and every protected route becomes public. */
    expect([...locate("middleware"), ...locate("proxy")]).toHaveLength(1);
  });
});
