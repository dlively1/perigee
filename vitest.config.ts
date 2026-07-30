import { defineConfig } from "vitest/config";

// Unit tests cover the pure sim logic (src/core/) and run in milliseconds —
// no browser, no Phaser. End-to-end behavior lives in the Playwright suite
// (tests/*.spec.ts).
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
