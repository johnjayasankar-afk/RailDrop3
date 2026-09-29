"use client";

import { useState } from "react";

/* The split-flap, which did not split and did not flap.
 *
 * The product is named after a departure board and this is its signature
 * component. It was one face tipping from rotateX(-72deg) to flat over 280ms:
 * a card dropping in. A split-flap does something specific and physical, and
 * the specificity is the whole charm of it —
 *
 *   the glyph is cut across the middle by a hinge
 *   the top half of the OLD glyph falls forward, revealing the new top behind it
 *   the bottom half of the NEW glyph then drops from the hinge over the old bottom
 *
 * — so for an instant you are reading the top of one character and the bottom
 * of another, which is the thing nobody can mistake for a fade.
 *
 * That needs the outgoing glyph, and the old component could not have it: it
 * keyed the face on its own text, so React destroyed the old DOM before the
 * new one existed. Keeping both is the documented "adjusting state when a prop
 * changes" pattern — a set during render, which React applies before it
 * commits anything, without an effect and without a wasted paint.
 *
 * Leaf B settles with `both`, so it stays put at rest holding the new bottom
 * half over the stale static one. That is what makes the resting state correct
 * without an animationend handler, and it is why reduced motion needs nothing
 * more than switching the animations off.
 */
export interface FlapState {
  /** The glyph on the cell now. */
  now: string;
  /** The glyph it is turning away from, equal to `now` at rest. */
  was: string;
}

/**
 * The state adjustment, pulled out so it can be tested without a renderer.
 *
 * Returning the same object when nothing changed is what stops the render-time
 * set from looping: React compares with Object.is and does nothing.
 */
export function nextFlapState(previous: FlapState, children: string): FlapState {
  if (previous.now === children) return previous;
  return { now: children, was: previous.now };
}

export function Flap({ children, className = "" }: { children: string; className?: string }) {
  const [shown, setShown] = useState<FlapState>({ now: children, was: children });
  const next = nextFlapState(shown, children);
  if (next !== shown) setShown(next);

  return (
    <span className={`flap ${className}`.trim()}>
      {/* The text, once, for anything that reads rather than looks. The
          mechanism below paints the same characters up to four times. */}
      <span className="sr-only">{next.now}</span>
      <span className="flap-mech" aria-hidden key={next.now}>
        {/* In flow, so it sizes the cell. The three below are absolute. */}
        <span className="flap-half flap-top">{next.now}</span>
        <span className="flap-half flap-bottom">{next.was}</span>
        <span className="flap-leaf flap-leaf-out">{next.was}</span>
        <span className="flap-leaf flap-leaf-in">{next.now}</span>
      </span>
    </span>
  );
}
