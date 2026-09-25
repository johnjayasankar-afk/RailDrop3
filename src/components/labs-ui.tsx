"use client";

/* RailDrop, in the Labs material.
 *
 * Glass on the masthead and the fact tiles. The departure board is left alone:
 * it is the product, and a split-flap board reads as a solid object.
 */
import { useEffect } from "react";
// labs-ui is plain JavaScript, shared across every Labs product
import { initLabsUI } from "../lib/labs-ui.js";

export function LabsUI() {
  useEffect(() => {
    const ui = initLabsUI({
      observe: true,
      glass: [
        {
          sel: "header.site-header, header.masthead",
          spec: 1,
          lens: [13, 52, 9, 1.95],
          vars: { "--gl-tint": ".5" },
        },
        { sel: ".panel", lens: [12, 34, 8, 1.7], vars: { "--gl-tint": ".62" } },
      ],
      headings: "h1, h2",
    });
    return () => ui.stop?.();
  }, []);
  return null;
}
