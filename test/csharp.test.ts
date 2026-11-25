import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkProject } from "../src/check/check.js";
import { buildCSharp, findCSharpProject, findDotnet, isRestored, parseMsbuildOutput } from "../src/check/csharp-build.js";
import { buildGraph } from "../src/deps/deps.js";
import { allClasses, maskCSharp, outlineCSharp, pascalToSnake, sameGodotName, scriptClass, snakeToPascal } from "../src/godot/csharp.js";
import { reviewProject } from "../src/review/review.js";
import { RULES } from "../src/review/rules.js";
import { ScaffoldError } from "../src/scaffold/error.js";
import { csprojText, newProject, sanitizeNamespace, slnText } from "../src/scaffold/project.js";
import { CSHARP_TEMPLATES, csharpTemplateText, formatNewScript, newScript } from "../src/scaffold/script.js";
import { csharpClassIndex, resolveCSharpClass } from "../src/scan/csharp.js";
import { formatProjectMap } from "../src/scan/format.js";
import { loadProject, scanProject } from "../src/scan/scan.js";
import { SceneError, csharpScriptInfo, editScene } from "../src/scene/edit.js";
import { findUsages } from "../src/usages/usages.js";
import { fakeGodot } from "./fake-godot.js";
import { makeProject, tempFolder } from "./helpers.js";

const PROJECT = '; Engine configuration file.\n\nconfig_version=5\n\n[application]\n\nconfig/name="CsDemo"\nrun/main_scene="res://Main.tscn"\nconfig/features=PackedStringArray("4.7", "C#")\n\n[dotnet]\n\nproject/assembly_name="CsDemo"\n\n[input]\n\njump={\n"deadzone": 0.5,\n"events": []\n}\nmove_left={\n"deadzone": 0.5,\n"events": []\n}\nmove_right={\n"deadzone": 0.5,\n"events": []\n}\n';

const PLAYER = `using Godot;
using System.Collections.Generic;

namespace Game.Actors;

/// A player. "Not a string", // not a comment in a doc comment
[GlobalClass, Tool]
[Icon("res://icon.svg")]
public partial class Player : CharacterBody2D, IDamageable
{
	[Signal]
	public delegate void HealthChangedEventHandler(int current, int max);

	[Signal] public delegate void DiedEventHandler();

	[ExportCategory("Stats")]
	[ExportGroup("Movement")]
	[Export(PropertyHint.Range, "0,1000,10")]
	public float Speed { get; set; } = 300.0f;

	[Export] public int MaxHealth = 10;

	[ExportGroup("Scenes")]
	[Export]
	private PackedScene _bulletScene;

	[Export] public Godot.Collections.Array<NodePath> Targets { get; set; } = new();

	public int Health => _health;
	private int _health;
	private readonly Dictionary<string, List<int>> _table = new() { { "a", new List<int> { 1, 2 } } };
	private static readonly PackedScene Explosion = GD.Load<PackedScene>("res://fx/explosion.tscn");
	private string _verbatim = @"C:\\path ""quoted"" { not a brace // not a comment";
	private string _raw = """
		class Fake { void Nope() { GetNode("Nope"); } }
		""";
	private char _quote = '"';
	private char _brace = '{';

#if TOOLS
	private const string Mode = "editor";
#else
	private const string Mode = "game"; } } }
#endif

	#region Callbacks
	public override void _Ready()
	{
		var sprite = GetNode<Sprite2D>("Sprite2D");
		var hud = GetNodeOrNull<Control>("../HUD");
		var bar = GetNode<ProgressBar>("%HealthBar");
		var timer = GetNode<Timer>("Timer");
		timer.Timeout += OnTimeout;
		GetNode<Button>("UI/Button").Pressed += () => GD.Print($"pressed {Name} {{literal}} {(_health > 0 ? "alive" : "dead")}");
		Connect(SignalName.Died, Callable.From(OnDied));
		AddToGroup("players");
		_health += MaxHealth;
	}

	public override void _PhysicsProcess(double delta)
	{
		Vector2 velocity = Velocity;
		if (Input.IsActionJustPressed("jump") && IsOnFloor()) velocity.Y = -400;
		float axis = Input.GetAxis("move_left", "move_right");
		velocity.X = axis * Speed;
		Velocity = velocity;
		MoveAndSlide();
	}

	public override void _UnhandledInput(InputEvent @event)
	{
		if (@event.IsActionPressed("ui_cancel")) GetTree().Quit();
	}
	#endregion

	[Rpc(MultiplayerApi.RpcMode.AnyPeer, CallLocal = true)]
	public void TakeDamage(int amount, bool crit = false)
	{
		_health -= amount;
		EmitSignal(SignalName.HealthChanged, _health, MaxHealth);
		if (_health <= 0) EmitSignal(SignalName.Died);
		/* GetNode("InBlockComment"); */
	}

	public static T Pick<T>(IReadOnlyList<T> items, int index = 0) where T : class => items[index];

	private async void OnTimeout()
	{
		await ToSignal(GetTree().CreateTimer(1.0), SceneTreeTimer.SignalName.Timeout);
		var scene = ResourceLoader.Load<PackedScene>("res://bullet.tscn");
		var other = GetParent().GetNode<Node2D>("Elsewhere");
		if (IsInGroup("enemies")) Rpc(MethodName.TakeDamage, 1, false);
	}

	private void OnDied() { }

	private (int, string) Pair(int a) => (a, "x");

	public static Player operator +(Player a, int b) => a;

	private sealed class State
	{
		public int Frames;
		public void Tick() { Frames++; }
	}

	public record struct Hit(int Damage, Vector2 At);
}

public interface IDamageable { void TakeDamage(int amount, bool crit = false); }

public enum Team { Red, Blue }
`;

describe("C# outline", () => {
  const outline = outlineCSharp(PLAYER);
  const player = outline.classes[0]!;

  it("reads the namespace, usings, class, base, attributes and nested types", () => {
    expect(outline.namespace).toBe("Game.Actors");
    expect(outline.usings).toEqual(["Godot", "System.Collections.Generic"]);
    expect(outline.classes.map((c) => `${c.kind} ${c.name}`)).toEqual(["class Player", "interface IDamageable"]);
    expect(player).toMatchObject({ name: "Player", namespace: "Game.Actors", base: "CharacterBody2D", interfaces: ["IDamageable"], partial: true, globalClass: true, tool: true, icon: "res://icon.svg", line: 9 });
    expect(player.nested.map((c) => `${c.kind} ${c.name}`)).toEqual(["class State", "record Hit"]);
    expect(player.nested[0]!.methods.map((m) => m.name)).toEqual(["Tick"]);
    expect(scriptClass(outline, "res://actors/Player.cs")).toBe(player);
    expect(scriptClass(outline, "res://actors/Hero.cs")).toBeUndefined();
    expect(allClasses(outline)).toHaveLength(4);
  });

  it("reads [Export] properties and fields with type, hint, group and category", () => {
    expect(player.exports.map((e) => ({ name: e.name, type: e.type, kind: e.kind, hint: e.hint, group: e.group, category: e.category }))).toEqual([
      { name: "Speed", type: "float", kind: "property", hint: 'PropertyHint.Range, "0,1000,10"', group: "Movement", category: "Stats" },
      { name: "MaxHealth", type: "int", kind: "field", hint: undefined, group: "Movement", category: "Stats" },
      { name: "_bulletScene", type: "PackedScene", kind: "field", hint: undefined, group: "Scenes", category: "Stats" },
      { name: "Targets", type: "Godot.Collections.Array<NodePath>", kind: "property", hint: undefined, group: "Scenes", category: "Stats" },
    ]);
    // Members that are not exported are members all the same; code in strings is not.
    expect(player.members.map((m) => m.name)).toEqual(["Speed", "MaxHealth", "_bulletScene", "Targets", "Health", "_health", "_table", "Explosion", "_verbatim", "_raw", "_quote", "_brace", "Mode"]);
    expect(player.members.find((m) => m.name === "_table")!.type).toBe("Dictionary<string, List<int>>");
  });

  it("reads [Signal] delegates as signals without EventHandler", () => {
    expect(player.signals).toEqual([
      { name: "HealthChanged", delegate: "HealthChangedEventHandler", params: [{ name: "current", type: "int", hasDefault: false }, { name: "max", type: "int", hasDefault: false }], line: 12 },
      { name: "Died", delegate: "DiedEventHandler", params: [], line: 14 },
    ]);
  });

  it("reads methods with parameters, return type, modifiers and lines", () => {
    expect(player.methods.map((m) => m.name)).toEqual(["_Ready", "_PhysicsProcess", "_UnhandledInput", "TakeDamage", "Pick", "OnTimeout", "OnDied", "Pair"]);
    expect(player.callbacks).toEqual(["_Ready", "_PhysicsProcess", "_UnhandledInput"]);
    const byName = Object.fromEntries(player.methods.map((m) => [m.name, m]));
    expect(byName["_PhysicsProcess"]).toMatchObject({ returnType: "void", override: true, static: false, async: false, params: [{ name: "delta", type: "double", hasDefault: false }] });
    expect(byName["_UnhandledInput"]!.params).toEqual([{ name: "@event", type: "InputEvent", hasDefault: false }]);
    expect(byName["TakeDamage"]).toMatchObject({ rpc: "MultiplayerApi.RpcMode.AnyPeer, CallLocal = true", params: [{ name: "amount", type: "int", hasDefault: false }, { name: "crit", type: "bool", hasDefault: true }] });
    expect(byName["Pick"]).toMatchObject({ static: true, returnType: "T", params: [{ name: "items", type: "IReadOnlyList<T>", hasDefault: false }, { name: "index", type: "int", hasDefault: true }] });
    expect(byName["OnTimeout"]).toMatchObject({ async: true, returnType: "void" });
    expect(byName["Pair"]!.returnType).toBe("(int, string)");
    expect(PLAYER.split("\n")[byName["_Ready"]!.line - 1]).toContain("void _Ready()");
    expect(PLAYER.split("\n")[byName["_Ready"]!.endLine - 1]!.trim()).toBe("}");
  });

  it("finds the calls that tie the script to the project", () => {
    const of = (kind: string) => outline.usages.filter((u) => u.kind === kind).map((u) => `${u.name}${u.type ? `<${u.type}>` : ""}${u.self === false ? " other" : ""}${u.optional ? " optional" : ""} @${u.method ?? "-"}`);
    expect(of("node")).toEqual(["Sprite2D<Sprite2D> @_Ready", "../HUD<Control> optional @_Ready", "Timer<Timer> @_Ready", "UI/Button<Button> @_Ready", "Elsewhere<Node2D> other @OnTimeout"]);
    expect(of("unique node")).toEqual(["HealthBar<ProgressBar> @_Ready"]);
    expect(of("load")).toEqual(["res://fx/explosion.tscn<PackedScene> @-", "res://bullet.tscn<PackedScene> @OnTimeout"]);
    expect(of("path")).toEqual(["res://icon.svg @-"]);
    expect(of("connect")).toEqual(["Timeout other @_Ready", "Pressed other @_Ready", "Died @_Ready"]);
    expect(of("emit")).toEqual(["HealthChanged @TakeDamage", "Died @TakeDamage"]);
    expect(of("input action")).toEqual(["jump @_PhysicsProcess", "move_left @_PhysicsProcess", "move_right @_PhysicsProcess", "ui_cancel @_UnhandledInput"]);
    expect(of("group")).toEqual(["players @_Ready", "enemies @OnTimeout"]);
    expect(of("rpc")).toEqual(["TakeDamage @-", "TakeDamage @OnTimeout"]);
    // `_health += MaxHealth` is arithmetic, and nothing is read from strings or comments.
    expect(outline.usages.some((u) => /Nope|InBlockComment|_health/.test(u.name))).toBe(false);
  });

  it("blanks strings, comments and inactive #if branches at the same length", () => {
    const masked = maskCSharp(PLAYER);
    expect(masked.code).toHaveLength(PLAYER.length);
    expect(masked.code.split("\n")).toHaveLength(PLAYER.split("\n").length);
    expect(masked.code).not.toMatch(/Nope|InBlockComment|not a brace|"game"|#if|#region/);
    expect(masked.code).toContain('private const string Mode = "      ";');
    expect(masked.text).toContain('GetNode<Sprite2D>("Sprite2D")');
    expect(masked.text).not.toContain("InBlockComment");
    const values = [...masked.literals.values()].map((l) => l.value);
    expect(values).toContain('C:\\path "quoted" { not a brace // not a comment');
    expect(values.find((v) => v.includes("class Fake"))).toBe('\t\tclass Fake { void Nope() { GetNode("Nope"); } }');
    expect([...masked.literals.values()].find((l) => l.interpolated)!.value).toContain('{(_health > 0 ? "alive" : "dead")}');
  });

  it("copes with block namespaces, records, generics, primary constructors and broken code", () => {
    const o = outlineCSharp(
      [
        "namespace A.B {",
        "  namespace C {",
        "    public abstract partial class Pool<T> : Node where T : Node, new() {",
        "      public abstract T Make();",
        "      protected virtual void Reset(T item) { }",
        "      public T this[int i] => default;",
        "      public event System.Action<T> Made;",
        "    }",
        "    public sealed record Save(string Name, int Level) : Resource;",
        "    public partial class Enemy(int hp) : Base(hp), IThing { public int Hp { get; init; } = hp; }",
        "    internal static class Ext { public static void Hide(this Node node, params string[] names) { } }",
        "    public readonly struct Cell { public readonly int X; }",
        "  }",
        "}",
      ].join("\n"),
    );
    expect(o.classes.map((c) => `${c.namespace} ${c.kind} ${c.name}${c.generic ? "<>" : ""} : ${c.base ?? "-"}`)).toEqual(["A.B.C class Pool<> : Node", "A.B.C record Save : Resource", "A.B.C class Enemy : Base", "A.B.C class Ext : -", "A.B.C struct Cell : -"]);
    expect(o.classes[0]).toMatchObject({ abstract: true, partial: true });
    expect(o.classes[0]!.methods.map((m) => `${m.name}:${m.hasBody}`)).toEqual(["Make:false", "Reset:true"]);
    expect(o.classes[0]!.members.map((m) => m.name)).toEqual(["Made"]);
    expect(o.classes[2]).toMatchObject({ interfaces: ["IThing"] });
    expect(o.classes[3]!.methods[0]!.params).toEqual([{ name: "node", type: "Node", hasDefault: false, modifier: "this" }, { name: "names", type: "string[]", hasDefault: false, modifier: "params" }]);
    // Unbalanced, unterminated and empty input: an outline, never an exception.
    for (const text of ["", "}}}", "public partial class A : Node { void F( {", 'class B { string s = "open', "class C { /* open", "#if X\nclass D {\n#else\nclass D {\n#endif\n}", "var x = 1; System.Console.WriteLine(x);", "$\"{a[\"b\"]}\""]) {
      expect(() => outlineCSharp(text)).not.toThrow();
    }
    expect(outlineCSharp("#if X\npartial class D : Node {\n#else\nclass D {\n#endif\n void F() { }\n}").classes[0]).toMatchObject({ name: "D", partial: true });
  });

  it("maps names the way Godot does", () => {
    expect(pascalToSnake("BodyEntered")).toBe("body_entered");
    expect(pascalToSnake("_PhysicsProcess")).toBe("_physics_process");
    expect(pascalToSnake("GetGlobalTransform2D")).toBe("get_global_transform_2d".replace("_2d", "2d"));
    expect(snakeToPascal("_unhandled_input")).toBe("_UnhandledInput");
    expect(snakeToPascal("is_on_floor")).toBe("IsOnFloor");
    expect(sameGodotName("BodyEntered", "body_entered")).toBe(true);
    expect(sameGodotName("_Ready", "_ready")).toBe(true);
    expect(sameGodotName("Speed", "speed")).toBe(true);
    expect(sameGodotName("BodyEntered", "body_exited")).toBe(false);
  });
});

const MAIN_SCENE = `[gd_scene load_steps=3 format=3 uid="uid://c1aaaaaaaaaa1"]

[ext_resource type="Script" path="res://Main.cs" id="1_main"]
[ext_resource type="Script" path="res://Player.cs" id="2_player"]

[node name="Main" type="Node2D"]
script = ExtResource("1_main")

[node name="Player" type="CharacterBody2D" parent="."]
script = ExtResource("2_player")
Speed = 250.0

[node name="Sprite2D" type="Sprite2D" parent="Player"]

[node name="Timer" type="Timer" parent="Player"]

[node name="HealthBar" type="ProgressBar" parent="."]
unique_name_in_owner = true

[node name="Button" type="Button" parent="."]

[connection signal="HealthChanged" from="Player" to="." method="OnPlayerHealthChanged"]
`;

const MAIN_CS = `using Godot;

public partial class Main : Node2D
{
	[Export] public PackedScene MobScene { get; set; }

	public override void _Ready()
	{
		GetNode<Button>("Button").Pressed += OnButtonPressed;
		var bar = GetNode<ProgressBar>("%HealthBar");
	}

	private void OnButtonPressed() { }
	private void OnPlayerHealthChanged(int current, int max) { }
	private void OnTimerTimeout() { }
	private void NeedsTwo(int a, int b) { }
}
`;

const PLAYER_CS = `using Godot;

public partial class Player : Actor
{
	[Export] public float Speed { get; set; } = 300.0f;
	[Export] public Texture2D Portrait { get; set; }

	public override void _Ready()
	{
		GetNode<Timer>("Timer").Start();
		GetNode<Sprite2D>("Sprite2D").Show();
		if (Input.IsActionJustPressed("jump")) GD.Load<PackedScene>("res://Mob.tscn");
	}
}
`;

const ACTOR_CS = `using Godot;

public partial class Actor : CharacterBody2D
{
	[Signal] public delegate void HealthChangedEventHandler(int current, int max);
	[Export] public int MaxHealth { get; set; } = 10;
	public void Heal(int amount = 1) { }
}
`;

const PLAYER_PART_CS = `public partial class Player
{
	private void OnAreaEntered(Area2D area) { }
}
`;

const MOB_SCENE = '[gd_scene format=3 uid="uid://c1aaaaaaaaaa2"]\n\n[node name="Mob" type="Node2D"]\n';

function csProject(extra: Record<string, string> = {}): string {
  return makeProject({ "project.godot": PROJECT, "Main.tscn": MAIN_SCENE, "Main.cs": MAIN_CS, "Player.cs": PLAYER_CS, "Actor.cs": ACTOR_CS, "Player.Input.cs": PLAYER_PART_CS, "Mob.tscn": MOB_SCENE, ".gitignore": ".godot/\n", ...extra });
}

describe("C# in the project map, usages and deps", () => {
  it("lists C# scripts with class, base, exports, signals and methods", () => {
    const root = csProject();
    const map = scanProject(root);
    expect(map.warnings).toEqual([]);
    const player = map.csharpScripts.find((s) => s.path === "res://Player.cs")!;
    expect(player).toMatchObject({ language: "csharp", className: "Player", extends: "Actor", partial: true, tool: false, globalClass: false, usedBy: ["res://Main.tscn"] });
    expect(player.exports.map((e) => `${e.type} ${e.name}`)).toEqual(["float Speed", "Texture2D Portrait"]);
    const actor = map.csharpScripts.find((s) => s.path === "res://Actor.cs")!;
    expect(actor.signals).toEqual([{ name: "HealthChanged", signature: "HealthChanged(int current, int max)", line: 5 }]);
    expect(actor.functions.map((f) => f.signature)).toEqual(["void Heal(int amount)"]);
    // A file with no class named after it is listed without one.
    expect(map.csharpScripts.find((s) => s.path === "res://Player.Input.cs")).toMatchObject({ className: undefined, otherClasses: ["Player"] });
    const text = formatProjectMap(map, "full");
    expect(text).toContain("C# scripts (4):");
    expect(text).toContain("res://Actor.cs  partial class Actor : CharacterBody2D");
    expect(text).toContain("    signal HealthChanged(int current, int max)  :5");
    expect(text).toContain("    [Export] float Speed  :5");
    expect(loadProject(root).csharp.size).toBe(4);
  });

  it("reports a file a C# script loads that is not there", () => {
    const root = csProject({ "Player.cs": PLAYER_CS.replace("res://Mob.tscn", "res://Missing.tscn") });
    expect(scanProject(root).warnings).toEqual([{ file: "res://Player.cs", line: 12, message: "GD.Load() path not found: res://Missing.tscn" }]);
    const findings = reviewProject(root).findings.filter((f) => f.file === "res://Player.cs");
    expect(findings.map((f) => `${f.severity} ${f.rule} ${f.line}`)).toEqual(["error structure/broken-reference 12"]);
  });

  it("finds names and res:// paths inside C#", () => {
    const root = csProject();
    const kinds = (name: string) => findUsages(root, name).usages.map((u) => `${u.file}:${u.line} ${u.kind}`);
    expect(kinds("HealthChanged")).toEqual(["res://Actor.cs:5 definition", "res://Main.tscn:22 signal connection"]);
    expect(kinds("OnPlayerHealthChanged")).toEqual(["res://Main.cs:14 definition", "res://Main.tscn:22 method connection"]);
    expect(kinds("OnButtonPressed")).toEqual(["res://Main.cs:13 definition", "res://Main.cs:9 reference"]);
    expect(kinds("HealthBar")).toEqual(["res://Main.cs:10 node path", "res://Main.tscn:17 scene node"]);
    expect(kinds("jump")).toEqual(["res://project.godot:17 input action", "res://Player.cs:12 string"]);
    expect(kinds("Actor")).toEqual(["res://Actor.cs:3 definition", "res://Player.cs:3 reference"]);
    const mob = findUsages(root, "res://Mob.tscn");
    expect(mob.resource).toEqual({ path: "res://Mob.tscn", exists: true });
    expect(mob.usages.map((u) => `${u.file}:${u.line} ${u.kind}`)).toEqual(["res://Player.cs:12 resource"]);
    expect(findUsages(root, "res://Player.cs").usages.map((u) => u.file)).toEqual(["res://Main.tscn"]);
  });

  it("follows what a C# script loads, and a scene's C# scripts", () => {
    const root = csProject({ "Player.cs": PLAYER_CS.replace("GD.Load", "/* GD.Load<PackedScene>(\"res://Ghost.tscn\") */ GD.Load") });
    const graph = buildGraph(root);
    expect(graph.edgesOf("res://Player.cs")).toEqual([{ to: "res://Mob.tscn", kind: "load", line: 12 }]);
    expect(graph.edgesOf("res://Main.tscn").map((e) => `${e.to} ${e.kind}`)).toEqual(["res://Main.cs ext_resource", "res://Player.cs ext_resource"]);
    expect(graph.parent.get("res://Mob.tscn")?.from).toBe("res://Player.cs");
  });
});

describe("C# in scene edits", () => {
  it("resolves a script class over its partial parts and project base classes", () => {
    const root = csProject();
    const facts = csharpScriptInfo(root, "res://Player.cs");
    expect(facts.extends).toBe("CharacterBody2D");
    expect(facts.csharp).toEqual({ className: "Player", partial: true, complete: true });
    expect([...facts.signals]).toEqual([["HealthChanged", "(current: int, max: int)"]]);
    expect(Object.fromEntries(facts.funcs)).toEqual({ _Ready: { min: 0, max: 0 }, OnAreaEntered: { min: 1, max: 1 }, Heal: { min: 0, max: 1 } });
    expect(Object.fromEntries(facts.exports)).toEqual({ Speed: "float", Portrait: "Texture2D", MaxHealth: "int" });
    const data = loadProject(root);
    const resolved = resolveCSharpClass(data.csharp.get("res://Player.cs")!.outline, "res://Player.cs", csharpClassIndex([...data.csharp.values()].map((c) => c.outline)))!;
    expect(resolved.parts.map((p) => p.name)).toEqual(["Player", "Player", "Actor"]);
    expect(resolved.nativeBase).toBe("CharacterBody2D");
  });

  it("checks a connection to a C# method by its C# name and argument count", () => {
    const root = csProject();
    const connect = (signal: string, from: string, to: string, method: string) => editScene(join(root, "Main.tscn"), { op: "connect", signal, from, to, method });
    // Godot's own signal, C# handler: fine, and nothing to warn about.
    expect(connect("timeout", "Player/Timer", ".", "OnTimerTimeout").warnings).toEqual([]);
    // A C# [Signal] by its C# name, to a method of the right size.
    expect(connect("HealthChanged", "Player", ".", "NeedsTwo").warnings).toEqual([]);
    // A method in another part of the partial class, and one from a base class in the project.
    expect(connect("pressed", "Button", "Player", "Heal").warnings).toEqual([]);
    expect(connect("pressed", "Button", "Player", "OnAreaEntered").warnings[0]).toMatch(/pressed passes 0 arguments \(none\), but OnAreaEntered\(\) takes 1/);
    expect(connect("timeout", "Player/Timer", ".", "NeedsTwo").warnings[0]).toMatch(/timeout passes 0 arguments.*NeedsTwo\(\) takes 2/);
    // GDScript's spelling of a C# method.
    expect(connect("timeout", "Player/Timer", ".", "_on_timer_timeout").warnings[0]).toMatch(/has OnTimerTimeout: a C# method is connected by its C# name/);
    expect(connect("timeout", "Player/Timer", ".", "on_timer_timeout").warnings[0]).toMatch(/has OnTimerTimeout: a C# method is connected by its C# name/);
    expect(connect("timeout", "Player/Timer", ".", "OnNothing").warnings[0]).toMatch(/has no method OnNothing in its C# script.*private void OnNothing\(\) \{ \}/);
    expect(connect("toggled", "Button", ".", "OnToggled").warnings[0]).toContain("private void OnToggled(bool toggled_on) { }");
    // Signal names: Godot's are snake_case in the scene, a C# signal keeps its name.
    expect(() => connect("Timeout", "Player/Timer", ".", "OnTimerTimeout")).toThrow(/has no signal Timeout; it is timeout in the scene file \(Godot's own signals are snake_case/);
    expect(() => connect("health_changed", "Player", ".", "NeedsTwo")).toThrow(/it is HealthChanged in the scene file \(a C# \[Signal\] keeps its C# name/);
    const plan = editScene(join(root, "Main.tscn"), { op: "connect", signal: "timeout", from: "Player/Timer", to: ".", method: "OnTimerTimeout" }, { write: true });
    expect(plan.written).toBe(true);
    expect(readFileSync(join(root, "Main.tscn"), "utf8")).toContain('[connection signal="timeout" from="Player/Timer" to="." method="OnTimerTimeout"]');
  });

  it("sets an exported C# property under its C# name", () => {
    const root = csProject();
    const set = (node: string, property: string, value: string) => editScene(join(root, "Main.tscn"), { op: "set", node, property, value });
    expect(set("Player", "Speed", "120").summary).toBe("set Player.Speed = 120.0");
    // An export of a base class, and Godot's own property next to it.
    expect(set("Player", "MaxHealth", "25").summary).toBe("set Player.MaxHealth = 25");
    expect(set("Player", "collision_mask", "3").summary).toBe("set Player.collision_mask = 3");
    expect(() => set("Player", "Speed", "fast")).toThrow(/Player\.Speed is a float/);
    expect(() => set("Player", "speed", "120")).toThrow(/has no property speed; it is Speed in the scene file \(a C# export keeps its C# name\)/);
    expect(() => set("Player", "CollisionMask", "3")).toThrow(/it is collision_mask in the scene file \(Godot's own properties are snake_case/);
    expect(() => set("Player", "Portrait", "res://Mob.tscn")).toThrow(/Portrait takes a Texture2D; res:\/\/Mob\.tscn is a PackedScene/);
    expect(set(".", "MobScene", "res://Mob.tscn").summary).toMatch(/^set \.\.MobScene = ExtResource\(/);
  });

  it("attaches a C# script when its class fits the node", () => {
    const root = csProject({ "Loose.cs": "using Godot;\npublic class Loose : Node { }\n", "Wrong.cs": "using Godot;\npublic partial class Other : Node { }\n" });
    const attach = (node: string, script: string) => editScene(join(root, "Main.tscn"), { op: "attach_script", node, script });
    expect(attach("Player", "res://Actor.cs").summary).toBe("attach res://Actor.cs to Player");
    expect(() => attach("Button", "res://Actor.cs")).toThrow(SceneError);
    // Actor extends CharacterBody2D: it fits a CharacterBody2D, not a Timer.
    expect(() => attach("Player/Timer", "res://Player.cs")).toThrow(/Player\/Timer is a Timer, but res:\/\/Player\.cs extends CharacterBody2D/);
    expect(() => attach("Button", "res://Wrong.cs")).toThrow(/has no class named Wrong/);
    expect(attach("Button", "res://Loose.cs").warnings[0]).toMatch(/is not partial/);
    expect(editScene(join(root, "New.tscn"), { op: "create_scene", type: "CharacterBody2D", script: "res://Player.cs" }).summary).toContain("res://Player.cs");
    expect(() => editScene(join(root, "New.tscn"), { op: "create_scene", type: "Node", script: "res://Player.cs" })).toThrow(/the root is a Node, but res:\/\/Player\.cs extends CharacterBody2D/);
  });
});

describe("C# review rules", () => {
  const cs = (root: string, file?: string) =>
    reviewProject(root)
      .findings.filter((f) => f.file.endsWith(".cs") && (!file || f.file === file))
      .map((f) => `${f.file}:${f.line ?? ""} ${f.severity} [${f.rule}] ${f.message}`);

  it("is quiet on a correct project", () => {
    expect(cs(csProject())).toEqual([]);
  });

  it("has every C# rule in the rule list", () => {
    for (const id of ["api/csharp-not-partial", "api/csharp-class-name", "api/csharp-signal-name", "api/csharp-callback"]) expect(RULES[id], id).toBeDefined();
    expect(RULES["api/csharp-not-partial"]!.severity).toBe("error");
    expect(RULES["api/csharp-callback"]!.severity).toBe("warning");
  });

  it("reports a class that derives from a Godot class without partial", () => {
    const root = csProject({
      "Actor.cs": ACTOR_CS.replace("public partial class Actor", "public class Actor"),
      // Not Godot's: plain C# classes, a System.Timers.Timer, a class with an alias for a base, and a static class.
      "Plain.cs": "using System.Timers;\nusing Godot;\npublic class Plain { }\npublic class Ticker : Timer { }\npublic static class Helper { }\n",
      "Alias.cs": "using Node = MyLib.Tree.Node;\nusing Godot;\npublic class Alias : Node { }\n",
      "NoGodot.cs": "namespace Lib;\npublic class Resource { }\npublic class Sound : Resource { }\n",
    });
    const found = cs(root);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^res:\/\/Actor\.cs:3 error \[api\/csharp-not-partial\] class Actor derives from CharacterBody2D but is not partial\..*GD0001.*public partial class Actor : CharacterBody2D/);
    // Through a project base class: Player : Actor : CharacterBody2D.
    const deep = csProject({ "Player.cs": PLAYER_CS.replace("public partial class Player", "public class Player") });
    expect(cs(deep, "res://Player.cs")[0]).toMatch(/class Player derives from CharacterBody2D but is not partial/);
  });

  it("reports a script whose class does not have the name of its file", () => {
    const root = csProject({ "Main.cs": MAIN_CS.replace("partial class Main", "partial class MainScene"), "Util.cs": "public static class Helpers { }\n" });
    const found = cs(root);
    // Util.cs is no script (nothing attaches it), so its class may have any name.
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^res:\/\/Main\.cs:3 error \[api\/csharp-class-name\] res:\/\/Main\.cs is used as a script, but it has no class named Main \(it declares MainScene\)/);
  });

  it("reports a [Signal] delegate without EventHandler", () => {
    const root = csProject({ "Actor.cs": ACTOR_CS.replace("HealthChangedEventHandler", "HealthChanged") });
    expect(cs(root, "res://Actor.cs")).toEqual(["res://Actor.cs:5 error [api/csharp-signal-name] [Signal] delegate HealthChanged must end with EventHandler (the build fails with GD0201). Name it HealthChangedEventHandler: the signal is then HealthChanged."]);
  });

  it("reports GetNode paths that are in none of the scenes that use the script", () => {
    const root = csProject({
      "Player.cs": PLAYER_CS.replace('GetNode<Timer>("Timer")', 'GetNode<Timer>("Cooldown")').replace('GetNode<Sprite2D>("Sprite2D").Show();', 'GetNodeOrNull<Sprite2D>("Ghost")?.Show(); GetParent().GetNode("Nope"); GetNode("/root/Global"); GetNode("Mob"); var p = GetNode("../HealthBar");'),
      "Main.cs": MAIN_CS.replace("%HealthBar", "%ManaBar"),
    });
    expect(cs(root)).toEqual([
      'res://Main.cs:10 warning [structure/missing-node] %ManaBar is not a unique-name node in res://Main.tscn.',
      'res://Player.cs:10 warning [structure/missing-node] Node "Cooldown" does not exist under node "Player" in res://Main.tscn.',
    ]);
  });

  it("reports input actions that are not in the input map", () => {
    const root = csProject({ "Player.cs": PLAYER_CS.replace('"jump"', '"jmp"').replace("GetNode<Timer>", 'if (Input.IsActionPressed("ui_accept") || Input.GetAxis("move_left", "move_rite") > 0) return; GetNode<Timer>') });
    expect(cs(root)).toEqual([
      'res://Player.cs:10 error [api/unknown-input-action] Input action "move_rite" is not in the Input Map. Did you mean "move_right"?',
      'res://Player.cs:12 error [api/unknown-input-action] Input action "jmp" is not in the Input Map. Did you mean "jump"?',
    ]);
    // Actions the code adds count; when one is added from a variable, any name may be an action.
    expect(cs(csProject({ "Player.cs": PLAYER_CS.replace('"jump"', '"dash"'), "Setup.cs": 'using Godot;\npublic static class Setup { public static void Run() { InputMap.AddAction("dash"); } }\n' }))).toEqual([]);
    expect(cs(csProject({ "Player.cs": PLAYER_CS.replace('"jump"', '"dash"'), "Setup.cs": "using Godot;\npublic static class Setup { public static void Run(string n) { InputMap.AddAction(n); } }\n" }))).toEqual([]);
  });

  it("reports engine callbacks Godot never calls", () => {
    const root = csProject({
      "Actor.cs": ACTOR_CS.replace("public void Heal", "public void _ready() { }\n\tpublic override void _Process(float delta) { }\n\tpublic void _Notification(int what, bool extra) { }\n\tpublic override void _PhysicsProcess(double delta) { }\n\tpublic void Heal"),
      // Not a Godot class: its methods are its own.
      "Plain.cs": "public class Plain { public void _ready() { } public void _Process(int a, int b) { } }\n",
    });
    expect(cs(root)).toEqual([
      "res://Actor.cs:7 warning [api/csharp-callback] _ready() is GDScript's name; in C# Godot calls _Ready: write `public override void _Ready()`.",
      "res://Actor.cs:8 warning [api/csharp-callback] _Process(float) does not override Godot's _Process(double): delta is a double in Godot 4. Write `public override void _Process(double delta)` and cast where a float is needed.",
      "res://Actor.cs:9 warning [api/csharp-callback] _Notification(int, bool) is not Godot's _Notification(int), so Godot never calls it: write `public override void _Notification(int what)`.",
    ]);
  });

  it("reports GD.Print in a per-frame callback, like print() in _process", () => {
    const root = csProject({
      "Actor.cs": ACTOR_CS.replace("public void Heal", 'public override void _Process(double delta)\n\t{\n\t\tGD.Print("tick");\n\t}\n\tpublic void Heal'),
      "Quiet.cs": 'using Godot;\npublic partial class Quiet : Node\n{\n\tpublic override void _Process(double delta)\n\t{\n\t\tif (OS.IsDebugBuild()) GD.Print("tick");\n\t\t// GD.Print("no");\n\t}\n\tpublic override void _Ready() { GD.Print("once"); }\n}\n',
    });
    expect(cs(root)).toEqual(["res://Actor.cs:9 info [performance/print-per-frame] GD.Print() in _Process() prints every frame and slows the game."]);
  });

  it("reports Godot 3 classes as a base class or an export type", () => {
    const root = csProject({ "Old.cs": "using Godot;\npublic partial class Old : KinematicBody2D\n{\n\t[Export] public Spatial Target { get; set; }\n\t[Export] public Mystery Other { get; set; }\n}\n" });
    expect(cs(root)).toEqual([
      "res://Old.cs:2 error [api/unknown-type] KinematicBody2D (the base class of Old) is a Godot 3 class; it is CharacterBody2D in Godot 4.",
      "res://Old.cs:4 error [api/unknown-type] Spatial (the type of [Export] Target) is a Godot 3 class; it is Node3D in Godot 4.",
    ]);
  });

  it("does not ask C# file names to be snake_case", () => {
    const naming = reviewProject(csProject()).findings.filter((f) => f.rule === "structure/file-naming");
    expect(naming.map((f) => f.message).join()).not.toMatch(/\.cs\b|\.csproj|\.sln/);
  });
});

// Lines as MSBuild prints them with `dotnet build --nologo -v q -consoleloggerparameters:NoSummary`.
const msbuildLines = (root: string) =>
  [
    `${root}/Player.cs(12,9): error CS0103: The name 'velocty' does not exist in the current context [${root}/CsDemo.csproj]`,
    `${root}/Player.cs(12,9): error CS0103: The name 'velocty' does not exist in the current context [${root}/CsDemo.csproj]`,
    `${root}/actors/Mob.cs(7,17): warning CS0414: The field 'Mob._unused' is assigned but its value is never used [${root}/CsDemo.csproj]`,
    `${root}/Main.cs(5,22): error GD0001: Missing partial modifier on declaration of type 'Main' that derives from 'Godot.GodotObject' [${root}/CsDemo.csproj::TargetFramework=net8.0]`,
    `actors/Boss.cs(3,1): warning CS8632: The annotation for nullable reference types should only be used in code within a '#nullable' annotations context. [${root}/CsDemo.csproj]`,
    `CSC : error CS5001: Program does not contain a static 'Main' method suitable for an entry point [${root}/CsDemo.csproj]`,
    `${root}/CsDemo.csproj : error NU1101: Unable to find package Godot.NET.Sdk. No packages exist with this id in source(s): nuget.org [${root}/CsDemo.sln]`,
    "MSBUILD : error MSB1009: Project file does not exist.",
    `/usr/share/dotnet/sdk/8.0.100/Microsoft.Common.CurrentVersion.targets(2382,5): warning MSB3245: Could not resolve this reference. Could not locate the assembly "Steamworks.NET". [${root}/CsDemo.csproj]`,
    "  CsDemo -> " + `${root}/.godot/mono/temp/bin/Debug/CsDemo.dll`,
    "",
    "Build FAILED.",
  ].join("\n");

function fakeDotnet(output: string, exit = 1): { bin: string; dir: string } {
  const dir = tempFolder("fake-dotnet-");
  const bin = join(dir, "dotnet");
  writeFileSync(bin, `#!/usr/bin/env node\nrequire("node:fs").appendFileSync(${JSON.stringify(join(dir, "calls.log"))}, JSON.stringify(process.argv.slice(2)) + "\\n");\nprocess.stdout.write(${JSON.stringify(output)});\nprocess.exit(${exit});\n`);
  chmodSync(bin, 0o755);
  return { bin, dir };
}

describe("C# build diagnostics", () => {
  it("parses MSBuild's lines into check diagnostics with res:// paths, once each", () => {
    const root = "/home/me/game";
    expect(parseMsbuildOutput(msbuildLines(root), root)).toEqual([
      { severity: "error", file: "res://Player.cs", line: 12, message: "CS0103: The name 'velocty' does not exist in the current context", source: "csharp" },
      { severity: "warning", file: "res://actors/Mob.cs", line: 7, message: "CS0414: The field 'Mob._unused' is assigned but its value is never used", source: "csharp" },
      { severity: "error", file: "res://Main.cs", line: 5, message: "GD0001: Missing partial modifier on declaration of type 'Main' that derives from 'Godot.GodotObject'", source: "csharp" },
      { severity: "warning", file: "res://actors/Boss.cs", line: 3, message: "CS8632: The annotation for nullable reference types should only be used in code within a '#nullable' annotations context.", source: "csharp" },
      { severity: "error", message: "CS5001: Program does not contain a static 'Main' method suitable for an entry point", source: "csharp" },
      { severity: "error", file: "res://CsDemo.csproj", message: "NU1101: Unable to find package Godot.NET.Sdk. No packages exist with this id in source(s): nuget.org", source: "csharp" },
      { severity: "error", message: "MSB1009: Project file does not exist.", source: "csharp" },
      { severity: "warning", message: 'MSB3245: Could not resolve this reference. Could not locate the assembly "Steamworks.NET". (/usr/share/dotnet/sdk/8.0.100/Microsoft.Common.CurrentVersion.targets:2382)', source: "csharp" },
    ]);
    expect(parseMsbuildOutput("Build succeeded.\n    0 Warning(s)\n    0 Error(s)\n", root)).toEqual([]);
    // A message with brackets and parentheses of its own keeps them.
    expect(parseMsbuildOutput(`${root}/A.cs(1,2,1,9): warning CS0618: 'Foo.Bar(int[])' is obsolete: 'Use Baz [new]' [${root}/G.csproj]`, root)).toEqual([
      { severity: "warning", file: "res://A.cs", line: 1, message: "CS0618: 'Foo.Bar(int[])' is obsolete: 'Use Baz [new]'", source: "csharp" },
    ]);
  });

  // Lines as dotnet 8.0.134 (MSBuild 17.8.64) printed them for a project made by `godotwright new project --dotnet`
  // (Godot.NET.Sdk 4.7.0), with the project folder replaced by ROOT. Nothing else was changed.
  const REAL = {
    compileError: "ROOT/scripts/Bad.cs(7,15): error CS0103: The name 'missing' does not exist in the current context [ROOT/Cs.csproj]",
    warning: "ROOT/scripts/Bad.cs(8,10): warning CS0219: The variable 'unused' is assigned but its value is never used [ROOT/Cs.csproj]",
    // -warnaserror: the same diagnostic, worded as an error.
    warningAsError: "ROOT/scripts/Bad.cs(7,10): error CS0219: The variable 'unused' is assigned but its value is never used [ROOT/Cs.csproj]",
    // A .csproj that is not valid XML: a location in the project file, and no [project] at the end.
    brokenProject: "ROOT/Cs.csproj(5,5): error MSB4025: The project file could not be loaded. The 'PropertyGroup' start tag on line 2 position 4 does not match the end tag of 'PropertyGrou'. Line 5, position 5.",
    // No location at all, followed by a line that is not a diagnostic.
    noProject: "MSBUILD : error MSB1009: Project file does not exist.\nSwitch: Nope.sln",
    missingPackage: "ROOT/Cs.csproj : error NU1101: Unable to find package No.Such.Package.Gw. No packages exist with this id in source(s): nuget.org [ROOT/Cs.sln]",
    sdkTargets:
      "/usr/lib/dotnet/sdk/8.0.134/Sdks/Microsoft.NET.Sdk/targets/Microsoft.NET.TargetFrameworkInference.targets(166,5): error NETSDK1045: The current .NET SDK does not support targeting .NET 99.0.  Either target .NET 8.0 or lower, or use a version of the .NET SDK that supports .NET 99.0. Download the .NET SDK from https://aka.ms/dotnet/download [ROOT/Cs.csproj]",
    // Default verbosity prints every diagnostic again in the summary.
    summary: ["", "Build FAILED.", "", "ROOT/scripts/Bad.cs(8,10): warning CS0219: The variable 'unused' is assigned but its value is never used [ROOT/Cs.csproj]", "ROOT/scripts/Bad.cs(7,15): error CS0103: The name 'missing' does not exist in the current context [ROOT/Cs.csproj]", "    1 Warning(s)", "    1 Error(s)", "", "Time Elapsed 00:00:03.44"].join("\n"),
    // DOTNET_CLI_UI_LANGUAGE=de: only the text is translated, so the line still parses; builds run in English.
    german: 'ROOT/scripts/Bad.cs(7,10): warning CS0219: Die Variable "unused" ist zugewiesen, ihr Wert wird aber nie verwendet. [ROOT/Cs.csproj]',
  };

  it("reads what a real dotnet build printed", () => {
    const root = "/home/me/game";
    const parse = (...lines: string[]) => parseMsbuildOutput(lines.join("\n").replaceAll("ROOT", root), root);
    expect(parse(REAL.compileError, REAL.warning, REAL.summary)).toEqual([
      { severity: "error", file: "res://scripts/Bad.cs", line: 7, message: "CS0103: The name 'missing' does not exist in the current context", source: "csharp" },
      { severity: "warning", file: "res://scripts/Bad.cs", line: 8, message: "CS0219: The variable 'unused' is assigned but its value is never used", source: "csharp" },
    ]);
    expect(parse(REAL.warningAsError)).toEqual([{ severity: "error", file: "res://scripts/Bad.cs", line: 7, message: "CS0219: The variable 'unused' is assigned but its value is never used", source: "csharp" }]);
    expect(parse(REAL.brokenProject)).toEqual([
      { severity: "error", file: "res://Cs.csproj", line: 5, message: "MSB4025: The project file could not be loaded. The 'PropertyGroup' start tag on line 2 position 4 does not match the end tag of 'PropertyGrou'. Line 5, position 5.", source: "csharp" },
    ]);
    expect(parse(REAL.noProject)).toEqual([{ severity: "error", message: "MSB1009: Project file does not exist.", source: "csharp" }]);
    expect(parse(REAL.missingPackage)).toEqual([{ severity: "error", file: "res://Cs.csproj", message: "NU1101: Unable to find package No.Such.Package.Gw. No packages exist with this id in source(s): nuget.org", source: "csharp" }]);
    const sdk = parse(REAL.sdkTargets);
    expect(sdk).toHaveLength(1);
    expect(sdk[0]).toMatchObject({ severity: "error", source: "csharp" });
    expect(sdk[0]!.file).toBeUndefined();
    expect(sdk[0]!.message).toMatch(/^NETSDK1045: The current \.NET SDK does not support targeting \.NET 99\.0\..*\(\/usr\/lib\/dotnet\/sdk\/8\.0\.134\/Sdks\/Microsoft\.NET\.Sdk\/targets\/Microsoft\.NET\.TargetFrameworkInference\.targets:166\)$/);
    expect(parse(REAL.german)).toEqual([{ severity: "warning", file: "res://scripts/Bad.cs", line: 7, message: 'CS0219: Die Variable "unused" ist zugewiesen, ihr Wert wird aber nie verwendet.', source: "csharp" }]);
  });

  it("knows a restored project by where the Godot.NET.Sdk keeps obj/", () => {
    const root = makeProject({ "project.godot": PROJECT, "CsDemo.csproj": "<Project />" });
    expect(isRestored(root, "CsDemo.csproj")).toBe(false);
    mkdirSync(join(root, ".godot", "mono", "temp", "obj"), { recursive: true });
    writeFileSync(join(root, ".godot", "mono", "temp", "obj", "project.assets.json"), "{}");
    expect(isRestored(root, "CsDemo.csproj")).toBe(true);
  });

  it("finds the project file Godot builds", () => {
    const root = makeProject({ "project.godot": PROJECT, "Tools.csproj": "<Project />", "CsDemo.csproj": "<Project />", "CsDemo.sln": "" });
    expect(findCSharpProject(root)).toEqual({ csproj: "CsDemo.csproj", sln: "CsDemo.sln" });
    expect(findCSharpProject(makeProject({ "project.godot": PROJECT }))).toEqual({});
    expect(findDotnet({ PATH: "/nonexistent-a:/nonexistent-b" }, "linux")).toBeUndefined();
  });

  it("says so when there is no C# project or no dotnet, without calling it an error", async () => {
    expect(await buildCSharp(makeProject({ "project.godot": PROJECT }))).toMatchObject({ status: "no-project", errors: 0, diagnostics: [] });
    const root = makeProject({ "project.godot": PROJECT, "CsDemo.csproj": "<Project />" });
    const saved = { PATH: process.env["PATH"], DOTNET_ROOT: process.env["DOTNET_ROOT"] };
    process.env["PATH"] = "/nonexistent";
    delete process.env["DOTNET_ROOT"];
    try {
      const r = await buildCSharp(root);
      expect(r).toMatchObject({ status: "no-dotnet", target: "CsDemo.csproj", errors: 0, warnings: 0, diagnostics: [] });
      expect(r.note).toMatch(/dotnet is not on PATH, so CsDemo\.csproj was not built/);
    } finally {
      process.env["PATH"] = saved.PATH;
      if (saved.DOTNET_ROOT !== undefined) process.env["DOTNET_ROOT"] = saved.DOTNET_ROOT;
    }
  });

  it("runs dotnet build, restores only when it must, and reports what the compiler said", async () => {
    const root = makeProject({ "project.godot": PROJECT, "CsDemo.csproj": "<Project />", "CsDemo.sln": "", "Player.cs": "" });
    const failing = fakeDotnet(msbuildLines(root));
    const r = await buildCSharp(root, { dotnet: failing.bin, configuration: "ExportDebug" });
    expect(r).toMatchObject({ status: "failed", target: "CsDemo.sln", restored: true, errors: 5, warnings: 3, exitCode: 1 });
    expect(r.note).toBe("dotnet build CsDemo.sln: 5 errors, 3 warnings (NuGet packages were restored first: there was no project.assets.json)");
    expect(JSON.parse(readFileSync(join(failing.dir, "calls.log"), "utf8").trim())).toEqual(["build", "CsDemo.sln", "--nologo", "-v", "q", "-consoleloggerparameters:NoSummary", "--no-incremental", "-c", "ExportDebug"]);
    // Restored before: no restore, so no network.
    mkdirSync(join(root, "obj"));
    writeFileSync(join(root, "obj", "project.assets.json"), "{}");
    const clean = fakeDotnet("", 0);
    expect(await buildCSharp(root, { dotnet: clean.bin })).toMatchObject({ status: "ok", restored: false, errors: 0, note: "dotnet build CsDemo.sln: ok, 0 warnings" });
    expect(JSON.parse(readFileSync(join(clean.dir, "calls.log"), "utf8").trim())).toContain("--no-restore");
    // A failure with no MSBuild error line is still a failure.
    const odd = await buildCSharp(root, { dotnet: fakeDotnet("Unhandled exception. boom\n", 134).bin });
    expect(odd).toMatchObject({ status: "failed", errors: 1 });
    expect(odd.diagnostics[0]!.message).toMatch(/dotnet build exited with code 134; last output: Unhandled exception\. boom/);
  });

  it("is part of the check when the project has a .csproj", async () => {
    const root = makeProject({ "project.godot": PROJECT, "CsDemo.csproj": "<Project />", "Player.cs": "", "Main.tscn": MOB_SCENE });
    const godot = fakeGodot();
    const dotnet = fakeDotnet(`${root}/Player.cs(12,9): error CS0103: The name 'velocty' does not exist in the current context [${root}/CsDemo.csproj]\n`);
    const result = await checkProject(root, { godot: godot.bin, dotnet: dotnet.bin });
    expect(result.csharp).toMatchObject({ status: "failed", target: "CsDemo.csproj", errors: 1 });
    expect(result.diagnostics.filter((d) => d.source === "csharp")).toEqual([{ severity: "error", file: "res://Player.cs", line: 12, message: "CS0103: The name 'velocty' does not exist in the current context", source: "csharp" }]);
    expect(result.steps.map((s) => s.name)).toEqual(["dotnet build", "import", "check"]);
    expect(result.errors).toBe(1);
    // Switched off, and a project without C#: no build step.
    expect((await checkProject(root, { godot: godot.bin, dotnet: dotnet.bin, csharp: false })).csharp).toBeUndefined();
    const plain = makeProject({ "project.godot": PROJECT, "Main.tscn": MOB_SCENE });
    expect((await checkProject(plain, { godot: godot.bin, dotnet: dotnet.bin })).steps.map((s) => s.name)).toEqual(["import", "check"]);
  });
});

describe("C# scaffolding", () => {
  it("writes each C# template as a partial class named after the file, clean in the review", () => {
    const actions = ["move_forward", "move_back"].map((a) => `${a}={\n"deadzone": 0.5,\n"events": []\n}\n`).join("");
    const root = makeProject({ "project.godot": PROJECT + actions, ".gitignore": ".godot/\n", "CsDemo.csproj": csprojText("CsDemo") });
    for (const template of CSHARP_TEMPLATES) {
      const name = `${snakeToPascal(template)}Thing`;
      const r = newScript(root, `res://scripts/${name}.cs`, { template });
      expect(r.written, template).toBe(true);
      expect(r.review, template).toEqual({ errors: 0, warnings: 0 });
      expect(r.className).toBe(name);
      const text = readFileSync(join(root, "scripts", `${name}.cs`), "utf8");
      expect(text).toBe(r.text);
      expect(text.startsWith("using Godot;\n")).toBe(true);
      const outline = outlineCSharp(text);
      const cls = scriptClass(outline, r.file)!;
      expect(cls, template).toMatchObject({ name, partial: true, base: r.extends });
      // Balanced, tab-indented, and nothing left for the outline to trip on.
      expect(text.split("{").length, template).toBe(text.split("}").length);
      expect(text).not.toMatch(/^ +\S/m);
      expect(readFileSync(join(root, "scripts", `${name}.cs.uid`), "utf8")).toBe(`${r.uid}\n`);
    }
    const map = scanProject(root);
    expect(map.csharpScripts).toHaveLength(CSHARP_TEMPLATES.length);
    const trigger = map.csharpScripts.find((s) => s.className === "AreaTriggerThing")!;
    expect(trigger.signals.map((s) => s.signature)).toEqual(["Triggered(Node2D body)"]);
    expect(trigger.exports.map((e) => `${e.type} ${e.name}`)).toEqual(["StringName TargetGroup", "bool OneShot"]);
    expect(map.csharpScripts.find((s) => s.className === "ResourceThing")).toMatchObject({ globalClass: true, extends: "Resource" });
  });

  it("names the input actions a C# template reads, and takes a base and a dimension", () => {
    const root = makeProject({ "project.godot": PROJECT, ".gitignore": ".godot/\n" });
    const r = newScript(root, "res://Hero.cs", { template: "character_3d", write: false });
    expect(r.written).toBe(false);
    expect(existsSync(join(root, "Hero.cs"))).toBe(false);
    expect(r.inputActions.map((a) => `${a.name}:${a.defined}`)).toEqual(["move_left:true", "move_right:true", "move_forward:false", "move_back:false", "jump:true"]);
    expect(r.notes.join("\n")).toMatch(/no \.csproj yet/);
    const shown = formatNewScript(r);
    expect(shown).toContain("new script res://Hero.cs (character_3d) (dry run: nothing written): partial class Hero : CharacterBody3D");
    expect(shown).toContain("public override void _PhysicsProcess(double delta)");
    expect(csharpTemplateText("node", "Spawner", { base: "Marker2D" })).toBe("using Godot;\n\npublic partial class Spawner : Marker2D\n{\n\tpublic override void _Ready()\n\t{\n\t}\n}\n");
    expect(csharpTemplateText("area_trigger", "Zone", { dimension: "3d" })).toContain("public partial class Zone : Area3D");
    expect(csharpTemplateText("area_trigger", "Zone", { dimension: "3d" })).toContain("private void OnBodyEntered(Node3D body)");
  });

  it("refuses what Godot or the compiler would refuse", () => {
    const root = makeProject({ "project.godot": PROJECT, "Taken.cs": "public partial class Taken : Godot.Node { }\n" });
    expect(() => newScript(root, "res://Fsm.cs", { template: "state_machine" })).toThrow(/GDScript only; C# templates: node, character_2d/);
    expect(() => newScript(root, "res://my-script.cs")).toThrow(/not a usable class name/);
    expect(() => newScript(root, "res://Player.cs", { className: "Hero" })).toThrow(/must have the name of its file/);
    expect(() => newScript(root, "res://Timer.cs")).toThrow(/Timer is a Godot class/);
    expect(() => newScript(root, "res://sub/Taken.cs")).toThrow(/already declared in res:\/\/Taken\.cs/);
    expect(() => newScript(root, "res://Taken.cs")).toThrow(ScaffoldError);
    expect(() => newScript(root, "res://Thing.cs", { base: "Nope" })).toThrow(/not a Godot .* class or a C# class in this project/);
    expect(newScript(root, "res://Child.cs", { base: "Taken", write: false }).text).toContain("public partial class Child : Taken");
  });

  it("makes a C# project with the .csproj and .sln Godot generates", () => {
    const dir = join(tempFolder("godotwright-new-cs-"), "game");
    const r = newProject(dir, { name: "Space Game", dotnet: true });
    expect(r.created).toEqual(["project.godot", "main.tscn", "main.gd", "main.gd.uid", "icon.svg", ".gitignore", ".gitattributes", "Space Game.csproj", "Space Game.sln", ".editorconfig"]);
    // Godot's C# templates use tabs: dotnet format must keep them.
    expect(readFileSync(join(dir, ".editorconfig"), "utf8")).toBe("root = true\n\n[*]\ncharset = utf-8\n\n[*.cs]\nindent_style = tab\n");
    const project = readFileSync(join(dir, "project.godot"), "utf8");
    expect(project).toContain('config/features=PackedStringArray("4.7", "C#", "Forward Plus")');
    expect(project).toContain('[dotnet]\n\nproject/assembly_name="Space Game"\n');
    expect(readFileSync(join(dir, "Space Game.csproj"), "utf8")).toBe(
      '<Project Sdk="Godot.NET.Sdk/4.7.0">\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>\n    <EnableDynamicLoading>true</EnableDynamicLoading>\n    <RootNamespace>Space_Game</RootNamespace>\n  </PropertyGroup>\n</Project>\n',
    );
    const sln = readFileSync(join(dir, "Space Game.sln"), "utf8");
    const guid = /, "\{([0-9A-F-]{36})\}"/.exec(sln)![1]!;
    expect(sln).toBe(slnText("Space Game", "Space Game.csproj", guid));
    expect(sln).toContain(`Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Space Game", "Space Game.csproj", "{${guid}}"`);
    for (const config of ["Debug", "ExportDebug", "ExportRelease"]) expect(sln).toContain(`\t\t{${guid}}.${config}|Any CPU.Build.0 = ${config}|Any CPU`);
    expect(r.notes.join("\n")).toMatch(/\.NET build of Godot/);
    // The scan reads it back, and the check would find the project to build.
    expect(scanProject(dir).warnings).toEqual([]);
    expect(findCSharpProject(dir)).toEqual({ csproj: "Space Game.csproj", sln: "Space Game.sln" });
    // A name that is a namespace needs no RootNamespace; one that cannot be a file name is refused.
    expect(csprojText("Game")).not.toContain("RootNamespace");
    expect(sanitizeNamespace("3D Demo: C#")).toBe("_3D_Demo__C_");
    expect(() => newProject(join(dir, "..", "bad"), { name: "A/B", dotnet: true })).toThrow(/characters a file name cannot hold/);
    // Without the option nothing about C# is written.
    const plain = newProject(join(dir, "..", "plain"));
    expect(plain.created).toHaveLength(7);
    expect(readFileSync(join(plain.project, "project.godot"), "utf8")).not.toMatch(/dotnet|C#/);
  });
});
