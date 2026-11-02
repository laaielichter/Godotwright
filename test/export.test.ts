import { describe, expect, it } from "vitest";
import { checkExport, formatExportCheck, matchesFilter, parsePresets } from "../src/export/export.js";
import { makeProject, runCli } from "./helpers.js";

const PRESETS = '[preset.0]\n\nname="Linux"\nplatform="Linux"\nexport_filter="all_resources"\ninclude_filter="*.bin"\nexclude_filter="lib/*,tests/*"\nexport_path="out/game.x86_64"\n\n[preset.0.options]\n';

describe("export presets", () => {
  it("are read with their filters", () => {
    expect(parsePresets(PRESETS)).toEqual([
      { index: 0, name: "Linux", platform: "Linux", exportFilter: "all_resources", include: ["*.bin"], exclude: ["lib/*", "tests/*"], exportPath: "out/game.x86_64", files: [] },
    ]);
  });

  it("match like Godot: * crosses folders, a bare pattern also matches the file name", () => {
    expect(matchesFilter("lib/a/helper.gd", "lib/*")).toBe(true);
    expect(matchesFilter("data/table.txt", "*.txt")).toBe(true);
    expect(matchesFilter("tools/build_city.gd", "tools/build_*.gd")).toBe(true);
    expect(matchesFilter("library/x.gd", "lib/*")).toBe(false);
  });
});

describe("godotwright export", () => {
  const project = () =>
    makeProject({
      "project.godot": '[application]\nconfig/name="E"\nconfig/features=PackedStringArray("4.7")\n',
      "export_presets.cfg": PRESETS,
      "main.gd":
        'extends Node\nconst Helper = preload("res://lib/helper.gd")\nconst LEVELS := "res://lib/levels/"\nconst NOTES := "res://lib/notes.json"\n\n\nfunc _ready() -> void:\n\tvar t := FileAccess.get_file_as_string("res://data/table.txt")\n\tvar j := FileAccess.get_file_as_string("res://data/table.json")\n\tvar b := FileAccess.get_file_as_bytes("res://data/blob.bin")\n\tprint(Helper, t, j, b, LEVELS, NOTES)\n',
      "lib/helper.gd": "extends RefCounted\n",
      "lib/notes.json": "{}",
      "data/table.txt": "x",
      "data/table.json": "{}",
      "data/blob.bin": "x",
      "tests/test_main.gd": 'extends Node\nconst X = preload("res://lib/helper.gd")\n',
    });

  it("finds what the build will miss: excluded loads, plain files without include_filter, built paths in excluded folders", () => {
    const r = checkExport(project());
    const lines = r.problems.map((p) => `${p.severity} ${p.from} ${p.file}`);
    expect(lines).toEqual([
      "error res://main.gd:2 res://lib/helper.gd",
      "warning res://main.gd:3 res://lib/levels/",
      "warning res://main.gd:4 res://lib/notes.json",
      "error res://main.gd:8 res://data/table.txt",
    ]);
    expect(formatExportCheck(r)).toMatch(/^export check: 1 preset \(Linux, Linux\): 2 errors, 2 warnings/);
  });

  it("says when there is nothing to check", async () => {
    const root = makeProject({ "project.godot": '[application]\nconfig/name="E"\n' });
    expect(checkExport(root).notes.join("\n")).toMatch(/no export_presets\.cfg/);
    const cli = await runCli(["export", project(), "--json"]);
    expect(cli.exitCode).toBe(1);
    expect(JSON.parse(cli.output).problems).toHaveLength(4);
  });
});
