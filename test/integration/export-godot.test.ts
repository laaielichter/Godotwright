import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkExport } from "../../src/export/export.js";
import { patchExport } from "../../src/export/patch.js";
import { readPck } from "../../src/export/pck.js";
import { formatExportRun, inspectPack, runExport, smokePack } from "../../src/export/run.js";

/** Needs a real Godot 4.7 binary in $GODOT. CI provides one. Exporting a .pck needs no export templates. */
const GODOT = process.env["GODOT"];
const LINUX_X64 = process.platform === "linux" && process.arch === "x64";

/** Godot keeps export templates under $XDG_DATA_HOME on Linux: point it at an empty folder, so the machine's own are not used. */
const savedXdg = process.env["XDG_DATA_HOME"];
process.env["XDG_DATA_HOME"] = mkdtempSync(join(tmpdir(), "godotwright-xdg-"));
afterAll(() => {
  if (savedXdg === undefined) delete process.env["XDG_DATA_HOME"];
  else process.env["XDG_DATA_HOME"] = savedXdg;
});

const PRESET = (extra = "", options = "") =>
  `[preset.0]\n\nname="Linux"\nplatform="Linux"\nrunnable=true\nexport_filter="all_resources"\ninclude_filter=""\nexclude_filter=""\nexport_path=""\n${extra}\n[preset.0.options]\n\nbinary_format/embed_pck=false\n${options}`;

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "godotwright-export-"));
  const all: Record<string, string> = {
    "project.godot": 'config_version=5\n\n[application]\n\nconfig/name="E"\nrun/main_scene="res://main.tscn"\nconfig/features=PackedStringArray("4.7")\n',
    "main.tscn": '[gd_scene format=3]\n\n[ext_resource type="Script" path="res://main.gd" id="1"]\n\n[node name="Main" type="Node"]\nscript = ExtResource("1")\n',
    "export_presets.cfg": PRESET(),
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const GAME = {
  "main.gd":
    'extends Node\n\nvar frames := 0\n\n\nfunc _ready() -> void:\n\tprint("ready ", FileAccess.get_file_as_string("res://data/b.json"), " ", FileAccess.get_file_as_string("res://data/a.txt"))\n\n\nfunc _process(_delta: float) -> void:\n\tframes += 1\n\tif frames == 5:\n\t\t_explode()\n\n\nfunc _explode() -> void:\n\tvar d: Dictionary = {}\n\tprint(d["missing"])\n',
  "data/b.json": '{"v":1}',
  "data/a.txt": "x",
  "addons/tool/plugin.cfg": '[plugin]\nname="Tool"\ndescription=""\nauthor=""\nversion="1"\nscript="plugin.gd"\n',
  "addons/tool/plugin.gd": "@tool\nextends EditorPlugin\n",
};

describe.skipIf(!GODOT)("what Godot really exports", () => {
  it("matches the export check: an excluded preload is missing, JSON is in, plain text is not", { timeout: 300_000 }, () => {
    const root = project({
      "main.gd": 'extends Node\nconst Helper = preload("res://lib/helper.gd")\n\n\nfunc _ready() -> void:\n\tprint(Helper, FileAccess.get_file_as_string("res://data/a.txt"), FileAccess.get_file_as_string("res://data/b.json"))\n',
      "lib/helper.gd": "extends RefCounted\n",
      "data/a.txt": "x",
      "data/b.json": "{}",
      "export_presets.cfg": PRESET().replace('exclude_filter=""', 'exclude_filter="lib/*"'),
    });
    mkdirSync(join(root, "out"));
    execFileSync(GODOT!, ["--headless", "--path", root, "--import"], { stdio: "ignore", timeout: 120_000 });
    execFileSync(GODOT!, ["--headless", "--path", root, "--export-pack", "Linux", "out/game.pck"], { stdio: "ignore", timeout: 120_000 });
    const names = readPck(join(root, "out", "game.pck")).entries.map((e) => e.path);
    expect(names).toContain("data/b.json");
    expect(names).not.toContain("data/a.txt");
    expect(names.some((n) => n.startsWith("lib/"))).toBe(false);
    const files = checkExport(root).problems.map((p) => `${p.severity} ${p.file}`);
    expect(files).toEqual(["error res://lib/helper.gd", "error res://data/a.txt"]);
  });

  it("exports an imported file whatever its extension, but not one kept or skipped, as the audit says", { timeout: 300_000 }, async () => {
    const root = project({
      "main.gd": 'extends Node\n\n\nfunc _ready() -> void:\n\tprint(load("res://fx/water.glsl"), FileAccess.get_file_as_string("res://fx/notes.txt"), FileAccess.get_file_as_string("res://fx/raw.svg"))\n',
      "fx/water.glsl": "#[compute]\n#version 450\nvoid main() {}\n",
      "fx/notes.txt": "x",
      "fx/notes.txt.import": '[remap]\n\nimporter="keep"\n',
      "fx/raw.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>',
      "fx/raw.svg.import": '[remap]\n\nimporter="skip"\n',
    });
    const r = await runExport(root, { preset: "Linux", frames: 0 });
    const names = readPck(r.out!).entries.map((e) => e.path);
    expect(names).toContain("fx/water.glsl.import");
    expect(names.filter((n) => n.startsWith("fx/") && !n.startsWith("fx/water"))).toEqual([]);
    expect(r.contents?.audit).toEqual({ predicted: 2, confirmed: 2, wrong: [] });
    expect(r.diagnostics.filter((d) => d.source === "contents").map((d) => d.file)).toEqual(["res://fx/notes.txt", "res://fx/raw.svg"]);
  });

  it("export run: reads the real pack, finds what is missing and shipped, and runs it with call chains", { timeout: 300_000 }, async () => {
    const root = project(GAME);
    const r = await runExport(root, { preset: "Linux", frames: 30 });
    const text = formatExportRun(r);
    expect(r.pack).toMatchObject({ formatVersion: 4, engine: "4.7.2", encryptedDirectory: false });
    expect(r.contents).toMatchObject({ needed: 4, missing: 1, junk: 1, audit: { predicted: 1, confirmed: 1, wrong: [] } });
    expect(text).toContain('res://data/a.txt: error: the game loads it, but the pack does not hold it, so this load fails in the build; a plain file, which Godot exports only when include_filter names it: add "*.txt". Chain:');
    expect(text).toContain("Chain: res://data/a.txt < load in res://main.gd:7 < ext_resource in res://main.tscn:3 < project.godot: application/run/main_scene");
    expect(text).toContain("res://addons/tool/plugin.gd: warning: 1 editor-only script shipped in the pack");
    expect(r.smoke).toMatchObject({ frames: 30, exitCode: 0, errors: 1 });
    expect(r.smoke!.output).toBe('ready {"v":1}');
    expect(text).toContain("res://main.gd:18: error: Invalid access to property or key 'missing' on a base object of type 'Dictionary'.\n    called from res://main.gd:13 _process()");
    expect(r.errors).toBe(2);
    // Read again without Godot, as godot_export with pck does.
    expect(inspectPack(r.out!, { path: root }).contents).toMatchObject({ missing: 1, junk: 1 });
  });

  it("a byte order mark in export_presets.cfg makes Godot read no presets, so export run stops before it", { timeout: 300_000 }, async () => {
    const root = project({ "main.gd": "extends Node\n", "export_presets.cfg": `﻿${PRESET()}` });
    const raw = spawnSync(GODOT!, ["--headless", "--path", root, "--export-pack", "Linux", join(root, "x.pck")], { encoding: "utf8", timeout: 120_000 });
    expect(raw.status).toBe(1);
    expect(raw.stderr).toContain("Invalid export preset name: Linux.");
    const r = await runExport(root, { preset: "Linux" });
    expect(r.steps).toEqual([]);
    expect(r.diagnostics[0]!.message).toMatch(/byte order mark/);
  });

  it("release: stops without templates, exports with them, runs the binary; a failed embed still leaves a file", { timeout: 600_000 }, async () => {
    const root = project({ "main.gd": 'extends Node\n\n\nfunc _ready() -> void:\n\tprint("hello from the build")\n' });
    const none = await runExport(root, { preset: "Linux", mode: "release" });
    expect(none.steps).toEqual([]);
    expect(none.diagnostics.map((d) => d.message).join()).toMatch(/no export templates for Godot 4\.7\.\d+\.stable/);
    if (!LINUX_X64) return;
    // Stand-in templates: the editor binary runs an appended or neighbouring pack like a template does.
    const version = execFileSync(GODOT!, ["--headless", "--version"], { encoding: "utf8" }).trim().split("\n").pop()!.split(".").slice(0, 4).join(".");
    const templates = join(process.env["XDG_DATA_HOME"]!, "godot", "export_templates", version);
    mkdirSync(templates, { recursive: true });
    for (const name of ["linux_release.x86_64", "linux_debug.x86_64"]) symlinkSync(GODOT!, join(templates, name));
    const r = await runExport(root, { preset: "Linux", mode: "release", frames: 10 });
    expect(r.errors).toBe(0);
    expect(r.pack?.file).toMatch(/linux[\\/]linux\.pck$/);
    expect(r.smoke?.how).toBe("the exported binary linux.x86_64");
    expect(r.smoke?.output).toBe("hello from the build");
    // embed_pck: the stand-in has no "pck" section, so Godot fails (exit 1) after appending the pack anyway.
    writeFileSync(join(root, "export_presets.cfg"), PRESET().replace("embed_pck=false", "embed_pck=true"));
    const embedded = await runExport(root, { preset: "Linux", mode: "release", frames: 10, import: false });
    expect(embedded.diagnostics.map((d) => d.message)).toContain('PCK Embedding: Executable "pck" section not found.');
    expect(embedded.notes.join()).toMatch(/Godot failed but left .* behind: do not ship it/);
    const exe = embedded.out!;
    const pck = readPck(exe);
    expect(pck.start).toBe(statSync(GODOT!).size);
    expect(pck.entries.map((e) => e.path)).toContain("project.binary");
    const smoke = await smokePack(exe, { path: root, frames: 10 });
    expect(smoke.smoke?.output).toBe("hello from the build");
  });

  it("detects an encrypted pack directory and does not try to run it with the editor", { timeout: 300_000 }, async () => {
    const root = project({ "main.gd": "extends Node\n", "export_presets.cfg": PRESET('encryption_include_filters="*.gd"\nencryption_exclude_filters=""\nencrypt_pck=true\nencrypt_directory=true\n') });
    const saved = process.env["GODOT_SCRIPT_ENCRYPTION_KEY"];
    process.env["GODOT_SCRIPT_ENCRYPTION_KEY"] = "0f".repeat(32);
    try {
      const r = await runExport(root, { preset: "Linux" });
      expect(r.pack).toMatchObject({ encryptedDirectory: true });
      expect(r.pack!.files).toBeGreaterThan(3);
      expect(r.contents).toBeUndefined();
      expect(r.smoke).toBeUndefined();
      expect(r.notes.join("\n")).toMatch(/directory is encrypted[\s\S]*smoke run skipped: the pack is encrypted/);
    } finally {
      if (saved === undefined) delete process.env["GODOT_SCRIPT_ENCRYPTION_KEY"];
      else process.env["GODOT_SCRIPT_ENCRYPTION_KEY"] = saved;
    }
  });

  it("patch: Godot's patch against a base pack, a patch from a manifest, and nothing to patch", { timeout: 600_000 }, async () => {
    const root = project({
      "main.gd": 'extends Node\n\n\nfunc _ready() -> void:\n\tprint("v=", FileAccess.get_file_as_string("res://data/b.json"))\n',
      "data/b.json": "1",
      "data/old.json": "{}",
    });
    const base = join(mkdtempSync(join(tmpdir(), "godotwright-base-")), "base.pck");
    expect((await runExport(root, { preset: "Linux", out: base, frames: 0 })).errors).toBe(0);
    const manifest = join(base, "..", "manifest.json");
    writeFileSync(manifest, JSON.stringify({ resources: readPck(base).entries.map((e) => ({ resource: e.path, bytes: e.size, md5: e.md5 })) }));

    const same = await patchExport(root, { preset: "Linux", against: [base], frames: 0 });
    expect(same.errors).toBe(0);
    expect(same.patch?.by).toBe("none");

    writeFileSync(join(root, "data", "b.json"), "2");
    writeFileSync(join(root, "data", "new.json"), "{}");
    execFileSync("rm", [join(root, "data", "old.json")]);
    const godot = await patchExport(root, { preset: "Linux", against: [base], frames: 10 });
    expect(godot.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(godot.patch).toMatchObject({ by: "godot", changed: ["data/b.json"], added: ["data/new.json"], removed: ["data/old.json"] });
    expect(godot.smoke?.output).toBe("v=2");
    expect(formatExportRun(godot)).toContain("  ~ data/b.json\n  + data/new.json\n  - data/old.json");

    const listed = await patchExport(root, { preset: "Linux", manifest: [manifest], frames: 0, import: false });
    expect(listed.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(listed.patch).toMatchObject({ by: "godotwright", changed: ["data/b.json"], added: ["data/new.json"], removed: [] });
    expect(readPck(listed.out!).entries.map((e) => e.path)).toEqual(["data/b.json", "data/new.json"]);
  });
});
