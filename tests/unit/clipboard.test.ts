import { describe, expect, it, vi } from "vitest";
import { copySucceeded, copyText } from "@/lib/clipboard";

describe("copyText", () => {
  it("uses the Clipboard API when it works", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const selection = vi.fn().mockReturnValue(true);
    expect(await copyText("hello", { writeText, selectionCopy: selection })).toBe("clipboard");
    expect(writeText).toHaveBeenCalledWith("hello");
    // The deprecated path is not touched when the modern one succeeds.
    expect(selection).not.toHaveBeenCalled();
  });

  it("falls back when the Clipboard API rejects", async () => {
    // Insecure origin, unfocused document, or an in-app browser that refuses.
    const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    const selection = vi.fn().mockReturnValue(true);
    expect(await copyText("hello", { writeText, selectionCopy: selection })).toBe("fallback");
    expect(selection).toHaveBeenCalledWith("hello");
  });

  it("falls back when the Clipboard API is absent entirely", async () => {
    const selection = vi.fn().mockReturnValue(true);
    expect(await copyText("hello", { writeText: null, selectionCopy: selection })).toBe("fallback");
  });

  it("reports failure when nothing takes the text", async () => {
    // This is the case the old code called success. The caller now has to show
    // the text instead of claiming it was copied.
    const writeText = vi.fn().mockRejectedValue(new Error("no"));
    const selection = vi.fn().mockReturnValue(false);
    expect(await copyText("hello", { writeText, selectionCopy: selection })).toBe("failed");
  });

  it("reports failure rather than throwing when the fallback itself throws", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("no"));
    const selection = vi.fn().mockImplementation(() => {
      throw new Error("execCommand exploded");
    });
    expect(await copyText("hello", { writeText, selectionCopy: selection })).toBe("failed");
  });

  it("reports failure when neither route exists", async () => {
    expect(await copyText("hello", { writeText: null, selectionCopy: null })).toBe("failed");
  });

  it("copies empty text without pretending it failed", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await copyText("", { writeText, selectionCopy: null })).toBe("clipboard");
  });
});

describe("copySucceeded", () => {
  it("counts either route as a success, because the reader has the text", () => {
    expect(copySucceeded("clipboard")).toBe(true);
    expect(copySucceeded("fallback")).toBe(true);
  });

  it("counts nothing else", () => {
    expect(copySucceeded("failed")).toBe(false);
  });
});
