import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { codeIntel, flattenSymbols, formatCode, parseMarkdownHover, startCSharpServer } from "../src/lsp/code.js";
import { CSharpStamp, findCSharpServer, LanguageServerPool, type CSharpServerCommand } from "../src/lsp/server.js";

const FAKE = join(import.meta.dirname, "fixtures", "fake-csharp-ls.mjs");

const TRIGGER = [
  "using Godot;",
  "",
  "/// <summary>Emits Triggered when a body enters.</summary>",
  "",
  "",
  "public partial class AreaTriggerT : Area2D",
  "{",
  "\t[Signal]",
  "\tpublic delegate void TriggeredEventHandler(Node2D body);",
  "",
  "\t[Export]",
  "\tpublic StringName TargetGroup { get; set; } = \"player\";",
  "",
  "\t[Export]",
  "\tpublic bool OneShot { get; set; }",
  "",
  "\tpublic override void _Ready()",
  "\t{",
  "\t\tBodyEntered += OnBodyEntered;",
  "\t}",
  "",
  "\tprivate void OnBodyEntered(Node2D body)",
  "\t{",
  "\t\tif (!body.IsInGroup(TargetGroup))",
  "\t\t{",
  "\t\t\treturn;",
  "\t\t}",
  "\t\tEmitSignal(SignalName.Triggered, body);",
  "\t}",
  "}",
  "",
].join("\n");

function csProject(): string {
  const root = mkdtempSync(join(tmpdir(), "godotwright cs-lsp-"));
  writeFileSync(join(root, "project.godot"), 'config_version=5\n[application]\nconfig/name="Cs"\n\n[dotnet]\n\nproject/assembly_name="Cs"\n');
  writeFileSync(join(root, "Cs.csproj"), '<Project Sdk="Godot.NET.Sdk/4.7.2" />');
  writeFileSync(join(root, "Cs.sln"), "");
  mkdirSync(join(root, "scripts"));
  writeFileSync(join(root, "scripts", "AreaTriggerT.cs"), TRIGGER);
  writeFileSync(join(root, "scripts", "Other.cs"), "public partial class Other : Godot.Node\n{\n\tvoid Use(AreaTriggerT t) => t.OnBodyEntered(null);\n}\n");
  return root;
}

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
  delete process.env["FAKE_PULL"];
  delete process.env["GODOTWRIGHT_CSHARP_LS"];
});

function fake(root: string): { command: CSharpServerCommand; log: string; pool: LanguageServerPool; starts: string[]; messages: () => { method?: string; params?: any; response?: number; result?: unknown }[] } {
  const log = join(root, ".fake.log");
  process.env["FAKE_LOG"] = log;
  const command: CSharpServerCommand = { command: process.execPath, args: [FAKE], from: "env" };
  // How a user points Godotwright at a server: found by findCSharpServer.
  process.env["GODOTWRIGHT_CSHARP_LS"] = JSON.stringify([process.execPath, FAKE]);
  const starts: string[] = [];
  const pool = new LanguageServerPool({
    start: (r) => {
      starts.push(r);
      return startCSharpServer(r, command);
    },
  });
  cleanups.push(() => pool.stopAll());
  const messages = () => {
    try {
      return readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  };
  return { command, log, pool, starts, messages };
}

describe("godot_code on C# files", () => {
  it("finds csharp-ls: $GODOTWRIGHT_CSHARP_LS (a path or a JSON command), PATH, ~/.dotnet/tools; --solution names the .sln", () => {
    const root = csProject();
    const bin = mkdtempSync(join(tmpdir(), "bin-"));
    writeFileSync(join(bin, "csharp-ls"), "");
    expect(findCSharpServer(root, { PATH: bin, HOME: "/nowhere" }, "linux")).toEqual({ command: join(bin, "csharp-ls"), args: ["--solution", join(root, "Cs.sln")], from: "path" });
    const home = mkdtempSync(join(tmpdir(), "home-"));
    mkdirSync(join(home, ".dotnet", "tools"), { recursive: true });
    writeFileSync(join(home, ".dotnet", "tools", "csharp-ls"), "");
    expect(findCSharpServer(root, { PATH: "/nowhere", HOME: home }, "linux")?.from).toBe("dotnet-tools");
    expect(findCSharpServer(root, { GODOTWRIGHT_CSHARP_LS: '["/opt/ls","--stdio"]' }, "linux")).toEqual({ command: "/opt/ls", args: ["--stdio"], from: "env" });
    expect(findCSharpServer(root, { GODOTWRIGHT_CSHARP_LS: "/opt/csharp-ls" }, "linux")).toEqual({ command: "/opt/csharp-ls", args: ["--solution", join(root, "Cs.sln")], from: "env" });
    expect(findCSharpServer(root, { PATH: "/nowhere", HOME: "/nowhere" }, "linux")).toBeUndefined();
  });

  it("without a C# language server says how to install it, and starts nothing", async () => {
    const root = csProject();
    const saved = { PATH: process.env["PATH"], HOME: process.env["HOME"], LS: process.env["GODOTWRIGHT_CSHARP_LS"] };
    process.env["PATH"] = "/nonexistent";
    process.env["HOME"] = "/nonexistent";
    delete process.env["GODOTWRIGHT_CSHARP_LS"];
    try {
      const r = await codeIntel(root, { op: "hover", file: "res://scripts/AreaTriggerT.cs", line: 22, column: 16 });
      expect(r.unavailable).toMatchObject({ server: "csharp-ls", install: "dotnet tool install --global csharp-ls" });
      const text = formatCode(r);
      expect(text).toContain("install it with: dotnet tool install --global csharp-ls");
      expect(text).toContain("godot_check builds the C# with dotnet build");
    } finally {
      process.env["PATH"] = saved.PATH;
      process.env["HOME"] = saved.HOME;
      if (saved.LS !== undefined) process.env["GODOTWRIGHT_CSHARP_LS"] = saved.LS;
    }
  });

  it("answers hover, definition, references and symbols with res:// places, on one warm server", { timeout: 30_000 }, async () => {
    const root = csProject();
    const { pool, starts, messages } = fake(root);
    const hover = await codeIntel(root, { op: "hover", file: "res://scripts/AreaTriggerT.cs", line: 22, column: 16, csharpPool: pool });
    expect(hover.language).toBe("csharp");
    expect(hover.hover).toEqual({ signature: "private void AreaTriggerT.OnBodyEntered(Node2D body)", doc: "Runs when a body enters." });
    expect(hover.server.fresh).toBe(true);
    const refs = await codeIntel(root, { op: "references", file: "res://scripts/AreaTriggerT.cs", line: 22, column: 16, csharpPool: pool });
    expect(refs.references).toEqual([
      { file: "res://scripts/AreaTriggerT.cs", line: 19, column: 18, text: "BodyEntered += OnBodyEntered;" },
      { file: "res://scripts/AreaTriggerT.cs", line: 22, column: 15, text: "private void OnBodyEntered(Node2D body)" },
      { file: "res://scripts/Other.cs", line: 3, column: 32, text: "void Use(AreaTriggerT t) => t.OnBodyEntered(null);" },
    ]);
    expect(refs.server.fresh).toBe(false);
    expect(formatCode(refs)).toMatch(/^references of res:\/\/scripts\/AreaTriggerT\.cs:22:16: 3 places \(csharp-ls, declaration included\)\n/);
    const def = await codeIntel(root, { op: "definition", file: "res://scripts/Other.cs", line: 3, column: 35, csharpPool: pool });
    expect(def.definitions?.[0]).toMatchObject({ file: "res://scripts/AreaTriggerT.cs", line: 19 });
    // An engine member has no source in the project: named for godot_api.
    const engine = await codeIntel(root, { op: "definition", file: "res://scripts/AreaTriggerT.cs", line: 24, column: 14, csharpPool: pool });
    expect(engine.engine).toEqual({ signature: "bool Godot.Node.IsInGroup(StringName group)", lookup: "Node.is_in_group" });
    const syms = await codeIntel(root, { op: "symbols", file: "res://scripts/AreaTriggerT.cs", csharpPool: pool });
    expect(formatCode(syms).split("\n").slice(0, 4)).toEqual([
      "symbols of res://scripts/AreaTriggerT.cs: 3 (csharp-ls)",
      "class AreaTriggerT (6:22)",
      "  event TriggeredEventHandler (9:23)",
      "  method _Ready: void AreaTriggerT._Ready() (17:23)",
    ]);
    expect(starts).toHaveLength(1);
    // It was asked for its settings and got one null per item; documents were opened as csharp and closed again.
    const log = messages();
    expect(log.find((m) => m.response !== undefined)).toMatchObject({ result: [null] });
    expect(log.find((m) => m.method === "initialize")?.params.capabilities.textDocument.documentSymbol).toEqual({ hierarchicalDocumentSymbolSupport: true });
    expect(log.filter((m) => m.method === "textDocument/didOpen").every((m) => m.params.textDocument.languageId === "csharp")).toBe(true);
    expect(log.filter((m) => m.method === "textDocument/didOpen").length).toBe(log.filter((m) => m.method === "textDocument/didClose").length);
  });

  it("diagnostics: waits for the semantic pass after the empty first report, or pulls them when the server can", { timeout: 30_000 }, async () => {
    const root = csProject();
    const { pool } = fake(root);
    const broken = TRIGGER.replace("return;", "GD.Print(missingName);");
    const r = await codeIntel(root, { op: "diagnostics", file: "res://scripts/AreaTriggerT.cs", code: broken, csharpPool: pool });
    expect(r.diagnostics).toEqual([{ file: "res://scripts/AreaTriggerT.cs", line: 26, column: 18, severity: "error", message: "CS0103: The name 'missingName' does not exist in the current context" }]);
    expect(readFileSync(join(root, "scripts", "AreaTriggerT.cs"), "utf8")).toBe(TRIGGER);
    pool.stopAll();
    process.env["FAKE_PULL"] = "1";
    const pulled = fake(root);
    const p = await codeIntel(root, { op: "diagnostics", file: "res://scripts/AreaTriggerT.cs", code: broken, csharpPool: pulled.pool });
    expect(p.diagnostics?.map((d) => d.message)).toEqual(["CS0103: The name 'missingName' does not exist in the current context"]);
    expect(pulled.messages().some((m) => m.method === "textDocument/diagnostic")).toBe(true);
  });

  it("restarts for a changed .csproj or a new .cs file, and tells it about edited files without a restart", { timeout: 30_000 }, async () => {
    const root = csProject();
    const { pool, starts, messages } = fake(root);
    const ask = () => codeIntel(root, { op: "symbols", file: "res://scripts/AreaTriggerT.cs", csharpPool: pool });
    await ask();
    const other = join(root, "scripts", "Other.cs");
    writeFileSync(other, readFileSync(other, "utf8") + "// edited\n");
    utimesSync(other, new Date(), new Date(Date.now() + 5000));
    const edited = await ask();
    expect(edited.server.fresh).toBe(false);
    expect(messages().find((m) => m.method === "workspace/didChangeWatchedFiles")?.params.changes).toEqual([{ uri: expect.stringMatching(/scripts\/Other\.cs$/), type: 2 }]);
    writeFileSync(join(root, "scripts", "New.cs"), "public partial class New : Godot.Node {}\n");
    expect((await ask()).server.restarted).toBe("res://scripts/New.cs was added");
    const csproj = join(root, "Cs.csproj");
    writeFileSync(csproj, '<Project Sdk="Godot.NET.Sdk/4.7.2"><PropertyGroup><Nullable>enable</Nullable></PropertyGroup></Project>');
    utimesSync(csproj, new Date(), new Date(Date.now() + 9000));
    expect((await ask()).server.restarted).toBe("res://Cs.csproj changed");
    expect(starts).toHaveLength(3);
  });

  it("refuses completion for C#, and reads markdown hovers and nested symbols", () => {
    expect(parseMarkdownHover("```csharp\nint Foo.Bar\n```\n---\nDoc text")).toEqual({ signature: "int Foo.Bar", doc: "Doc text" });
    expect(parseMarkdownHover("plain `x`\nmore")).toEqual({ signature: "plain x", doc: "more" });
    expect(flattenSymbols([{ name: "A", kind: 5, location: { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } } }])).toEqual([{ name: "A", kind: "class", line: 1, column: 1, depth: 0 }]);
    const stamp = new CSharpStamp(csProject());
    expect(stamp.refresh()).toBeUndefined();
    expect(stamp.refresh()).toBeUndefined();
    return expect(codeIntel(csProject(), { op: "completion", file: "res://scripts/AreaTriggerT.cs", line: 1, column: 1, csharpServer: { command: "x", args: [], from: "env" } })).rejects.toThrow("completion is for GDScript");
  });
});
