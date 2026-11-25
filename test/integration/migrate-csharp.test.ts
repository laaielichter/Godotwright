import { cpSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCSharp, findDotnet } from "../../src/check/csharp-build.js";
import { migrateProject } from "../../src/migrate/migrate.js";
import { makeProject, tempFolder } from "../helpers.js";

/**
 * Needs the .NET SDK and NuGet (Godot.NET.Sdk 4.7.0). Godot 3 C# code is migrated and then compiled against Godot 4's
 * API by the real compiler. Ran with dotnet 8.0.134.
 *
 * With `GODOT3_MONO_DEMOS=<folder>` (the `mono/` folder of the 3.x branch of godotengine/godot-demo-projects) the
 * official Godot 3 C# demos are migrated on a copy and built too. They are not part of this repository.
 */
const DOTNET = findDotnet();
const DEMOS = process.env["GODOT3_MONO_DEMOS"];

const CSPROJ = '<Project Sdk="Godot.NET.Sdk/3.3.0">\n  <PropertyGroup>\n    <TargetFramework>net472</TargetFramework>\n    <RootNamespace>OldGame</RootNamespace>\n  </PropertyGroup>\n</Project>\n';

const PLAYER = `using Godot;

public class Player : KinematicBody2D
{
    [Signal]
    public delegate void Hit();

    [Signal]
    public delegate void Scored(int points);

    [Export(PropertyHint.ExpRange, "1,1000,1")]
    public int speed = 400;

    public Vector2 screenSize;
    private Object _last;

    public override void _Ready()
    {
        screenSize = GetViewportRect().Size;
        GetNode<Timer>("Timer").Connect("timeout", this, nameof(OnTimeout));
        Connect(nameof(Hit), this, "OnHit");
        GetNode<Area2D>("Area").Connect("body_entered", this, nameof(OnBody), new Godot.Collections.Array(), (int) ConnectFlags.Deferred);
    }

    public override void _PhysicsProcess(float delta)
    {
        var velocity = Vector2.Zero;
        if (Input.IsActionPressed("ui_right")) velocity.x += 1;
        if (Input.IsActionPressed("ui_down")) velocity.y += 1;
        var sprite = GetNode<AnimatedSprite>("AnimatedSprite");
        if (velocity.Length() > 0)
        {
            velocity = velocity.Normalized() * speed;
            sprite.Playing = true;
        }
        Position += velocity * delta;
        Position = new Vector2(x: Mathf.Clamp(Position.x, 0, screenSize.x), y: Mathf.Clamp(Position.y, 0, screenSize.y));
        sprite.FlipH = velocity.x < 0;
        Rotation = Mathf.Deg2Rad(90) * delta;
        if (Name.ToLower() == "player" && !Engine.EditorHint) _last = this;
    }

    public void OnTimeout()
    {
        ulong now = OS.GetTicksMsec();
        EmitSignal(nameof(Scored), (int)(now % 10));
        EmitSignal("Hit");
    }

    public void OnHit()
    {
        var scene = ResourceLoader.Load<PackedScene>("res://mob.tscn");
        var mob = (RigidBody2D)scene.Instance();
        GetParent().AddChild(mob);
        var marker = GetNode<Position2D>("Start");
        mob.Position = marker.Position;
        var follow = GetNode<PathFollow2D>("Path/Follow");
        follow.Offset = GD.Randi();
        mob.LinearVelocity = new Vector2((float)GD.RandRange(150.0, 250.0), 0).Rotated(follow.Rotation);
    }

    public void OnBody(PhysicsBody2D body)
    {
        Hide();
        GetNode<CollisionShape2D>("Shape").SetDeferred("disabled", true);
    }
}
`;

const NET = `using Godot;

public class Lobby : Control
{
    [Signal]
    public delegate void GameFinished();

    [Puppet]
    private void SetPos(Vector2 pos)
    {
        RectPosition = pos;
    }

    public override void _Ready()
    {
        GetTree().Connect("network_peer_connected", this, nameof(PlayerConnected));
        if (GetTree().IsNetworkServer()) SetNetworkMaster(1);
    }

    private void PlayerConnected(int id)
    {
        if (IsNetworkMaster()) Rpc(nameof(SetPos), Vector2.Zero);
        EmitSignal(nameof(GameFinished));
    }
}
`;

describe.skipIf(!DOTNET)("godot_migrate on Godot 3 C# with the real compiler", () => {
  it("migrates a Godot 3 C# project so that it builds against Godot 4", { timeout: 300_000 }, async () => {
    const root = makeProject({ "project.godot": 'config_version=4\n\n[application]\n\nconfig/name="OldGame"\n', "OldGame.csproj": CSPROJ, "Player.cs": PLAYER, "Lobby.cs": NET });
    const migrated = migrateProject(root, { write: true });
    expect(migrated.left).toBe(0);
    expect(migrated.files.map((f) => f.file)).toEqual(["res://Lobby.cs", "res://OldGame.csproj", "res://Player.cs"]);
    const built = await buildCSharp(root);
    expect(built.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(built.status).toBe("ok");
    // A second run finds nothing more to do.
    expect(migrateProject(root).files).toEqual([]);
  });

  it.skipIf(!DEMOS)("migrates the official Godot 3 C# demos; dodge_the_creeps and pong build", { timeout: 900_000 }, async () => {
    const copy = join(tempFolder("gw-demos3-"), "mono");
    cpSync(DEMOS!, copy, { recursive: true });
    const report: string[] = [];
    const errorsOf: Record<string, number> = {};
    for (const demo of readdirSync(copy).filter((d) => existsSync(join(copy, d, "project.godot"))).sort()) {
      const migrated = migrateProject(join(copy, demo), { write: true, includeAddons: true });
      const built = await buildCSharp(join(copy, demo));
      const errors = built.diagnostics.filter((d) => d.severity === "error");
      errorsOf[demo] = errors.length;
      report.push(`${demo}: ${built.status === "ok" ? "builds" : `${errors.length} errors`}, ${migrated.changes} changes, ${migrated.left} TO DOs${errors.length ? `; first: ${errors.slice(0, 5).map((e) => `${e.file}:${e.line} ${e.message.slice(0, 80)}`).join(" | ")}` : ""}`);
    }
    console.log(report.join("\n"));
    expect(errorsOf["dodge_the_creeps"]).toBe(0);
    expect(errorsOf["pong"]).toBe(0);
  });
});
