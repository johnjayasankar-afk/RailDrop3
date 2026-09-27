/* What actually failed, rather than always blaming the board.
 *
 * There is one error boundary for the whole app, and it opened with "The board
 * could not load." on every route it caught — sign-in, settings, the
 * methodology page. Three of those have no board. A reader who hit an error on
 * /login was told a screen they were not looking at had failed.
 *
 * The second sentence was worse. "This is usually a brief hitch, not a lost
 * watch" is a claim about the cause, and the boundary is in no position to make
 * it: in production React hands it a redacted digest and nothing else. When the
 * records store went unreachable for a fortnight, that sentence invited the
 * reader to keep pressing Try again against something that could not succeed,
 * and it read as reassurance every time. Saying less is the fix.
 *
 * So this maps the one fact the boundary genuinely has — the path — onto a
 * subject, and says nothing about how long the failure will last. Pure, because
 * the mapping is the part worth testing and the markup is not.
 */

export interface ErrorSubject {
  /** What failed, as a whole sentence, for the heading. */
  heading: string;
  /** What to do, without promising an outcome. */
  body: string;
}

/**
 * Whether this route is drawing something the reader has saved with us.
 *
 * Only these may say "nothing you saved was changed". The boundary catches a
 * failure to render, which is a read; on a route that stores nothing the
 * sentence would be noise, and on one we cannot identify it would be a guess.
 */
const SAVED = new Set(["board", "dashboard", "settings"]);

/** Try once more, and know when to stop. True on every route. */
const ADVICE =
  "Try again once — if it fails again the fault is ours, and waiting will not clear it.";

const HEADINGS: Record<string, string> = {
  board: "The board could not load.",
  dashboard: "Your watches could not load.",
  "watches-new": "The trip form could not load.",
  settings: "Your settings could not load.",
  login: "Sign in could not load.",
  home: "RailDrop could not load.",
  unknown: "This page could not load.",
};

/**
 * Which screen the reader was on, from the path alone.
 *
 * Exported for the test, and because the names are the interesting part: a
 * route that is not listed resolves to "unknown", which is honest, rather than
 * to the board, which was the bug.
 */
export function errorScreen(pathname: string | null | undefined): string {
  if (!pathname) return "unknown";
  const path = pathname.split("?")[0]!.replace(/\/+$/, "") || "/";
  if (path === "/") return "home";
  if (path === "/dashboard") return "dashboard";
  if (path === "/settings") return "settings";
  if (path === "/login") return "login";
  if (path === "/watches/new") return "watches-new";
  /* A board is /watches/<id> and nothing deeper. Matching the prefix alone
     would drag /watches/new back in, which is a form and not a board. */
  if (/^\/watches\/[^/]+$/.test(path)) return "board";
  return "unknown";
}

export function errorSubject(pathname: string | null | undefined): ErrorSubject {
  const screen = errorScreen(pathname);
  return {
    heading: HEADINGS[screen] ?? HEADINGS.unknown!,
    body: SAVED.has(screen) ? `Nothing you saved was changed. ${ADVICE}` : ADVICE,
  };
}
