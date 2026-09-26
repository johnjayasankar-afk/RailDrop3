import { createHmac, timingSafeEqual } from "node:crypto";

/* A way out of the mail, for someone who never signed up for anything.
 *
 * A guest can create a watch and put an email on it without an account. That
 * email then receives fare alerts with no link to stop them, no
 * List-Unsubscribe header, and no way to identify themselves to us in order to
 * ask. That is not a rough edge; in most of the world it is unlawful, and it
 * is plainly wrong regardless.
 *
 * The token is an HMAC over the watch id, not a sequential id, so a link
 * cannot be edited into somebody else's unsubscribe. It carries no secret and
 * no personal data — it is a signature over an id the holder already has.
 */

function secret(): string {
  // A dedicated key if one exists, otherwise the operator credential. Never a
  // constant: a predictable key makes the signature decorative.
  const key = process.env.UNSUBSCRIBE_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  return key ?? "";
}

export function unsubscribeTokenFor(watchId: string, key = secret()): string | null {
  if (!key) return null;
  return createHmac("sha256", key).update(`unsubscribe:${watchId}`).digest("base64url");
}

export function unsubscribeTokenValid(watchId: string, token: string, key = secret()): boolean {
  const expected = unsubscribeTokenFor(watchId, key);
  if (!expected || !token) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function unsubscribeUrl(origin: string, watchId: string): string | null {
  const token = unsubscribeTokenFor(watchId);
  if (!token) return null;
  return `${origin}/unsubscribe?w=${encodeURIComponent(watchId)}&t=${encodeURIComponent(token)}`;
}

/**
 * The headers that let a mail client offer "unsubscribe" in its own interface.
 *
 * List-Unsubscribe-Post plus a POST target is RFC 8058 one-click: Gmail and
 * others show a native unsubscribe control and never make the reader hunt
 * through the footer. Returns nothing when no token can be signed, because a
 * header advertising a link that will not work is worse than no header.
 */
export function unsubscribeHeaders(origin: string, watchId: string): Record<string, string> {
  const url = unsubscribeUrl(origin, watchId);
  if (!url) return {};
  return {
    "List-Unsubscribe": `<${url}&one_click=1>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
