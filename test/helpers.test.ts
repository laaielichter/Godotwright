import { describe, expect, it } from "vitest";
import { runCli } from "./helpers.js";

describe("runCli", () => {
  it("reports the exit code of its own call, not one left in process.exitCode", async () => {
    process.exitCode = 1;
    try {
      expect((await runCli(["api", "Node2D"])).exitCode).toBe(0);
    } finally {
      process.exitCode = undefined;
    }
  });

  it("leaves the exit code of a failing call in process.exitCode", async () => {
    process.exitCode = undefined;
    try {
      expect((await runCli(["api", "NoSuchClassXyz"])).exitCode).toBe(1);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = undefined;
    }
  });
});
