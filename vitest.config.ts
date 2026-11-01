import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    // The ready-made models are detailed now: one build and lint takes up to about 3 s here, and a test that builds a
    // model at every parameter extreme more. 15 s leaves room for slower CI machines.
    testTimeout: 15_000,
  },
});
