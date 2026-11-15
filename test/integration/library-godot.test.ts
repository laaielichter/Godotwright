import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildGlb } from "../../src/build/glb.js";
import { buildSpec } from "../../src/build/spec.js";
import { runGodot } from "../../src/check/godot.js";
import { loadAssetLibrary } from "../../src/library/library.js";
import { makeProject } from "../helpers.js";

/** Needs a real Godot 4.7 binary in $GODOT. CI provides one. LIBRARY_GODOT=all checks all assets, not one per family. */
const GODOT = process.env["GODOT"];

const PROJECT = `config_version=5

[application]

config/name="Asset library"
config/features=PackedStringArray("4.7")
`;

describe.skipIf(!GODOT)("library assets in Godot", () => {
  it("imports, loads and instantiates them, with normals, materials, UVs, tangents and their feet on the ground", { timeout: 1_800_000 }, async () => {
    const all = process.env["LIBRARY_GODOT"] === "all";
    const seen = new Set<string>();
    const assets = [...loadAssetLibrary().values()].filter((a) => all || (!seen.has(a.family) && seen.add(a.family)));
    const root = makeProject({ "project.godot": PROJECT, ".gitignore": ".godot/\n" });
    for (const a of assets) {
      mkdirSync(join(root, "assets", a.category), { recursive: true });
      writeFileSync(join(root, "assets", a.category, `${a.id.split("/")[1]}.glb`), buildGlb(buildSpec(a.spec)));
    }
    copyFileSync(new URL("./library_check.gd", import.meta.url), join(root, "check_all.gd"));

    const imported = await runGodot(GODOT!, ["--headless", "--path", root, "--import"], { timeoutMs: 1_500_000 });
    const importErrors = `${imported.stdout}\n${imported.stderr}`.split("\n").filter((l) => /^(ERROR|WARNING):/.test(l));
    expect(importErrors).toEqual([]);

    const checked = await runGodot(GODOT!, ["--headless", "--path", root, "--script", "res://check_all.gd"], { timeoutMs: 600_000 });
    const lines = readFileSync(join(root, "check_all.txt"), "utf8").trim().split("\n");
    expect(lines.filter((l) => !l.startsWith("ok "))).toEqual([]);
    expect(lines.length).toBe(assets.length);
    expect(checked.code).toBe(0);
  });
});
