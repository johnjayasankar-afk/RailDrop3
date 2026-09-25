/* Who owns a keystroke on the board.
 *
 * The board binds twenty bare letters at the window. That is only safe if it
 * first declines every keystroke that already belongs to somebody else — the
 * browser, the operating system, an input, or an IME mid-composition. A board
 * that answers Cmd+C does two wrong things at once: it swallows the copy and
 * it spends a provider credit rechecking fares nobody asked about.
 *
 * Shift is deliberately not disqualifying: "?" is Shift+/ on a US layout, and
 * the help sheet is bound to it.
 */

export interface BoardKeyTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
}

export interface BoardKeyEventLike {
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  /** True while an IME is composing; the keystroke belongs to the composition. */
  isComposing?: boolean;
  target?: BoardKeyTargetLike | EventTarget | null;
}

/** Elements that consume their own keystrokes. */
const TEXT_ENTRY_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * True when the board may act on this keystroke and call preventDefault().
 *
 * Pure so the guard can be tested without a DOM: every rule below is a real
 * bug that reached the live site, and each one has a test.
 */
export function shouldHandleBoardKey(event: BoardKeyEventLike): boolean {
  // A modified key is a browser or OS shortcut: Cmd+C, Ctrl+R, Alt+Left.
  // The board never owns those, so it must not read them or block them.
  if (event.metaKey || event.ctrlKey || event.altKey) return false;

  // Mid-composition, the keystroke is the IME's. Japanese or Korean input
  // otherwise triggers a shortcut for every letter typed into a search field.
  if (event.isComposing) return false;

  const target = event.target as BoardKeyTargetLike | null | undefined;
  if (!target) return true;

  if (typeof target.tagName === "string" && TEXT_ENTRY_TAGS.has(target.tagName.toUpperCase())) {
    return false;
  }

  // contenteditable is a text field that does not announce itself by tag name.
  if (target.isContentEditable) return false;

  return true;
}
