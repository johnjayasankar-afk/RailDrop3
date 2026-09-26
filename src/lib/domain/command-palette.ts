/* Finding an action without already knowing it exists.
 *
 * The board has nineteen single-key shortcuts and the only way to learn any of
 * them was to press `?` — which you also had to already know about. That is a
 * lot of product behind a door with no handle.
 *
 * This is the matching half, kept pure so it can be tested without a DOM: the
 * command list is data, the ranking is a function, and the component's only job
 * is to render what comes back and run what is chosen.
 *
 * Ranking is subsequence matching with the bonuses that make a palette feel
 * like it read your mind rather than your keystrokes: a hit at the start of a
 * word beats one in the middle, consecutive hits beat scattered ones, and a
 * short label beats a long one on an equal match. No dependency — "fuzzy
 * search" is thirty lines and a library would be a runtime dependency to ask
 * permission for.
 */

export type CommandGroup = "Navigate" | "Filter" | "Copy" | "Trip" | "Help";

/** The order groups appear in. Doing before describing; help last. */
export const COMMAND_GROUPS: readonly CommandGroup[] = [
  "Navigate",
  "Filter",
  "Copy",
  "Trip",
  "Help",
];

export interface CommandSpec {
  id: string;
  label: string;
  group: CommandGroup;
  /** The single key or combination that also does this, if there is one. */
  shortcut?: string;
  /** Extra words that should find this command but do not belong in its label. */
  keywords?: string;
  /** Why it is unavailable right now. Present means disabled, and says so. */
  unavailable?: string;
}

export interface RankedCommand {
  spec: CommandSpec;
  score: number;
  /** Indices into `label` that matched, for highlighting. Empty on no query. */
  positions: readonly number[];
}

/* Scoring weights. Tuned by hand against the real command list; the tests below
 * pin the orderings that matter rather than the numbers themselves, so these
 * can be adjusted without rewriting expectations. */
const HIT = 8;
const CONSECUTIVE = 10;
const WORD_START = 14;
const FIRST_CHAR = 20;
const GAP_PENALTY = 1;
const LENGTH_PENALTY = 0.25;

function isBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = text[index - 1] ?? "";
  return previous === " " || previous === "-" || previous === "/" || previous === "·";
}

/**
 * Whether `query`'s characters appear in order in `text`, and how well.
 *
 * Greedy left-to-right, which is not optimal — "ct" against "copy the ticket"
 * takes the `t` in "the" rather than the one in "ticket" — but it is
 * predictable, and a palette that reorders itself on a rule nobody can infer is
 * worse than one that occasionally ranks second-best first.
 */
export function fuzzyMatch(
  query: string,
  text: string,
): { score: number; positions: number[] } | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return { score: 0, positions: [] };
  const haystack = text.toLowerCase();

  const positions: number[] = [];
  let score = 0;
  let at = 0;
  let previous = -2;

  for (const character of needle) {
    if (character === " ") continue;
    const found = haystack.indexOf(character, at);
    if (found === -1) return null;
    positions.push(found);

    score += HIT;
    if (found === 0) score += FIRST_CHAR;
    else if (isBoundary(text, found)) score += WORD_START;
    if (found === previous + 1) score += CONSECUTIVE;
    else if (previous >= 0) score -= Math.min(GAP_PENALTY * (found - previous - 1), HIT);

    previous = found;
    at = found + 1;
  }

  // A shorter label matching the same letters is the better answer.
  score -= text.length * LENGTH_PENALTY;
  return { score, positions };
}

/**
 * The commands worth showing for a query, best first.
 *
 * With no query the list is the whole command set in its declared order, which
 * is the thing a first-time reader actually wants: everything the board can do,
 * grouped, with the keys next to it.
 */
export function rankCommands(commands: readonly CommandSpec[], query: string): RankedCommand[] {
  const needle = query.trim();
  if (!needle) {
    return commands.map((spec) => ({ spec, score: 0, positions: [] }));
  }

  const ranked: RankedCommand[] = [];
  for (const spec of commands) {
    const onLabel = fuzzyMatch(needle, spec.label);
    if (onLabel) {
      ranked.push({ spec, score: onLabel.score, positions: onLabel.positions });
      continue;
    }
    // Keywords and the shortcut are searchable but do not highlight: the
    // characters that matched are not in the label the reader is looking at.
    const elsewhere = [spec.keywords, spec.shortcut].filter(Boolean).join(" ");
    const onExtra = elsewhere ? fuzzyMatch(needle, elsewhere) : null;
    if (onExtra) {
      // Below anything that matched the visible text, however weakly.
      ranked.push({ spec, score: onExtra.score - 1_000, positions: [] });
    }
  }

  return ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Stable and legible: declared order breaks a tie, never label text, so the
    // same query always produces the same list.
    return commands.indexOf(a.spec) - commands.indexOf(b.spec);
  });
}

/** The ranked list split into its groups, empty groups dropped. */
export function groupRanked(ranked: readonly RankedCommand[]): Array<{
  group: CommandGroup;
  commands: RankedCommand[];
}> {
  const out: Array<{ group: CommandGroup; commands: RankedCommand[] }> = [];
  for (const group of COMMAND_GROUPS) {
    const commands = ranked.filter((item) => item.spec.group === group);
    if (commands.length > 0) out.push({ group, commands });
  }
  return out;
}

/** Flat order as rendered, so arrow keys and the group headings agree. */
export function flattenRanked(ranked: readonly RankedCommand[]): RankedCommand[] {
  return groupRanked(ranked).flatMap((section) => section.commands);
}

/**
 * Where the selection lands after an arrow key.
 *
 * Wraps, unlike the board's own J and K: a palette is a short list you are
 * cycling, not a timetable you are reading down.
 */
export function moveSelection(count: number, index: number, delta: number): number {
  if (count <= 0) return 0;
  return (((index + delta) % count) + count) % count;
}

/**
 * What the toast says after running a command from the palette.
 *
 * The palette's second job is to make itself unnecessary. A command with a key
 * teaches it on the way out; one without says only what it did.
 */
export function commandToast(spec: CommandSpec, done: string): string {
  if (!spec.shortcut) return done;
  return `${done} — next time press ${spec.shortcut}`;
}
