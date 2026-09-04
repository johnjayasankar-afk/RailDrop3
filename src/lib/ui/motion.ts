export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}

export function scrollElementIntoView(
  element: Element | null,
  block: ScrollLogicalPosition = "center",
) {
  element?.scrollIntoView({ behavior: scrollBehavior(), block });
}
