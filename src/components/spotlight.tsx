"use client";

import { useEffect } from "react";

/* The highlight that follows the pointer across a panel.
 *
 * One delegated listener on the document rather than one per card: a board can
 * hold twenty panels, and twenty pointermove handlers firing on every mouse
 * movement is a real cost for an effect that is decoration. Coalesced into an
 * animation frame, so a burst of moves writes the custom properties once.
 *
 * It only ever writes two custom properties. With no JavaScript, no pointer,
 * or a coarse one, the gradient stays at its default position and the panel
 * looks lit from the middle — which is a perfectly good panel. Nothing here is
 * load-bearing.
 */
export function Spotlight() {
  useEffect(() => {
    // A finger has no hover, so this is pure cost on a touch screen.
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let pending: { el: HTMLElement; x: number; y: number } | null = null;

    const write = () => {
      frame = 0;
      if (!pending) return;
      const { el, x, y } = pending;
      pending = null;
      el.style.setProperty("--px", `${x}%`);
      el.style.setProperty("--py", `${y}%`);
    };

    const onMove = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      /* Kept in step with the same list in globals.css by hand. A panel that
         is styled for the effect but not matched here simply stays lit from
         its centre, which is why this is a comment and not a runtime check. */
      const panel = target.closest<HTMLElement>(
        ".spotlight, .date-card, .verdict, .ticket, .assistant, .lookup-head, .metric",
      );
      if (!panel) return;
      const box = panel.getBoundingClientRect();
      pending = {
        el: panel,
        x: ((event.clientX - box.left) / box.width) * 100,
        y: ((event.clientY - box.top) / box.height) * 100,
      };
      if (frame === 0) frame = window.requestAnimationFrame(write);
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
