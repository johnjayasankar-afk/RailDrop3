import { describe, expect, it } from "vitest";
import { shouldHandleBoardKey } from "@/lib/domain/board-keys";

describe("shouldHandleBoardKey", () => {
  it("handles a bare letter pressed on the page", () => {
    expect(shouldHandleBoardKey({ target: { tagName: "DIV" } })).toBe(true);
  });

  it("handles a keystroke with no target at all", () => {
    expect(shouldHandleBoardKey({})).toBe(true);
    expect(shouldHandleBoardKey({ target: null })).toBe(true);
  });

  it("declines every browser and OS shortcut", () => {
    // Cmd+C used to fire a recheck AND swallow the copy: the board spent a
    // provider credit and the clipboard stayed empty.
    expect(shouldHandleBoardKey({ metaKey: true, target: { tagName: "DIV" } })).toBe(false);
    expect(shouldHandleBoardKey({ ctrlKey: true, target: { tagName: "DIV" } })).toBe(false);
    expect(shouldHandleBoardKey({ altKey: true, target: { tagName: "DIV" } })).toBe(false);
  });

  it("still handles Shift, because ? is Shift+/", () => {
    expect(
      shouldHandleBoardKey({ target: { tagName: "DIV" }, metaKey: false, ctrlKey: false }),
    ).toBe(true);
  });

  it("declines while an IME is composing", () => {
    expect(shouldHandleBoardKey({ isComposing: true, target: { tagName: "DIV" } })).toBe(false);
  });

  it("declines inside text entry controls", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(shouldHandleBoardKey({ target: { tagName } })).toBe(false);
    }
  });

  it("matches the tag name whatever its case", () => {
    expect(shouldHandleBoardKey({ target: { tagName: "input" } })).toBe(false);
  });

  it("declines inside a contenteditable element", () => {
    expect(shouldHandleBoardKey({ target: { tagName: "DIV", isContentEditable: true } })).toBe(
      false,
    );
  });

  it("declines a modified key even inside an input, without reading further", () => {
    expect(shouldHandleBoardKey({ metaKey: true, target: { tagName: "INPUT" } })).toBe(false);
  });
});
