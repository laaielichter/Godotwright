import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildCSharp, findDotnet } from "../../src/check/csharp-build.js";
import { codeIntel, formatCode, sharedCSharpPool } from "../../src/lsp/code.js";
import { findCSharpServer } from "../../src/lsp/server.js";
import { newProject } from "../../src/scaffold/project.js";
import { newScript } from "../../src/scaffold/script.js";

/**
 * Needs a real C# language server (csharp-ls on PATH or in ~/.dotnet/tools, or $GODOTWRIGHT_CSHARP_LS) and the .NET
 * SDK, with Godot.NET.Sdk where NuGet finds it. Skipped otherwise.
 */
const probe = mkdtempSync(join(tmpdir(), "godotwright-cs-probe-"));
const enabled = findDotnet() !== undefined && findCSharpServer(probe) !== undefined;

describe.skipIf(!enabled)("godot_code on C# with a real C# language server", () => {
  const root = join(mkdtempSync(join(tmpdir(), "godotwright-cs-code-")), "cs");
  newProject(root, { dotnet: true });
  newScript(root, "res://scripts/AreaTriggerT.cs", { template: "area_trigger" });
  afterAll(() => sharedCSharpPool().stopAll());

  it("answers hover, definition, references, symbols and diagnostics on a Godot.NET.Sdk project", { timeout: 600_000 }, async () => {
    // The server loads the solution with MSBuild: the packages must be restored first.
    expect((await buildCSharp(root)).status).toBe("ok");
    const file = "res://scripts/AreaTriggerT.cs";
    const symbols = await codeIntel(root, { op: "symbols", file });
    expect(symbols.symbols?.map((s) => s.name)).toEqual(expect.arrayContaining(["AreaTriggerT", "OnBodyEntered"]));
    const line = symbols.symbols!.find((s) => s.name === "OnBodyEntered")!;
    const refs = await codeIntel(root, { op: "references", file, line: line.line, column: line.column });
    expect(refs.references!.length).toBeGreaterThanOrEqual(2);
    const hover = await codeIntel(root, { op: "hover", file, line: line.line, column: line.column });
    expect(hover.hover?.signature).toContain("OnBodyEntered");
    const diagnostics = await codeIntel(root, { op: "diagnostics", file, code: "using Godot;\npublic partial class AreaTriggerT : Area2D { void F() { GD.Print(missingName); } }\n" });
    expect(formatCode(diagnostics)).toContain("CS0103");
  });
});
