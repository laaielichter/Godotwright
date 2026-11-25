import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { outlineShape } from "../src/format/csharp.js";
import { formatFormatReport, formatProject, formatProjectAll } from "../src/format/project.js";
import { undoJournal } from "../src/journal/journal.js";
import { fakeDotnetFormat } from "./fake-dotnet-format.js";
import { makeProject } from "./helpers.js";

const PROJECT = 'config_version=5\n\n[application]\n\nconfig/name="Cs"\nconfig/features=PackedStringArray("4.7", "C#")\n';
const UGLY = 'using Godot;\n\npublic partial class Ugly : Node\n{\n\t[Export] public int   Speed {get;set;} = 3;   \n\n\tpublic override void _Ready()\n\t{\n\t\tGD.Print("a  b",   Speed);\n\t}\n}\n';
const CLEAN = "using Godot;\n\npublic partial class Clean : Node\n{\n}\n";
const EVIL = 'using Godot;\n\npublic partial class Evil : Node\n{\n\t// evil\n\tpublic string  Name2 = "keep me";\n}\n';
const BREAKS = "using Godot;\n\npublic partial class Breaks : Node\n{\n\tpublic void  Run()\n\t{\n\t\t/*break*/\n\t}\n}\n";
const GD = "extends Node\n\n\nfunc _ready() -> void:\n\tvar x=1\n\tprint(x)\n";

function project(files: Record<string, string>, csproj = true): string {
  return makeProject({ "project.godot": PROJECT, ...(csproj ? { "Cs.csproj": "<Project />", ".godot/mono/temp/obj/project.assets.json": "{}" } : {}), ...files });
}
const read = (root: string, file: string) => readFileSync(join(root, file), "utf8");
const calls = (log: string) => readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[]);

describe("godot_format on C#", () => {
  it("lists what dotnet format would change without writing, restricted to the files", async () => {
    const root = project({ "Ugly.cs": UGLY, "Clean.cs": CLEAN, "sub/Other.cs": UGLY.replaceAll("Ugly", "Other"), "main.gd": GD });
    const dotnet = fakeDotnetFormat();
    const report = await formatProjectAll(root, { dotnet: dotnet.bin });
    expect(report).toMatchObject({ written: false, files: 4, unchanged: 1, skipped: [] });
    expect(report.changed).toEqual([
      { file: "res://Ugly.cs", lines: 2 },
      { file: "res://main.gd", lines: 1 },
      { file: "res://sub/Other.cs", lines: 2 },
    ]);
    expect(read(root, "Ugly.cs")).toBe(UGLY);
    expect(calls(dotnet.log)).toEqual([["format", "Cs.csproj", "--no-restore", "--include", "Clean.cs", "Ugly.cs", join("sub", "Other.cs"), "--verify-no-changes", "--report", expect.any(String), "-v", "q"]]);
    expect(formatFormatReport(report)).toContain("format: would format 3 of 4 scripts");
    expect(formatFormatReport(report)).toContain("note: C#: the count is of lines dotnet format would touch");
    // Only the named file, or the files of a folder.
    const one = await formatProjectAll(root, { dotnet: dotnet.bin, files: ["res://sub"] });
    expect(one.changed.map((c) => c.file)).toEqual(["res://sub/Other.cs"]);
    expect(calls(dotnet.log).at(-1)!.slice(3, 5)).toEqual(["--include", join("sub", "Other.cs")]);
    await expect(formatProjectAll(root, { dotnet: dotnet.bin, files: ["res://project.godot"] })).rejects.toThrow("is not a GDScript or C# file");
    // The GDScript-only entry point leaves C# alone.
    expect(formatProject(root).files).toBe(1);
  });

  it("writes through the journal, keeps only files whose outline is the same and that build, and undo restores them", async () => {
    const root = project({ "Ugly.cs": UGLY, "Clean.cs": CLEAN, "Evil.cs": EVIL, "Breaks.cs": BREAKS, "main.gd": GD });
    const dotnet = fakeDotnetFormat();
    const report = await formatProjectAll(root, { dotnet: dotnet.bin, write: true, diff: true });
    expect(report.written).toBe(true);
    expect(report.changed.map((c) => c.file)).toEqual(["res://Ugly.cs", "res://main.gd"]);
    expect(report.changed[0]!.diff).toContain('-\t[Export] public int   Speed {get;set;} = 3;   \n+\t[Export] public int Speed { get; set; } = 3;');
    expect(read(root, "Ugly.cs")).toContain('GD.Print("a  b", Speed);');
    // The formatter changed a string literal: the outline differs, the file is as it was.
    expect(read(root, "Evil.cs")).toBe(EVIL);
    // The formatter broke the build in this file: it is as it was.
    expect(read(root, "Breaks.cs")).toBe(BREAKS);
    expect(report.skipped).toEqual([
      { file: "res://Evil.cs", reason: "dotnet format changed more than the layout (a string literal changed): the file was put back as it was" },
      { file: "res://Breaks.cs", reason: "dotnet build reports an error in it after formatting (line 7: CS0103: The name 'BROKEN' does not exist in the current context): the file was put back as it was" },
    ]);
    // Formatted, built, the broken file restored, built again.
    expect(calls(dotnet.log).map((c) => c[0])).toEqual(["format", "build", "build"]);
    expect(formatFormatReport(report)).toContain("note: C#: formatted by dotnet format; the outline of every file is the same as before and the project builds");
    // One journal entry with the two files that changed.
    const undone = undoJournal(root);
    expect(undone.undone).toHaveLength(1);
    expect(read(root, "Ugly.cs")).toBe(UGLY);
    expect(read(root, "main.gd")).toBe(GD);
  });

  it("keeps nothing when the project does not build anyway, since the build cannot vouch for the formatting", async () => {
    const root = project({ "Ugly.cs": UGLY, "Wip.cs": "public partial class Wip : Godot.Node\n{\n\tint x = NEVER_BUILDS;\n}\n" });
    const report = await formatProjectAll(root, { dotnet: fakeDotnetFormat().bin, write: true });
    expect(report.changed).toEqual([]);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]).toMatchObject({ file: "res://Ugly.cs" });
    expect(report.skipped[0]!.reason).toMatch(/^the project does not build \(res:\/\/Wip\.cs:3: CS0103: .*\), so the build could not check the formatting: the file was put back as it was$/);
    expect(read(root, "Ugly.cs")).toBe(UGLY);
  });

  it("formats whitespace by folder when there is no project file, and says what was not checked", async () => {
    const root = project({ "Ugly.cs": UGLY }, false);
    const dotnet = fakeDotnetFormat();
    const report = await formatProjectAll(root, { dotnet: dotnet.bin, write: true });
    expect(report.changed.map((c) => c.file)).toEqual(["res://Ugly.cs"]);
    expect(calls(dotnet.log)).toEqual([["format", "whitespace", "--folder", ".", "--include", "Ugly.cs", "-v", "q"]]);
    expect(report.notes?.[0]).toContain("no .csproj or .sln in the project root, so only whitespace was formatted");
  });

  it("skips C# with the reason when dotnet is missing or a file is protected, and still formats GDScript", async () => {
    const root = project({ "Ugly.cs": UGLY, "main.gd": GD, "godotwright.json": '{ "protect": ["Locked.cs"] }', "Locked.cs": UGLY.replaceAll("Ugly", "Locked") });
    const saved = { PATH: process.env["PATH"], DOTNET_ROOT: process.env["DOTNET_ROOT"] };
    process.env["PATH"] = "/nonexistent";
    delete process.env["DOTNET_ROOT"];
    try {
      const report = await formatProjectAll(root, { write: true });
      expect(report.changed.map((c) => c.file)).toEqual(["res://main.gd"]);
      expect(report.skipped.map((s) => s.file)).toEqual(["res://Locked.cs", "res://Ugly.cs"]);
      expect(report.skipped[0]!.reason).toContain("dotnet is not on PATH");
    } finally {
      process.env["PATH"] = saved.PATH;
      if (saved.DOTNET_ROOT !== undefined) process.env["DOTNET_ROOT"] = saved.DOTNET_ROOT;
    }
    const report = await formatProjectAll(root, { dotnet: fakeDotnetFormat().bin, write: true });
    expect(report.changed.map((c) => c.file)).toEqual(["res://Ugly.cs"]);
    expect(report.skipped.map((s) => s.file)).toEqual(["res://Locked.cs"]);
    expect(read(root, "Locked.cs")).toContain("{get;set;}");
  });

  it("compares outlines without positions, keeping every character of a string", () => {
    expect(outlineShape(UGLY)).toBe(outlineShape(UGLY.replace("{get;set;}", "{ get; set; }").replace("int   Speed", "int Speed").replaceAll("\t", "    ")));
    expect(outlineShape('class A { string s = "a  b"; }')).not.toBe(outlineShape('class A { string s = "a b"; }'));
    expect(outlineShape("class A { void Run() { } }")).not.toBe(outlineShape("class A { void Ran() { } }"));
    expect(outlineShape("class A { Godot.Collections.Dictionary<string,int> d; }")).toBe(outlineShape("class A { Godot.Collections.Dictionary<string, int> d; }"));
  });
});
