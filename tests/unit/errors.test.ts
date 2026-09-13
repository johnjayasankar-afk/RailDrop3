import { describe, expect, it } from "vitest";
import { errorMessage, toAppError } from "@/lib/errors";

describe("toAppError", () => {
  it("maps profile foreign-key failures to a guest migration hint", () => {
    const err = toAppError({
      code: "23503",
      message: 'insert or update on table "profiles" violates foreign key constraint "profiles_id_fkey"',
    });
    expect(err.message).toContain("guest_profiles.sql");
  });

  it("keeps normal Error messages", () => {
    expect(errorMessage(new Error("Origin and destination must differ"))).toBe(
      "Origin and destination must differ",
    );
  });
});
