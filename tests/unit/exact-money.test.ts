import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/* No surface rounds a fare.
 *
 * The product's one promise is that it never invents a price, and the obvious
 * reading of that is "do not make one up". The subtler reading is the one that
 * actually got violated: four separate surfaces took an exact observation in
 * cents and printed a rounded dollar figure.
 *
 *   watch-detail.tsx   Math.round(best.savingsCents / 100)
 *                      → "Save up to $55" over an observed saving of $54.50,
 *                        rounded in our own favour, in the headline figure of
 *                        the panel the whole product exists to show.
 *   fare-lookup.tsx    (cheapest.totalPartyPriceCents / 100).toFixed(0)
 *                      → "$74" for a listed $74.50, in the hero.
 *   connect-live-fares Math is the same, in the sentence that exists to prove
 *                      the live provider is returning real numbers.
 *   WatchSettingsForm  seeded a text input from a rounded value and multiplied
 *                      it straight back out, so opening the settings form and
 *                      saving it moved a $5.50 threshold to $6.00.
 *
 * None of these is a fabricated fare in the sense the comments elsewhere warn
 * about — no number was conjured. Each one is worse in a quieter way: it takes
 * a number we did observe and shows a different one, and it does it in the
 * exact places a reader is most likely to trust.
 *
 * formatUsdCompact is the only correct way to put cents on screen. It drops
 * the decimals when there are none and keeps them when there are, which is the
 * entire distinction. This test exists because all four of these were written
 * by people (and by me) who knew the rule perfectly well — the failure mode is
 * not ignorance, it is that `/ 100` is the shortest thing to type.
 */

const ROOT = path.resolve(__dirname, "../..");

/* Presentation only. Domain code divides by 100 for legitimate reasons —
   percentage arithmetic, bucketing a corridor's fares into dollar bands — and
   none of that reaches a reader as a price. */
const SURFACES = ["src/components", "src/app"];

/** `Math.round(x / 100)`, `Math.floor(xCents / 100)`, `(x / 100).toFixed(0)`. */
const ROUNDERS = [
  /Math\.(?:round|floor|trunc|ceil)\s*\([^;\n]*?\/\s*100\s*\)/,
  /\/\s*100\s*\)\s*\.toFixed\(\s*0\s*\)/,
];

function walk(dir: string): string[] {
  const absolute = path.join(ROOT, dir);
  const out: string[] = [];
  for (const entry of readdirSync(absolute)) {
    const relative = path.join(dir, entry);
    if (statSync(path.join(ROOT, relative)).isDirectory()) {
      out.push(...walk(relative));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(relative);
    }
  }
  return out;
}

/* Comments are where the rule is explained, and every explanation of it has to
   quote the thing it is warning against. Stripping them keeps this test from
   failing on its own documentation. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("cents reach the screen exactly", () => {
  const files = SURFACES.flatMap(walk);

  it("scans every component and page", () => {
    // A glob that matches nothing passes every assertion below it.
    expect(files.length).toBeGreaterThan(40);
  });

  it("has no surface that rounds cents to whole dollars", () => {
    const offenders = files.flatMap((file) => {
      const lines = code(readFileSync(path.join(ROOT, file), "utf8")).split("\n");
      return lines.flatMap((line, index) =>
        ROUNDERS.some((pattern) => pattern.test(line))
          ? [`${file}:${index + 1}  ${line.trim()}`]
          : [],
      );
    });
    expect(
      offenders.length === 0
        ? []
        : offenders.concat(
            "Use formatUsdCompact from @/lib/domain/money — it keeps the cents when there are any.",
          ),
    ).toEqual([]);
  });

  it("would catch the bug it was written for", () => {
    // The literal line that shipped, so this test cannot quietly stop working.
    const shipped = "{Math.round(best.savingsCents / 100)}";
    expect(ROUNDERS.some((pattern) => pattern.test(shipped))).toBe(true);
    const alsoShipped = "{(cheapest!.totalPartyPriceCents / 100).toFixed(0)}";
    expect(ROUNDERS.some((pattern) => pattern.test(alsoShipped))).toBe(true);
  });

  it("leaves arithmetic that is not a price alone", () => {
    // A percentage is derived, not displayed as money, and must stay legal.
    const percentage = "const pct = Math.round((savings / booked) * 100);";
    expect(ROUNDERS.some((pattern) => pattern.test(percentage))).toBe(false);
  });
});
