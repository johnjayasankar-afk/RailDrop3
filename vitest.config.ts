import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    /* .tsx too. The glob matched only .ts, so tests/unit/flap.test.tsx was
       never collected — `vitest list` never named it — and a test file
       nobody runs is worse than no test file, because the directory listing
       claims coverage that does not exist. It uses renderToStaticMarkup, so
       it needs no DOM environment. */
    include: ["tests/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
