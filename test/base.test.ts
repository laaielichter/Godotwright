import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { outlineScript } from "../src/godot/gdscript.js";
import { formatFinding } from "../src/review/format.js";
import { reviewProject } from "../src/review/review.js";
import { formatProjectMap } from "../src/scan/format.js";
import { listedFiles, loadProject, scanProject } from "../src/scan/scan.js";
import { makeProject, runCli } from "./helpers.js";

const PROJECT = (name: string, extra = "") => `[application]\nconfig/name="${name}"\nrun/main_scene="res://main.tscn"\nconfig/features=PackedStringArray("4.7")\n${extra}`;

/** A small game, and a mod laid over it that uses the game's scripts, scenes and input map. */
function gameAndMod() {
  const game = makeProject({
    "project.godot": PROJECT("Game", '\n[autoload]\nWorld="*res://world.gd"\n\n[input]\nfly_up={"deadzone": 0.2, "events": []}\n'),
    "main.tscn": '[gd_scene format=3]\n\n[node name="Main" type="Node3D"]\n',
    "world.gd": "extends Node\n\n\nfunc spawn_heli() -> Node3D:\n\treturn Node3D.new()\n",
    "heli.gd": "class_name Heli\nextends Node3D\n\nvar rotor_rpm: float = 0.0\n\n\nfunc start_engine() -> void:\n\tpass\n",
    "broken_in_game.gd": "extends Node\n\n\nfunc _ready() -> void:\n\tvar a: Array = []\n\tprint(a.empty())\n",
  });
  const mod = makeProject({
    "project.godot": PROJECT("Mod").replace('run/main_scene="res://main.tscn"\n', ""),
    "mod/rescue.gd": [
      "extends Node",
      'const Base = preload("res://heli.gd")',
      "",
      "",
      "func _ready() -> void:",
      "\tvar heli: Heli = World.spawn_heli() as Heli",
      "\theli.start_engine()",
      "\theli.rotor_rpm = 300.0",
      '\tif Input.is_action_pressed("fly_up"):',
      "\t\tpass",
      '\tvar scene: PackedScene = load("res://main.tscn")',
      "\tprint(scene, Base)",
      "",
    ].join("\n"),
  });
  return { game, mod };
}

describe("projects laid over a base game", () => {
  it("reports the game's files as missing without the base", () => {
    const { mod } = gameAndMod();
    const lines = reviewProject(mod).findings.filter((f) => f.severity === "error").map(formatFinding);
    expect(lines.some((l) => l.includes("preload() path not found: res://heli.gd"))).toBe(true);
    expect(lines.some((l) => l.includes("[api/unknown-type]"))).toBe(true);
  });

  it("uses the base game's files, classes, autoloads and input map", () => {
    const { game, mod } = gameAndMod();
    const report = reviewProject(mod, { base: [game] });
    expect(report.findings.filter((f) => f.severity !== "info").map(formatFinding)).toEqual([]);
    // Only the mod's own files are reviewed: the game's own bug is not reported.
    expect(report.findings.map((f) => f.file).filter((f) => !f.startsWith("res://mod/") && !["res://project.godot", "res://.gitignore"].includes(f))).toEqual([]);
    expect(report.scripts).toBe(1);
  });

  it("reads the base from godotwright.json", () => {
    const { game, mod } = gameAndMod();
    writeFileSync(join(mod, "godotwright.json"), JSON.stringify({ base: [game] }));
    expect(reviewProject(mod).findings.filter((f) => f.severity !== "info")).toEqual([]);
    const data = loadProject(mod);
    expect(data.external.has("res://heli.gd")).toBe(true);
    expect(data.external.has("res://mod/rescue.gd")).toBe(false);
    expect(data.map.base).toEqual({ roots: [game], files: 4 });
  });

  it("lets the project's own files win over the base", () => {
    const { game, mod } = gameAndMod();
    writeFileSync(join(mod, "heli.gd"), "class_name Heli\nextends Node3D\n\n\nfunc start_engine() -> void:\n\tpass\n");
    const lines = reviewProject(mod, { base: [game] }).findings.map(formatFinding);
    expect(lines.some((l) => l.includes('"rotor_rpm" is not a member of Heli'))).toBe(true);
  });

  it("lists only the project's own files in the scan, and counts the base", () => {
    const { game, mod } = gameAndMod();
    const map = scanProject(mod, { base: [game] });
    expect(map.scripts.filter((s) => !s.external).map((s) => s.path)).toEqual(["res://mod/rescue.gd"]);
    expect(map.project.mainScene).toBe("res://main.tscn");
    expect(map.autoloads.map((a) => a.name)).toEqual(["World"]);
    expect(map.warnings).toEqual([]);
    const text = formatProjectMap(map);
    expect(text).toContain("base: 4 files from");
    expect(text).not.toContain("heli.gd");
  });

  it("fails clearly on a base without project.godot", () => {
    const { mod } = gameAndMod();
    expect(() => reviewProject(mod, { base: [join(mod, "mod")] })).toThrow("base project not found");
    writeFileSync(join(mod, "godotwright.json"), "{ nope");
    expect(() => reviewProject(mod)).toThrow("godotwright.json");
  });

  it("takes --base on the command line", async () => {
    const { game, mod } = gameAndMod();
    const { output, exitCode } = await runCli(["review", mod, "--base", game]);
    expect(exitCode).toBe(0);
    expect(output).toContain("1 scripts");
    expect((await runCli(["scan", mod, "--base", game])).output).toContain("base: 4 files");
  });
});

describe("file lists of a shipped game", () => {
  it("reads .pck manifests and plain lists, mapping exported names back", () => {
    const dir = makeProject({
      "manifest.json": JSON.stringify({
        archives: [{ file: "assets-01.zip" }],
        resources: [
          { resource: ".godot/imported/heli.glb-123.scn" },
          { resource: "models/heli.glb.import" },
          { resource: "scripts/ec135.gd.remap" },
          { resource: "scripts/ec135.gdc" },
          { resource: "res://audio/rotor.ogg" },
        ],
      }),
      "list.txt": "res://textures/sky.png\nmaps\\north.tres\n\n",
    });
    const files = listedFiles(dir, [join(dir, "manifest.json"), join(dir, "list.txt")]);
    expect([...files].sort()).toEqual([
      "res://assets-01.zip",
      "res://audio/rotor.ogg",
      "res://maps/north.tres",
      "res://models/heli.glb",
      "res://scripts/ec135.gd",
      "res://textures/sky.png",
    ]);
  });

  it("counts listed files as present", () => {
    const root = makeProject({
      "project.godot": PROJECT("Mod").replace('run/main_scene="res://main.tscn"\n', ""),
      "kit.gd": 'extends Node\nconst Truck = preload("res://models/truck.glb")\n\n\nfunc _ready() -> void:\n\tprint(Truck)\n',
      "files.txt": "models/truck.glb.import\n",
    });
    const broken = (o = {}) => reviewProject(root, o).findings.filter((f) => f.rule === "structure/broken-reference" && f.file === "res://kit.gd").map((f) => f.message);
    expect(broken()).toEqual(["preload() path not found: res://models/truck.glb"]);
    expect(broken({ baseFiles: [join(root, "files.txt")] })).toEqual([]);
    writeFileSync(join(root, "godotwright.json"), JSON.stringify({ baseFiles: "files.txt" }));
    expect(broken()).toEqual([]);
    expect(scanProject(root).base?.listed).toBe(1);
  });
});

describe("GDScript that real projects use", () => {
  const review = (code: string, files: Record<string, string> = {}) => {
    const root = makeProject({ "project.godot": PROJECT("T").replace('run/main_scene="res://main.tscn"\n', ""), "a.gd": code, ...files });
    return reviewProject(root).findings.filter((f) => f.severity !== "info" && f.file === "res://a.gd").map(formatFinding);
  };

  it("lets a plain string run over lines, like Godot 4", () => {
    const outline = outlineScript('extends Node\n\n\nfunc a() -> void:\n\tprint("one\ntwo")\n\n\nfunc b() -> void:\n\tpass\n');
    expect(outline.functions.map((f) => f.name)).toEqual(["a", "b"]);
    // An unclosed quote still ends at its line.
    expect(outlineScript('extends Node\nvar s = "open\n\n\nfunc b() -> void:\n\tpass\n').functions.map((f) => f.name)).toEqual(["b"]);
  });

  it("reads inner classes that extend a script path", () => {
    const outline = outlineScript('extends Node\nclass Fixed extends "res://base.gd":\n\tfunc f() -> void: pass\n');
    expect(outline.innerClasses.map((c) => [c.name, c.extends])).toEqual([["Fixed", "res://base.gd"]]);
  });

  it("only checks load() paths that are a whole literal", () => {
    expect(review('extends Node\n\n\nfunc _ready() -> void:\n\tvar name := "sky"\n\tprint(load("res://textures/" + name + ".png"))\n')).toEqual([]);
    expect(review('extends Node\n\n\nfunc _ready() -> void:\n\tprint(load("res://nope.png"))\n')).toEqual(["res://a.gd:5: error [structure/broken-reference] load() path not found: res://nope.png"]);
  });

  it("reads dict.key as a key, even when a method has the name", () => {
    expect(review("extends Node\n\n\nfunc _ready() -> void:\n\tvar d: Dictionary = {}\n\tprint(d.size.y, d.anything)\n")).toEqual([]);
  });

  it("types X.new().f() by f's return type", () => {
    const v = { "v.gd": "class_name V\nextends RefCounted\n\n\nfunc validate() -> Dictionary:\n\treturn {}\n" };
    expect(review('extends Node\n\n\nfunc _ready() -> void:\n\tvar r := V.new().validate()\n\tprint(r.get("ok", false))\n', v)).toEqual([]);
  });

  it("accepts input actions added from a list of names", () => {
    const code = 'extends Node\nconst KEYS := {"walk_left": KEY_A}\n\n\nfunc _ready() -> void:\n\tfor action: String in KEYS:\n\t\tInputMap.add_action(action)\n\tprint(Input.is_action_pressed("walk_left"))\n';
    expect(review(code)).toEqual([]);
    expect(review('extends Node\n\n\nfunc _ready() -> void:\n\tprint(Input.is_action_pressed("walk_left"))\n')[0]).toContain("[api/unknown-input-action]");
  });

  it("does not guess members of a class whose base is missing", () => {
    const lines = review('extends "res://missing.gd"\n\n\nfunc _ready() -> void:\n\tsuper._ready()\n\tself.anything()\n\tfoo()\n');
    expect(lines).toEqual(['res://a.gd:1: error [api/unknown-type] Cannot extend "res://missing.gd": it does not exist in Godot 4.7 or this project.']);
  });
});

describe("type inference from Variant", () => {
  const review = (body: string) => {
    const root = makeProject({ "project.godot": '[application]\nconfig/name="T"\n', "a.gd": `extends Node\n\n\nfunc _ready() -> void:\n${body}` });
    return reviewProject(root).findings.filter((f) => f.file === "res://a.gd" && f.severity !== "info").map(formatFinding);
  };

  it("reports := from a function that returns Variant, as Godot does", () => {
    expect(review("\tvar w := weakref(self)\n\tvar m := max(1, 2)\n\tprint(w, m)\n")).toEqual([
      'res://a.gd:5: error [api/infer-variant] Cannot infer the type of "w": weakref() returns Variant. Give it a type.',
      'res://a.gd:6: error [api/infer-variant] Cannot infer the type of "m": max() returns Variant. Give it a type or use maxf() or maxi().',
    ]);
  });

  it("accepts typed variables, typed functions and the script's own functions", () => {
    expect(review("\tvar w: WeakRef = weakref(self)\n\tvar m := maxi(1, 2)\n\tvar a := abs(1.0) as float\n\tvar c := clamp_it()\n\tprint(w, m, a, c)\n\n\nfunc clamp_it() -> int:\n\treturn 1\n")).toEqual([]);
    expect(review("\tvar c := clamp(1, 0, 2) + 1\n\tprint(c)\n")).toEqual([]);
  });
});

describe("super(...)", () => {
  it("has the value the parent's function returns", () => {
    const root = makeProject({
      "project.godot": '[application]\nconfig/name="T"\n',
      "base.gd": "class_name Base\nextends Node\n\n\nfunc act(id: int) -> Dictionary:\n\treturn {}\n",
      "a.gd": 'extends Base\n\n\nfunc act(id: int) -> Dictionary:\n\tvar result := super(id)\n\tprint(result.get("ok", false))\n\treturn result\n',
    });
    expect(reviewProject(root).findings.filter((f) => f.file === "res://a.gd" && f.severity !== "info").map(formatFinding)).toEqual([]);
  });
});
