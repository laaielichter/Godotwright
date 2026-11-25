import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCSharp, findDotnet } from "../../src/check/csharp-build.js";
import { codeIntel, formatCode } from "../../src/lsp/code.js";
import { csharpPool, findCSharpLs } from "../../src/lsp/csharp.js";
import { generatedCSharpProject } from "../csharp-helpers.js";

/**
 * Needs the .NET SDK and csharp-ls (`dotnet tool install --global csharp-ls`; with the .NET 8 SDK `--version 0.16.0`),
 * and NuGet for the first build. No Godot. Ran with dotnet 8.0.134, Godot.NET.Sdk 4.7.0 and csharp-ls 0.16.0.
 */
const READY = Boolean(findDotnet() && findCSharpLs());

const HELLO = [
  "using Godot;",
  "",
  "public partial class Hello : Node",
  "{",
  "\t[Signal]",
  "\tpublic delegate void PingedEventHandler(int n);",
  "",
  "\t[Export]",
  "\tpublic int MaxHealth { get; set; } = 3;",
  "",
  "\tpublic override void _Ready()",
  "\t{",
  '\t\tGD.Print($"hello {MaxHealth}");',
  "\t}",
  "}",
  "",
].join("\n");

const USER = [
  "using Godot;",
  "",
  "public partial class User : Node",
  "{",
  "\tpublic override void _Ready()",
  "\t{",
  '\t\tHello hello = GetNode<Hello>("Hello");',
  "\t\thello.MaxHealth = 9;",
  "\t\thello.EmitSignal(Hello.SignalName.Pinged, 1);",
  "\t}",
  "}",
  "",
].join("\n");

describe.skipIf(!READY)("godot_code on C# with the real csharp-ls", () => {
  const pool = csharpPool();
  let root = "";
  const ask = (options: Omit<Parameters<typeof codeIntel>[1], "csharpPool">) => codeIntel(root, { ...options, csharpPool: pool });

  beforeAll(async () => {
    root = generatedCSharpProject();
    writeFileSync(join(root, "scripts", "Hello.cs"), HELLO);
    writeFileSync(join(root, "scripts", "User.cs"), USER);
    // The build restores the packages: the language server needs them to know Godot's API.
    expect((await buildCSharp(root)).status).toBe("ok");
  }, 300_000);
  afterAll(() => pool.stopAll());

  it("loads a Godot.NET.Sdk project without an editor and gives the compiler's diagnostics, also for unsaved code", { timeout: 240_000 }, async () => {
    const clean = await ask({ op: "diagnostics", file: "res://scripts/User.cs" });
    expect(clean.server.fresh).toBe(true);
    expect(clean.diagnostics).toEqual([]);
    const broken = await ask({ op: "diagnostics", file: "res://scripts/User.cs", code: USER.replace("hello.MaxHealth = 9;", "hello.MaxHealth = nope;") });
    expect(broken.server.fresh).toBe(false);
    expect(formatCode(broken)).toContain("res://scripts/User.cs:8:21: error [CS0103] The name 'nope' does not exist in the current context");
    // The unsaved code is gone again, and the file was not touched.
    expect((await ask({ op: "diagnostics", file: "res://scripts/User.cs" })).diagnostics).toEqual([]);
    expect(readFileSync(join(root, "scripts", "User.cs"), "utf8")).toBe(USER);
  });

  it("knows Godot's API and the names Godot's source generators make", { timeout: 120_000 }, async () => {
    const hover = await ask({ op: "hover", file: "res://scripts/User.cs", line: 7, column: 17 });
    expect(hover.hover?.signature).toBe("Hello Node.GetNode<Hello>(NodePath path)");
    expect(hover.hover?.definedIn).toBe("assembly GodotSharp");
    expect(hover.hover?.doc).toContain("Fetches a node.");
    const generated = await ask({ op: "hover", file: "res://scripts/User.cs", line: 9, column: 37 });
    expect(generated.hover?.signature).toBe("StringName SignalName.Pinged");
    const engine = await ask({ op: "definition", file: "res://scripts/User.cs", line: 3, column: 29 });
    expect(engine.definitions).toEqual([]);
    expect(engine.engine?.lookup).toBe("Node");
  });

  it("finds the definition, the references across files and the symbols of a file", { timeout: 120_000 }, async () => {
    const def = await ask({ op: "definition", file: "res://scripts/User.cs", line: 8, column: 10 });
    expect(def.definitions).toEqual([{ file: "res://scripts/Hello.cs", line: 9, column: 13, text: "public int MaxHealth { get; set; } = 3;" }]);
    const refs = await ask({ op: "references", file: "res://scripts/Hello.cs", line: 9, column: 14 });
    expect(refs.references?.map((r) => `${r.file}:${r.line}:${r.column}`)).toEqual(["res://scripts/Hello.cs:9:13", "res://scripts/Hello.cs:13:21", "res://scripts/User.cs:8:9"]);
    const symbols = await ask({ op: "symbols", file: "res://scripts/Hello.cs" });
    expect(symbols.symbols?.map((s) => `${s.depth} ${s.kind} ${s.name}`)).toEqual(["0 class Hello", "1 class PingedEventHandler", "1 property MaxHealth", "1 method _Ready()"]);
    const completion = await ask({ op: "completion", file: "res://scripts/User.cs", line: 8, column: 11 });
    expect(completion.completion?.items.map((i) => i.label)).toContain("MaxHealth");
  });

  it("sees a file written after the start, and starts again when the project file changes", { timeout: 240_000 }, async () => {
    writeFileSync(join(root, "scripts", "Late.cs"), "using Godot;\n\npublic partial class Late : Node\n{\n\tpublic int X = nope;\n}\n");
    const late = await ask({ op: "diagnostics", file: "res://scripts/Late.cs" });
    expect(late.server.fresh).toBe(false);
    expect(late.diagnostics?.map((d) => `${d.line} ${d.code}`)).toEqual(["5 CS0103"]);
    // Fixed on disk: the warm server is told, and a file that uses it is clean.
    writeFileSync(join(root, "scripts", "Late.cs"), "using Godot;\n\npublic partial class Late : Node\n{\n\tpublic int X = 1;\n}\n");
    writeFileSync(join(root, "scripts", "User.cs"), USER.replace("hello.MaxHealth = 9;", "hello.MaxHealth = new Late().X;"));
    expect((await ask({ op: "diagnostics", file: "res://scripts/User.cs" })).diagnostics).toEqual([]);
    const csproj = join(root, "CsGame.csproj");
    writeFileSync(csproj, readFileSync(csproj, "utf8").replace("</PropertyGroup>", "  <Nullable>disable</Nullable>\n  </PropertyGroup>"));
    const again = await ask({ op: "symbols", file: "res://scripts/Late.cs" });
    expect(again.server).toMatchObject({ fresh: true, restarted: "the .csproj, the .sln or the restored packages changed" });
    expect(again.symbols?.[0]).toMatchObject({ name: "Late", kind: "class" });
  });
});
