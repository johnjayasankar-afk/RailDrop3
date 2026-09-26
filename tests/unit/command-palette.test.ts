import { describe, expect, it } from "vitest";
import {
  COMMAND_GROUPS,
  commandToast,
  flattenRanked,
  fuzzyMatch,
  groupRanked,
  moveSelection,
  rankCommands,
  type CommandSpec,
} from "@/lib/domain/command-palette";

const commands: CommandSpec[] = [
  { id: "recheck", label: "Check fares now", group: "Trip", shortcut: "C" },
  { id: "down", label: "Move down the board", group: "Navigate", shortcut: "J" },
  { id: "up", label: "Move up the board", group: "Navigate", shortcut: "K" },
  { id: "timetable", label: "Jump to the timetable", group: "Navigate", shortcut: "G" },
  { id: "friend", label: "Copy a line for a friend", group: "Copy", shortcut: "T" },
  { id: "compare", label: "Copy you vs this train", group: "Copy", shortcut: "Y" },
  { id: "fields", label: "Copy Amtrak search fields", group: "Copy", shortcut: "F" },
  { id: "cheapest", label: "Cheapest first", group: "Filter", keywords: "sort price" },
  { id: "zen", label: "Zen mode", group: "Filter", shortcut: "Z", keywords: "hide focus" },
  { id: "shortcuts", label: "Board shortcuts", group: "Help", shortcut: "?" },
];

const labels = (query: string) => rankCommands(commands, query).map((item) => item.spec.label);

describe("fuzzyMatch", () => {
  it("matches an exact prefix", () => {
    const hit = fuzzyMatch("chea", "Cheapest first");
    expect(hit?.positions).toEqual([0, 1, 2, 3]);
  });

  it("matches characters spread through the text", () => {
    expect(fuzzyMatch("cvt", "Copy you vs this train")).not.toBeNull();
  });

  it("returns null when a character is missing", () => {
    expect(fuzzyMatch("xyz", "Cheapest first")).toBeNull();
  });

  it("returns null when the characters are out of order", () => {
    expect(fuzzyMatch("tsrif", "Cheapest first")).toBeNull();
  });

  it("is case-insensitive in both directions", () => {
    expect(fuzzyMatch("CHEA", "cheapest first")).not.toBeNull();
    expect(fuzzyMatch("chea", "CHEAPEST FIRST")).not.toBeNull();
  });

  it("ignores spaces in the query so a typed phrase still matches", () => {
    expect(fuzzyMatch("copy friend", "Copy a line for a friend")).not.toBeNull();
  });

  it("scores an empty query as neutral rather than failing", () => {
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, positions: [] });
    expect(fuzzyMatch("   ", "anything")).toEqual({ score: 0, positions: [] });
  });

  it("prefers a word start over the middle of a word", () => {
    const start = fuzzyMatch("t", "The timetable")!.score;
    const middle = fuzzyMatch("t", "Fastest")!.score;
    expect(start).toBeGreaterThan(middle);
  });

  it("prefers consecutive characters over scattered ones", () => {
    const together = fuzzyMatch("che", "Cheapest")!.score;
    const apart = fuzzyMatch("che", "Copy here everything")!.score;
    expect(together).toBeGreaterThan(apart);
  });

  it("prefers the shorter of two equal matches", () => {
    const short = fuzzyMatch("zen", "Zen mode")!.score;
    const long = fuzzyMatch("zen", "Zen mode, the long descriptive version")!.score;
    expect(short).toBeGreaterThan(long);
  });
});

describe("rankCommands", () => {
  it("returns everything in declared order for an empty query", () => {
    expect(labels("")).toEqual(commands.map((command) => command.label));
    expect(labels("   ")).toHaveLength(commands.length);
  });

  it("puts the obvious answer first", () => {
    expect(labels("cheap")[0]).toBe("Cheapest first");
    expect(labels("zen")[0]).toBe("Zen mode");
    expect(labels("timetable")[0]).toBe("Jump to the timetable");
  });

  it("finds every copy action from the word copy, and puts them first", () => {
    // All three are equally good prefix matches, so the shortest label leads.
    // The assertion is which commands are on top, not which of the three is.
    expect(labels("copy").slice(0, 3).sort()).toEqual([
      "Copy Amtrak search fields",
      "Copy a line for a friend",
      "Copy you vs this train",
    ]);
  });

  it("drops what does not match at all", () => {
    expect(labels("qqqq")).toEqual([]);
  });

  it("finds a command by a keyword that is not in its label", () => {
    // "sort" appears nowhere in "Cheapest first".
    expect(labels("sort")).toContain("Cheapest first");
  });

  it("finds a command by its shortcut key", () => {
    expect(labels("?")).toContain("Board shortcuts");
  });

  it("ranks a label match above a keyword match", () => {
    // "hide" is a keyword of Zen mode; nothing has it in a label, so Zen wins.
    // But "Zen" in a label must beat "hide" as a keyword when both could match.
    const ranked = rankCommands(
      [
        { id: "a", label: "Hide this train", group: "Filter" },
        { id: "b", label: "Zen mode", group: "Filter", keywords: "hide" },
      ],
      "hide",
    );
    expect(ranked[0]!.spec.id).toBe("a");
  });

  it("highlights the characters that matched in the label", () => {
    const [first] = rankCommands(commands, "zen");
    expect(first!.positions).toEqual([0, 1, 2]);
  });

  it("highlights nothing when the match was on a keyword", () => {
    // The matched characters are not in the text being looked at, so drawing
    // them would highlight arbitrary letters.
    const found = rankCommands(commands, "sort").find((item) => item.spec.id === "cheapest");
    expect(found?.positions).toEqual([]);
  });

  it("is stable: the same query always gives the same order", () => {
    expect(labels("o")).toEqual(labels("o"));
  });

  it("does not mutate the input", () => {
    const before = commands.map((command) => command.id);
    rankCommands(commands, "copy");
    expect(commands.map((command) => command.id)).toEqual(before);
  });
});

describe("groupRanked", () => {
  it("groups in the declared order, doing before helping", () => {
    const groups = groupRanked(rankCommands(commands, "")).map((section) => section.group);
    expect(groups).toEqual(["Navigate", "Filter", "Copy", "Trip", "Help"]);
    expect(groups[groups.length - 1]).toBe("Help");
  });

  it("drops a group with nothing in it", () => {
    const groups = groupRanked(rankCommands(commands, "copy")).map((s) => s.group);
    expect(groups).toEqual(["Copy"]);
  });

  it("covers every group the type allows", () => {
    // A new group with no section in COMMAND_GROUPS would silently never render.
    const used = new Set(commands.map((command) => command.group));
    for (const group of used) expect(COMMAND_GROUPS).toContain(group);
  });
});

describe("flattenRanked", () => {
  it("matches what the groups render, so arrow keys land where they look", () => {
    const ranked = rankCommands(commands, "");
    const flat = flattenRanked(ranked).map((item) => item.spec.id);
    const fromGroups = groupRanked(ranked).flatMap((section) =>
      section.commands.map((item) => item.spec.id),
    );
    expect(flat).toEqual(fromGroups);
  });

  it("is not simply the ranked order, because grouping reorders it", () => {
    const ranked = rankCommands(commands, "");
    expect(flattenRanked(ranked).map((i) => i.spec.id)).not.toEqual(ranked.map((i) => i.spec.id));
  });

  it("keeps every command", () => {
    expect(flattenRanked(rankCommands(commands, ""))).toHaveLength(commands.length);
  });
});

describe("moveSelection", () => {
  it("steps forward and back", () => {
    expect(moveSelection(5, 0, 1)).toBe(1);
    expect(moveSelection(5, 3, -1)).toBe(2);
  });

  it("wraps at both ends", () => {
    // Unlike the board's J and K, which clamp: a palette is a short cycle.
    expect(moveSelection(5, 4, 1)).toBe(0);
    expect(moveSelection(5, 0, -1)).toBe(4);
  });

  it("stays at zero for an empty list", () => {
    expect(moveSelection(0, 0, 1)).toBe(0);
    expect(moveSelection(0, 3, -1)).toBe(0);
  });

  it("handles a jump larger than the list", () => {
    expect(moveSelection(3, 0, -7)).toBe(2);
    expect(moveSelection(3, 0, 7)).toBe(1);
  });
});

describe("commandToast", () => {
  it("teaches the shortcut on the way out", () => {
    expect(commandToast(commands[4]!, "Copied")).toBe("Copied — next time press T");
  });

  it("says only what it did when there is no shortcut", () => {
    expect(commandToast({ id: "x", label: "Something", group: "Trip" }, "Done")).toBe("Done");
  });
});
