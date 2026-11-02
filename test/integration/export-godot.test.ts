import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkExport } from "../../src/export/export.js";

/** Needs a real Godot 4.7 binary in $GODOT. CI provides one. Exporting a .pck needs no export templates. */
const GODOT = process.env["GODOT"];

describe.skipIf(!GODOT)("what Godot really exports", () => {
  it("matches the export check: an excluded preload is missing, JSON is in, plain text is not", { timeout: 300_000 }, () => {
    const root = mkdtempSync(join(tmpdir(), "godotwright-export-"));
    for (const dir of ["lib", "data", "out"]) mkdirSync(join(root, dir));
    writeFileSync(join(root, "project.godot"), 'config_version=5\n[application]\nconfig/name="E"\nconfig/features=PackedStringArray("4.7")\n');
    writeFileSync(join(root, "main.gd"), 'extends Node\nconst Helper = preload("res://lib/helper.gd")\n\n\nfunc _ready() -> void:\n\tprint(Helper, FileAccess.get_file_as_string("res://data/a.txt"), FileAccess.get_file_as_string("res://data/b.json"))\n');
    writeFileSync(join(root, "lib", "helper.gd"), "extends RefCounted\n");
    writeFileSync(join(root, "data", "a.txt"), "x");
    writeFileSync(join(root, "data", "b.json"), "{}");
    writeFileSync(join(root, "export_presets.cfg"), '[preset.0]\n\nname="Linux"\nplatform="Linux"\nrunnable=true\nexport_filter="all_resources"\ninclude_filter=""\nexclude_filter="lib/*"\nexport_path="out/game.pck"\n\n[preset.0.options]\n');
    execFileSync(GODOT!, ["--headless", "--path", root, "--import"], { stdio: "ignore", timeout: 120_000 });
    execFileSync(GODOT!, ["--headless", "--path", root, "--export-pack", "Linux", "out/game.pck"], { stdio: "ignore", timeout: 120_000 });
    const pack = readFileSync(join(root, "out", "game.pck")).toString("latin1");
    expect(pack).not.toContain("lib/helper");
    expect(pack).toContain("data/b.json");
    expect(pack).not.toContain("data/a.txt");
    const files = checkExport(root).problems.map((p) => `${p.severity} ${p.file}`);
    expect(files).toEqual(["error res://lib/helper.gd", "error res://data/a.txt"]);
  });
});
