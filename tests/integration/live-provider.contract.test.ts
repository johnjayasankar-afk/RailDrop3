import { describe, expect, it } from "vitest";

describe("Parse live contract", () => {
  it("runs one search_trains call only when PARSE_API_KEY is present", async () => {
    const key = process.env.PARSE_API_KEY;
    if (!key) {
      expect(key).toBeFalsy();
      return;
    }

    const scraperId = process.env.PARSE_SCRAPER_ID ?? "f800c27d-0aaa-4ca0-864e-4dc69e20f764";
    const departure = new Date();
    departure.setUTCDate(departure.getUTCDate() + 21);
    const departureDate = departure.toISOString().slice(0, 10);
    const response = await fetch(`https://api.parse.bot/scraper/${scraperId}/search_trains`, {
      method: "POST",
      headers: {
        "X-API-Key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        origin: "BOS",
        destination: "NYP",
        departure_date: departureDate,
        num_adults: 1,
      }),
    });

    expect(response.status).not.toBe(401);
    const json = (await response.json()) as Record<string, unknown>;
    expect(json).toBeTruthy();
    const serialized = JSON.stringify(json);
    expect(
      serialized.includes("journey") ||
        serialized.includes("success") ||
        serialized.includes("data"),
    ).toBe(true);
  });
});
