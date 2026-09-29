import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  // .next-demo is a stray 97MB build output that was committed by accident and
  // is now gitignored. It is still on disk for anyone who has it, and linting
  // generated bundles produces thousands of findings about code nobody wrote.
  globalIgnores([
    ".next/**",
    ".next-demo/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    "visual-qa/**",
    // Throwaway Playwright probes written at the repo root while measuring a
    // page, and gitignored for the same reason. They are one-shot scripts, not
    // code anyone maintains, and linting them stops `npm run verify` on files
    // that will not exist in ten minutes.
    ".probe-*.ts",
  ]),
]);

export default eslintConfig;
