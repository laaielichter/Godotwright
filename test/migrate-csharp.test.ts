import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GodotApi } from "../src/api/api.js";
import { csharpProjectContext, migrateCSharp, migrateCsproj, migrateSln } from "../src/migrate/csharp.js";
import { formatMigration, migrateProject, migrateProjectChecked } from "../src/migrate/migrate.js";

const api = GodotApi.load();
const run = (source: string, others: string[] = []) => migrateCSharp(source, api, csharpProjectContext([source, ...others]));

describe("C# migration from Godot 3", () => {
  it("makes Godot classes partial, also through a project base class, and leaves plain C# classes alone", () => {
    const r = run("using Godot;\npublic class Hud : CanvasLayer { }\npublic class Boss : Enemy { }\npublic class Enemy : KinematicBody2D { }\npublic class Data { }\ninternal sealed class Tool : Godot.Node { }\n");
    expect(r.code).toBe("using Godot;\npublic partial class Hud : CanvasLayer { }\npublic partial class Boss : Enemy { }\npublic partial class Enemy : CharacterBody2D { }\npublic class Data { }\ninternal sealed partial class Tool : Godot.Node { }\n");
  });

  it("gives signal delegates the EventHandler name, and nameof(Signal) becomes SignalName", () => {
    const hud = "using Godot;\npublic class Hud : CanvasLayer\n{\n    [Signal]\n    public delegate void StartGame();\n\n    void F() { EmitSignal(nameof(StartGame)); }\n}\n";
    const main = "using Godot;\npublic class Main : Node\n{\n    void F(Hud hud) { hud.Connect(nameof(Hud.StartGame), this, nameof(Go)); }\n    void Go() { }\n}\n";
    expect(run(hud, [main]).code).toContain("public delegate void StartGameEventHandler();");
    expect(run(hud, [main]).code).toContain("EmitSignal(SignalName.StartGame);");
    expect(run(main, [hud]).code).toContain("hud.Connect(Hud.SignalName.StartGame, new Callable(this, nameof(Go)));");
  });

  it("turns Connect, Disconnect and IsConnected into the Callable form, and binds into a TO DO", () => {
    const src = 'using Godot;\npublic class M : Node\n{\n    void F(Node t)\n    {\n        t.Connect("a", this, nameof(G));\n        t.Connect("b", this, "G", null, 4);\n        t.Disconnect("a", this, nameof(G));\n        t.Connect("c", this, nameof(G), new Godot.Collections.Array { 1 });\n    }\n    void G() { }\n}\n';
    const r = run(src);
    expect(r.code).toContain('t.Connect("a", new Callable(this, nameof(G)));');
    expect(r.code).toContain('t.Connect("b", new Callable(this, "G"), 4);');
    expect(r.code).toContain('t.Disconnect("a", new Callable(this, nameof(G)));');
    expect(r.left).toEqual([{ line: 9, message: expect.stringContaining("Connect with binds") }]);
  });

  it("moves the SceneTree's multiplayer API to Multiplayer, signal names included", () => {
    const r = run('using Godot;\npublic class L : Node\n{\n    void F()\n    {\n        GetTree().Connect("network_peer_connected", this, nameof(P));\n        GetTree().NetworkPeer = null;\n        if (GetTree().IsNetworkServer()) { }\n    }\n    void P(int id) { }\n}\n');
    expect(r.code).toContain('Multiplayer.Connect("peer_connected", new Callable(this, nameof(P)));');
    expect(r.code).toContain("Multiplayer.MultiplayerPeer = null;");
    expect(r.code).toContain("if (Multiplayer.IsServer()) { }");
  });

  it("renames classes and types, Godot.Object, and Transform only where it is a type", () => {
    const src = "using Godot;\npublic class S : Spatial\n{\n    Object o;\n    Godot.Object g;\n    Transform t = Transform.Identity;\n    void F() { var x = Transform.origin; Transform = new Transform(); Texture tex = GD.Load<Texture>(\"a\"); }\n}\n";
    const r = run(src);
    expect(r.code).toContain("public partial class S : Node3D");
    expect(r.code).toContain("GodotObject o;");
    expect(r.code).toContain("Godot.GodotObject g;");
    expect(r.code).toContain("Transform3D t = Transform3D.Identity;");
    // The property Transform of Node3D stays; its origin field is Origin now.
    expect(r.code).toContain("var x = Transform.Origin; Transform = new Transform3D();");
    expect(r.code).toContain('Texture2D tex = GD.Load<Texture2D>("a");');
  });

  it("renames members only where the type says they are Godot 3's, and fields of math types to PascalCase", () => {
    const src = 'using Godot;\npublic class M : Node2D\n{\n    [Export] public PackedScene Scene;\n    void F(Vector2 v)\n    {\n        var p = GetNode<PathFollow2D>("P");\n        p.Offset = 3;\n        var s = GetNode<Sprite>("S");\n        s.Offset = Vector2.Zero;\n        var m = (Node2D)Scene.Instance();\n        var a = v.x + Position.y;\n        var k = GetNode<AnimatedSprite>("A");\n        k.Playing = true;\n        GD.RandRange(0, 1);\n    }\n}\n';
    const r = run(src);
    expect(r.code).toContain("p.Progress = 3;");
    // Sprite2D still has offset: nothing to rename.
    expect(r.code).toContain("s.Offset = Vector2.Zero;");
    expect(r.code).toContain("Scene.Instantiate()");
    expect(r.code).toContain("var a = v.X + Position.Y;");
    expect(r.code).toContain("k.Play();");
    // GD has its own C# API: the GDScript-shaped table does not apply to it.
    expect(r.code).toContain("GD.RandRange(0, 1);");
  });

  it("keeps the project's own members, strings and comments as they are", () => {
    const src = 'using Godot;\npublic struct P { public float x; }\npublic class M : Node\n{\n    // Spatial and Instance() in a comment\n    void F(P p) { var s = "Spatial.Instance()"; var q = p.x; }\n}\n';
    const r = run(src);
    expect(r.code).toContain("// Spatial and Instance() in a comment");
    expect(r.code).toContain('var s = "Spatial.Instance()"; var q = p.x;');
  });

  it("gives _Process a double, RPC attributes their Godot 4 form, and moved Engine members", () => {
    const src = "using Godot;\npublic class M : Node\n{\n    [RemoteSync] void A() { }\n    [Puppet] void B() { }\n    [Master] void C() { }\n    public override void _Process(float delta)\n    {\n        if (Engine.EditorHint) return;\n        var t = OS.GetTicksMsec();\n    }\n}\n";
    const r = run(src);
    expect(r.code).toContain("[Rpc(MultiplayerApi.RpcMode.AnyPeer, CallLocal = true)] void A()");
    expect(r.code).toContain("[Rpc] void B()");
    expect(r.code).toContain("public override void _Process(double deltaDouble)\n    {\n        float delta = (float)deltaDouble;\n        if (Engine.IsEditorHint()) return;\n        var t = Time.GetTicksMsec();");
    expect(r.left.map((l) => l.line)).toEqual([6]);
  });

  it("upgrades the .csproj and .sln as Godot's editor does", () => {
    const csproj = migrateCsproj('<Project Sdk="Godot.NET.Sdk/3.3.0">\n  <PropertyGroup>\n    <TargetFramework>net472</TargetFramework>\n    <RootNamespace>Dodge</RootNamespace>\n  </PropertyGroup>\n</Project>', "Dodge");
    expect(csproj.code).toBe('<Project Sdk="Godot.NET.Sdk/4.7.2">\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>\n    <RootNamespace>Dodge</RootNamespace>\n  </PropertyGroup>\n</Project>');
    expect(migrateCsproj('<?xml version="1.0"?>\n<Project ToolsVersion="4.0"></Project>', "Old").left[0]?.message).toContain("add back any NuGet packages");
    const sln = migrateSln("\tDebug|Any CPU = Debug|Any CPU\n\tRelease|Any CPU = Release|Any CPU\n\tTools|Any CPU = Tools|Any CPU\n");
    expect(sln.code).toBe("\tDebug|Any CPU = Debug|Any CPU\n\tExportDebug|Any CPU = ExportDebug|Any CPU\n\tExportRelease|Any CPU = ExportRelease|Any CPU\n");
  });

  it("migrates the C# of a project with the GDScript, and says when it could not build it", async () => {
    const root = mkdtempSync(join(tmpdir(), "godotwright-mig-cs-"));
    writeFileSync(join(root, "project.godot"), "config_version=4\n");
    writeFileSync(join(root, "Game.csproj"), '<Project Sdk="Godot.NET.Sdk/3.3.0">\n  <PropertyGroup>\n    <TargetFramework>net472</TargetFramework>\n  </PropertyGroup>\n</Project>');
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "Hud.cs"), "using Godot;\npublic class Hud : CanvasLayer { }\n");
    writeFileSync(join(root, "a.gd"), "extends Spatial\n");
    const dry = migrateProject(root);
    expect(dry.files.map((f) => f.file).sort()).toEqual(["res://Game.csproj", "res://a.gd", "res://src/Hud.cs"]);
    expect(readFileSync(join(root, "src", "Hud.cs"), "utf8")).toBe("using Godot;\npublic class Hud : CanvasLayer { }\n");
    const saved = process.env["PATH"];
    process.env["PATH"] = "/nonexistent";
    try {
      const checked = await migrateProjectChecked(root);
      expect(checked.build?.status).toBe("no-dotnet");
      expect(formatMigration(checked)).toContain("C#: trial build of the migrated code: dotnet is not on PATH");
    } finally {
      process.env["PATH"] = saved;
    }
  });
});
