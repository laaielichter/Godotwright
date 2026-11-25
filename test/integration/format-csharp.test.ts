import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildCSharp, findDotnet } from "../../src/check/csharp-build.js";
import { formatProjectAll } from "../../src/format/project.js";
import { undoJournal } from "../../src/journal/journal.js";
import { generatedCSharpProject } from "../csharp-helpers.js";

/** Needs the .NET SDK (`dotnet format` is part of it) and NuGet for the first build. Ran with dotnet 8.0.134 and Godot.NET.Sdk 4.7.0. */
const DOTNET = findDotnet();

const UGLY = `using Godot;

public partial class Ugly:Node
{
    [Export] public int   Speed {get;set;}=3;
  public override void _Ready( ){
        if(Speed>2){GD.Print( "a  b" );}
	var d=new Godot.Collections.Dictionary<string,int>();
	GD.Print(d);
  }
}
`;

describe.skipIf(!DOTNET)("godot_format on C# with the real dotnet format", () => {
  let root = "";
  const read = (file: string) => readFileSync(join(root, file), "utf8");

  beforeAll(async () => {
    root = generatedCSharpProject();
    expect((await buildCSharp(root)).status).toBe("ok");
    writeFileSync(join(root, "scripts", "Ugly.cs"), UGLY);
  }, 300_000);

  it("leaves the generated templates alone (tabs, by the project's .editorconfig) and lists the file that needs it", { timeout: 300_000 }, async () => {
    const report = await formatProjectAll(root);
    expect(report.skipped).toEqual([]);
    expect(report.changed.map((c) => c.file)).toEqual(["res://scripts/Ugly.cs"]);
    expect(report.changed[0]!.lines).toBeGreaterThan(3);
    expect(read("scripts/Ugly.cs")).toBe(UGLY);
  });

  it("formats the file, with the outline unchanged and the project building, and undo puts it back", { timeout: 300_000 }, async () => {
    const report = await formatProjectAll(root, { write: true, files: ["res://scripts/Ugly.cs"] });
    expect(report.skipped).toEqual([]);
    expect(report.changed.map((c) => c.file)).toEqual(["res://scripts/Ugly.cs"]);
    expect(read("scripts/Ugly.cs")).toBe(
      [
        "using Godot;",
        "",
        "public partial class Ugly : Node",
        "{",
        "\t[Export] public int Speed { get; set; } = 3;",
        "\tpublic override void _Ready()",
        "\t{",
        '\t\tif (Speed > 2) { GD.Print("a  b"); }',
        "\t\tvar d = new Godot.Collections.Dictionary<string, int>();",
        "\t\tGD.Print(d);",
        "\t}",
        "}",
        "",
      ].join("\n"),
    );
    expect(report.notes).toContain("C#: formatted by dotnet format; the outline of every file is the same as before and the project builds");
    // Stable: a second run changes nothing.
    expect((await formatProjectAll(root)).changed).toEqual([]);
    expect(undoJournal(root).undone).toHaveLength(1);
    expect(read("scripts/Ugly.cs")).toBe(UGLY);
  });

  it("keeps nothing when the project does not build", { timeout: 300_000 }, async () => {
    writeFileSync(join(root, "scripts", "Wip.cs"), "using Godot;\n\npublic partial class Wip : Node\n{\n\tpublic int X = nope;\n}\n");
    const report = await formatProjectAll(root, { write: true, files: ["res://scripts/Ugly.cs"] });
    expect(report.changed).toEqual([]);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]!.reason).toMatch(/^the project does not build \(res:\/\/scripts\/Wip\.cs:5: CS0103: The name 'nope' does not exist in the current context\)/);
    expect(read("scripts/Ugly.cs")).toBe(UGLY);
  });
});
