import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { undoJournal } from "../src/journal/journal.js";
import { applyTextEdits, findCSharpDefinitions, renameAnything, renameCSharp, workspaceEdits } from "../src/rename/csharp.js";
import { formatRename, RenameError } from "../src/rename/rename.js";
import type { CSharpServerCommand } from "../src/lsp/server.js";

const FAKE = join(import.meta.dirname, "fixtures", "fake-csharp-ls.mjs");
const server: CSharpServerCommand = { command: process.execPath, args: [FAKE], from: "env" };

const TRIGGER = `using Godot;

public partial class AreaTriggerT : Area2D
{
\t[Signal]
\tpublic delegate void TriggeredEventHandler(Node2D body);

\t[Export]
\tpublic StringName TargetGroup { get; set; } = "player";

\tpublic override void _Ready()
\t{
\t\tBodyEntered += OnBodyEntered;
\t}

\tprivate void OnBodyEntered(Node2D body)
\t{
\t\tif (body.IsInGroup(TargetGroup))
\t\t{
\t\t\tEmitSignal(SignalName.Triggered, body);
\t\t}
\t}
}
`;

const OTHER = `using Godot;

public partial class Other : Node
{
\tpublic void Use(AreaTriggerT t)
\t{
\t\tt.Triggered += OnTriggered;
\t\tCall("OnBodyEntered", default(Variant));
\t}

\tprivate void OnTriggered(Node2D body) { }
}
`;

const SCENE = `[gd_scene load_steps=3 format=3 uid="uid://b1"]

[ext_resource type="Script" uid="uid://ctrig" path="res://scripts/AreaTriggerT.cs" id="1_t"]
[ext_resource type="Script" path="res://main.gd" id="2_m"]

[node name="Main" type="Node2D"]
script = ExtResource("2_m")

[node name="Trigger" type="Area2D" parent="."]
TargetGroup = &"enemy"
script = ExtResource("1_t")

[node name="Plain" type="Node2D" parent="."]
TargetGroup = 3

[connection signal="Triggered" from="Trigger" to="." method="_on_triggered"]
[connection signal="body_entered" from="Trigger" to="Trigger" method="OnBodyEntered"]
`;

const MAIN_GD = `extends Node2D


func _ready() -> void:
\t$Trigger.Triggered.connect(_on_triggered)
\t$Trigger.TargetGroup = &"boss"
\t$Trigger.OnBodyEntered(null)


func _on_triggered(_body: Node2D) -> void:
\tpass
`;

function csProject(): string {
  const root = mkdtempSync(join(tmpdir(), "godotwright cs-rename-"));
  writeFileSync(join(root, "project.godot"), 'config_version=5\n[application]\nconfig/name="Cs"\nrun/main_scene="res://main.tscn"\n\n[dotnet]\n\nproject/assembly_name="Cs"\n');
  writeFileSync(join(root, "Cs.csproj"), '<Project Sdk="Godot.NET.Sdk/4.7.2" />');
  mkdirSync(join(root, "scripts"));
  writeFileSync(join(root, "scripts", "AreaTriggerT.cs"), TRIGGER);
  writeFileSync(join(root, "scripts", "AreaTriggerT.cs.uid"), "uid://ctrig\n");
  writeFileSync(join(root, "scripts", "Other.cs"), OTHER);
  writeFileSync(join(root, "main.tscn"), SCENE);
  writeFileSync(join(root, "main.gd"), MAIN_GD);
  return root;
}

const read = (root: string, file: string) => readFileSync(join(root, file), "utf8");

afterEach(() => {
  delete process.env["FAKE_NO_GENERATED"];
});

describe("godot_rename on C#", () => {
  it("finds C# declarations with Godot's names: a signal by its name or its delegate", () => {
    const root = csProject();
    expect(findCSharpDefinitions(root, "Triggered").map((d) => [d.kind, d.csharp, d.godot, d.file, d.line, d.column])).toEqual([["signal", "TriggeredEventHandler", "Triggered", "res://scripts/AreaTriggerT.cs", 6, 23]]);
    expect(findCSharpDefinitions(root, "TriggeredEventHandler")[0]?.godot).toBe("Triggered");
    expect(findCSharpDefinitions(root, "TargetGroup")[0]?.kind).toBe("export");
    expect(findCSharpDefinitions(root, "AreaTriggerT")[0]).toMatchObject({ kind: "class", line: 3, column: 22 });
    expect(findCSharpDefinitions(root, "_on_triggered")).toEqual([]);
  });

  it("renames a method: C# through the server, then scene connections and GDScript; undo puts it back", { timeout: 30_000 }, async () => {
    const root = csProject();
    const plan = await renameCSharp(root, "OnBodyEntered", "HandleBody", { server });
    expect(plan.written).toBe(false);
    expect(plan.edits.map((e) => `${e.file}:${e.line} ${e.after}`)).toEqual([
      "res://main.gd:7 $Trigger.HandleBody(null)",
      'res://main.tscn:17 [connection signal="body_entered" from="Trigger" to="Trigger" method="HandleBody"]',
      "res://scripts/AreaTriggerT.cs:13 BodyEntered += HandleBody;",
      "res://scripts/AreaTriggerT.cs:16 private void HandleBody(Node2D body)",
    ]);
    // The string in C# is not code the server renames: it is shown, not changed.
    expect(formatRename(plan)).toContain('CHECK BY HAND res://scripts/Other.cs:8  string  "OnBodyEntered"');
    expect(read(root, "scripts/AreaTriggerT.cs")).toBe(TRIGGER);
    const written = await renameCSharp(root, "OnBodyEntered", "HandleBody", { server, write: true });
    expect(written).toMatchObject({ written: true, journal: expect.any(Number) });
    expect(read(root, "scripts/AreaTriggerT.cs")).toContain("private void HandleBody(Node2D body)");
    expect(read(root, "main.tscn")).toContain('method="HandleBody"');
    expect(read(root, "main.tscn")).toContain('method="_on_triggered"');
    undoJournal(root);
    expect(read(root, "scripts/AreaTriggerT.cs")).toBe(TRIGGER);
    expect(read(root, "main.tscn")).toBe(SCENE);
    expect(read(root, "main.gd")).toBe(MAIN_GD);
  });

  it("renames a [Signal]: the delegate keeps EventHandler, scenes and GDScript get the bare name, generated uses follow the server", { timeout: 30_000 }, async () => {
    const root = csProject();
    const plan = await renameCSharp(root, "Triggered", "Fired", { server, write: true });
    expect(plan.from).toBe("Triggered");
    expect(plan.to).toBe("Fired");
    const trigger = read(root, "scripts/AreaTriggerT.cs");
    expect(trigger).toContain("public delegate void FiredEventHandler(Node2D body);");
    expect(trigger).toContain("EmitSignal(SignalName.Fired, body);");
    expect(read(root, "scripts/Other.cs")).toContain("t.Fired += OnTriggered;");
    expect(read(root, "main.tscn")).toContain('[connection signal="Fired" from="Trigger" to="." method="_on_triggered"]');
    expect(read(root, "main.gd")).toContain("$Trigger.Fired.connect(_on_triggered)");
    // The handler that only happens to contain the name is not touched.
    expect(read(root, "scripts/Other.cs")).toContain("private void OnTriggered(Node2D body)");
    expect(plan.skipped).toEqual([]);
  });

  it("lists generated uses the server cannot resolve, and changes nothing there", { timeout: 30_000 }, async () => {
    const root = csProject();
    process.env["FAKE_NO_GENERATED"] = "1";
    const plan = await renameCSharp(root, "TriggeredEventHandler", "Fired", { server });
    expect(plan.skipped.map((s) => `${s.file}:${s.line}`)).toEqual(expect.arrayContaining(["res://scripts/AreaTriggerT.cs:20"]));
    expect(plan.skipped.find((s) => s.line === 20)?.text).toContain("generated by Godot from TriggeredEventHandler");
    expect(plan.edits.find((e) => e.file === "res://scripts/AreaTriggerT.cs" && e.line === 20)).toBeUndefined();
  });

  it("renames an [Export]: the stored value in scenes whose node has the script, not a node without it", { timeout: 30_000 }, async () => {
    const root = csProject();
    await renameCSharp(root, "TargetGroup", "TargetTag", { server, write: true });
    const scene = read(root, "main.tscn");
    expect(scene).toContain('TargetTag = &"enemy"');
    expect(scene).toContain("TargetGroup = 3");
    expect(read(root, "main.gd")).toContain('$Trigger.TargetTag = &"boss"');
    expect(read(root, "scripts/AreaTriggerT.cs")).toContain("if (body.IsInGroup(TargetTag))");
  });

  it("renames a class with its file and .uid, and every scene that loads the file", { timeout: 30_000 }, async () => {
    const root = csProject();
    const plan = await renameCSharp(root, "AreaTriggerT", "ZoneTrigger", { server, write: true });
    expect(plan.moves).toEqual([
      { from: "res://scripts/AreaTriggerT.cs", to: "res://scripts/ZoneTrigger.cs" },
      { from: "res://scripts/AreaTriggerT.cs.uid", to: "res://scripts/ZoneTrigger.cs.uid" },
    ]);
    expect(existsSync(join(root, "scripts", "AreaTriggerT.cs"))).toBe(false);
    expect(read(root, "scripts/ZoneTrigger.cs")).toContain("public partial class ZoneTrigger : Area2D");
    expect(read(root, "scripts/Other.cs")).toContain("public void Use(ZoneTrigger t)");
    expect(read(root, "main.tscn")).toContain('path="res://scripts/ZoneTrigger.cs"');
    undoJournal(root);
    expect(read(root, "scripts/AreaTriggerT.cs")).toBe(TRIGGER);
    expect(read(root, "main.tscn")).toBe(SCENE);
  });

  it("refuses without a C# language server, for engine callbacks, keywords and names that are taken; writes nothing", async () => {
    const root = csProject();
    const saved = { PATH: process.env["PATH"], HOME: process.env["HOME"] };
    process.env["PATH"] = "/nonexistent";
    process.env["HOME"] = "/nonexistent";
    try {
      await expect(renameCSharp(root, "OnBodyEntered", "HandleBody", { write: true })).rejects.toThrow(/needs a C# language server: install csharp-ls with `dotnet tool install --global csharp-ls`.*does not rename C# by replacing text/);
    } finally {
      process.env["PATH"] = saved.PATH;
      process.env["HOME"] = saved.HOME;
    }
    await expect(renameCSharp(root, "_Ready", "Start", { server })).rejects.toThrow("a method Godot calls by that name");
    await expect(renameCSharp(root, "OnBodyEntered", "class", { server })).rejects.toThrow("is a C# keyword");
    await expect(renameCSharp(root, "OnBodyEntered", "TargetGroup", { server })).rejects.toThrow('"TargetGroup" is already declared');
    await expect(renameCSharp(root, "AreaTriggerT", "Other", { server })).rejects.toThrow('"Other" is already declared');
    expect(read(root, "scripts/AreaTriggerT.cs")).toBe(TRIGGER);
    expect(read(root, "main.tscn")).toBe(SCENE);
  });

  it("sends GDScript names to the GDScript rename, and reads both WorkspaceEdit forms", async () => {
    const root = csProject();
    const plan = await renameAnything(root, "_on_triggered", "_on_fired");
    expect(plan.edits.some((e) => e.file === "res://main.gd")).toBe(true);
    const edits = workspaceEdits({ documentChanges: [{ textDocument: { uri: "file:///p/A.cs", version: 3 }, edits: [{ range: { start: { line: 0, character: 4 }, end: { line: 0, character: 7 } }, newText: "Bar" }] }] });
    expect([...edits.keys()]).toEqual(["/p/A.cs"]);
    expect(applyTextEdits("var Foo = Foo;\n", [...edits.get("/p/A.cs")!, { range: { start: { line: 0, character: 10 }, end: { line: 0, character: 13 } }, newText: "Bar" }])).toBe("var Bar = Bar;\n");
    expect(() => workspaceEdits({ documentChanges: [{ kind: "rename", oldUri: "file:///a", newUri: "file:///b" }] })).toThrow(RenameError);
  });
});
