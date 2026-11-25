import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCSharp, findDotnet } from "../../src/check/csharp-build.js";
import { formatAll } from "../../src/format/project.js";
import { newProject } from "../../src/scaffold/project.js";
import { newScript } from "../../src/scaffold/script.js";
import { editProjectSettings } from "../../src/settings/edit.js";

/**
 * Needs the .NET build of Godot 4.7 in $GODOT and the .NET SDK on PATH, and Godot.NET.Sdk where NuGet finds it
 * (nuget.org, or a local source pointed at the editor's GodotSharp/Tools/nupkgs). Skipped otherwise.
 */
const GODOT = process.env["GODOT"];
const isDotnetGodot = (() => {
  if (!GODOT) return false;
  try {
    return /mono/.test(execFileSync(GODOT, ["--version"], { encoding: "utf8" }));
  } catch {
    return false;
  }
})();
const enabled = isDotnetGodot && findDotnet() !== undefined;

export const CS_TEMPLATES: [string, Parameters<typeof newScript>[2]][] = [
  ["res://scripts/NodeT.cs", { template: "node" }],
  ["res://scripts/SpriteT.cs", { template: "node", base: "Sprite2D" }],
  ["res://scripts/Character2dT.cs", { template: "character_2d" }],
  ["res://scripts/Character3dT.cs", { template: "character_3d" }],
  ["res://scripts/Area2dT.cs", { template: "area_trigger", dimension: "2d" }],
  ["res://scripts/Area3dT.cs", { template: "area_trigger", dimension: "3d" }],
  ["res://scripts/AutoloadT.cs", { template: "autoload" }],
  ["res://scripts/ResourceT.cs", { template: "resource" }],
  ["res://scripts/UiControlT.cs", { template: "ui_control" }],
];

describe.skipIf(!enabled)("C# with dotnet and the .NET build of Godot", () => {
  it("a new C# project with every C# template builds with no errors and no warnings, and Godot runs them", { timeout: 600_000 }, async () => {
    const root = join(mkdtempSync(join(tmpdir(), "godotwright-cs-")), "cs");
    newProject(root, { dotnet: true });
    for (const [file, options] of CS_TEMPLATES) newScript(root, file, options);
    for (const action of ["move_left", "move_right", "move_forward", "move_back", "jump"]) editProjectSettings(root, { op: "input_add", action, events: ["key:Space"] }, { write: true });

    const build = await buildCSharp(root);
    expect(build.diagnostics).toEqual([]);
    expect(build).toMatchObject({ status: "ok", errors: 0, warnings: 0 });

    // Every node template on one scene, run for a few frames: no script errors.
    const nodes = [
      ["NodeT", "Node"], ["SpriteT", "Sprite2D"], ["Character2dT", "CharacterBody2D"], ["Character3dT", "CharacterBody3D"],
      ["Area2dT", "Area2D"], ["Area3dT", "Area3D"], ["UiControlT", "Control"],
    ];
    const scene = [
      `[gd_scene format=3]`,
      "",
      ...nodes.map(([name], i) => `[ext_resource type="Script" path="res://scripts/${name}.cs" id="${i + 1}"]`),
      "",
      `[node name="Root" type="Node"]`,
      ...nodes.flatMap(([name, type], i) => ["", `[node name="${name}" type="${type}" parent="."]`, `script = ExtResource("${i + 1}")`]),
      "",
    ].join("\n");
    writeFileSync(join(root, "cs_templates.tscn"), scene);
    execFileSync(GODOT!, ["--headless", "--path", root, "--import"], { encoding: "utf8", stdio: "pipe" });
    const run = spawnSync(GODOT!, ["--headless", "--path", root, "res://cs_templates.tscn", "--quit-after", "10"], { encoding: "utf8" });
    const out = `${run.stdout}\n${run.stderr}`;
    expect(out).toContain("Godot Engine v4.7");
    expect(out.split("\n").filter((l) => /ERROR|SCRIPT ERROR|Exception/.test(l))).toEqual([]);
  });

  it("dotnet format leaves every template as it is, formats a messy file, and the build stays clean", { timeout: 600_000 }, async () => {
    const root = join(mkdtempSync(join(tmpdir(), "godotwright-cs-format-")), "cs");
    newProject(root, { dotnet: true });
    for (const [file, options] of CS_TEMPLATES) newScript(root, file, options);
    const clean = await formatAll(root, { files: ["res://scripts"] });
    expect(clean.changed).toEqual([]);
    expect(clean.skipped).toEqual([]);
    expect(clean.unchanged).toBe(CS_TEMPLATES.length);
    const messy = 'using Godot;\npublic partial class Messy:Node{\n  [Export]   public int Speed{get;set;}=3;\n    public override void _Ready( ){GD.Print("a  b" ,Speed);   }\n}\n';
    writeFileSync(join(root, "scripts", "Messy.cs"), messy);
    const r = await formatAll(root, { files: ["res://scripts/Messy.cs"], write: true });
    expect(r.changed.map((c) => c.file)).toEqual(["res://scripts/Messy.cs"]);
    expect(r.build).toEqual({ before: 0, after: 0 });
    expect(readFileSync(join(root, "scripts", "Messy.cs"), "utf8")).toBe('using Godot;\npublic partial class Messy : Node\n{\n    [Export] public int Speed { get; set; } = 3;\n    public override void _Ready() { GD.Print("a  b", Speed); }\n}\n');
  });
});
