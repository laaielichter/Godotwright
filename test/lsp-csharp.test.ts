import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { codeIntel, csharpEngineLookup, formatCode, parseCSharpHover } from "../src/lsp/code.js";
import { CSharpLsMissingError, CSharpStamp, csharpLsInstallCommand, csharpPool, findCSharpLs } from "../src/lsp/csharp.js";
import { MessageReader, RpcConnection, encodeMessage } from "../src/lsp/jsonrpc.js";
import { LanguageServerError, LanguageServerPool } from "../src/lsp/server.js";
import { fakeCSharpLs } from "./fake-csharp-ls.js";
import { makeProject, tempFolder } from "./helpers.js";

const PROJECT = 'config_version=5\n\n[application]\n\nconfig/name="Cs"\nconfig/features=PackedStringArray("4.7", "C#")\n\n[dotnet]\n\nproject/assembly_name="Cs"\n';
const PLAYER = "using Godot;\n\npublic partial class Player : Node\n{\n\tpublic int Speed { get; set; } = 3;\n\n\tpublic override void _Ready()\n\t{\n\t\tSpeed = Speed + 1;\n\t\tGetNode<Timer>(\"Timer\");\n\t}\n}\n";

/** A C# project that counts as restored (the Godot.NET.Sdk's obj folder is there). */
function csProject(files: Record<string, string> = {}): string {
  return makeProject({ "project.godot": PROJECT, "Cs.csproj": "<Project />", "Cs.sln": "", ".godot/mono/temp/obj/project.assets.json": "{}", "Player.cs": PLAYER, "main.gd": "extends Node\n", ...files });
}

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function setup(options: Parameters<typeof fakeCSharpLs>[0] = {}) {
  const fake = fakeCSharpLs(options);
  const pool = csharpPool();
  // A .cs file must never start Godot.
  const godot = new LanguageServerPool({ start: () => Promise.reject(new Error("Godot was started for a C# file")) });
  cleanups.push(() => pool.stopAll(), () => godot.stopAll());
  const calls = () => readFileSync(fake.log, "utf8").trim().split("\n");
  return { fake, pool, godot, calls, opts: { csharpLs: fake.bin, csharpPool: pool, pool: godot } };
}

describe("JSON-RPC over stdio pipes", () => {
  it("talks over two pipes and answers the server's own requests", async () => {
    const toServer = new PassThrough();
    const fromServer = new PassThrough();
    const rpc = new RpcConnection({ input: fromServer, output: toServer }, 500);
    rpc.onRequest = (method) => (method === "workspace/configuration" ? [null] : undefined);
    const reader = new MessageReader();
    const got: unknown[] = [];
    toServer.on("data", (chunk: Buffer) => got.push(...reader.push(chunk)));
    const answer = rpc.request("ping", {});
    await new Promise((r) => setTimeout(r, 10));
    fromServer.write(encodeMessage({ jsonrpc: "2.0", id: 1, result: "pong" }));
    expect(await answer).toBe("pong");
    fromServer.write(encodeMessage({ jsonrpc: "2.0", id: "a", method: "workspace/configuration", params: { items: [{}] } }));
    fromServer.write(encodeMessage({ jsonrpc: "2.0", id: "b", method: "client/registerCapability", params: {} }));
    await new Promise((r) => setTimeout(r, 10));
    expect(got.slice(1)).toEqual([
      { jsonrpc: "2.0", id: "a", result: [null] },
      { jsonrpc: "2.0", id: "b", result: null },
    ]);
    fromServer.end();
    await new Promise((r) => setTimeout(r, 10));
    expect(rpc.closed).toBe(true);
    await expect(rpc.request("ping", {})).rejects.toThrow("closed the connection");
  });
});

describe("godot_code picks the server by the file's extension", () => {
  it("answers a .cs file from csharp-ls with the same ops, and never starts Godot for it", async () => {
    const { opts, calls } = setup();
    const root = csProject();
    const diag = await codeIntel(root, { op: "diagnostics", file: "res://Player.cs", code: PLAYER.replace("Speed + 1", "nope + 1").replace("using Godot;", "using Godot; using System;"), ...opts });
    expect(diag).toMatchObject({ language: "csharp", unsaved: true, server: { fresh: true } });
    // The hint (severity 4) is left out; the compiler's code is kept.
    expect(diag.diagnostics).toEqual([{ file: "res://Player.cs", line: 9, column: 11, severity: "error", code: "CS0103", message: "The name 'nope' does not exist in the current context" }]);
    expect(formatCode(diag)).toContain("res://Player.cs:9:11: error [CS0103] The name 'nope' does not exist in the current context");
    expect(formatCode(diag)).toContain("started the C# language server (csharp-ls)");
    // The saved text goes back to the server after unsaved code.
    expect(calls()).toContain("textDocument/didChange");
    const clean = await codeIntel(root, { op: "diagnostics", file: "res://Player.cs", ...opts });
    expect(clean).toMatchObject({ diagnostics: [], server: { fresh: false } });

    const hover = await codeIntel(root, { op: "hover", file: "Player.cs", line: 10, column: 5, ...opts });
    expect(hover.hover).toEqual({ signature: "Timer Node.GetNode<Timer>(NodePath path)", doc: "Fetches a node.", definedIn: "assembly GodotSharp" });
    const def = await codeIntel(root, { op: "definition", file: "res://Player.cs", line: 9, column: 4, ...opts });
    expect(def.definitions).toEqual([{ file: "res://Player.cs", line: 5, column: 13, text: "public int Speed { get; set; } = 3;" }]);
    const engine = await codeIntel(root, { op: "definition", file: "res://Player.cs", line: 3, column: 32, ...opts });
    expect(engine.definitions).toEqual([]);
    expect(engine.engine?.lookup).toBe("Node");
    expect(formatCode(engine)).toContain("Next: godot_api Node");
    const refs = await codeIntel(root, { op: "references", file: "res://Player.cs", line: 5, column: 14, ...opts });
    // Three uses of Speed; the accessor the server also lists is not one.
    expect(refs.references?.map((r) => `${r.line}:${r.column}`)).toEqual(["5:13", "9:3", "9:11"]);
    expect(formatCode(refs)).toMatch(/^references of res:\/\/Player\.cs:5:14: 3 in 1 file\n/);
    const symbols = await codeIntel(root, { op: "symbols", file: "res://Player.cs", ...opts });
    expect(symbols.symbols).toEqual([
      { name: "Player", kind: "class", line: 3, depth: 0 },
      { name: "Speed", kind: "property", line: 5, depth: 1, detail: "int Player.Speed" },
    ]);
    expect(formatCode(symbols)).toContain("class Player (line 3)\n  property Speed (line 5): int Player.Speed");
    const completion = await codeIntel(root, { op: "completion", file: "res://Player.cs", line: 9, column: 5, ...opts });
    expect(completion.completion).toEqual({ prefix: "Sp", total: 2, items: [{ label: "Speed", kind: "property" }, { label: "SpeedUp", kind: "method" }] });
    // One warm server did all of it.
    expect(calls().filter((c) => c === "initialize")).toHaveLength(1);
  });

  it("sends a .gd file to Godot's server, not to csharp-ls", async () => {
    const { opts, calls } = setup();
    const root = csProject();
    await expect(codeIntel(root, { op: "diagnostics", file: "res://main.gd", ...opts })).rejects.toThrow("Godot was started for a C# file");
    expect(() => calls()).toThrow();
    await expect(codeIntel(root, { op: "hover", file: "res://notes.txt", line: 1, column: 1, ...opts })).rejects.toThrow("is not a GDScript (.gd) or C# (.cs) file");
  });

  it("tells the warm server which C# files changed on disk, and starts a new one when the project file changed", async () => {
    const { opts, calls } = setup();
    const root = csProject();
    await codeIntel(root, { op: "diagnostics", file: "res://Player.cs", ...opts });
    writeFileSync(join(root, "Enemy.cs"), "public partial class Enemy : Godot.Node { int X = nope; }\n");
    const later = new Date(Date.now() + 5000);
    utimesSync(join(root, "Player.cs"), later, later);
    const enemy = await codeIntel(root, { op: "diagnostics", file: "res://Enemy.cs", ...opts });
    expect(enemy.server.fresh).toBe(false);
    expect(enemy.diagnostics).toHaveLength(1);
    expect(calls().filter((c) => c.startsWith("watched")).sort()).toEqual(["watched 1 Enemy.cs", "watched 2 Player.cs"]);
    rmSync(join(root, "Enemy.cs"));
    await codeIntel(root, { op: "diagnostics", file: "res://Player.cs", ...opts });
    expect(calls()).toContain("watched 3 Enemy.cs");
    utimesSync(join(root, "Cs.csproj"), later, later);
    const again = await codeIntel(root, { op: "diagnostics", file: "res://Player.cs", ...opts });
    expect(again.server).toMatchObject({ fresh: true, restarted: "the .csproj, the .sln or the restored packages changed" });
    expect(calls().filter((c) => c === "initialize")).toHaveLength(2);
  });

  it("stops an idle C# server like a GDScript one", async () => {
    const fake = fakeCSharpLs();
    const pool = csharpPool({ idleMs: 1000 });
    cleanups.push(() => pool.stopAll());
    const root = csProject();
    await codeIntel(root, { op: "symbols", file: "res://Player.cs", csharpLs: fake.bin, csharpPool: pool });
    expect(pool.size).toBe(1);
    await pool.sweep(Date.now() + 500);
    expect(pool.size).toBe(1);
    await pool.sweep(Date.now() + 5000);
    expect(pool.size).toBe(0);
  });
});

describe("csharp-ls is the user's to install", () => {
  it("names the exact install command when it is missing, and installs nothing", async () => {
    const root = csProject();
    const saved = { CSHARP_LS: process.env["CSHARP_LS"] };
    process.env["CSHARP_LS"] = join(tempFolder("no-ls-"), "csharp-ls");
    const pool = csharpPool();
    cleanups.push(() => pool.stopAll());
    try {
      const error = await codeIntel(root, { op: "diagnostics", file: "res://Player.cs", csharpPool: pool }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CSharpLsMissingError);
      expect((error as Error).message).toMatch(/csharp-ls is not installed.*Install it yourself with: dotnet tool install --global csharp-ls/);
      expect((error as Error).message).toContain("Everything else keeps working");
      expect(pool.size).toBe(0);
    } finally {
      if (saved.CSHARP_LS === undefined) delete process.env["CSHARP_LS"];
      else process.env["CSHARP_LS"] = saved.CSHARP_LS;
    }
  });

  it("finds it on PATH or in ~/.dotnet/tools, and picks the version for the SDK", () => {
    const home = tempFolder("home-");
    expect(findCSharpLs({ PATH: "/nonexistent" }, "linux", home)).toBeUndefined();
    mkdirSync(join(home, ".dotnet", "tools"), { recursive: true });
    writeFileSync(join(home, ".dotnet", "tools", "csharp-ls"), "");
    expect(findCSharpLs({ PATH: "/nonexistent" }, "linux", home)).toBe(join(home, ".dotnet", "tools", "csharp-ls"));
    expect(findCSharpLs({ PATH: "/nonexistent", CSHARP_LS: "/nonexistent/csharp-ls" }, "linux", home)).toBeUndefined();
    expect(csharpLsInstallCommand("8.0.134")).toBe("dotnet tool install --global csharp-ls --version 0.16.0");
    expect(csharpLsInstallCommand("10.0.100")).toBe("dotnet tool install --global csharp-ls");
    expect(csharpLsInstallCommand()).toBe("dotnet tool install --global csharp-ls");
  });

  it("refuses a project without a .csproj, one that was never restored, and reports a server that dies", async () => {
    const { opts } = setup();
    const plain = makeProject({ "project.godot": PROJECT, "Player.cs": PLAYER });
    await expect(codeIntel(plain, { op: "symbols", file: "res://Player.cs", ...opts })).rejects.toThrow("no .csproj or .sln in the project root");
    const unrestored = makeProject({ "project.godot": PROJECT, "Cs.csproj": "<Project />", "Player.cs": PLAYER });
    await expect(codeIntel(unrestored, { op: "symbols", file: "res://Player.cs", ...opts })).rejects.toThrow(/were never restored.*Run godot_check once/);
    const dying = fakeCSharpLs({ exitAtStart: 3 });
    const error = await codeIntel(csProject(), { op: "symbols", file: "res://Player.cs", ...opts, csharpLs: dying.bin }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LanguageServerError);
    expect((error as Error).message).toMatch(/csharp-ls/);
  });
});

describe("C# helpers", () => {
  it("reads csharp-ls's hover and metadata URIs", () => {
    expect(parseCSharpHover("`` int Hello.MaxHealth ``")).toEqual({ signature: "int Hello.MaxHealth", doc: "" });
    expect(parseCSharpHover("`` void GD.Print(string what) `` from assembly `` GodotSharp ``\n\nPrints a message to the console. See `` Godot.GD.PushError(System.String) ``.")).toEqual({
      signature: "void GD.Print(string what)",
      doc: "Prints a message to the console. See Godot.GD.PushError(System.String).",
      definedIn: "assembly GodotSharp",
    });
    expect(parseCSharpHover("")).toBeUndefined();
    expect(csharpEngineLookup("csharp:/metadata/projects/Cs/assemblies/GodotSharp/symbols/Godot.Node.cs")).toBe("Node");
    expect(csharpEngineLookup("csharp:/metadata/projects/Cs/assemblies/System.Runtime/symbols/System.String.cs")).toBeUndefined();
  });

  it("keeps a stamp of the project files and the C# files", () => {
    const root = csProject();
    const stamp = new CSharpStamp(root);
    expect(stamp.refresh()).toBeUndefined();
    expect(stamp.changes()).toEqual([]);
    writeFileSync(join(root, "New.cs"), "");
    expect(stamp.changes()).toEqual([{ path: join(root, "New.cs"), type: 1 }]);
    expect(stamp.changes()).toEqual([]);
    expect(stamp.refresh()).toBeUndefined();
    const later = new Date(Date.now() + 5000);
    utimesSync(join(root, ".godot/mono/temp/obj/project.assets.json"), later, later);
    expect(stamp.refresh()).toBe("the .csproj, the .sln or the restored packages changed");
    expect(stamp.refresh()).toBeUndefined();
  });
});
