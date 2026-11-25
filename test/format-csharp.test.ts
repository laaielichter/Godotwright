import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { csharpMeaningChange, csharpSymbolCount, formatCSharp } from "../src/format/csharp.js";
import { formatAll, formatFormatReport } from "../src/format/project.js";
import { JournalWriter, undoJournal } from "../src/journal/journal.js";

const FAKE = join(import.meta.dirname, "fixtures", "fake-dotnet-format.mjs");

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "godotwright cs-format-"));
  writeFileSync(join(root, "project.godot"), 'config_version=5\n[application]\nconfig/name="Cs"\n');
  writeFileSync(join(root, "Cs.csproj"), '<Project Sdk="Godot.NET.Sdk/4.7.2" />');
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
}

const A = "using Godot;\npublic partial class A : Node\n{\n    int x=1;\n}\n";
const B = "using Godot;\npublic partial class B : Node\n{\n    int x=1;\n    void Old() { }\n}\n";

afterEach(() => {
  for (const k of ["FAKE_FORMAT_MORE", "FAKE_BUILD_BREAKS"]) delete process.env[k];
});

describe("C# formatting", () => {
  it("knows a whitespace change from a change of meaning", () => {
    const src = 'using Godot;\npublic partial class A:Node{ [Export] public int X{get;set;} void F(){GD.Print("a  b");} }\n';
    expect(csharpMeaningChange(src, src.replace("A:Node{", "A : Node\n{").replace("F(){", "F()\n{\n"))).toBeUndefined();
    expect(csharpMeaningChange(src, src.replace('"a  b"', '"a b"'))).toBe("the formatter changed a string");
    expect(csharpMeaningChange(src, src.replace("void F", "void G"))).toBe("the formatter changed more than whitespace in the code");
    // Class A, method F, and the export X (a member and an export).
    expect(csharpSymbolCount(src)).toBe(4);
  });

  it("formats only the asked files, keeps their meaning, writes through the journal", { timeout: 30_000 }, async () => {
    const root = project({ "scripts/A.cs": A, "scripts/B.cs": B, "main.gd": "extends Node\nvar  x = 1\n" });
    const dry = await formatAll(root, { files: ["res://scripts/A.cs"], diff: true, dotnet: FAKE });
    expect(dry).toMatchObject({ files: 1, csharp: 1, written: false, unchanged: 0, skipped: [] });
    expect(dry.changed[0]?.diff).toContain("+    int x = 1;");
    expect(readFileSync(join(root, "scripts", "A.cs"), "utf8")).toBe(A);
    const written = await formatAll(root, { files: ["res://scripts"], write: true, dotnet: FAKE });
    expect(written.changed.map((c) => c.file)).toEqual(["res://scripts/A.cs", "res://scripts/B.cs"]);
    expect(readFileSync(join(root, "main.gd"), "utf8")).toBe("extends Node\nvar  x = 1\n");
    undoJournal(root);
    expect(readFileSync(join(root, "scripts", "B.cs"), "utf8")).toBe(B);
  });

  it("skips a file whose meaning would change", { timeout: 30_000 }, async () => {
    const root = project({ "scripts/A.cs": A, "scripts/B.cs": B });
    process.env["FAKE_FORMAT_MORE"] = "1";
    const r = await formatCSharp(root, ["res://scripts/A.cs", "res://scripts/B.cs"], { dotnet: FAKE });
    expect(r.changed.map((c) => c.file)).toEqual(["res://scripts/A.cs"]);
    expect(r.skipped).toEqual([{ file: "res://scripts/B.cs", reason: "the formatter changed more than whitespace in the code" }]);
  });

  it("builds before and after a write, and puts back a file that makes the build worse", { timeout: 60_000 }, async () => {
    const root = project({ "scripts/A.cs": A, "scripts/B.cs": B });
    process.env["FAKE_BUILD_BREAKS"] = "B.cs";
    const journal = new JournalWriter(root, "format", "format scripts");
    const r = await formatCSharp(root, ["res://scripts/A.cs", "res://scripts/B.cs"], { dotnet: FAKE, write: true, journal });
    journal.commit();
    expect(r.changed.map((c) => c.file)).toEqual(["res://scripts/A.cs"]);
    expect(r.skipped).toEqual([{ file: "res://scripts/B.cs", reason: "the build had more errors after formatting (0 before); the file was put back" }]);
    expect(r.build).toEqual({ before: 0, after: 0 });
    expect(readFileSync(join(root, "scripts", "A.cs"), "utf8")).toContain("int x = 1;");
    expect(readFileSync(join(root, "scripts", "B.cs"), "utf8")).toBe(B);
    undoJournal(root);
    expect(readFileSync(join(root, "scripts", "A.cs"), "utf8")).toBe(A);
  });

  it("formats GDScript and C# in one run and one journal entry, and says so", { timeout: 30_000 }, async () => {
    const root = project({ "scripts/A.cs": A, "main.gd": "extends Node\n\n\nfunc f() -> void:\n\tprint(1+2)\n" });
    const saved = process.env["PATH"];
    // No dotnet on PATH: the GDScript still formats, the C# file is listed with the reason.
    process.env["PATH"] = "/nonexistent";
    try {
      const r = await formatAll(root, { write: true });
      expect(r.changed.map((c) => c.file)).toEqual(["res://main.gd"]);
      expect(r.skipped).toEqual([{ file: "res://scripts/A.cs", reason: "dotnet is not on PATH: C# is formatted with dotnet format, which comes with the .NET SDK 8 or later" }]);
      expect(r.journal).toEqual(expect.any(Number));
      expect(formatFormatReport(r)).toContain("res://scripts/A.cs: dotnet is not on PATH");
    } finally {
      process.env["PATH"] = saved;
    }
  });
});
