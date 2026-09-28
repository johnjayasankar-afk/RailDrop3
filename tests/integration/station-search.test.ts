import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/stations/search/route";

/* The picker on a page anyone can open.
 *
 * This endpoint required a session, which was correct while every station
 * picker sat behind the login. /fares is public, so a logged-out visitor on
 * the page built for exactly that case got a 401 from the autocomplete and had
 * to already know the three-letter code — and an autocomplete that fails
 * silently is the worst way for one to fail.
 */

function get(query: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/stations/search?q=${encodeURIComponent(query)}`));
}

async function stations(query: string) {
  const response = await get(query);
  const json = (await response.json()) as {
    stations: { code: string; coverage?: string }[];
  };
  return { status: response.status, ...json };
}

describe("searching stations without a session", () => {
  it("answers rather than demanding a login", async () => {
    const result = await stations("bos");
    expect(result.status).toBe(200);
    expect(result.stations.map((s) => s.code)).toContain("BOS");
  });

  it("matches on city as well as code", async () => {
    expect((await stations("new york")).stations.map((s) => s.code)).toContain("NYP");
  });

  it("still carries coverage, which the browser has no way to compute", async () => {
    /* The Wanderu id table is provider-side knowledge and stays server-side;
       what the picker needs is the verdict, and that still travels. */
    const result = await stations("bos");
    expect(result.stations[0]?.coverage).toBeTruthy();
  });

  it("returns an empty list for nonsense instead of failing", async () => {
    const result = await stations("zzzzzzzz");
    expect(result.status).toBe(200);
    expect(result.stations).toEqual([]);
  });

  it("caps the list, so one keystroke cannot return the whole catalogue", async () => {
    // A single letter matches most of the country.
    expect((await stations("a")).stations.length).toBeLessThanOrEqual(8);
  });
});

describe("where the answer comes from", () => {
  it("is served from the in-memory catalogue, not the database", async () => {
    /* The other half of opening the endpoint up. A public route that hits
       Postgres on every keystroke is an abuse surface; the catalogue is 189
       rows already in memory and answers without leaving the process. The
       cache header is the observable signal that this path was taken. */
    const response = await get("bos");
    expect(response.headers.get("cache-control")).toMatch(/max-age=/);
  });
});
