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
  ]),
]);

export default eslintConfig;
