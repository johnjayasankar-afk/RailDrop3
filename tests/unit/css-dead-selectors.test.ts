import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/* A rule that styles a class nothing renders is silent, and it lies twice.
 *
 * Rewriting the split-flap retired `.flap-face`. Three rules still targeted
 * it, and two of them were the unboxing work from earlier the same day:
 *
 *   .date-card .flap-face            { animation: none }
 *   .ticket-hero .flap-hero .flap-face { animation: none }
 *
 * So the date-card fare and the hero fare — the two figures the board exists
 * to show, deliberately taken out of their boxes — quietly got a hinge line
 * across the middle and a board-coloured leaf on a paper card. Nothing warned.
 * The build was green, the tests passed, the overlap audit was clean, and the
 * only way to find it was to read a grep of the file for an unrelated reason.
 *
 * The same rewrite orphaned `@keyframes flap-tick` for three other rules;
 * tests/unit/css-animations.test.ts covers that half. This is the other half:
 * a selector naming a class that no component emits.
 *
 * Tailwind utilities are not checked — they are generated, and half of them
 * legitimately appear only inside the framework. This looks at the app's own
 * component classes, which are the ones a rename can strand.
 */

const ROOT = path.resolve(__dirname, "../..");
const CSS = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
/* Comments name retired classes on purpose, explaining why they went. */
const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, dir))) {
    const relative = path.join(dir, entry);
    if (statSync(path.join(ROOT, relative)).isDirectory()) out.push(...walk(relative));
    else if (/\.tsx?$/.test(entry)) out.push(relative);
  }
  return out;
}

const SOURCE = walk("src")
  .filter((file) => !file.endsWith(".css"))
  .map((file) => readFileSync(path.join(ROOT, file), "utf8"))
  .join("\n");

/**
 * The app's own component classes, as they appear in selectors.
 *
 * Only multi-part kebab names: `board-row`, `flap-leaf`, `hud-label`. That is
 * the house convention and it excludes Tailwind's generated utilities and
 * single words like `flap` or `panel` that could collide with anything.
 */
function appClasses(): Map<string, number> {
  const seen = new Map<string, number>();
  const lines = CODE.split("\n");
  lines.forEach((line, index) => {
    // Selector lines only: no declarations, no at-rules.
    if (!line.includes(".") || line.includes(":") === false ? false : line.trim().endsWith(";"))
      return;
    if (/^\s*(@|\/|\*)/.test(line)) return;
    for (const match of line.matchAll(/\.([a-z][a-z0-9]*(?:-[a-z0-9]+)+)/g)) {
      const name = match[1]!;
      if (!seen.has(name)) seen.set(name, index + 1);
    }
  });
  return seen;
}

/* Classes built at runtime, where the literal never appears whole.
 *
 * Every prefix is tried, not just the last segment: `is-${standing.standing}`
 * produces `.is-well-above`, whose literal in the source is `is-$`, and a rule
 * that only looked at `is-well-` would call it dead. This is a real loss of
 * precision — any `.is-*` rule now passes once a single `is-${...}` exists
 * anywhere — and it is the right trade, because a dead-code check that reports
 * live code is a check people delete.
 */
function referenced(name: string): boolean {
  if (SOURCE.includes(name)) return true;
  const parts = name.split("-");
  for (let take = 1; take < parts.length; take += 1) {
    if (SOURCE.includes(`${parts.slice(0, take).join("-")}-$`)) return true;
  }
  return false;
}

describe("globals.css does not style classes nothing renders", () => {
  const classes = appClasses();

  it("finds the app's own component classes", () => {
    // A regex that matches nothing passes every assertion below it.
    /* Was 150, when the stylesheet also dressed a dashboard, a board, a
       command palette and seven authenticated routes. Those are gone and
       390 rules went with them; the floor tracks what the app is now, and
       the two named classes are ones the surviving surfaces emit. */
    expect(classes.size).toBeGreaterThan(80);
    expect(classes.has("flap-leaf")).toBe(true);
    expect(classes.has("lookup-day")).toBe(true);
  });

  it("has no selector for a class no component emits", () => {
    const orphans = [...classes.entries()]
      .filter(([name]) => !referenced(name))
      .map(([name, line]) => `globals.css:${line}  .${name}`);
    expect(
      orphans.length === 0
        ? []
        : orphans.concat(
            "Either the markup lost the class, or the rule outlived it. Both are bugs.",
          ),
    ).toEqual([]);
  });

  it("would catch the rename that prompted it", () => {
    // .flap-face is gone from the markup; a rule for it must not come back.
    expect(SOURCE.includes("flap-face")).toBe(false);
    expect(CODE.includes(".flap-face")).toBe(false);
    expect(referenced("flap-face")).toBe(false);
    // And the classes that replaced it are real on both sides.
    for (const live of ["flap-mech", "flap-leaf-in", "flap-leaf-out"]) {
      expect(referenced(live)).toBe(true);
      expect(classes.has(live)).toBe(true);
    }
  });
});
