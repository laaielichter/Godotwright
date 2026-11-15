import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GodotApi } from "../src/api/api.js";
import { migrateScript } from "../src/migrate/migrate.js";
import { FIXTURES } from "./helpers.js";

const api = GodotApi.load();
const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "examples", "godot3-platformer", "scripts");
const EXPECTED = join(FIXTURES, "godot3-platformer-expected");

describe("examples/godot3-platformer", () => {
  const scripts = readdirSync(SCRIPTS).filter((f) => f.endsWith(".gd")).sort();

  it("migrates every example script exactly as the example README documents", () => {
    expect(scripts.length).toBeGreaterThanOrEqual(3);
    for (const name of scripts) {
      const source = readFileSync(join(SCRIPTS, name), "utf8");
      const expected = readFileSync(join(EXPECTED, name), "utf8");
      const m = migrateScript(source, api);
      expect(m.code, name).toBe(expected);
    }
  });

  it("the migrated examples need no further change", () => {
    for (const name of scripts) {
      const expected = readFileSync(join(EXPECTED, name), "utf8");
      const twice = migrateScript(expected, api);
      expect(twice.changes, name).toEqual([]);
    }
  });

  it("keeps the hand-fix leftover the README walks through", () => {
    const player = migrateScript(readFileSync(join(SCRIPTS, "player.gd"), "utf8"), api);
    expect(player.left.map((l) => l.message).join(" ")).toContain("move_and_slide() takes no arguments");
  });
});
