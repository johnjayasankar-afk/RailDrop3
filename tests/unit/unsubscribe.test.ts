import { describe, expect, it } from "vitest";
import {
  unsubscribeHeaders,
  unsubscribeTokenFor,
  unsubscribeTokenValid,
  unsubscribeUrl,
} from "@/lib/notifications/unsubscribe";

const KEY = "test-signing-key";
const WATCH = "0f0a3b2c-1111-2222-3333-444455556666";

describe("unsubscribe tokens", () => {
  it("signs a token for a watch", () => {
    const token = unsubscribeTokenFor(WATCH, KEY);
    expect(token).toBeTruthy();
    expect(unsubscribeTokenValid(WATCH, token!, KEY)).toBe(true);
  });

  it("is stable for the same watch and key", () => {
    // The link in an old email has to keep working.
    expect(unsubscribeTokenFor(WATCH, KEY)).toBe(unsubscribeTokenFor(WATCH, KEY));
  });

  it("does not unsubscribe a different watch", () => {
    // The whole reason this is an HMAC and not a sequential id: a link must
    // not be editable into somebody else's unsubscribe.
    const token = unsubscribeTokenFor(WATCH, KEY)!;
    expect(unsubscribeTokenValid("99999999-1111-2222-3333-444455556666", token, KEY)).toBe(false);
  });

  it("rejects a token signed with another key", () => {
    const token = unsubscribeTokenFor(WATCH, "other-key")!;
    expect(unsubscribeTokenValid(WATCH, token, KEY)).toBe(false);
  });

  it("rejects empty and malformed tokens rather than throwing", () => {
    expect(unsubscribeTokenValid(WATCH, "", KEY)).toBe(false);
    expect(unsubscribeTokenValid(WATCH, "not-a-token", KEY)).toBe(false);
    expect(unsubscribeTokenValid(WATCH, "x".repeat(500), KEY)).toBe(false);
  });

  it("signs nothing when no key is configured", () => {
    // Better to omit the link than to ship one that cannot be verified.
    expect(unsubscribeTokenFor(WATCH, "")).toBeNull();
    expect(unsubscribeTokenValid(WATCH, "anything", "")).toBe(false);
  });

  it("carries no personal data — only a signature over an id the holder has", () => {
    const token = unsubscribeTokenFor(WATCH, KEY)!;
    expect(token).not.toContain("@");
    expect(token).not.toContain(WATCH);
  });
});

describe("unsubscribe link and headers", () => {
  const origin = "https://example.test";
  const withKey = <T>(run: () => T): T => {
    const prev = process.env.UNSUBSCRIBE_SECRET;
    process.env.UNSUBSCRIBE_SECRET = KEY;
    try {
      return run();
    } finally {
      if (prev === undefined) delete process.env.UNSUBSCRIBE_SECRET;
      else process.env.UNSUBSCRIBE_SECRET = prev;
    }
  };

  it("builds a link that works without a login", () => {
    const url = withKey(() => unsubscribeUrl(origin, WATCH))!;
    expect(url).toContain(`${origin}/unsubscribe?`);
    expect(url).toContain(`w=${WATCH}`);
    expect(url).toContain("t=");
  });

  it("offers RFC 8058 one-click headers", () => {
    const headers = withKey(() => unsubscribeHeaders(origin, WATCH));
    expect(headers["List-Unsubscribe"]).toMatch(/^<https:\/\/example\.test\/unsubscribe\?/);
    expect(headers["List-Unsubscribe"]).toContain("one_click=1");
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("advertises no header it cannot honour", () => {
    const prev = process.env.UNSUBSCRIBE_SECRET;
    const prevCron = process.env.CRON_SECRET;
    delete process.env.UNSUBSCRIBE_SECRET;
    delete process.env.CRON_SECRET;
    try {
      expect(unsubscribeHeaders(origin, WATCH)).toEqual({});
    } finally {
      if (prev !== undefined) process.env.UNSUBSCRIBE_SECRET = prev;
      if (prevCron !== undefined) process.env.CRON_SECRET = prevCron;
    }
  });
});
