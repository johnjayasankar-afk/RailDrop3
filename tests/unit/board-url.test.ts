import { describe, expect, it } from "vitest";
import {
  BOARD_STATE_PARAM,
  alertBoardUrl,
  boardStateUrl,
  decodeBoardState,
  encodeBoardState,
  hasBoardState,
  unmatchedKeys,
  withBoardLink,
} from "@/lib/domain/board-url";
import { boardReducer, initialBoardState, type BoardState } from "@/lib/domain/board-state";

const base = "https://raildrop.app/watches/w1";

function withState(patch: Partial<BoardState>): BoardState {
  return { ...initialBoardState, ...patch };
}

describe("encodeBoardState", () => {
  it("writes nothing for an untouched board", () => {
    // An empty string is the signal to drop the parameter, so a first visit has
    // a clean URL and localStorage stays in charge of pins.
    expect(encodeBoardState(initialBoardState)).toBe("");
  });

  it("produces a link short enough to paste", () => {
    const encoded = encodeBoardState(
      withState({ dateFilter: "2026-10-04", sort: "price", service: "acela", zen: true }),
    );
    expect(encoded).toBe("d:2026-10-04,s:price,f:acela,g:z");
  });

  it("omits every field that is at its default", () => {
    expect(encodeBoardState(withState({ sort: "savings" }))).toBe("s:savings");
  });

  it("packs the booleans into one field", () => {
    const encoded = encodeBoardState(
      withState({ zen: true, showAll: true, savingsOnly: true, arriveBuffer: true }),
    );
    expect(encoded).toBe("g:zasb");
  });

  it("does not write the row the board focused for you", () => {
    /* The board focuses your train the moment it loads, so focusKey is almost
     * never null. Writing it made every untouched board rewrite its own address
     * bar with a row nobody had picked. */
    expect(encodeBoardState(withState({ focusKey: "j1:f1" }))).toBe("");
    expect(encodeBoardState(withState({ focusKey: "j1:f1", focusIntent: true }))).toBe("x:j1:f1");
  });

  it("does not write a date the board could not have set", () => {
    // Belt and braces: the reducer accepts any string as a date filter.
    expect(encodeBoardState(withState({ dateFilter: "tomorrow" }))).toBe("");
  });
});

describe("round trip", () => {
  const cases: Array<[string, Partial<BoardState>]> = [
    ["a date", { dateFilter: "2026-10-09" }],
    ["every sort", { sort: "duration" }],
    ["a service filter", { service: "regional" }],
    ["a time bucket", { bucket: "evening" }],
    ["a train search", { trainQuery: "2151" }],
    ["clock filters", { departAfter: "07:30", arriveBefore: "19:45", arriveBuffer: true }],
    ["a duration cap", { durationCap: 260 }],
    ["pins", { pins: ["j1:f1", "j2:f2"] }],
    ["hidden rows", { hiddenKeys: ["j3:f3"] }],
    ["a compare pair", { picked: ["j1:f1", "j2:f2"] }],
    ["a chosen row", { focusKey: "j4:f4", focusIntent: true }],
    ["every flag", { zen: true, showAll: true, savingsOnly: true, pinnedOnly: true }],
    [
      "all of it at once",
      {
        dateFilter: "2026-10-04",
        sort: "price",
        service: "acela",
        bucket: "morning",
        trainQuery: "Acela 2151",
        departAfter: "06:00",
        arriveBefore: "12:00",
        durationCap: 240,
        arriveBuffer: true,
        hideDeparted: true,
        zen: true,
        showAll: true,
        savingsOnly: true,
        pinnedOnly: true,
        pins: ["j1:f1"],
        hiddenKeys: ["j2:f2"],
        picked: ["j3:f3", "j4:f4"],
        focusKey: "j5:f5",
        focusIntent: true,
      },
    ],
  ];

  for (const [name, patch] of cases) {
    it(`survives ${name}`, () => {
      const before = withState(patch);
      expect(decodeBoardState(encodeBoardState(before))).toEqual(before);
    });
  }

  it("survives a row key containing the separators", () => {
    // Not hypothetical: a provider trip id is opaque and a fare id is appended
    // to it with a colon.
    const key = "trip,a|b%c:fare-1";
    const before = withState({
      pins: [key],
      focusKey: key,
      focusIntent: true,
      trainQuery: "a,b|c%d",
    });
    expect(decodeBoardState(encodeBoardState(before))).toEqual(before);
  });

  it("keeps the colon inside a row key readable rather than escaping it", () => {
    expect(encodeBoardState(withState({ pins: ["j1:f1"] }))).toBe("p:j1:f1");
  });
});

describe("decodeBoardState treats the URL as untrusted", () => {
  it("returns defaults for nothing at all", () => {
    expect(decodeBoardState(null)).toEqual(initialBoardState);
    expect(decodeBoardState("")).toEqual(initialBoardState);
    expect(decodeBoardState("garbage")).toEqual(initialBoardState);
  });

  it("drops a sort the board does not have", () => {
    // Coercing this would put the board in a state with no way out: nothing in
    // the UI can select a sort that is not in the union.
    expect(decodeBoardState("s:cheapest").sort).toBe("rank");
    expect(decodeBoardState("s:__proto__").sort).toBe("rank");
  });

  it("drops an unknown service or bucket", () => {
    expect(decodeBoardState("f:maglev").service).toBe("all");
    expect(decodeBoardState("w:midnight").bucket).toBe("all");
  });

  it("drops a malformed date", () => {
    expect(decodeBoardState("d:2026-13-99x").dateFilter).toBe("all");
    expect(decodeBoardState("d:0000-00-00").dateFilter).toBe("0000-00-00");
    // Shape is all this claims to check; a nonexistent day filters to nothing
    // and the board says "no options match", which is the truth.
  });

  it("drops a malformed clock", () => {
    expect(decodeBoardState("ta:25:00").departAfter).toBe("");
    expect(decodeBoardState("ta:7:5").departAfter).toBe("");
    expect(decodeBoardState("tb:19:45").arriveBefore).toBe("19:45");
  });

  it("rejects a duration cap that is not a filter", () => {
    expect(decodeBoardState("du:0").durationCap).toBeNull();
    expect(decodeBoardState("du:-90").durationCap).toBeNull();
    expect(decodeBoardState("du:99999").durationCap).toBeNull();
    expect(decodeBoardState("du:abc").durationCap).toBeNull();
    expect(decodeBoardState("du:240").durationCap).toBe(240);
  });

  it("caps a key list so a link cannot be a payload", () => {
    const many = Array.from({ length: 200 }, (_, i) => `j${i}:f${i}`).join("|");
    expect(decodeBoardState(`p:${many}`).pins).toHaveLength(24);
  });

  it("caps the compare pair at two", () => {
    expect(decodeBoardState("c:a:1|b:2|c:3|d:4").picked).toEqual(["a:1", "b:2"]);
  });

  it("drops duplicate and empty keys", () => {
    expect(decodeBoardState("p:j1:f1|j1:f1||j2:f2").pins).toEqual(["j1:f1", "j2:f2"]);
  });

  it("truncates an over-long train query", () => {
    expect(decodeBoardState(`q:${"x".repeat(500)}`).trainQuery).toHaveLength(40);
  });

  it("ignores a code it does not know", () => {
    // Forwards and backwards compatibility: a link from another build must not
    // fail, it must degrade.
    expect(decodeBoardState("s:price,zz:whatever,f:acela")).toEqual(
      withState({ sort: "price", service: "acela" }),
    );
  });

  it("ignores a field with no value or no code", () => {
    expect(decodeBoardState("s:,:price,,s:depart").sort).toBe("depart");
  });

  it("reads unknown flag letters as absent rather than failing", () => {
    const state = decodeBoardState("g:zq");
    expect(state.zen).toBe(true);
    expect(state.showAll).toBe(false);
  });

  it("returns a state the reducer can act on", () => {
    // The decoded object is fed straight to useReducer as its initial value, so
    // it has to be a whole BoardState and not a patch.
    const state = decodeBoardState("d:2026-10-04,s:price,g:z");
    const next = boardReducer(state, { type: "TOGGLE_ZEN" });
    expect(next.zen).toBe(false);
    expect(next.dateFilter).toBe("2026-10-04");
    expect(boardReducer(state, { type: "RESET_VIEW" })).toEqual(
      withState({ zen: true, sort: "rank" }),
    );
  });
});

describe("hasBoardState", () => {
  it("is false for absent, empty, and meaningless values", () => {
    expect(hasBoardState(null)).toBe(false);
    expect(hasBoardState("")).toBe(false);
    expect(hasBoardState("s:nonsense")).toBe(false);
    expect(hasBoardState("g:")).toBe(false);
  });

  it("is true once one field survives validation", () => {
    expect(hasBoardState("s:price")).toBe(true);
    expect(hasBoardState("p:j1:f1")).toBe(true);
  });
});

describe("boardStateUrl", () => {
  it("appends the state to a clean URL", () => {
    expect(boardStateUrl(base, withState({ sort: "price" }))).toBe(
      "https://raildrop.app/watches/w1?b=s%3Aprice",
    );
  });

  it("replaces an existing state rather than accumulating one", () => {
    const once = boardStateUrl(base, withState({ sort: "price" }));
    const twice = boardStateUrl(once, withState({ sort: "savings" }));
    expect(twice).toBe("https://raildrop.app/watches/w1?b=s%3Asavings");
    expect(new URL(twice).searchParams.getAll(BOARD_STATE_PARAM)).toHaveLength(1);
  });

  it("removes the parameter when the board is back to default", () => {
    const once = boardStateUrl(base, withState({ sort: "price" }));
    expect(boardStateUrl(once, initialBoardState)).toBe(base);
  });

  it("preserves other query parameters", () => {
    const url = boardStateUrl(`${base}?from=email`, withState({ sort: "price" }));
    expect(new URL(url).searchParams.get("from")).toBe("email");
  });

  it("works on a path-only base", () => {
    expect(boardStateUrl("/watches/w1", withState({ sort: "price" }))).toBe(
      "/watches/w1?b=s%3Aprice",
    );
    expect(boardStateUrl("/watches/w1?b=s%3Aprice", initialBoardState)).toBe("/watches/w1");
  });

  it("round-trips through a real URL", () => {
    const before = withState({ dateFilter: "2026-10-04", pins: ["a,b:c"], zen: true });
    const url = boardStateUrl(base, before);
    expect(decodeBoardState(new URL(url).searchParams.get(BOARD_STATE_PARAM))).toEqual(before);
  });
});

describe("alertBoardUrl", () => {
  it("opens on the day of the drop, cheapest first, nothing hidden", () => {
    const url = alertBoardUrl(base, "2026-10-09");
    const state = decodeBoardState(new URL(url).searchParams.get(BOARD_STATE_PARAM));
    expect(state.dateFilter).toBe("2026-10-09");
    expect(state.sort).toBe("price");
    expect(state.showAll).toBe(true);
  });

  it("pins nothing", () => {
    // The fare in the email may be gone by the time it is opened. A link that
    // pinned its row would open on an empty board and look broken.
    const state = decodeBoardState(
      new URL(alertBoardUrl(base, "2026-10-09")).searchParams.get(BOARD_STATE_PARAM),
    );
    expect(state.pins).toEqual([]);
    expect(state.picked).toEqual([]);
    expect(state.focusKey).toBeNull();
  });

  it("falls back to all dates rather than an impossible filter", () => {
    const state = decodeBoardState(
      new URL(alertBoardUrl(base, "not-a-date")).searchParams.get(BOARD_STATE_PARAM),
    );
    expect(state.dateFilter).toBe("all");
    expect(state.sort).toBe("price");
  });
});

describe("unmatchedKeys", () => {
  const present = ["j1:f1", "j2:f2"];

  it("finds nothing when the link matches the board", () => {
    expect(unmatchedKeys(withState({ pins: ["j1:f1"], picked: present }), present)).toEqual([]);
  });

  it("names a pin whose fare is no longer listed", () => {
    expect(unmatchedKeys(withState({ pins: ["j1:f1", "gone:f9"] }), present)).toEqual(["gone:f9"]);
  });

  it("covers hidden rows, the compare pair, and focus", () => {
    const state = withState({
      hiddenKeys: ["h:1"],
      picked: ["c:1"],
      focusKey: "x:1",
    });
    expect(unmatchedKeys(state, present).sort()).toEqual(["c:1", "h:1", "x:1"]);
  });

  it("reports a key once even when it is pinned and picked", () => {
    const state = withState({ pins: ["gone:f9"], picked: ["gone:f9"], focusKey: "gone:f9" });
    expect(unmatchedKeys(state, present)).toEqual(["gone:f9"]);
  });

  it("finds nothing on a default state, so a first visit says nothing", () => {
    expect(unmatchedKeys(initialBoardState, present)).toEqual([]);
    expect(unmatchedKeys(initialBoardState, [])).toEqual([]);
  });
});

describe("withBoardLink", () => {
  const link = "https://raildrop.app/watches/w1?b=s%3Aprice";

  it("puts the link on its own line at the end", () => {
    expect(withBoardLink("Confirm on Amtrak.", link)).toBe(`Confirm on Amtrak.\n${link}`);
  });

  it("returns the text untouched when there is no link", () => {
    expect(withBoardLink("text", null)).toBe("text");
    expect(withBoardLink("text", "")).toBe("text");
    expect(withBoardLink("text", undefined)).toBe("text");
  });

  it("does not stack the same link twice", () => {
    const once = withBoardLink("text", link);
    expect(withBoardLink(once, link)).toBe(once);
  });

  it("leaves a multi-line copy string intact", () => {
    const body = "line one\nline two\n\nline three";
    expect(withBoardLink(body, link)).toBe(`${body}\n${link}`);
  });
});
