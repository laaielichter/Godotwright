import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GodotApi } from "../src/api/api.js";
import { undoJournal } from "../src/journal/journal.js";
import { csharpMigrationContext, godot3CSharpName, migrateCSharp, migrateCsproj } from "../src/migrate/csharp.js";
import { formatMigration, migrateProject } from "../src/migrate/migrate.js";
import { DOTNET_TARGET_FRAMEWORK, GODOT_NET_SDK } from "../src/scaffold/project.js";
import { makeProject } from "./helpers.js";

const api = GodotApi.load();
const migrate = (source: string, others: string[] = []) => migrateCSharp(source, api, csharpMigrationContext([source, ...others]));
/** The body of a Godot 3 node class, migrated; only the body comes back. */
const body = (lines: string, others: string[] = []) => {
  const out = migrate(`using Godot;\n\npublic partial class T : Node\n{\n${lines}\n}\n`, others);
  return { ...out, code: out.code.split("\n").slice(4, -2).join("\n") };
};

describe("C# migration from Godot 3 to Godot 4", () => {
  it("makes script classes partial, with the classes around them", () => {
    const out = migrate("using Godot;\n\npublic class Player : KinematicBody2D\n{\n\tpublic class Inner : Node\n\t{\n\t}\n}\n\npublic static class Util\n{\n}\n\npublic class Plain\n{\n}\n\ninternal sealed class Stats : Resource, ISaved\n{\n}\n");
    expect(out.code).toContain("public partial class Player : CharacterBody2D");
    expect(out.code).toContain("\tpublic partial class Inner : Node");
    expect(out.code).toContain("public static class Util");
    // No base class: nothing asks for partial.
    expect(out.code).toContain("public class Plain\n");
    expect(out.code).toContain("internal sealed partial class Stats : Resource, ISaved");
    expect(out.changes.filter((c) => c.rule === "partial").map((c) => c.line)).toEqual([3, 5, 18]);
    // Already Godot 4: nothing changes.
    expect(migrate(out.code).changes).toEqual([]);
  });

  it("renames signal delegates and names the signal by SignalName where it is declared", () => {
    const out = body('\t[Signal]\n\tpublic delegate void Hit();\n\n\t[Signal] public delegate void ScoredEventHandler(int n);\n\n\tvoid Run()\n\t{\n\t\tEmitSignal(nameof(Hit));\n\t\tEmitSignal("Hit");\n\t\tEmitSignal("Scored", 1);\n\t\tEmitSignal("body_entered");\n\t\tConnect(nameof(Hit), this, nameof(Run));\n\t\tGD.Print("Hit", nameof(Run));\n\t}');
    expect(out.code).toBe(
      '\t[Signal]\n\tpublic delegate void HitEventHandler();\n\n\t[Signal] public delegate void ScoredEventHandler(int n);\n\n\tvoid Run()\n\t{\n\t\tEmitSignal(SignalName.Hit);\n\t\tEmitSignal(SignalName.Hit);\n\t\tEmitSignal(SignalName.Scored, 1);\n\t\tEmitSignal("body_entered");\n\t\tConnect(SignalName.Hit, new Callable(this, nameof(Run)));\n\t\tGD.Print("Hit", nameof(Run));\n\t}',
    );
    // A signal of another class of the project, and one inherited from a project class.
    const other = "using Godot;\npublic class Enemy : Node\n{\n\t[Signal] public delegate void Died();\n}\n";
    expect(body("\tvoid Run(Enemy e)\n\t{\n\t\te.Connect(nameof(Enemy.Died), this, nameof(Run));\n\t}", [other]).code).toContain("e.Connect(Enemy.SignalName.Died, new Callable(this, nameof(Run)));");
    const child = migrate("using Godot;\npublic class Boss : Enemy\n{\n\tvoid Die() { EmitSignal(nameof(Died)); }\n}\n", [other]);
    expect(child.code).toContain("EmitSignal(SignalName.Died);");
    const stranger = body("\tvoid Run(Node e)\n\t{\n\t\te.Connect(nameof(Died), this, nameof(Run));\n\t}", [other]);
    expect(stranger.left).toEqual([{ line: 7, message: "nameof(Died) names a [Signal] of another class, whose delegate is now DiedEventHandler: write TheClass.SignalName.Died" }]);
  });

  it("gives Connect, Disconnect and IsConnected a Callable", () => {
    const out = body(
      [
        '\t\ttimer.Connect("timeout", this, nameof(OnTimeout));',
        '\t\ttimer.Connect("timeout", this, "OnTimeout");',
        '\t\tGetNode<Button>("B").Connect("pressed", GetParent(), nameof(Main.Start));',
        '\t\tpong.Connect("GameFinished", this, nameof(EndGame), new Godot.Collections.Array(), (int) ConnectFlags.Deferred);',
        '\t\tarea.Connect("body_entered", this, nameof(OnBody), new Godot.Collections.Array { 1 });',
        '\t\tif (timer.IsConnected("timeout", this, nameof(OnTimeout))) timer.Disconnect("timeout", this, nameof(OnTimeout));',
        '\t\ttimer.Connect("timeout", new Callable(this, nameof(OnTimeout)));',
        '\t\ttimer.Connect("timeout", Callable.From(OnTimeout), (uint)ConnectFlags.OneShot);',
        '\t\tsocket.Connect("host", 80, "x");',
      ].join("\n"),
    );
    expect(out.code.split("\n")).toEqual([
      '\t\ttimer.Connect("timeout", new Callable(this, nameof(OnTimeout)));',
      '\t\ttimer.Connect("timeout", new Callable(this, "OnTimeout"));',
      '\t\tGetNode<Button>("B").Connect("pressed", new Callable(GetParent(), nameof(Main.Start)));',
      '\t\tpong.Connect("GameFinished", new Callable(this, nameof(EndGame)), (uint)((int) ConnectFlags.Deferred));',
      '\t\tarea.Connect("body_entered", this, nameof(OnBody), new Godot.Collections.Array { 1 });',
      '\t\tif (timer.IsConnected("timeout", new Callable(this, nameof(OnTimeout)))) timer.Disconnect("timeout", new Callable(this, nameof(OnTimeout)));',
      '\t\ttimer.Connect("timeout", new Callable(this, nameof(OnTimeout)));',
      '\t\ttimer.Connect("timeout", Callable.From(OnTimeout), (uint)ConnectFlags.OneShot);',
      // Not Godot's Connect: the third argument is a string, so it is rewritten like one. The compiler says so.
      '\t\tsocket.Connect("host", new Callable(80, "x"));',
    ]);
    expect(out.left).toEqual([
      { line: 9, message: expect.stringContaining("Connect with bound arguments") },
      { line: 9, message: expect.stringContaining("Godot.Collections.Array holds Variant in Godot 4") },
    ]);
  });

  it("renames classes and members from Godot's rename table, in their C# names", () => {
    expect(godot3CSharpName("deg2rad")).toBe("Deg2Rad");
    expect(godot3CSharpName("is_network_server")).toBe("IsNetworkServer");
    expect(godot3CSharpName("_about_to_show")).toBe("_AboutToShow");
    const out = body(
      [
        "\tprivate Spatial _node;",
        "\tprivate Godot.Object _thing;",
        "\tprivate Object _other;",
        "\tprivate HTTPRequest _http;",
        "\tprivate AABB _box;",
        "\tvoid Run()",
        "\t{",
        '\t\tvar sprite = GetNode<AnimatedSprite>("AnimatedSprite");',
        "\t\tvar mob = (RigidBody2D)scene.Instance();",
        "\t\tfloat a = Mathf.Deg2Rad(90) + (float)GD.RandRange(0, 1);",
        "\t\t_node.Translation = Vector3.Zero;",
        "\t\tvar key = KeyList.Space;",
        '\t\tGD.Print("Spatial", Area, _node.Area);',
        "\t}",
      ].join("\n"),
    );
    expect(out.code.split("\n")).toEqual([
      "\tprivate Node3D _node;",
      "\tprivate GodotObject _thing;",
      "\tprivate GodotObject _other;",
      "\tprivate HttpRequest _http;",
      "\tprivate Aabb _box;",
      "\tvoid Run()",
      "\t{",
      '\t\tvar sprite = GetNode<AnimatedSprite2D>("AnimatedSprite");',
      "\t\tvar mob = (RigidBody2D)scene.Instantiate();",
      // GD.RandRange is still there in C#.
      "\t\tfloat a = Mathf.DegToRad(90) + (float)GD.RandRange(0, 1);",
      "\t\t_node.Position = Vector3.Zero;",
      "\t\tvar key = Key.Space;",
      // A string, and a member named like a Godot 3 class: not the class.
      '\t\tGD.Print("Spatial", Area, _node.Area);',
      "\t}",
    ]);
    // A class of the project with a Godot 3 name is the project's.
    const own = "using Godot;\npublic class Spatial : Node { }\npublic class Holder : Node { Spatial s; }\n";
    expect(migrate(own).code).toContain("Holder : Node { Spatial s; }");
    // System's Object is not Godot's.
    expect(migrate("using System;\nusing Godot;\npublic partial class A : Node { Object o; Godot.Object g; }\n").code).toContain("{ Object o; GodotObject g; }");
    // Not a Godot file: untouched.
    const plain = "using System;\n\npublic class Spatial\n{\n\tpublic float x;\n}\n";
    expect(migrate(plain)).toEqual({ code: plain, changes: [], left: [] });
  });

  it("gives _Process a double, and keeps the body computing in float", () => {
    const out = body("\tpublic override void _Process(float delta)\n\t{\n\t\tPosition += velocity * delta;\n\t\tdelta /= 2;\n\t\tbase._Process(delta);\n\t\tMove((float)delta, this.delta);\n\t}\n\n\tpublic override void _PhysicsProcess(real_t dt)\n\t{\n\t\tStep(dt);\n\t}\n\n\tpublic void Other(float delta)\n\t{\n\t\tStep(delta);\n\t}");
    expect(out.code).toBe(
      "\tpublic override void _Process(double delta)\n\t{\n\t\tPosition += velocity * (float)delta;\n\t\tdelta /= 2;\n\t\tbase._Process(delta);\n\t\tMove((float)delta, this.delta);\n\t}\n\n\tpublic override void _PhysicsProcess(double dt)\n\t{\n\t\tStep((real_t)dt);\n\t}\n\n\tpublic void Other(float delta)\n\t{\n\t\tStep(delta);\n\t}",
    );
  });

  it("writes struct fields in PascalCase, unless the project has a member of that name and the type is unknown", () => {
    const out = body("\tvoid Run(Vector2 v)\n\t{\n\t\tv.x += 1;\n\t\tvar p = new Vector2(x: v.y, y: 0);\n\t\tif (v.x < 0 && GetViewportRect().Size.x > 2) c.a = 0.5f;\n\t\tvar o = t.origin.z + rect.position.x + rect.size.y;\n\t\titems.x();\n\t}");
    expect(out.code).toBe("\tvoid Run(Vector2 v)\n\t{\n\t\tv.X += 1;\n\t\tvar p = new Vector2(x: v.Y, y: 0);\n\t\tif (v.X < 0 && GetViewportRect().Size.X > 2) c.A = 0.5f;\n\t\tvar o = t.Origin.Z + rect.Position.X + rect.Size.Y;\n\t\titems.x();\n\t}");
    const own = "using Godot;\npublic struct Cell { public int x; public int y; }\n";
    const mixed = body("\tvoid Run(Vector2 v, Cell cell)\n\t{\n\t\tv.x = cell.x;\n\t\tvar w = other.y;\n\t\tvar c = col.r;\n\t}", [own]);
    // v is declared as a Vector2 here; cell is the project's; other is unknown.
    expect(mixed.code).toBe("\tvoid Run(Vector2 v, Cell cell)\n\t{\n\t\tv.X = cell.x;\n\t\tvar w = other.y;\n\t\tvar c = col.R;\n\t}");
    expect(mixed.left.map((l) => l.line)).toEqual([7, 8]);
    expect(mixed.left[1]!.message).toContain('.y is .Y in Godot 4 when this is a Godot struct');
  });

  it("moves what moved one to one, and names the rest in a TO DO", () => {
    const out = body(
      [
        "\tvoid Run()",
        "\t{",
        "\t\tulong t = OS.GetTicksMsec();",
        "\t\tif (Engine.EditorHint) return;",
        "\t\tOS.SetWindowTitle(JSON.Print(data));",
        "\t\tOS.WindowFullscreen = true;",
        "\t\tvar size = OS.WindowSize;",
        "\t\tOS.Alert(OS.GetName());",
        "\t}",
      ].join("\n"),
    );
    expect(out.code.split("\n").slice(2, 8)).toEqual([
      "\t\tulong t = Time.GetTicksMsec();",
      "\t\tif (Engine.IsEditorHint()) return;",
      "\t\tDisplayServer.WindowSetTitle(Json.Stringify(data));",
      "\t\tOS.WindowFullscreen = true;",
      "\t\tvar size = OS.WindowSize;",
      "\t\tOS.Alert(OS.GetName());",
    ]);
    expect(out.left).toEqual([
      { line: 10, message: "OS.WindowFullscreen is gone in Godot 4: use DisplayServer.WindowSetMode(DisplayServer.WindowMode.Fullscreen) / WindowGetMode()" },
      { line: 11, message: "OS.WindowSize is gone in Godot 4: use DisplayServer.WindowGetSize() / WindowSetSize(), or GetWindow().Size" },
    ]);
  });

  it("maps export hints, RPC attributes and the networking that moved to the MultiplayerApi", () => {
    const out = body(
      [
        '\t[Export(PropertyHint.ExpRange, "1,100,1")] public float Zoom = 1;',
        "\t[Export(PropertyHint.Layers2dPhysics)] public uint Mask;",
        "\t[Remote] void A() { }",
        "\t[PuppetSync] void B() { }",
        "\t[Master] void C() { }",
        "\tvoid Run()",
        "\t{",
        '\t\tGetTree().Connect("network_peer_connected", this, nameof(A));',
        "\t\tif (GetTree().IsNetworkServer() && IsNetworkMaster()) GetTree().NetworkPeer = null;",
        "\t\tRpcUnreliable(nameof(A));",
        "\t\tRset(nameof(Zoom), 2);",
        "\t}",
      ].join("\n"),
    );
    expect(out.code.split("\n")).toEqual([
      '\t[Export(PropertyHint.Range, "1,100,1,exp")] public float Zoom = 1;',
      "\t[Export(PropertyHint.Layers2DPhysics)] public uint Mask;",
      "\t[Rpc(MultiplayerApi.RpcMode.AnyPeer)] void A() { }",
      "\t[Rpc(CallLocal = true)] void B() { }",
      "\t[Master] void C() { }",
      "\tvoid Run()",
      "\t{",
      '\t\tMultiplayer.Connect("peer_connected", new Callable(this, nameof(A)));',
      "\t\tif (Multiplayer.IsServer() && IsMultiplayerAuthority()) Multiplayer.MultiplayerPeer = null;",
      "\t\tRpcUnreliable(nameof(A));",
      "\t\tRset(nameof(Zoom), 2);",
      "\t}",
    ]);
    expect(out.left.map((l) => [l.line, l.message.slice(0, 32)])).toEqual([
      [9, "[Master] is gone in Godot 4: use"],
      [14, "RpcUnreliable() is gone in Godot"],
      [15, "Rset() is gone in Godot 4: prope"],
    ]);
  });

  it("renames a member of one class only where the receiver is declared with that class", () => {
    const out = body(
      [
        "\tvoid Run(PathFollow2D follow, AnimatedSprite sprite)",
        "\t{",
        "\t\tfollow.Offset = 3;",
        "\t\tsprite.Playing = true;",
        "\t\tsprite.Playing = false;",
        "\t\tvar names = sprite.Frames.GetAnimationNames();",
        "\t\tif (sprite.Playing) camera.Offset = Vector2.Zero;",
        '\t\tstring n = Name.ToLower() + other.Name.Substring(1) + Name;',
        "\t}",
      ].join("\n"),
    );
    expect(out.code.split("\n").slice(2, 8)).toEqual([
      "\t\tfollow.Progress = 3;",
      "\t\tsprite.Play();",
      "\t\tsprite.Stop();",
      "\t\tvar names = sprite.SpriteFrames.GetAnimationNames();",
      "\t\tif (sprite.Playing) camera.Offset = Vector2.Zero;",
      "\t\tstring n = Name.ToString().ToLower() + other.Name.ToString().Substring(1) + Name;",
    ]);
    expect(out.left.map((l) => l.line)).toEqual([11, 11]);
    expect(out.left[0]!.message).toBe("AnimatedSprite2D.Playing is gone in Godot 4: IsPlaying() reads it, Play() and Stop() set it");
    expect(out.left[1]!.message).toContain("camera.Offset: if camera is one of these, PathFollow2D.Offset is Progress");
  });

  it("says what Variant changes for Godot's collections, and renames Dictionary.Contains", () => {
    const out = migrate(
      [
        "using Godot;",
        "using Godot.Collections;",
        "",
        "public class Purchase",
        "{",
        "\tpublic Purchase(Dictionary purchase)",
        "\t{",
        '\t\tif (purchase.Contains("id")) Id = (string)purchase["id"];',
        '\t\tState = (PurchaseState)purchase["state"];',
        "\t\tforeach (var key in purchase.Keys)",
        "\t\t{",
        "\t\t\tswitch (key)",
        "\t\t\t{",
        '\t\t\t\tcase "a": break;',
        "\t\t\t}",
        "\t\t}",
        '\t\tbool ready = (payment.Call("isReady") as bool?) ?? false;',
        '\t\tif (list.Contains("x")) return;',
        "\t}",
        "}",
        "",
      ].join("\n"),
    );
    expect(out.code).toContain('if (purchase.ContainsKey("id")) Id = (string)purchase["id"];');
    expect(out.code).toContain('if (list.Contains("x")) return;');
    expect(out.left.map((l) => [l.line, l.message.slice(0, 40)])).toEqual([
      [9, "an element of a Godot collection is a Va"],
      [12, "if this switches on an element or key of"],
      [17, "Call() returns a Variant in Godot 4: `as"],
    ]);
  });

  it("lists what it cannot rewrite", () => {
    const out = body("\tprivate Texture _icon;\n\tvoid Run()\n\t{\n\t\tvar f = new File();\n\t\tvelocity = MoveAndSlide(velocity, Vector2.Up);\n\t\tMoveAndSlide();\n\t\tvar pad = JoystickList.Axis0;\n\t}");
    expect(out.left.map((l) => [l.line, l.message.slice(0, 36)])).toEqual([
      [5, "Texture is the abstract base class i"],
      [8, "new File() is gone in Godot 4: use F"],
      [9, "MoveAndSlide() takes no arguments in"],
      [11, "JoystickList is split in Godot 4: Jo"],
    ]);
  });

  it("migrates the .csproj to the Godot 4 SDK and target framework", () => {
    const old = '<Project Sdk="Godot.NET.Sdk/3.3.0">\r\n  <PropertyGroup>\r\n    <TargetFramework>net472</TargetFramework>\r\n    <RootNamespace>DodgeTheCreeps</RootNamespace>\r\n  </PropertyGroup>\r\n</Project>';
    const out = migrateCsproj(old, GODOT_NET_SDK, DOTNET_TARGET_FRAMEWORK);
    expect(out.code).toBe('<Project Sdk="Godot.NET.Sdk/4.7.0">\r\n  <PropertyGroup>\r\n    <TargetFramework>net8.0</TargetFramework>\r\n    <EnableDynamicLoading>true</EnableDynamicLoading>\r\n    <RootNamespace>DodgeTheCreeps</RootNamespace>\r\n  </PropertyGroup>\r\n</Project>');
    expect(out.changes.map((c) => c.rule)).toEqual(["sdk", "framework", "framework"]);
    // Already Godot 4: untouched.
    expect(migrateCsproj(out.code, GODOT_NET_SDK, DOTNET_TARGET_FRAMEWORK).changes).toEqual([]);
    // The long form of Godot 3.0 to 3.2: a TO DO, nothing rewritten.
    const long = '<?xml version="1.0" encoding="utf-8"?>\n<Project ToolsVersion="4.0" DefaultTargets="Build" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">\n  <ItemGroup>\n    <Reference Include="GodotSharp" />\n  </ItemGroup>\n</Project>\n';
    const kept = migrateCsproj(long, GODOT_NET_SDK, DOTNET_TARGET_FRAMEWORK);
    expect(kept.code).toBe(long);
    expect(kept.left[0]!.message).toContain("old MSBuild form of Godot 3.0 to 3.2");
    const refs = migrateCsproj('<Project Sdk="Godot.NET.Sdk/3.3.0">\n  <PropertyGroup>\n    <TargetFramework>net472</TargetFramework>\n    <LangVersion>8.0</LangVersion>\n  </PropertyGroup>\n  <ItemGroup>\n    <PackageReference Include="Microsoft.NETFramework.ReferenceAssemblies" Version="1.0.0" />\n  </ItemGroup>\n</Project>\n', GODOT_NET_SDK, DOTNET_TARGET_FRAMEWORK);
    // Lines of the file as it was.
    expect(refs.left.map((l) => l.line)).toEqual([7, 4]);
  });

  it("migrates C# next to GDScript in a project, through the journal", () => {
    const player = "using Godot;\n\npublic class Player : KinematicBody2D\n{\n\t[Signal]\n\tpublic delegate void Hit();\n\n\tpublic override void _Process(float delta)\n\t{\n\t\tPosition += Vector2.Right * delta;\n\t\tEmitSignal(nameof(Hit));\n\t}\n}\n";
    const root = makeProject({
      "project.godot": 'config_version=4\n\n[application]\n\nconfig/name="Old"\n',
      "Old.csproj": '<Project Sdk="Godot.NET.Sdk/3.3.0">\n  <PropertyGroup>\n    <TargetFramework>net472</TargetFramework>\n  </PropertyGroup>\n</Project>\n',
      "Player.cs": player,
      "main.gd": "extends KinematicBody2D\n\nfunc _ready():\n\tyield(get_tree(), \"idle_frame\")\n",
      "addons/tool/Tool.cs": "using Godot;\npublic class Tool : Spatial { }\n",
    });
    const dry = migrateProject(root);
    expect(dry.files.map((f) => f.file)).toEqual(["res://Old.csproj", "res://Player.cs", "res://main.gd"]);
    expect(readFileSync(join(root, "Player.cs"), "utf8")).toBe(player);
    expect(formatMigration(dry)).toContain("res://Player.cs (6 changes)");
    const wet = migrateProject(root, { write: true, includeAddons: true });
    expect(wet.files.map((f) => f.file)).toContain("res://addons/tool/Tool.cs");
    expect(readFileSync(join(root, "Player.cs"), "utf8")).toBe(
      "using Godot;\n\npublic partial class Player : CharacterBody2D\n{\n\t[Signal]\n\tpublic delegate void HitEventHandler();\n\n\tpublic override void _Process(double delta)\n\t{\n\t\tPosition += Vector2.Right * (float)delta;\n\t\tEmitSignal(SignalName.Hit);\n\t}\n}\n",
    );
    expect(readFileSync(join(root, "Old.csproj"), "utf8")).toContain('<Project Sdk="Godot.NET.Sdk/4.7.0">');
    expect(readFileSync(join(root, "main.gd"), "utf8")).toContain("extends CharacterBody2D");
    // One file, by path.
    expect(migrateProject(join(root, "Player.cs")).files).toEqual([]);
    undoJournal(root);
    expect(readFileSync(join(root, "Player.cs"), "utf8")).toBe(player);
  });
});
