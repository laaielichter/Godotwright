import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { undoJournal } from "../src/journal/journal.js";
import { csharpPool } from "../src/lsp/csharp.js";
import { applyTextEdits, findCSharpDeclarations, renameAnywhere } from "../src/rename/csharp.js";
import { RenameError, formatRename, renameInProject } from "../src/rename/rename.js";
import { loadProject } from "../src/scan/scan.js";
import { fakeCSharpLs } from "./fake-csharp-ls.js";
import { makeProject, tempFolder } from "./helpers.js";

const PROJECT = 'config_version=5\n\n[application]\n\nconfig/name="Cs"\nconfig/features=PackedStringArray("4.7", "C#")\n\n[dotnet]\n\nproject/assembly_name="Cs"\n\n[input]\n\njump={\n"deadzone": 0.5,\n"events": []\n}\n';

const HELLO = `using Godot;

public partial class Hello : Node
{
	[Signal]
	public delegate void PingedEventHandler(int n);

	[Export]
	public int MaxHealth { get; set; } = 3;

	public void OnPinged(int n)
	{
		EmitSignal(SignalName.Pinged, MaxHealth);
		// Pinged, OnPinged and MaxHealth in a comment stay.
	}
}
`;
const BOSS = "using Godot;\n\npublic partial class Boss : Hello\n{\n}\n";
const USER = `using Godot;

public partial class User : Node
{
	public override void _Ready()
	{
		Hello hello = GetNode<Hello>("Hello");
		hello.Connect(Hello.SignalName.Pinged, Callable.From<int>(hello.OnPinged));
		hello.Call(Hello.MethodName.OnPinged, 1);
		hello.Call("OnPinged", 1);
		hello.Set(Hello.PropertyName.MaxHealth, 2);
		if (Input.IsActionPressed("jump")) hello.MaxHealth = 4;
	}
}
`;
// Another class with a signal, a method and a property of the same names: its scene must not change.
const OTHER = "using Godot;\n\npublic partial class Other : Node\n{\n}\n";
const HELLO_SCENE = `[gd_scene load_steps=2 format=3 uid="uid://chello"]

[ext_resource type="Script" path="res://Hello.cs" id="1"]

[node name="Hello" type="Node"]
script = ExtResource("1")
MaxHealth = 7

[node name="Child" type="Node" parent="."]

[connection signal="Pinged" from="." to="." method="OnPinged"]
`;
const MAIN_SCENE = `[gd_scene load_steps=5 format=3]

[ext_resource type="PackedScene" path="res://hello.tscn" id="1"]
[ext_resource type="Script" path="res://Boss.cs" id="2"]
[ext_resource type="Script" path="res://Other.cs" id="3"]
[ext_resource type="Script" path="res://caller.gd" id="4"]

[node name="Main" type="Node"]
script = ExtResource("4")

[node name="Inst" parent="." instance=ExtResource("1")]
MaxHealth = 9

[node name="Boss" type="Node" parent="."]
script = ExtResource("2")
MaxHealth = 11

[node name="Other" type="Node" parent="."]
script = ExtResource("3")
MaxHealth = 13

[connection signal="Pinged" from="Inst" to="Boss" method="OnPinged"]
[connection signal="Pinged" from="Other" to="Other" method="OnPinged"]
[connection signal="Pinged" from="Boss" to="." method="_on_pinged"]
`;
const STATS = `[gd_resource type="Resource" script_class="Stats" load_steps=2 format=3]

[ext_resource type="Script" path="res://Stats.cs" id="1"]

[resource]
script = ExtResource("1")
MaxHealth = 20
`;
const STATS_CS = "using Godot;\n\n[GlobalClass]\npublic partial class Stats : Resource\n{\n\t[Export]\n\tpublic int MaxHealth { get; set; } = 1;\n}\n";
const CALLER = `extends Node


func _ready() -> void:
	var hello: Node = $Inst
	hello.OnPinged(1)
	hello.Pinged.connect(_on_pinged)
	hello.connect("Pinged", _on_pinged)
	print(hello.MaxHealth)


func _on_pinged(_n: int) -> void:
	pass
`;

function project(extra: Record<string, string> = {}): string {
  return makeProject({
    "project.godot": PROJECT,
    "Cs.csproj": "<Project />",
    "Cs.sln": "",
    ".godot/mono/temp/obj/project.assets.json": "{}",
    "Hello.cs": HELLO,
    "Hello.cs.uid": "uid://chellocs\n",
    "Boss.cs": BOSS,
    "User.cs": USER,
    "Other.cs": OTHER,
    "hello.tscn": HELLO_SCENE,
    "main.tscn": MAIN_SCENE,
    "caller.gd": CALLER,
    ...extra,
  });
}

const cleanups: (() => unknown)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});
function server() {
  const fake = fakeCSharpLs();
  const pool = csharpPool();
  cleanups.push(() => pool.stopAll());
  return { csharpLs: fake.bin, pool };
}
const read = (root: string, file: string) => readFileSync(join(root, file), "utf8");
const changed = (plan: { edits: { file: string; line: number }[] }) => plan.edits.map((e) => `${e.file.slice(6)}:${e.line}`);

describe("rename of a C# symbol", () => {
  it("renames a signal: the delegate by the server, the generated names by the compiler, then scenes and GDScript", async () => {
    const root = project();
    const opts = server();
    const dry = await renameAnywhere(root, "Pinged", "Ponged", opts);
    expect(dry.written).toBe(false);
    expect(dry.csharp).toEqual({ kind: "signal", className: "Hello", file: "res://Hello.cs", generated: 2, problems: [] });
    expect(changed(dry)).toEqual([
      "Hello.cs:6", // the delegate: the language server
      "Hello.cs:13", // SignalName.Pinged: the compiler said it was gone
      "User.cs:8",
      "caller.gd:7",
      "caller.gd:8",
      "hello.tscn:11", // the connection of a node with the script
      "main.tscn:22", // from an instance of that scene, and
      "main.tscn:24", // from a node whose class inherits from Hello; line 23 (Other) is another class
    ]);
    expect(read(root, "Hello.cs")).toBe(HELLO);
    expect(formatRename(dry)).toContain("the C# code was renamed by the language server, and 2 uses of the names Godot generates for it followed");

    // Either form of the new name works.
    const wet = await renameAnywhere(root, "PingedEventHandler", "PongedEventHandler", { ...opts, write: true });
    expect(wet).toMatchObject({ written: true, to: "Ponged" });
    expect(read(root, "Hello.cs")).toContain("public delegate void PongedEventHandler(int n);");
    expect(read(root, "Hello.cs")).toContain("EmitSignal(SignalName.Ponged, MaxHealth);");
    expect(read(root, "Hello.cs")).toContain("// Pinged, OnPinged and MaxHealth in a comment stay.");
    expect(read(root, "User.cs")).toContain("hello.Connect(Hello.SignalName.Ponged, Callable.From<int>(hello.OnPinged));");
    expect(read(root, "hello.tscn")).toContain('[connection signal="Ponged" from="." to="." method="OnPinged"]');
    expect(read(root, "main.tscn")).toContain('[connection signal="Ponged" from="Inst" to="Boss" method="OnPinged"]\n[connection signal="Pinged" from="Other" to="Other" method="OnPinged"]\n[connection signal="Ponged" from="Boss" to="." method="_on_pinged"]');
    expect(read(root, "caller.gd")).toContain('hello.Ponged.connect(_on_pinged)\n\thello.connect("Ponged", _on_pinged)');

    // One journal entry: undo puts every file back.
    expect(undoJournal(root).undone).toHaveLength(1);
    for (const [file, text] of Object.entries({ "Hello.cs": HELLO, "User.cs": USER, "hello.tscn": HELLO_SCENE, "main.tscn": MAIN_SCENE, "caller.gd": CALLER })) expect(read(root, file), file).toBe(text);
  });

  it("renames a method with its scene connections, and lists strings it cannot be sure of", async () => {
    const root = project();
    const plan = await renameAnywhere(root, "OnPinged", "OnPonged", { ...server(), write: true });
    expect(plan.csharp).toMatchObject({ kind: "method", generated: 1 });
    expect(read(root, "Hello.cs")).toContain("public void OnPonged(int n)");
    expect(read(root, "User.cs")).toContain("hello.Call(Hello.MethodName.OnPonged, 1);");
    expect(read(root, "User.cs")).toContain('hello.Call("OnPinged", 1);');
    expect(plan.skipped).toEqual([{ file: "res://User.cs", line: 10, kind: "string", text: 'hello.Call("OnPinged", 1);' }]);
    expect(read(root, "hello.tscn")).toContain('method="OnPonged"');
    expect(read(root, "main.tscn")).toContain('to="Boss" method="OnPonged"]\n[connection signal="Pinged" from="Other" to="Other" method="OnPinged"]');
    expect(read(root, "caller.gd")).toContain("hello.OnPonged(1)");
  });

  it("renames an exported property where scenes and resources store it", async () => {
    const root = project({ "Stats.cs": STATS_CS, "stats.tres": STATS });
    const opts = server();
    // Two classes declare MaxHealth: the file says which.
    await expect(renameAnywhere(root, "MaxHealth", "TopHealth", opts)).rejects.toThrow(/"MaxHealth" is declared 2 times in C#: property in Hello \(res:\/\/Hello\.cs:9\), property in Stats \(res:\/\/Stats\.cs:7\)\. Pass file/);
    const plan = await renameAnywhere(root, "MaxHealth", "TopHealth", { ...opts, file: "res://Hello.cs", write: true });
    expect(plan.csharp).toMatchObject({ kind: "property", className: "Hello" });
    expect(read(root, "hello.tscn")).toContain('script = ExtResource("1")\nTopHealth = 7');
    // The instance and the inheriting class follow; the other class and the resource of another class do not.
    expect(read(root, "main.tscn")).toContain('instance=ExtResource("1")]\nTopHealth = 9');
    expect(read(root, "main.tscn")).toContain('script = ExtResource("2")\nTopHealth = 11');
    expect(read(root, "main.tscn")).toContain('script = ExtResource("3")\nMaxHealth = 13');
    expect(read(root, "stats.tres")).toBe(STATS);
    expect(read(root, "caller.gd")).toContain("print(hello.TopHealth)");
    // A resource with the script of the class (the fake server renames by word, so this is a project of its own).
    const other = makeProject({ "project.godot": PROJECT, "Cs.csproj": "<Project />", ".godot/mono/temp/obj/project.assets.json": "{}", "Stats.cs": STATS_CS, "stats.tres": STATS });
    const stats = await renameAnywhere(other, "MaxHealth", "Cap", { ...opts, file: "Stats.cs", write: true });
    expect(changed(stats)).toEqual(["Stats.cs:7", "stats.tres:7"]);
    expect(read(other, "stats.tres")).toContain('script = ExtResource("1")\nCap = 20');
  });

  it("moves the file of a script class with it, and every path to it", async () => {
    const root = project();
    const plan = await renameAnywhere(root, "Hello", "Howdy", { ...server(), write: true });
    expect(plan.moves).toEqual([
      { from: "res://Hello.cs", to: "res://Howdy.cs" },
      { from: "res://Hello.cs.uid", to: "res://Howdy.cs.uid" },
    ]);
    expect(existsSync(join(root, "Hello.cs"))).toBe(false);
    expect(read(root, "Howdy.cs")).toContain("public partial class Howdy : Node");
    expect(read(root, "Howdy.cs.uid")).toBe("uid://chellocs\n");
    expect(read(root, "Boss.cs")).toContain("public partial class Boss : Howdy");
    expect(read(root, "hello.tscn")).toContain('[ext_resource type="Script" path="res://Howdy.cs" id="1"]');
    // The node named Hello and the string "Hello" are not the class.
    expect(read(root, "hello.tscn")).toContain('[node name="Hello" type="Node"]');
    undoJournal(root);
    expect(read(root, "Hello.cs")).toBe(HELLO);
    expect(existsSync(join(root, "Howdy.cs"))).toBe(false);
  });

  it("shows what would not compile and refuses the write", async () => {
    // A second part of the class, further down the file, already has a Tick: the name check reads one part, the
    // compiler the whole class (the fake one reports CS0111 for a method declared twice in a file).
    const parts = `${HELLO}\npublic partial class Hello\n{\n\tpublic void Tick(int n) { }\n}\n`;
    const root = project({ "Hello.cs": parts });
    const opts = server();
    const dry = await renameAnywhere(root, "OnPinged", "Tick", opts);
    expect(dry.csharp?.problems).toEqual([
      "res://Hello.cs:11: CS0111: Type already defines a member called 'Tick' with the same parameter types",
      "res://Hello.cs:20: CS0111: Type already defines a member called 'Tick' with the same parameter types",
    ]);
    expect(formatRename(dry)).toContain("WOULD NOT COMPILE res://Hello.cs:11: CS0111");
    await expect(renameAnywhere(root, "OnPinged", "Tick", { ...opts, write: true })).rejects.toThrow(/would leave 2 compile errors the rename cannot fix, so nothing was written/);
    expect(read(root, "Hello.cs")).toBe(parts);
    expect(read(root, "hello.tscn")).toBe(HELLO_SCENE);
    expect(read(root, "caller.gd")).toBe(CALLER);
  });

  it("never falls back to replacing text: without csharp-ls it refuses with the install command", async () => {
    const root = project();
    const saved = process.env["CSHARP_LS"];
    process.env["CSHARP_LS"] = join(tempFolder("no-ls-"), "csharp-ls");
    const pool = csharpPool();
    cleanups.push(() => pool.stopAll());
    try {
      for (const write of [false, true]) {
        const error = await renameAnywhere(root, "OnPinged", "OnPonged", { pool, write }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(RenameError);
        expect((error as Error).message).toMatch(/"OnPinged" is a C# method \(res:\/\/Hello\.cs:11\) and renaming C# code needs the C# language server; nothing was changed\..*dotnet tool install --global csharp-ls/);
      }
    } finally {
      if (saved === undefined) delete process.env["CSHARP_LS"];
      else process.env["CSHARP_LS"] = saved;
    }
    // The GDScript rename does not touch C# code either.
    expect(() => renameInProject(root, "OnPinged", "OnPonged", { write: true })).toThrow(/is declared in C# \(res:\/\/Hello\.cs:11\); a C# symbol is renamed through the C# language server, not as text/);
    for (const [file, text] of Object.entries({ "Hello.cs": HELLO, "User.cs": USER, "hello.tscn": HELLO_SCENE, "main.tscn": MAIN_SCENE, "caller.gd": CALLER })) expect(read(root, file), file).toBe(text);
  });

  it("still renames what is not C#, with strings in C# code that Godot looks up", async () => {
    const root = project();
    // An input action: no language server is needed (CSHARP_LS points nowhere).
    const plan = await renameAnywhere(root, "jump", "leap", { csharpLs: "/nonexistent/csharp-ls", write: true });
    expect(plan.csharp).toBeUndefined();
    expect(read(root, "User.cs")).toContain('Input.IsActionPressed("leap")');
    expect(read(root, "project.godot")).toContain("leap={");
    // A GDScript function used nowhere in C# renames as before.
    const gd = await renameAnywhere(root, "_on_pinged", "_on_ping", { write: true });
    expect(gd.csharp).toBeUndefined();
    expect(read(root, "caller.gd")).toContain("func _on_ping(_n: int) -> void:");
  });

  it("refuses names it cannot rename", async () => {
    const root = project({ "Hello.cs": HELLO.replace("\tpublic void OnPinged(int n)", "\tpublic override void _Ready() { }\n\n\tpublic void OnPinged() { }\n\n\tpublic void OnPinged(int n)") });
    const opts = server();
    await expect(renameAnywhere(root, "OnPinged", "X", opts)).rejects.toThrow("Hello.OnPinged has 2 overloads");
    await expect(renameAnywhere(root, "_Ready", "Start", { ...opts, file: "res://Hello.cs" })).rejects.toThrow("overrides a method of its base class");
    await expect(renameAnywhere(root, "MaxHealth", "class", opts)).rejects.toThrow('"class" is a C# keyword');
    await expect(renameAnywhere(root, "MaxHealth", "max-health", opts)).rejects.toThrow("is not a C# name");
    await expect(renameAnywhere(root, "Pinged", "PingedEventHandler", opts)).rejects.toThrow("the new name is the same as the old one");
    await expect(renameAnywhere(root, "Hello", "Boss", opts)).rejects.toThrow("a class named Boss already exists");
    await expect(renameAnywhere(root, "Nope", "X", { ...opts, file: "res://Hello.cs" })).rejects.toThrow('res://Hello.cs does not declare "Nope"');
    await expect(renameAnywhere(root, "MaxHealth", "X", { ...opts, file: "res://caller.gd" })).rejects.toThrow("file is for a C# symbol");
  });
});

describe("C# rename helpers", () => {
  it("finds declarations by name, a signal by either form", () => {
    const data = loadProject(project());
    expect(findCSharpDeclarations(data, "Pinged").map((t) => [t.kind, t.identifier, t.name, t.line, t.column])).toEqual([["signal", "PingedEventHandler", "Pinged", 6, 23]]);
    expect(findCSharpDeclarations(data, "PingedEventHandler")).toHaveLength(1);
    expect(findCSharpDeclarations(data, "MaxHealth").map((t) => [t.kind, t.line, t.column])).toEqual([["property", 9, 13]]);
    expect(findCSharpDeclarations(data, "Hello").map((t) => [t.kind, t.file, t.line, t.column])).toEqual([["class", "res://Hello.cs", 3, 22]]);
    expect(findCSharpDeclarations(data, "jump")).toEqual([]);
  });

  it("applies text edits from the end, in UTF-16 units", () => {
    const edit = (line: number, a: number, b: number, newText: string) => ({ range: { start: { line, character: a }, end: { line, character: b } }, newText });
    expect(applyTextEdits("ab\ncd é ef\n", [edit(0, 0, 1, "X"), edit(1, 5, 7, "YZ!"), edit(1, 0, 2, "")])).toBe("Xb\n é YZ!\n");
  });
});
