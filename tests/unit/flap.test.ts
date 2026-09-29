import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Flap, nextFlapState, type FlapState } from "@/components/flap";

/* The split-flap, which did not split and did not flap.
 *
 * The product is named after a departure board and this is its signature
 * component. It was one face tipping from rotateX(-72deg) to flat over 280ms
 * — a card dropping in. A split-flap does something specific: the glyph is cut
 * across the middle, the top half of the OLD character falls forward to reveal
 * the new top behind it, and then the bottom half of the NEW character drops
 * from the hinge over the old bottom. For an instant you are reading the top
 * of one character and the bottom of another, and that is the part nobody can
 * mistake for a fade.
 *
 * Which needs the outgoing glyph. The old component could not have it: it
 * keyed its single face on its own text, so React destroyed the old DOM before
 * the new existed.
 */

const rest: FlapState = { now: "BOS", was: "BOS" };

describe("nextFlapState", () => {
  it("remembers what the cell is turning away from", () => {
    expect(nextFlapState(rest, "NYP")).toEqual({ now: "NYP", was: "BOS" });
  });

  it("returns the same object when nothing changed", () => {
    // Identity, not equality. A render-time set that produced a new object
    // every render would loop forever; React bails out on Object.is.
    expect(nextFlapState(rest, "BOS")).toBe(rest);
  });

  it("keeps only one step of history, however many changes arrive", () => {
    let state = rest;
    for (const glyph of ["NYP", "PHL", "WAS"]) state = nextFlapState(state, glyph);
    expect(state).toEqual({ now: "WAS", was: "PHL" });
  });

  it("treats a change and a change back as two changes", () => {
    const away = nextFlapState(rest, "NYP");
    expect(nextFlapState(away, "BOS")).toEqual({ now: "BOS", was: "NYP" });
  });
});

describe("the rendered mechanism", () => {
  const html = renderToStaticMarkup(createElement(Flap, { children: "8:14 PM" }));

  it("paints four halves: two static, two leaves", () => {
    for (const cls of ["flap-top", "flap-bottom", "flap-leaf-out", "flap-leaf-in"]) {
      expect(html).toContain(cls);
    }
  });

  it("hides the mechanism from the accessibility tree", () => {
    // Four copies of the same string is a picture of an object turning, not
    // four things to read. scripts/audit-overlap.ts skips this subtree for
    // the same reason.
    expect(html).toContain('aria-hidden="true"');
  });

  it("says the value exactly once to anything that reads", () => {
    const announced = html.match(/class="sr-only"[^>]*>([^<]*)</);
    expect(announced?.[1]).toBe("8:14 PM");
    expect(html.match(/sr-only/g)).toHaveLength(1);
  });

  it("shows the same glyph top and bottom at rest", () => {
    // Nothing has changed yet, so the cell must read as one character — not
    // as a flip frozen halfway.
    const halves = [...html.matchAll(/class="flap-(?:half flap-(?:top|bottom)|leaf[^"]*)"[^>]*>([^<]*)</g)];
    expect(halves).toHaveLength(4);
    expect(new Set(halves.map((m) => m[1]))).toEqual(new Set(["8:14 PM"]));
  });

  it("keeps the caller's className on the cell", () => {
    const withClass = renderToStaticMarkup(
      createElement(Flap, { children: "95", className: "flap-hero" }),
    );
    expect(withClass).toContain('class="flap flap-hero"');
  });
});
