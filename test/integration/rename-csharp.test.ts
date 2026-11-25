import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCSharp, findDotnet } from "../../src/check/csharp-build.js";
import { undoJournal } from "../../src/journal/journal.js";
import { csharpPool, findCSharpLs } from "../../src/lsp/csharp.js";
import { renameAnywhere } from "../../src/rename/csharp.js";
import { generatedCSharpProject } from "../csharp-helpers.js";

/**
 * Needs the .NET SDK and csharp-ls, and NuGet for the first build. No Godot. Ran with dotnet 8.0.134, Godot.NET.Sdk
 * 4.7.0 and csharp-ls 0.16.0: after every rename the project is built with the real compiler.
 */
const READY = Boolean(findDotnet() && findCSharpLs());

const HELLO = `using Godot;

public partial class Hello : Node
{
	[Signal]
	public delegate void PingedEventHandler(int n);

	[Export]
	public int MaxHealth { get; set; } = 3;

	public override void _Ready()
	{
		GD.Print($"hello {MaxHealth}");
		EmitSignal(SignalName.Pinged, MaxHealth);
		EmitSignalPinged(1);
	}

	public void OnPinged(int n)
	{
	}
}
`;
const USER = `using Godot;

public partial class User : Node
{
	private Hello _hello;

	public override void _Ready()
	{
		_hello = GetNode<Hello>("Hello");
		_hello.Pinged += OnPinged;
		_hello.Connect(Hello.SignalName.Pinged, Callable.From<int>(OnPinged));
		_hello.Set(Hello.PropertyName.MaxHealth, 4);
		_hello.Call(Hello.MethodName.OnPinged, 5);
		_hello.Call("OnPinged", 5);
		_hello.MaxHealth = 9;
	}

	private void OnPinged(int n)
	{
	}
}
`;
const SCENE = `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://scripts/Hello.cs" id="1"]

[node name="Hello" type="Node"]
script = ExtResource("1")
MaxHealth = 7

[connection signal="Pinged" from="." to="." method="OnPinged"]
`;
const CALLER = "extends Node\n\n\nfunc _ready() -> void:\n\tvar h: Node = $Hello\n\th.OnPinged(2)\n\th.Pinged.connect(func(n: int) -> void: print(n))\n\tprint(h.MaxHealth)\n";

describe.skipIf(!READY)("godot_rename on C# with the real csharp-ls and dotnet build", () => {
  const pool = csharpPool();
  let root = "";
  const read = (file: string) => readFileSync(join(root, file), "utf8");
  const builds = async () => {
    const built = await buildCSharp(root);
    expect(built.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(built.status).toBe("ok");
  };

  beforeAll(async () => {
    root = generatedCSharpProject();
    writeFileSync(join(root, "scripts", "Hello.cs"), HELLO);
    writeFileSync(join(root, "scripts", "User.cs"), USER);
    writeFileSync(join(root, "hello.tscn"), SCENE);
    writeFileSync(join(root, "caller.gd"), CALLER);
    await builds();
  }, 300_000);
  afterAll(() => pool.stopAll());

  it("renames a signal, a method, a property and a script class, and the project still builds after each", { timeout: 480_000 }, async () => {
    const signal = await renameAnywhere(root, "Pinged", "Ponged", { pool, write: true });
    // Four names the source generators made followed: the event, two SignalName.Pinged and EmitSignalPinged.
    expect(signal.csharp).toMatchObject({ kind: "signal", generated: 4, problems: [] });
    expect(read("scripts/Hello.cs")).toContain("public delegate void PongedEventHandler(int n);");
    expect(read("scripts/Hello.cs")).toContain("EmitSignal(SignalName.Ponged, MaxHealth);\n\t\tEmitSignalPonged(1);");
    expect(read("scripts/User.cs")).toContain("_hello.Ponged += OnPinged;\n\t\t_hello.Connect(Hello.SignalName.Ponged, Callable.From<int>(OnPinged));");
    expect(read("hello.tscn")).toContain('[connection signal="Ponged" from="." to="." method="OnPinged"]');
    expect(read("caller.gd")).toContain("h.Ponged.connect(");
    await builds();

    // Two classes have an OnPinged: the file says which. User's own OnPinged stays.
    await expect(renameAnywhere(root, "OnPinged", "OnPonged", { pool })).rejects.toThrow(/declared 2 times in C#/);
    const method = await renameAnywhere(root, "OnPinged", "OnPonged", { pool, file: "res://scripts/Hello.cs", write: true });
    expect(method.csharp).toMatchObject({ kind: "method", generated: 1 });
    expect(method.skipped).toEqual([{ file: "res://scripts/User.cs", line: 14, kind: "string", text: '_hello.Call("OnPinged", 5);' }]);
    expect(read("scripts/User.cs")).toContain("_hello.Call(Hello.MethodName.OnPonged, 5);");
    expect(read("scripts/User.cs")).toContain("_hello.Ponged += OnPinged;");
    expect(read("scripts/User.cs")).toContain("private void OnPinged(int n)");
    expect(read("hello.tscn")).toContain('method="OnPonged"');
    await builds();

    const property = await renameAnywhere(root, "MaxHealth", "TopHealth", { pool, write: true });
    expect(property.csharp).toMatchObject({ kind: "property", generated: 1 });
    expect(read("scripts/User.cs")).toContain("_hello.Set(Hello.PropertyName.TopHealth, 4);");
    expect(read("scripts/User.cs")).toContain("_hello.TopHealth = 9;");
    expect(read("hello.tscn")).toContain("TopHealth = 7");
    expect(read("caller.gd")).toContain("print(h.TopHealth)");
    await builds();

    const cls = await renameAnywhere(root, "Hello", "Howdy", { pool, write: true });
    expect(cls.moves[0]).toEqual({ from: "res://scripts/Hello.cs", to: "res://scripts/Howdy.cs" });
    expect(read("scripts/Howdy.cs")).toContain("public partial class Howdy : Node");
    expect(read("scripts/User.cs")).toContain('_hello = GetNode<Howdy>("Hello");');
    expect(read("hello.tscn")).toContain('path="res://scripts/Howdy.cs"');
    await builds();

    // Four journal entries: undo brings back the project as it was, and that builds too.
    for (let i = 0; i < 4; i++) undoJournal(root);
    expect(read("scripts/Hello.cs")).toBe(HELLO);
    expect(read("scripts/User.cs")).toBe(USER);
    expect(read("hello.tscn")).toBe(SCENE);
    expect(read("caller.gd")).toBe(CALLER);
    expect(existsSync(join(root, "scripts", "Howdy.cs"))).toBe(false);
    await builds();
  });

  it("shows the compiler's errors and writes nothing when a rename would not compile", { timeout: 240_000 }, async () => {
    // Another part of the class, in another file, has a method of the new name.
    writeFileSync(join(root, "scripts", "Part.cs"), "public partial class Hello\n{\n\tpublic void TopHealth()\n\t{\n\t}\n}\n");
    const dry = await renameAnywhere(root, "MaxHealth", "TopHealth", { pool });
    expect(dry.written).toBe(false);
    expect(dry.csharp?.problems.length).toBeGreaterThan(0);
    expect(dry.csharp?.problems.join("\n")).toMatch(/CS0102|CS0111|TopHealth/);
    await expect(renameAnywhere(root, "MaxHealth", "TopHealth", { pool, write: true })).rejects.toThrow(/so nothing was written/);
    expect(read("scripts/Hello.cs")).toBe(HELLO);
    expect(read("hello.tscn")).toBe(SCENE);
  });
});
