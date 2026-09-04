import { describe, expect, it } from "vitest";
import { mintGuestUser, parseGuestCookie } from "@/lib/auth/guest";

describe("guest cookie", () => {
  it("mints a uuid guest", () => {
    const guest = mintGuestUser();
    expect(guest.isGuest).toBe(true);
    expect(guest.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(guest.email).toBe("");
  });

  it("parses a valid cookie payload", () => {
    const guest = mintGuestUser("a@b.com");
    const parsed = parseGuestCookie(JSON.stringify(guest));
    expect(parsed?.id).toBe(guest.id);
    expect(parsed?.email).toBe("a@b.com");
    expect(parsed?.isGuest).toBe(true);
  });

  it("rejects garbage", () => {
    expect(parseGuestCookie("nope")).toBeNull();
    expect(parseGuestCookie("{}")).toBeNull();
  });
});
