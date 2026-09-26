/* Copying, honestly.
 *
 * Every copy action in the board used to be `void navigator.clipboard
 * .writeText(...)` followed unconditionally by a "Copied" toast. Fifteen of
 * them, none with a catch. The async Clipboard API is unavailable on an
 * insecure origin, throws when the document is not focused, and is blocked
 * outright in several in-app browsers — so on those the text never reached the
 * clipboard and the interface said it did.
 *
 * This product's whole claim is that it does not tell you things it cannot
 * stand behind. A toast that lies about the clipboard is the same fault as a
 * fare that was never observed, in a smaller place.
 *
 * So: try the real API, fall back to a selection-based copy, and when both
 * fail say so, so the caller can put the text somewhere the reader can select
 * it by hand.
 */

export type CopyOutcome =
  /** The async Clipboard API took it. */
  | "clipboard"
  /** The older selection-based path took it. */
  | "fallback"
  /** Nothing took it. The caller must show the text instead. */
  | "failed";

export interface CopyDeps {
  /** Injected for tests; defaults to navigator.clipboard when it exists. */
  writeText?: ((text: string) => Promise<void>) | null;
  /** Injected for tests; defaults to the hidden-textarea path. */
  selectionCopy?: ((text: string) => boolean) | null;
}

/**
 * The pre-Clipboard-API path: put the text in an off-screen textarea, select
 * it, and ask the document to copy the selection.
 *
 * Deprecated, and still the only thing that works in some in-app browsers.
 * Positioned rather than hidden because a display:none element cannot be
 * selected, and read-only so focusing it does not raise a keyboard on iOS.
 */
function selectionCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "0";
  area.style.opacity = "0";
  area.style.pointerEvents = "none";

  const active = document.activeElement as HTMLElement | null;
  document.body.appendChild(area);
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    // execCommand is deprecated but not replaced for this case.
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
    // Put focus back where the reader left it, or the next keystroke goes
    // somewhere they did not choose.
    active?.focus?.();
  }
}

export async function copyText(text: string, deps: CopyDeps = {}): Promise<CopyOutcome> {
  const write =
    deps.writeText !== undefined
      ? deps.writeText
      : typeof navigator !== "undefined" && navigator.clipboard
        ? navigator.clipboard.writeText.bind(navigator.clipboard)
        : null;

  if (write) {
    try {
      await write(text);
      return "clipboard";
    } catch {
      // Insecure origin, unfocused document, or a browser that refuses.
      // Not fatal: there is still the older path.
    }
  }

  const fallback = deps.selectionCopy !== undefined ? deps.selectionCopy : selectionCopy;
  if (fallback) {
    try {
      if (fallback(text)) return "fallback";
    } catch {
      // fall through
    }
  }

  return "failed";
}

/** True when the text reached the clipboard by either route. */
export function copySucceeded(outcome: CopyOutcome): boolean {
  return outcome !== "failed";
}
