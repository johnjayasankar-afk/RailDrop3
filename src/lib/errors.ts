import { ZodError } from "zod";

/** Normalize Supabase / Zod / unknown failures into a user-facing Error. */
export function toAppError(error: unknown): Error {
  if (error instanceof ZodError) {
    const detail = error.issues.map((issue) => issue.message).join("; ");
    return new Error(detail || "Invalid watch details");
  }
  if (error instanceof Error) {
    return new Error(friendlyDbMessage(error.message));
  }
  if (typeof error === "object" && error && "message" in error) {
    const message = String((error as { message: unknown }).message ?? "");
    const code =
      "code" in error && (error as { code: unknown }).code != null
        ? String((error as { code: unknown }).code)
        : "";
    return new Error(friendlyDbMessage(message, code));
  }
  return new Error("Could not create watch");
}

function friendlyDbMessage(message: string, code = ""): string {
  const lower = message.toLowerCase();
  if (
    code === "23503" ||
    lower.includes("profiles_id_fkey") ||
    (lower.includes("foreign key") && lower.includes("profiles"))
  ) {
    return "Database needs a one-time guest fix: in Supabase SQL Editor run file supabase/migrations/20260904140000_guest_profiles.sql then try again.";
  }
  if (lower.includes("service role") || lower.includes("supabase is not configured")) {
    return message;
  }
  return message || "Could not create watch";
}

export function errorMessage(error: unknown): string {
  return toAppError(error).message;
}
