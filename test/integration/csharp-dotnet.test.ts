import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCSharp, findDotnet } from "../../src/check/csharp-build.js";
import { GODOT_NET_SDK, newProject } from "../../src/scaffold/project.js";
import { newScript } from "../../src/scaffold/script.js";
import { generatedCSharpProject } from "../csharp-helpers.js";
import { tempFolder } from "../helpers.js";

/**
 * Needs the .NET SDK (`dotnet` on PATH) and, for the first build, NuGet (the Godot.NET.Sdk package). No Godot needed:
 * the SDK package holds Godot's C# API.
 */
const DOTNET = findDotnet();

describe.skipIf(!DOTNET)("dotnet build on a generated C# project", () => {
  it("builds every C# template without errors or warnings, and reports real compiler errors by file and line", async () => {
    const root = generatedCSharpProject();
    const first = await buildCSharp(root);
    expect(first.diagnostics).toEqual([]);
    expect(first).toMatchObject({ status: "ok", target: "CsGame.sln", restored: true, errors: 0, warnings: 0, exitCode: 0 });
    expect(readFileSync(join(root, "CsGame.csproj"), "utf8")).toContain(`<Project Sdk="${GODOT_NET_SDK}">`);

    // Restored now (the Godot.NET.Sdk keeps obj/ under .godot/mono/temp): the next build does not go to the network.
    writeFileSync(
      join(root, "scripts", "Bad.cs"),
      ["using Godot;", "", "public partial class Bad : Node", "{", "\tpublic override void _Ready()", "\t{", "\t\tint count = missing + 1;", '\t\tstring unused = "x";', "\t}", "}", ""].join("\n"),
    );
    const failed = await buildCSharp(root);
    expect(failed).toMatchObject({ status: "failed", restored: false, errors: 1, warnings: 1, exitCode: 1 });
    expect(failed.command).toContain("--no-restore");
    expect(failed.diagnostics).toEqual([
      { severity: "error", file: "res://scripts/Bad.cs", line: 7, message: "CS0103: The name 'missing' does not exist in the current context", source: "csharp" },
      { severity: "warning", file: "res://scripts/Bad.cs", line: 8, message: "CS0219: The variable 'unused' is assigned but its value is never used", source: "csharp" },
    ]);

    // A warning is reported on every build, not only on the one that compiled the file.
    writeFileSync(join(root, "scripts", "Bad.cs"), ["using Godot;", "", "public partial class Bad : Node", "{", "\tpublic override void _Ready()", "\t{", '\t\tstring unused = "x";', "\t}", "}", ""].join("\n"));
    for (let i = 0; i < 2; i++) {
      const warned = await buildCSharp(root);
      expect(warned).toMatchObject({ status: "ok", errors: 0, warnings: 1 });
      expect(warned.diagnostics[0]).toMatchObject({ severity: "warning", file: "res://scripts/Bad.cs", line: 7 });
    }
    rmSync(join(root, "scripts", "Bad.cs"));

    // A project file that is not valid XML: an MSBuild error, in the .csproj.
    const csproj = join(root, "CsGame.csproj");
    writeFileSync(csproj, readFileSync(csproj, "utf8").replace("</PropertyGroup>", "</PropertyGrou>"));
    const broken = await buildCSharp(root);
    expect(broken).toMatchObject({ status: "failed", errors: 1 });
    expect(broken.diagnostics[0]).toMatchObject({ severity: "error", file: "res://CsGame.csproj", line: 5 });
    expect(broken.diagnostics[0]!.message).toMatch(/^MSB4025: The project file could not be loaded\./);
  }, 300_000);

  it("builds a project whose name is not a valid namespace", async () => {
    const root = join(tempFolder("gw-dotnet-"), "space");
    newProject(root, { name: "My 2D Game", dotnet: true });
    newScript(root, "res://Player.cs", { template: "character_2d" });
    const built = await buildCSharp(root);
    expect(built.diagnostics).toEqual([]);
    expect(built).toMatchObject({ status: "ok", target: "My 2D Game.sln" });
  }, 300_000);
});
