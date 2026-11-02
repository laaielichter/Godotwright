import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, describe, expect, it } from "vitest";
import { codeIntel, formatCode, sharedPool } from "../../src/lsp/code.js";
import { LanguageServerPool } from "../../src/lsp/server.js";
import { createServer } from "../../src/mcp/server.js";

/** Needs a real Godot 4.7 binary in $GODOT. CI provides one. */
const GODOT = process.env["GODOT"];

const MAIN = [
  "extends Node",
  "",
  "var speed: float = 3.0",
  "",
  "",
  "func _ready() -> void:",
  "\tvar unused := 5",
  '\tvar n: int = "text"',
  "\tvar inferred := speed * 2",
  "\tvar body := get_parent()",
  "\tprint(n, inferred, body.jump())",
  "",
].join("\n");

/** A 1x1 PNG. */
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

describe.skipIf(!GODOT)("godot_code with Godot's language server", () => {
  const root = mkdtempSync(join(tmpdir(), "godotwright-code-"));
  writeFileSync(
    join(root, "project.godot"),
    'config_version=5\n[application]\nconfig/name="C"\nconfig/features=PackedStringArray("4.7")\n\n[debug]\n\ngdscript/warnings/unsafe_method_access=1\n',
  );
  writeFileSync(join(root, "main.gd"), MAIN);
  const pool = new LanguageServerPool();
  afterAll(() => {
    pool.stopAll();
    sharedPool().stopAll();
  });

  it("names the unused variable, the type error and the project's opt-in warning with lines", { timeout: 180_000 }, async () => {
    const r = await codeIntel(root, { op: "diagnostics", file: "res://main.gd", godot: GODOT!, pool });
    const text = formatCode(r);
    expect(r.server.fresh).toBe(true);
    expect(text).toContain('res://main.gd:7:2: warning [UNUSED_VARIABLE] The local variable "unused" is declared but never used');
    expect(text).toContain('res://main.gd:8:15: error Cannot assign a value of type "String" as "int".');
    expect(text).toContain('res://main.gd:11:21: warning [UNSAFE_METHOD_ACCESS] The method "jump()" is not present on the inferred type "Node"');
    expect(text).toMatch(/^diagnostics: res:\/\/main\.gd: 2 errors, 2 warnings/);
  });

  it("gives the inferred type on hover, and the declaration on definition, from the warm server", { timeout: 60_000 }, async () => {
    const started = Date.now();
    const hover = await codeIntel(root, { op: "hover", file: "res://main.gd", line: 9, column: 7, godot: GODOT!, pool });
    expect(hover.server.fresh).toBe(false);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(hover.hover?.signature).toBe("var inferred: float");
    const body = await codeIntel(root, { op: "hover", file: "res://main.gd", line: 10, column: 7, godot: GODOT!, pool });
    expect(body.hover?.signature).toBe("var body: Node");
    const def = await codeIntel(root, { op: "definition", file: "res://main.gd", line: 9, column: 18, godot: GODOT!, pool });
    expect(formatCode(def)).toContain("res://main.gd:3:5: var speed: float = 3.0");
    const engine = await codeIntel(root, { op: "definition", file: "res://main.gd", line: 10, column: 15, godot: GODOT!, pool });
    expect(engine.engine).toEqual({ signature: "func Node.get_parent() -> Node", lookup: "Node.get_parent" });
  });

  it("analyses unsaved code without touching the file on disk", { timeout: 60_000 }, async () => {
    const before = statSync(join(root, "main.gd")).mtimeMs;
    const code = "extends Node2D\n\n\nfunc _ready() -> void:\n\tvar spare := 1\n\tvar s: String = position\n\tprint(s)\n";
    const r = await codeIntel(root, { op: "diagnostics", file: "res://main.gd", code, godot: GODOT!, pool });
    const text = formatCode(r);
    expect(text).toMatch(/^diagnostics: res:\/\/main\.gd \(unsaved code\): 1 error, 1 warning/);
    expect(text).toContain('res://main.gd:5:2: warning [UNUSED_VARIABLE] The local variable "spare"');
    expect(text).toContain('res://main.gd:6:18: error Cannot assign a value of type Vector2 to variable "s" with specified type String.');
    // A parse error hides the analyser's warnings: Godot reports only the parse error then.
    const typing = "extends Node2D\n\n\nfunc _ready() -> void:\n\tvar spare := 1\n\tposition.\n";
    const broken = await codeIntel(root, { op: "diagnostics", file: "res://main.gd", code: typing, godot: GODOT!, pool });
    expect(broken.diagnostics?.map((d) => `${d.line}:${d.column} ${d.severity} ${d.message}`)).toEqual(['6:10 error Expected identifier after "." for attribute access.']);
    const completion = await codeIntel(root, { op: "completion", file: "res://main.gd", code: typing, line: 6, column: 11, godot: GODOT!, pool });
    expect(completion.completion?.items.map((i) => i.label)).toEqual(expect.arrayContaining(["x", "y", "angle()"]));
    expect(readFileSync(join(root, "main.gd"), "utf8")).toBe(MAIN);
    expect(statSync(join(root, "main.gd")).mtimeMs).toBe(before);
    // The saved file is what Godot knows again.
    const again = await codeIntel(root, { op: "diagnostics", file: "res://main.gd", godot: GODOT!, pool });
    expect(again.diagnostics?.filter((d) => d.warning).map((d) => `${d.line} ${d.warning}`)).toEqual(["7 UNUSED_VARIABLE", "11 UNSAFE_METHOD_ACCESS"]);
  });

  it("restarts for a png added after the start, which the running editor would never import", { timeout: 180_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "godotwright-code-asset-"));
    writeFileSync(join(dir, "project.godot"), 'config_version=5\n[application]\nconfig/name="A"\nconfig/features=PackedStringArray("4.7")\n');
    writeFileSync(join(dir, "main.gd"), 'extends Node\n\nconst TEX = preload("res://new.png")\n\n\nfunc _ready() -> void:\n\tprint(TEX)\n');
    const before = await codeIntel(dir, { op: "diagnostics", file: "res://main.gd", godot: GODOT!, pool });
    expect(before.diagnostics?.map((d) => d.message)).toEqual(['Preload file "res://new.png" does not exist.']);
    writeFileSync(join(dir, "new.png"), PNG_1X1);
    // Without the restart Godot says: Preload file "res://new.png" has no resource loaders (unrecognized file extension).
    const after = await codeIntel(dir, { op: "diagnostics", file: "res://main.gd", godot: GODOT!, pool });
    expect(after.server).toMatchObject({ fresh: true, restarted: "res://new.png was added, which the running editor does not import" });
    expect(after.diagnostics).toEqual([]);
    // Godot imported it (new.png.import) and that does not restart the server again.
    const again = await codeIntel(dir, { op: "diagnostics", file: "res://main.gd", godot: GODOT!, pool });
    expect(again.server.fresh).toBe(false);
  });

  it("answers through the MCP tool", { timeout: 180_000 }, async () => {
    const server = createServer({ root, godot: GODOT! });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const result = (await client.callTool({ name: "godot_code", arguments: { op: "hover", file: "res://main.gd", line: 3, column: 6 } })) as { content: { text: string }[]; isError?: boolean };
    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toMatch(/^hover res:\/\/main\.gd:3:6: var speed: float = 3\.0\n/);
    await client.close();
  });
});
