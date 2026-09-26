import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

/**
 * The browser chrome, the installed-app splash and the page itself all claim a
 * background colour, from three different files. They drifted once already:
 * the Labs re-skin moved --paper to #f8f6f1 and left themeColor on the old
 * #efe8d9, so the chrome sat a shade darker than the page it framed.
 */
describe("theme colour", () => {
  const paper = read("src/app/globals.css").match(/--paper:\s*(#[0-9a-f]{6})/i)?.[1];

  it("reads the paper token from the stylesheet", () => {
    expect(paper).toBeTruthy();
  });

  it("matches viewport.themeColor for the light scheme", () => {
    const layout = read("src/app/layout.tsx");
    const light = layout.match(
      /media:\s*"\(prefers-color-scheme:\s*light\)",\s*color:\s*"(#[0-9a-f]{6})"/i,
    )?.[1];
    expect(light?.toLowerCase()).toBe(paper?.toLowerCase());
  });

  it("matches the dark --paper for the dark scheme", () => {
    /* The chrome has to follow the page in both directions. A single themeColor
       framed a near-black board in porcelain — the same drift as before, one
       scheme along. */
    const css = read("src/app/globals.css");
    const darkPaper = css.match(
      /:root\[data-theme="dark"\]\s*\{[^}]*?--paper:\s*(#[0-9a-f]{6})/i,
    )?.[1];
    expect(darkPaper, "dark --paper token").toBeTruthy();
    const layout = read("src/app/layout.tsx");
    const dark = layout.match(
      /media:\s*"\(prefers-color-scheme:\s*dark\)",\s*color:\s*"(#[0-9a-f]{6})"/i,
    )?.[1];
    expect(dark?.toLowerCase()).toBe(darkPaper?.toLowerCase());
  });

  it("defines the dark scheme both ways round", () => {
    /* A system preference for dark, and a manual choice of dark on a light
       system. Missing either one leaves half the users on the wrong board. */
    const css = read("src/app/globals.css");
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)/);
    expect(css).toMatch(/:root:not\(\[data-theme="light"\]\)/);
    expect(css).toMatch(/:root\[data-theme="dark"\]/);
  });

  it("matches the web app manifest", () => {
    const manifest = read("src/app/manifest.ts");
    expect(manifest.match(/theme_color:\s*"(#[0-9a-f]{6})"/i)?.[1]?.toLowerCase()).toBe(
      paper?.toLowerCase(),
    );
    expect(manifest.match(/background_color:\s*"(#[0-9a-f]{6})"/i)?.[1]?.toLowerCase()).toBe(
      paper?.toLowerCase(),
    );
  });
});

/**
 * Deployment origin. Every absolute URL the product emits — canonical tags,
 * the sitemap, robots, the CTA in an alert email — has to come from the origin
 * the deployment actually answers on, resolved at runtime. A literal here
 * silently pointed production, previews and local development at the same
 * domain, and it was not one of them.
 */
describe("no hardcoded deployment domain", () => {
  const FILES = [
    "src/app/layout.tsx",
    "src/app/sitemap.ts",
    "src/app/robots.ts",
    "src/app/manifest.ts",
    "src/app/opengraph-image.tsx",
  ];

  it("keeps product domain literals out of src/app", () => {
    for (const file of FILES) {
      const source = read(file);
      expect(source, `${file} still hardcodes a product domain`).not.toMatch(
        /https?:\/\/(www\.)?(raildrop\.app|rail-drop\d*\.vercel\.app)/i,
      );
    }
  });
});
