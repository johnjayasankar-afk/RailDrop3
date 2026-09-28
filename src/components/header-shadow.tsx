"use client";

import { useEffect } from "react";

/* The header's boundary, shown only once it has something to separate.
 *
 * An IntersectionObserver on a sentinel is the tidier pattern and was the first
 * attempt — the browser reports the one moment the top of the page leaves the
 * viewport instead of the app asking on every frame. It is not used here
 * because it could not be verified: in the harness this was built in, IO never
 * delivered a callback at all, not even the initial one, on a scrollable page
 * with a one-pixel target. Shipping an effect that cannot be demonstrated to
 * fire is worse than shipping the plainer thing that can.
 *
 * So: a passive scroll listener, coalesced into one animation frame, comparing
 * a boolean and touching the DOM only when it changes. Passive means it never
 * delays a scroll; the rAF gate means bursts of scroll events collapse into one
 * read; the equality check means no class write on the overwhelming majority of
 * frames where the answer has not changed.
 *
 * The class only ever decorates. The header is server-rendered and sticks by
 * CSS, so with JavaScript off it still works and simply keeps its quiet border.
 */
const SHOW_AFTER_PX = 4;

export function HeaderShadow() {
  useEffect(() => {
    const header = document.querySelector(".site-header");
    if (!header) return;

    let frame = 0;
    let applied: boolean | null = null;

    const read = () => {
      frame = 0;
      const scrolled = window.scrollY > SHOW_AFTER_PX;
      if (scrolled === applied) return;
      applied = scrolled;
      header.classList.toggle("is-scrolled", scrolled);
    };

    const onScroll = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(read);
    };

    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
      header.classList.remove("is-scrolled");
    };
  }, []);

  return null;
}
