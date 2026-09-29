import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SCHEDULED_WAKES_PER_DAY,
  cadencePhrase,
  cadenceSentence,
  holdPromise,
} from "@/lib/domain/cadence";

/* The app may not claim a cadence the crontab does not run.
 *
 * Three user-facing places said the product checks three times a day:
 *
 *   how-it-works  "Three times a day — morning, afternoon and evening in the
 *                 timezone of your trip", on the page that exists to state
 *                 our method in words someone could hold us to
 *   the FAQ       "then morning / afternoon / evening"
 *   waitOrBook    "If you can hold, we check three times a day and will write
 *                 the moment it drops"
 *
 * vercel.json ships one cron. One run a day is the Hobby plan's limit, so the
 * sentence was never true on this deployment. The third one is the damaging
 * one: it is the product telling someone to leave money on the table on the
 * strength of a sampling rate it does not have.
 *
 * And the honesty stack rests on it. Volatility, recent direction, the
 * twelve-observation evidence floor, "we have seen this corridor between $47
 * and $133" — every one of those is a statement about a sample, and a
 * misstated sampling rate misdescribes all of them at once.
 *
 * Nobody edits the crontab and the prose in the same change, which is why this
 * reads one and checks the other.
 */

const ROOT = path.resolve(__dirname, "../..");

interface VercelConfig {
  crons?: Array<{ path: string; schedule: string }>;
}

const vercel = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8")) as VercelConfig;

/**
 * How many times a day a cron expression fires.
 *
 * Deliberately narrow. It understands a fixed hour, a step, a list and a
 * wildcard, and throws on anything else rather than guessing — a schedule this
 * cannot read is a schedule nobody has checked the copy against.
 */
function firesPerDay(schedule: string): number {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`Not a 5-field cron: "${schedule}"`);
  const [minute, hour] = fields as [string, string, string, string, string];

  const count = (field: string, range: number): number => {
    if (field === "*") return range;
    if (/^\*\/(\d+)$/.test(field)) return Math.ceil(range / Number(/^\*\/(\d+)$/.exec(field)![1]));
    if (/^\d+$/.test(field)) return 1;
    if (/^\d+(,\d+)+$/.test(field)) return field.split(",").length;
    throw new Error(`Cannot count fires for cron field "${field}" in "${schedule}"`);
  };

  return count(minute, 60) * count(hour, 24);
}

describe("the stated cadence is the scheduled one", () => {
  it("matches what vercel.json actually schedules", () => {
    const dispatch = (vercel.crons ?? []).filter((cron) => cron.path.includes("/cron/dispatch"));
    expect(dispatch.length).toBeGreaterThan(0);
    const scheduled = dispatch.reduce((total, cron) => total + firesPerDay(cron.schedule), 0);
    expect(
      scheduled === SCHEDULED_WAKES_PER_DAY
        ? null
        : `vercel.json schedules ${scheduled} dispatch run(s) a day; ` +
            `SCHEDULED_WAKES_PER_DAY says ${SCHEDULED_WAKES_PER_DAY}. ` +
            `Change the crontab or change the constant — the copy reads the constant.`,
    ).toBeNull();
  });

  it("counts cron expressions the way a cron daemon would", () => {
    expect(firesPerDay("5 12 * * *")).toBe(1);
    expect(firesPerDay("5 8,14,20 * * *")).toBe(3);
    expect(firesPerDay("0 */6 * * *")).toBe(4);
    expect(firesPerDay("0 * * * *")).toBe(24);
    // Anything it cannot read is an error, not a zero.
    expect(() => firesPerDay("0 8-20 * * *")).toThrow();
    expect(() => firesPerDay("nonsense")).toThrow();
  });
});

describe("no string in the app claims a different cadence", () => {
  const SURFACES = ["src/app", "src/components", "src/lib"];

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(path.join(ROOT, dir))) {
      const relative = path.join(dir, entry);
      if (statSync(path.join(ROOT, relative)).isDirectory()) out.push(...walk(relative));
      else if (/\.tsx?$/.test(entry)) out.push(relative);
    }
    return out;
  }

  /* Comments are stripped. Several of them recount the history honestly —
     "the product checks three times a day and used to keep only the newest
     number" — and a test that failed on its own documentation would be
     deleted within a week. */
  function code(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  }

  const CLAIMS = [
    { phrase: "three times a day", wakes: 3 },
    { phrase: "twice a day", wakes: 2 },
    { phrase: "once a day", wakes: 1 },
    { phrase: "every hour", wakes: 24 },
    { phrase: "morning / afternoon / evening", wakes: 3 },
    { phrase: "morning, afternoon and evening", wakes: 3 },
  ];

  it("has no hard-coded cadence that disagrees with the schedule", () => {
    const files = SURFACES.flatMap(walk);
    expect(files.length).toBeGreaterThan(80);

    const wrong: string[] = [];
    for (const file of files) {
      // cadence.ts is where the phrases legitimately live.
      if (file.endsWith("domain/cadence.ts")) continue;
      const lines = code(readFileSync(path.join(ROOT, file), "utf8")).split("\n");
      lines.forEach((line, index) => {
        for (const claim of CLAIMS) {
          if (
            line.toLowerCase().includes(claim.phrase) &&
            claim.wakes !== SCHEDULED_WAKES_PER_DAY
          ) {
            wrong.push(`${file}:${index + 1}  "${claim.phrase}"  ${line.trim().slice(0, 90)}`);
          }
        }
      });
    }
    expect(
      wrong.length === 0
        ? []
        : wrong.concat(
            "Use cadencePhrase()/cadenceSentence()/holdPromise() from @/lib/domain/cadence.",
          ),
    ).toEqual([]);
  });
});

describe("what the copy says at the cadence we actually run", () => {
  it("says once a day, and does not promise to catch every drop", () => {
    expect(cadencePhrase(1)).toBe("once a day");
    expect(holdPromise(1)).toContain(
      "a drop that comes and goes between checks is one we will miss",
    );
    expect(holdPromise(1)).not.toContain("the moment it drops");
    expect(cadenceSentence(1)).toMatch(/^Once a day,/);
    // The reader is told the sample is thinner than the design intends.
    expect(cadenceSentence(1)).toContain("once-daily sample");
  });

  it("goes back to the original promise if the crontab ever earns it", () => {
    expect(cadencePhrase(3)).toBe("three times a day");
    expect(holdPromise(3)).toContain("the moment it drops");
    expect(cadenceSentence(3)).toMatch(/^Three times a day — morning, afternoon and evening/);
  });

  it("has a phrase for any number, rather than printing undefined", () => {
    expect(cadencePhrase(7)).toBe("7 times a day");
  });
});
