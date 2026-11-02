import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunResult } from "../src/check/godot.js";
import { checkContents } from "../src/export/contents.js";
import { checkExport } from "../src/export/export.js";
import { patchExport, readBaseList } from "../src/export/patch.js";
import { overlay, readPck, sourcesOf, writePck } from "../src/export/pck.js";
import { exportDiagnostics, formatExportRun, inspectPack, runExport, templateVersion, type ExportDeps } from "../src/export/run.js";
import { FIXTURES, makeProject, runCli, tempFolder } from "./helpers.js";

/** test/fixtures/pck holds packs Godot 4.7.2 exported from this project (see test/pck.test.ts). */
const PCK = join(FIXTURES, "pck");
const PRESETS = '[preset.0]\n\nname="Linux"\nplatform="Linux"\nrunnable=true\nexport_filter="all_resources"\ninclude_filter=""\nexclude_filter=""\nexport_path=""\n\n[preset.0.options]\n\nbinary_format/embed_pck=false\n';
const FILES: Record<string, string> = {
  "project.godot": 'config_version=5\n\n[application]\n\nconfig/name="Fixture"\nrun/main_scene="res://main.tscn"\nconfig/features=PackedStringArray("4.7")\n\n[editor_plugins]\n\nenabled=PackedStringArray("res://addons/tool/plugin.cfg")\n',
  "main.tscn": '[gd_scene format=3]\n\n[ext_resource type="Script" path="res://main.gd" id="1"]\n\n[node name="Main" type="Node"]\nscript = ExtResource("1")\n',
  "main.gd": 'extends Node\n\n\nfunc _ready() -> void:\n\tprint(FileAccess.get_file_as_string("res://data/b.json"))\n',
  "data/b.json": '{"v":1}',
  "data/old.json": "x",
  "addons/tool/plugin.cfg": '[plugin]\nname="Tool"\ndescription=""\nauthor=""\nversion="1"\nscript="plugin.gd"\n',
  "addons/tool/plugin.gd": "@tool\nextends EditorPlugin\n",
  "export_presets.cfg": PRESETS,
};

const RUNTIME_ERROR =
  "SCRIPT ERROR: Invalid access to property or key 'missing' on a base object of type 'Dictionary'.\n          at: _explode (res://main.gd:19)\n          GDScript backtrace (most recent call first):\n              [0] _explode (res://main.gd:19)\n              [1] _process (res://main.gd:14)\n";

interface Call {
  bin: string;
  args: string[];
  cwd?: string;
}

/** A Godot stand-in: `on` answers each run by its flag; an export writes what it returns as `write` to the out path. */
function fakeGodot(on: (flag: string, args: string[]) => Partial<RunResult> & { write?: string }, version = "4.7.2.stable.official.fake"): { deps: ExportDeps; calls: Call[] } {
  const calls: Call[] = [];
  const deps: ExportDeps = {
    find: () => "/fake/godot",
    version: async () => version,
    run: async (bin, args, options = {}) => {
      calls.push({ bin, args, ...(options.cwd ? { cwd: options.cwd } : {}) });
      const flag = args.find((a) => a.startsWith("--export-") || a === "--import" || a === "--main-pack") ?? "binary";
      const { write, ...result } = on(flag, args);
      if (write) copyFileSync(write, args[args.indexOf(flag) + 2]!);
      return { code: 0, stdout: "", stderr: "", timedOut: false, ms: 1, ...result };
    },
  };
  return { deps, calls };
}

describe("export run (Godot faked)", () => {
  it("exports, compares the pack with what the game loads, and runs it with --main-pack outside the project", async () => {
    const root = makeProject(FILES);
    const { deps, calls } = fakeGodot((flag) =>
      flag === "--export-pack" ? { write: join(PCK, "game.pck") } : flag === "--main-pack" ? { stdout: "Godot Engine v4.7.2\n{\"v\":1}\n", stderr: RUNTIME_ERROR } : {},
    );
    const r = await runExport(root, { preset: "Linux" }, deps);
    expect(calls.map((c) => c.args.find((a) => a.startsWith("--")) && c.args.slice(0, 4).join(" "))).toEqual([
      `--headless --path ${root} --import`,
      `--headless --path ${root} --export-pack`,
      "--headless --main-pack " + r.out + " --fixed-fps",
    ]);
    expect(r.out).toBe(join(root, ".godot", "godotwright", "export", "linux", "linux.pck"));
    expect(calls[2]!.cwd).not.toBe(root);
    expect(calls[2]!.args).toEqual(["--headless", "--main-pack", r.out, "--fixed-fps", "60", "--quit-after", "120"]);
    expect(r.contents).toMatchObject({ files: 11, needed: 3, missing: 0, junk: 1 });
    expect(r.smoke).toMatchObject({ frames: 120, exitCode: 0, errors: 1, output: '{"v":1}' });
    const text = formatExportRun(r);
    expect(text).toMatch(/^export run: pack of Linux \(Linux\) -> \.godot\/godotwright\/export\/linux\/linux\.pck: 1 error, 1 warning/);
    expect(text).toContain("contents: 3 of 3 files the game loads are in it; 1 editor-only or test file shipped");
    expect(text).toContain('res://addons/tool/plugin.gd: warning: 1 editor-only script shipped in the pack (147 B); it extends EditorPlugin, a class only the editor has: add "addons/tool/plugin.gd" to the preset\'s exclude_filter');
    expect(text).toContain("res://main.gd:19: error: Invalid access to property or key 'missing' on a base object of type 'Dictionary'.\n    called from res://main.gd:14 _process()");
    expect(text).toContain("smoke: 120 frames (2 s at 60 fps) with Godot --main-pack linux.pck: exit 0, 1 error");
  });

  it("names a file the game loads that the pack lacks, with the chain and the cause, and checks the audit's prediction", async () => {
    const root = makeProject({
      ...FILES,
      "main.gd": 'extends Node\n\n\nfunc _ready() -> void:\n\tprint(FileAccess.get_file_as_string("res://data/b.json"), FileAccess.get_file_as_string("res://data/a.txt"))\n',
      "data/a.txt": "x",
    });
    const { deps } = fakeGodot((flag) => (flag === "--export-pack" ? { write: join(PCK, "game.pck") } : {}));
    const r = await runExport(root, { preset: "0", frames: 0 }, deps);
    expect(r.contents).toMatchObject({ needed: 4, missing: 1, audit: { predicted: 1, confirmed: 1, wrong: [] } });
    expect(r.smoke).toBeUndefined();
    const missing = r.diagnostics.find((d) => d.file === "res://data/a.txt")!;
    expect(missing.severity).toBe("error");
    expect(missing.message).toContain('a plain file that Godot exports only when include_filter names it (add "*.txt")');
    expect(missing.message).toContain("Chain: res://data/a.txt < load in res://main.gd:5 < ext_resource in res://main.tscn:3 < project.godot: application/run/main_scene");
    expect(formatExportRun(r)).toContain("audit: 1 of 1 predicted missing files confirmed by the pack");
  });

  it("stops before Godot on a BOM, an unknown preset or missing templates", async () => {
    const { deps, calls } = fakeGodot(() => ({}), "4.7.99.stable.official.fake");
    const bom = makeProject({ ...FILES, "export_presets.cfg": `﻿${PRESETS}` });
    expect((await runExport(bom, { preset: "Linux" }, deps)).diagnostics[0]!.message).toMatch(/byte order mark.*Invalid export preset name/);
    expect(checkExport(bom).problems.map((p) => p.message)).toEqual([expect.stringMatching(/^export_presets\.cfg starts with a UTF-8 byte order mark/)]);
    const root = makeProject(FILES);
    expect((await runExport(root, { preset: "Windows" }, deps)).diagnostics[0]!.message).toBe('no preset named "Windows"; presets: "Linux" (0)');
    const release = await runExport(root, { preset: "Linux", mode: "release" }, deps);
    expect(release.diagnostics.map((d) => d.message)).toEqual([
      expect.stringMatching(/^no export templates for Godot 4\.7\.99\.stable .*mode pack, which needs none$/),
    ]);
    expect(release.out).toMatch(/linux[\\/]linux\.x86_64$/);
    expect(calls).toEqual([]);
    expect((await runExport(root, { preset: "Linux", out: join(root, "game.zip") }, deps)).diagnostics[0]!.message).toMatch(/must end in \.pck/);
  });

  it("does not trust the exit code alone: no file, or a failure that left a file behind", async () => {
    const root = makeProject(FILES);
    const silent = await runExport(root, { preset: "Linux" }, fakeGodot(() => ({})).deps);
    expect(silent.diagnostics.map((d) => d.message)).toEqual(["Godot exited with 0 but wrote no linux.pck: the export did not happen"]);
    const failed = await runExport(
      root,
      { preset: "Linux" },
      fakeGodot((flag) => (flag === "--export-pack" ? { code: 1, write: join(PCK, "game.pck"), stderr: "ERROR: PCK Embedding: Executable \"pck\" section not found.\n   at: add_message (x.h:270)\nERROR: Project export for preset \"Linux\" failed.\n   at: _fs_changed (x.cpp:1)\n" } : {})).deps,
    );
    expect(failed.diagnostics.map((d) => d.message)).toEqual(['PCK Embedding: Executable "pck" section not found.']);
    expect(failed.notes.join()).toMatch(/Godot failed but left .*linux\.pck behind/);
    expect(failed.contents).toBeUndefined();
  });

  it("keeps Godot's multi-line export errors whole", () => {
    const log = [
      "[ DONE ] first_scan_filesystem",
      'ERROR: Cannot export project with preset "Linux" due to configuration errors:',
      "No export template found at the expected path:",
      "/data/godot/export_templates/4.7.2.stable/linux_debug.x86_64",
      "No export template found at the expected path:",
      "/data/godot/export_templates/4.7.2.stable/linux_release.x86_64",
      "   at: _fs_changed (editor/editor_node.cpp:1401)",
      'ERROR: Project export for preset "Linux" failed.',
      "   at: _fs_changed (editor/editor_node.cpp:1417)",
      "ERROR: Invalid export preset name: Nope.",
      "The following presets were detected in this project's `export_presets.cfg`:",
      '        "Linux"',
      "   at: _fs_changed (editor/editor_node.cpp:1417)",
    ].join("\n");
    expect(exportDiagnostics(log).map((d) => d.message)).toEqual([
      "No export template found at the expected path: /data/godot/export_templates/4.7.2.stable/linux_debug.x86_64 No export template found at the expected path: /data/godot/export_templates/4.7.2.stable/linux_release.x86_64 (install the export templates for this Godot version: Editor > Manage Export Templates, or unpack the .tpz there; mode pack needs no templates)",
      "Invalid export preset name: Nope. The following presets were detected in this project's `export_presets.cfg`: \"Linux\"",
    ]);
  });

  it("reads the template folder from the version line", () => {
    expect(templateVersion("4.7.2.stable.official.ed1daf0bf")).toBe("4.7.2.stable");
    expect(templateVersion("4.7.stable.mono.official.abc")).toBe("4.7.stable.mono");
    expect(templateVersion("4.8.dev3.custom_build")).toBe("4.8.dev3");
  });
});

describe("export patch (Godot faked)", () => {
  /** What a full export of the changed project holds: the base with the patch over it. */
  const fullAfter = (dir: string) => {
    const view = overlay([readPck(join(PCK, "game.pck")), readPck(join(PCK, "patch.pck"))]).files;
    const file = join(dir, "full-after.pck");
    const all = [...sourcesOf(readPck(join(PCK, "game.pck"))), ...sourcesOf(readPck(join(PCK, "patch.pck")))].filter((s) => view.get(s.path)?.pck.file === s.from.file);
    writePck(file, all, [4, 7, 2]);
    return file;
  };

  it("against a base pack: Godot's patch is checked against a fresh full export and run over the base", async () => {
    const dir = tempFolder("gw-patch-");
    const root = makeProject({ ...FILES, "data/b.json": '{"v":2}', "data/new.json": "{}" });
    const full = fullAfter(dir);
    const { deps, calls } = fakeGodot((flag) => (flag === "--export-pack" ? { write: full } : flag === "--export-patch" ? { write: join(PCK, "patch.pck") } : flag === "--main-pack" ? { stdout: '{"v":2}\n' } : {}));
    const r = await patchExport(root, { preset: "Linux", against: [join(PCK, "game.pck")] }, deps);
    expect(r.diagnostics).toEqual([]);
    expect(r.patch).toMatchObject({ by: "godot", files: 2, changed: ["data/b.json"], added: ["data/new.json"], removed: ["data/old.json"], unchanged: 9 });
    const patchCall = calls.find((c) => c.args.includes("--export-patch"))!;
    expect(patchCall.args.slice(-2)).toEqual(["--patches", join(PCK, "game.pck")]);
    expect(r.smoke?.how).toMatch(/^the base with the patch over it/);
    const text = formatExportRun(r);
    expect(text).toContain("patch: 2 files, 9 B: 1 changed, 1 new, 1 removed; 9 unchanged left out (Godot --export-patch)");
    expect(text).toContain("  ~ data/b.json\n  + data/new.json\n  - data/old.json");
    // The temporary full export and the merged game are removed.
    expect(existsSync(join(root, ".godot", "godotwright", "export", "linux", "full-for-patch.pck"))).toBe(false);
    expect(existsSync(join(root, ".godot", "godotwright", "export", "linux", "patched-game.pck"))).toBe(false);
  });

  it("finds a patch that ships unchanged base files and misses a changed one", async () => {
    const dir = tempFolder("gw-patch-");
    const root = makeProject(FILES);
    const full = fullAfter(dir);
    const { deps } = fakeGodot((flag) => (flag === "--export-pack" ? { write: full } : flag === "--export-patch" ? { write: join(PCK, "game.pck") } : {}));
    const r = await patchExport(root, { preset: "Linux", against: [join(PCK, "game.pck")], frames: 0 }, deps);
    const lines = r.diagnostics.map((d) => `${d.severity} ${d.file}: ${d.message}`);
    expect(lines).toContain("error res://main.gdc: the patch ships this file unchanged: the base pack has the same data");
    expect(lines).toContain("error res://data/new.json: new in a fresh full export, but the patch does not hold it");
    expect(lines).toContain("warning res://data/old.json: the base has it and the project no longer does, but the patch does not remove it");
  });

  it("from a .pck manifest only: Godotwright writes exactly the changed and new files", async () => {
    const dir = tempFolder("gw-patch-");
    const root = makeProject({ ...FILES, "data/b.json": '{"v":2}', "data/new.json": "{}" });
    const manifest = join(dir, "manifest.json");
    writeFileSync(manifest, JSON.stringify({ resources: readPck(join(PCK, "game.pck")).entries.map((e) => ({ resource: e.path, bytes: e.size, md5: e.md5, flags: e.flags })) }));
    const full = fullAfter(dir);
    const { deps, calls } = fakeGodot((flag) => (flag === "--export-pack" ? { write: full } : {}));
    const r = await patchExport(root, { preset: "Linux", manifest: [manifest], out: join(dir, "mod.pck") }, deps);
    expect(calls.some((c) => c.args.includes("--export-patch"))).toBe(false);
    expect(r.diagnostics).toEqual([]);
    expect(r.patch).toMatchObject({ by: "godotwright", changed: ["data/b.json"], added: ["data/new.json"], removed: [], unchanged: 9 });
    expect(readPck(join(dir, "mod.pck")).entries.map((e) => e.path)).toEqual(["data/b.json", "data/new.json"]);
    expect(r.notes.join("\n")).toMatch(/1 files of manifest\.json are not in this project's export/);
    // No base pack here: the smoke run starts the full export.
    expect(calls.find((c) => c.args.includes("--main-pack"))?.args[2]).toMatch(/full-for-patch\.pck$/);
  });

  it("says when nothing changed, and when there is no base at all", async () => {
    const root = makeProject(FILES);
    const { deps } = fakeGodot((flag) =>
      flag === "--export-pack" ? { write: join(PCK, "game.pck") } : flag === "--export-patch" ? { code: 1, stderr: "ERROR: Save PCK: No files or changes to export.\n   at: add_message (x.h:1)\n" } : {},
    );
    const r = await patchExport(root, { preset: "Linux", against: [join(PCK, "game.pck")] }, deps);
    expect(r.errors).toBe(0);
    expect(r.patch?.by).toBe("none");
    expect(formatExportRun(r)).toContain("patch: nothing changed against the base, no patch written");
    const none = await patchExport(root, { preset: "Linux" }, deps);
    expect(none.diagnostics[0]!.message).toMatch(/^a patch needs a base/);
  });
});

describe("reading a pack against the project (no Godot)", () => {
  it("lists a full pack and a patch", () => {
    const root = makeProject(FILES);
    const full = inspectPack(join(PCK, "game.pck"), { path: root });
    expect(full.contents).toMatchObject({ files: 11, needed: 3, missing: 0, junk: 1 });
    const patch = inspectPack(join(PCK, "patch.pck"), { path: root });
    expect(patch.notes[0]).toMatch(/read as a patch/);
    expect(patch.errors).toBe(0);
    expect(inspectPack(join(PCK, "encrypted.pck"), { path: root }).pack).toMatchObject({ encryptedDirectory: true, files: 11 });
  });

  it("needs project.binary in a main pack", () => {
    const root = makeProject(FILES);
    const { diagnostics } = checkContents(root, readPck(join(PCK, "patch.pck")), { main: true });
    expect(diagnostics[0]!.message).toMatch(/no project\.binary/);
  });

  it("works from the CLI, next to the audit's own --preset", async () => {
    const root = makeProject(FILES);
    const cli = await runCli(["export", "pck", join(PCK, "game.pck"), "--path", root]);
    expect(cli.exitCode).toBe(0);
    expect(cli.output).toMatch(/^export pck: .*game\.pck: ok, 1 warning\npack: 11 files, 2\.3 KB, format 4 by Godot 4\.7\.2\n/);
    const audit = await runCli(["export", root, "--preset", "Linux", "--json"]);
    expect(JSON.parse(audit.output).presets).toHaveLength(1);
    expect(readFileSync(join(root, "export_presets.cfg"), "utf8")).toBe(PRESETS);
  });
});

describe("base file lists", () => {
  it("read a .pck manifest with md5, a plain list and lines", () => {
    const dir = tempFolder("gw-list-");
    writeFileSync(
      join(dir, "manifest.json"),
      JSON.stringify({ archives: [{ file: "assets-01.zip" }], resources: [{ resource: "main.gdc", md5: "A".repeat(32), bytes: 10 }, { resource: ".godot/uid_cache.bin", md5: "b".repeat(32), bytes: 99 }] }),
    );
    writeFileSync(join(dir, "list.json"), JSON.stringify(["res://data/b.json", "res://main.tscn"]));
    writeFileSync(join(dir, "list.txt"), "res://icon.svg\n\nlevels/a.tscn\n");
    const list = readBaseList([join(dir, "manifest.json"), join(dir, "list.json"), join(dir, "list.txt")]);
    expect([...list.entries]).toEqual([
      ["main.gdc", { md5: "a".repeat(32), bytes: 10 }],
      [".godot/uid_cache.bin", { md5: "b".repeat(32), bytes: 99 }],
      ["data/b.json", {}],
      ["main.tscn", {}],
      ["icon.svg", {}],
      ["levels/a.tscn", {}],
    ]);
    expect([...list.sources].sort()).toEqual(["res://data/b.json", "res://icon.svg", "res://levels/a.tscn", "res://main.gd", "res://main.tscn"]);
    expect(() => readBaseList([join(dir, "nope.json")])).toThrow(/not found/);
  });
});
