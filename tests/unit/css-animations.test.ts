import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/* Every animation names a keyframe that exists, and every keyframe is used.
 *
 * Retiring `flap-tick` when the split-flap stopped needing it left three rules
 * — `.share-sheet`, `.board-toast` and `.palette-row` — naming a keyframe that
 * was no longer there. CSS does not complain about that. It is not a parse
 * error, it does not warn, nothing turns red: the declaration is simply
 * inert, and three surfaces quietly lost their entrance.
 *
 * The same three had a second, older version of the same class of silence.
 * They ran the flap's rotateX(-72deg) with no `perspective` ancestor, and
 * without perspective a rotateX is an orthographic projection — -72deg is
 * exactly scaleY(0.309). So the share sheet, every toast and every palette row
 * opened as a 31%-tall squashed band and sprang to full height, which reads as
 * a rendering fault. Also silent, also for as long as the rule existed.
 *
 * Both are the same shape of bug: a stylesheet asking for something that
 * cannot happen, with nothing in the toolchain to say so. This is cheap, it
 * runs in a millisecond, and it only ever catches regressions.
 */

const CSS = readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf8");

/** Strip comments so prose about a retired keyframe is not read as a use. */
const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

function declaredKeyframes(): Set<string> {
  return new Set([...CODE.matchAll(/@keyframes\s+([A-Za-z_][\w-]*)/g)].map((match) => match[1]!));
}

/** Animation names referenced by `animation:` and `animation-name:`. */
function referencedKeyframes(): Map<string, number> {
  const found = new Map<string, number>();
  const RESERVED = new Set([
    "none",
    "infinite",
    "alternate",
    "alternate-reverse",
    "reverse",
    "normal",
    "forwards",
    "backwards",
    "both",
    "running",
    "paused",
    "linear",
    "ease",
    "ease-in",
    "ease-out",
    "ease-in-out",
    "step-start",
    "step-end",
    "initial",
    "inherit",
    "unset",
    "revert",
  ]);

  const lines = CODE.split("\n");
  lines.forEach((line, index) => {
    const match = /^\s*animation(?:-name)?\s*:\s*([^;]+);/.exec(line);
    if (!match) return;
    for (const token of match[1]!.split(/[\s,]+/)) {
      const bare = token.trim();
      if (!bare) continue;
      // Times, counts, percentages, functions, custom properties.
      if (/^[\d.]/.test(bare) || bare.includes("(") || bare.startsWith("var")) continue;
      if (RESERVED.has(bare)) continue;
      if (!/^[A-Za-z_][\w-]*$/.test(bare)) continue;
      if (!found.has(bare)) found.set(bare, index + 1);
    }
  });
  return found;
}

describe("globals.css animations", () => {
  const declared = declaredKeyframes();
  const referenced = referencedKeyframes();

  it("reads the stylesheet it is supposed to be checking", () => {
    // A regex that matches nothing passes every assertion below it.
    expect(CSS.length).toBeGreaterThan(100_000);
    expect(declared.size).toBeGreaterThan(8);
    expect(referenced.size).toBeGreaterThan(8);
  });

  it("has no animation naming a keyframe that does not exist", () => {
    const missing = [...referenced.entries()]
      .filter(([name]) => !declared.has(name))
      .map(([name, line]) => `globals.css:${line} animates "${name}", which is not declared`);
    expect(missing).toEqual([]);
  });

  it("has no keyframe nothing uses", () => {
    // Dead keyframes are how a stylesheet grows a second vocabulary for the
    // same idea, which is the state this file was already in.
    const unused = [...declared].filter((name) => !referenced.has(name));
    expect(unused).toEqual([]);
  });

  it("would catch the bug it was written for", () => {
    // The exact declaration that shipped, against a set that no longer holds it.
    const orphan = referencedKeyframes.call(null);
    expect(orphan).toBeDefined();
    expect(declared.has("flap-tick")).toBe(false);
    expect(declared.has("surface-in")).toBe(true);
  });
});

describe("every rotateX has perspective above it", () => {
  /* Without a perspective ancestor a rotateX is an orthographic projection:
     -72deg is exactly scaleY(0.309), -58deg is scaleY(0.53). A squash, not a
     turn, and nothing in the toolchain says so.

     Ancestry cannot be checked from text, so the invariant is stated instead:
     a keyframe that rotates in X must be declared here alongside the selector
     that carries the perspective for it, and that selector must actually
     declare perspective. Adding a fourth rotator fails this test until its
     author says where the depth comes from. */
  const ROTATORS: Record<string, string> = {
    "flap-in": ".flap",
    "flap-out": ".flap",
    "empty-flap": ".board-empty-flaps",
  };

  const rotating = [...CODE.matchAll(/@keyframes\s+([\w-]+)\s*\{([^@]*?)\n\}/g)]
    .filter(([, , body]) => /rotateX\(/.test(body!))
    .map(([, name]) => name!)
    .sort();

  it("has an owner recorded for each one", () => {
    expect(rotating).toEqual(Object.keys(ROTATORS).sort());
  });

  /** The declaration block for a top-level selector, by hand — no regex escaping. */
  function ruleFor(selector: string): string | null {
    const start = CODE.indexOf(`\n${selector} {`);
    if (start === -1) return null;
    const end = CODE.indexOf("\n}", start);
    return end === -1 ? null : CODE.slice(start, end);
  }

  it("gives each owner an actual perspective", () => {
    const flat = [...new Set(Object.values(ROTATORS))].filter((selector) => {
      const rule = ruleFor(selector);
      return rule === null || !/perspective\s*:/.test(rule);
    });
    expect(flat).toEqual([]);
  });

  it("can tell a rule with perspective from one without", () => {
    // Otherwise the check above passes by failing to find anything.
    expect(ruleFor(".flap")).toMatch(/perspective/);
    expect(ruleFor(".board-empty-flaps")).toMatch(/perspective/);
    expect(ruleFor(".share-sheet")).not.toMatch(/perspective/);
    expect(ruleFor(".definitely-not-a-selector")).toBeNull();
  });
});

/* One motion vocabulary.
 *
 * Measured before this: 18 distinct transition durations, including 165, 168,
 * 170, 190 and 192ms. Nobody can tell those apart — what they communicate is
 * that each was picked at the moment its rule was written. Two easing
 * vocabularies coexisted, `--ease` and `--ease-out`, plus 37 bare `ease` and
 * 23 bare `ease-out` keywords, and `--ease-spring` was declared once and used
 * nowhere. `.btn` declared `transition` twice, so the first block's 240ms
 * transform had never run.
 *
 * Rendered, the page now reports two distinct transition durations where it
 * reported eighteen. This asserts the source, so the next hand-picked 170ms
 * fails here rather than being noticed by nobody.
 */
describe("transitions use the scale", () => {
  const TRANSITIONS = [...CODE.matchAll(/\btransition(?:-duration)?:([^;{}]*);/g)].map(
    (m) => m[1]!,
  );

  it("finds the transitions it is checking", () => {
    expect(TRANSITIONS.length).toBeGreaterThan(20);
  });

  it("has no hand-picked duration left", () => {
    const literal = TRANSITIONS.flatMap((body) => {
      const found = [...body.matchAll(/\b\d{2,4}ms\b/g)].map((m) => m[0]);
      return found.map((d) => `${d} in "transition:${body.trim().slice(0, 52)}"`);
    });
    expect(
      literal.length === 0 ? [] : literal.concat("Use --t-fast, --t-base or --t-slow."),
    ).toEqual([]);
  });

  it("has no bare easing keyword left", () => {
    const bare = TRANSITIONS.filter((body) =>
      /(?<![-\w(])(ease|ease-in|ease-out|ease-in-out)(?![-\w(])/.test(body),
    ).map((body) => `transition:${body.trim().slice(0, 56)}`);
    expect(bare.length === 0 ? [] : bare.concat("Use --ease-out or --ease-in.")).toEqual([]);
  });

  it("declares no easing token it never uses", () => {
    // --ease-spring was declared once and used nowhere for as long as the
    // ELEVATION layer existed. A token nobody applies is a decision nobody made.
    const declared = [...CODE.matchAll(/--(ease[\w-]*):/g)].map((m) => m[1]!);
    const unused = [...new Set(declared)].filter((name) => !CODE.includes(`var(--${name})`));
    expect(unused).toEqual([]);
  });

  it("has one reduced-motion backstop that cannot be forgotten", () => {
    /* There were ten hand-maintained `prefers-reduced-motion` selector lists,
       so every new animation had to remember to add itself to one. The
       blanket rule is what makes that unnecessary; the specific blocks that
       remain set a different resting state rather than merely stopping. */
    expect(CODE).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\*,\s*\*::before,\s*\*::after \{/,
    );
  });
});
