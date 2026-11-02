import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { codeIntel, completionPrefix, engineLookup, formatCode, parseHover, toCodeDiagnostic } from "../src/lsp/code.js";
import { MessageReader, RpcConnection, RpcError, RpcTimeoutError, encodeMessage, type RpcMessage } from "../src/lsp/jsonrpc.js";
import { GodotLanguageServer, LanguageServerError, LanguageServerPool, freePort } from "../src/lsp/server.js";

/** A small language server speaking the protocol like Godot 4.7.2 does (shapes copied from real Godot output). */
interface Fake {
  port: number;
  server: Server;
  opened: { path: string; text: string }[];
  methods: string[];
  /** Methods it never answers. */
  silent: Set<string>;
  close: () => Promise<void>;
}

async function fakeLsp(): Promise<Fake> {
  const fake: Fake = { port: 0, server: createServer(), opened: [], methods: [], silent: new Set(), close: async () => undefined };
  const sockets: Socket[] = [];
  fake.server.on("connection", (socket) => {
    sockets.push(socket);
    const reader = new MessageReader();
    const docs = new Map<string, string>();
    const send = (m: object) => socket.write(encodeMessage({ jsonrpc: "2.0", ...m } as RpcMessage));
    socket.on("data", (chunk: Buffer) => {
      for (const m of reader.push(chunk)) {
        fake.methods.push(m.method ?? "");
        if (m.method && fake.silent.has(m.method)) continue;
        const p = m.params as Record<string, any>;
        switch (m.method) {
          case "initialize":
            send({ method: "gdscript_client/changeWorkspace", params: { path: "/x" } });
            send({ id: m.id, result: { capabilities: { hoverProvider: true } } });
            break;
          case "textDocument/didOpen": {
            const { uri, text } = p["textDocument"];
            docs.set(uri, text);
            fake.opened.push({ path: fileURLToPath(uri), text });
            const diagnostics: object[] = [];
            text.split("\n").forEach((line: string, i: number) => {
              const unused = /var (unused\w*)/.exec(line);
              if (unused) {
                const message = `(UNUSED_VARIABLE): The local variable "${unused[1]}" is declared but never used in the block.`;
                diagnostics.push({ code: 0, message, range: { start: { line: i, character: 1 }, end: { line: i, character: 9 } }, severity: 2, source: "gdscript" });
              }
              if (line.includes('"text"')) {
                for (const message of ['Cannot assign a value of type "String" as "int".', 'Cannot assign a value of type "String" as "int".']) {
                  diagnostics.push({ code: 0, message, range: { start: { line: i, character: 14 }, end: { line: i, character: 20 } }, severity: 1, source: "gdscript" });
                }
              }
            });
            // Another file's diagnostics first: the client must wait for its own.
            send({ method: "textDocument/publishDiagnostics", params: { uri: "file:///elsewhere/other.gd", diagnostics: [] } });
            send({ method: "textDocument/publishDiagnostics", params: { uri: uri.replace(/ /g, "%20"), diagnostics } });
            break;
          }
          case "textDocument/hover": {
            const line = p["position"].line as number;
            const text = (docs.get(p["textDocument"].uri) ?? "").split("\n")[line] ?? "";
            if (text.includes("get_parent")) send({ id: m.id, result: { contents: { kind: "markdown", value: "\tfunc Node.get_parent() -> Node\n\nReturns this node's parent node.\n\n" } } });
            else if (text.includes("var speed")) send({ id: m.id, result: { contents: { kind: "markdown", value: "\tvar speed: float = 3.0\n\nDefined in [res://main.gd](file:///p/main.gd)" } } });
            else send({ id: m.id, result: { contents: [] } });
            break;
          }
          case "textDocument/definition": {
            const line = p["position"].line as number;
            const text = (docs.get(p["textDocument"].uri) ?? "").split("\n")[line] ?? "";
            send({ id: m.id, result: text.includes("speed") ? [{ uri: p["textDocument"].uri, range: { start: { line: 2, character: 4 }, end: { line: 2, character: 9 } } }] : [] });
            break;
          }
          case "textDocument/completion":
            send({
              id: m.id,
              result: [
                { label: "add_child(…)", kind: 2, insertText: "add_child" },
                { label: "add_sibling(…)", kind: 2, insertText: "add_sibling" },
                { label: "speed", kind: 6, insertText: "speed" },
              ],
            });
            break;
          case "completionItem/resolve":
            send({ id: m.id, result: { ...p, documentation: { kind: "markdown", value: `\tfunc Node.${String(p["insertText"])}(node: Node) -> void\n\nDoc.` } } });
            break;
          case "shutdown":
            send({ id: m.id, error: { code: -32601, message: "Method not found: shutdown" } });
            break;
          default:
            if (m.id !== undefined && m.method) send({ id: m.id, result: null });
        }
      }
    });
  });
  await new Promise<void>((r) => fake.server.listen(0, "127.0.0.1", r));
  fake.port = (fake.server.address() as { port: number }).port;
  fake.close = () =>
    new Promise((r) => {
      for (const s of sockets) s.destroy();
      fake.server.close(() => r());
    });
  return fake;
}

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "godotwright lsp-"));
  writeFileSync(join(root, "project.godot"), 'config_version=5\n[application]\nconfig/name="L"\n');
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  return root;
}

const MAIN = 'extends Node\n\nvar speed: float = 3.0\n\n\nfunc _ready() -> void:\n\tvar unused := 5\n\tvar n: int = "text"\n\tprint(speed, get_parent())\n';

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function setup(files: Record<string, string> = { "main.gd": MAIN }) {
  const fake = await fakeLsp();
  const starts: string[] = [];
  const pool = new LanguageServerPool({
    start: (root) => {
      starts.push(root);
      return GodotLanguageServer.start({ root, port: fake.port, startTimeoutMs: 3000, requestTimeoutMs: 1000 });
    },
  });
  cleanups.push(() => pool.stopAll(), () => fake.close());
  return { fake, pool, starts, root: project(files) };
}

describe("LSP framing", () => {
  it("splits messages that arrive in any chunks, with the length counted in bytes", () => {
    const a = encodeMessage({ jsonrpc: "2.0", id: 1, result: "héllo ✓" });
    const b = encodeMessage({ jsonrpc: "2.0", method: "x", params: { s: "ünïcode" } });
    const all = Buffer.concat([a, b]);
    const reader = new MessageReader();
    const got: RpcMessage[] = [];
    for (let i = 0; i < all.length; i++) got.push(...reader.push(all.subarray(i, i + 1)));
    expect(got).toEqual([
      { jsonrpc: "2.0", id: 1, result: "héllo ✓" },
      { jsonrpc: "2.0", method: "x", params: { s: "ünïcode" } },
    ]);
    expect(new MessageReader().push(all)).toHaveLength(2);
  });

  it("skips a header without a length and a body that is not JSON", () => {
    const reader = new MessageReader();
    const bad = Buffer.from("X-Other: 1\r\n\r\nContent-Length: 3\r\n\r\nnot");
    expect(reader.push(Buffer.concat([bad, encodeMessage({ jsonrpc: "2.0", id: 7, result: 1 })]))).toEqual([{ jsonrpc: "2.0", id: 7, result: 1 }]);
  });
});

describe("JSON-RPC connection", () => {
  async function pair(handler: (m: RpcMessage, reply: (m: object) => void) => void) {
    const server = createServer((socket) => {
      const reader = new MessageReader();
      socket.on("data", (c: Buffer) => {
        for (const m of reader.push(c)) handler(m, (r) => socket.write(encodeMessage({ jsonrpc: "2.0", ...r } as RpcMessage)));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { connect } = await import("node:net");
    const socket = connect((server.address() as { port: number }).port, "127.0.0.1");
    await new Promise((r) => socket.once("connect", r));
    const rpc = new RpcConnection(socket, 300);
    cleanups.push(() => rpc.close(), () => new Promise((r) => server.close(r)));
    return rpc;
  }

  it("matches responses to requests by id, also out of order", async () => {
    const held: { m: RpcMessage; reply: (m: object) => void }[] = [];
    const rpc = await pair((m, reply) => {
      held.push({ m, reply });
      if (held.length === 2) for (const h of held.reverse()) h.reply({ id: h.m.id, result: (h.m.params as { n: number }).n * 10 });
    });
    const [a, b] = await Promise.all([rpc.request("a", { n: 1 }), rpc.request("b", { n: 2 })]);
    expect([a, b]).toEqual([10, 20]);
  });

  it("rejects an error response and times out a request nobody answers", async () => {
    const rpc = await pair((m, reply) => {
      if (m.method === "bad") reply({ id: m.id, error: { code: -32601, message: "Method not found: bad" } });
    });
    await expect(rpc.request("bad", null)).rejects.toThrow(RpcError);
    await expect(rpc.request("bad", null)).rejects.toThrow("bad: Method not found: bad");
    await expect(rpc.request("never", null, 100)).rejects.toThrow(RpcTimeoutError);
    await expect(rpc.request("never", null, 100)).rejects.toThrow("did not answer never within 0.1 s");
  });

  it("answers requests from the server, passes notifications on, and fails pending calls when closed", async () => {
    const seen: string[] = [];
    let answer: unknown;
    const rpc = await pair((m, reply) => {
      if (m.method === "start") {
        reply({ id: 99, method: "workspace/configuration", params: {} });
        reply({ method: "note", params: { x: 1 } });
      } else if (m.id === 99) answer = m;
    });
    rpc.onNotification((method) => seen.push(method));
    const note = rpc.waitFor((method) => (method === "note" ? true : undefined), 1000, "note");
    void rpc.request("start", null).catch(() => undefined);
    await note;
    await new Promise((r) => setTimeout(r, 50));
    expect(seen).toEqual(["workspace/configuration", "note"]);
    expect(answer).toEqual({ jsonrpc: "2.0", id: 99, result: null });
    const pending = rpc.request("slow", null, 5000);
    rpc.close(new Error("gone"));
    await expect(pending).rejects.toThrow("gone");
    expect(() => rpc.notify("x", null)).toThrow("gone");
  });
});

describe("Godot's output read", () => {
  it("reads warning names, 1-based places and hovers", () => {
    const d = toCodeDiagnostic("res://a.gd", {
      message: '(UNUSED_VARIABLE): The local variable "x" is declared but never used in the block.',
      range: { start: { line: 6, character: 1 }, end: { line: 6, character: 9 } },
      severity: 2,
    });
    expect(d).toEqual({ file: "res://a.gd", line: 7, column: 2, severity: "warning", warning: "UNUSED_VARIABLE", message: 'The local variable "x" is declared but never used in the block.' });
    expect(parseHover("\tvar t: SceneTree\n\nDefined in [res://main.gd](file:///p/main.gd)")).toEqual({ signature: "var t: SceneTree", doc: "", definedIn: "res://main.gd" });
    expect(engineLookup("func Node.get_parent() -> Node")).toBe("Node.get_parent");
    expect(engineLookup("func @GlobalScope.print(...) -> void")).toBe("print");
    expect(engineLookup("<Native> class Timer extends Node")).toBe("Timer");
    expect(engineLookup("var speed: float")).toBeUndefined();
    expect(completionPrefix("\tposition.", 10)).toEqual({ prefix: "", trigger: "." });
    expect(completionPrefix("\tadd_ch", 7)).toEqual({ prefix: "add_ch" });
    expect(completionPrefix("\t$", 2)).toEqual({ prefix: "", trigger: "$" });
  });
});

describe("godot_code against a fake language server", () => {
  it("collects the diagnostics of one file, deduplicated, as res://file:line:column", async () => {
    const { pool, root } = await setup();
    const r = await codeIntel(root, { op: "diagnostics", file: "res://main.gd", pool });
    const text = formatCode(r);
    expect(text).toContain("res://main.gd:7:2: warning [UNUSED_VARIABLE] The local variable \"unused\"");
    expect(text.match(/res:\/\/main\.gd:8:15: error Cannot assign/g)).toHaveLength(1);
    expect(text).toMatch(/^diagnostics: res:\/\/main\.gd: 1 error, 1 warning/);
    expect(text).toMatch(/note: started Godot's language server in/);
    expect(text.trimEnd().split("\n").pop()).toMatch(/^Next: /);
  });

  it("analyses unsaved code without touching the file, then shows Godot the saved file again", async () => {
    const { pool, root, fake } = await setup();
    const code = "extends Node\n\nfunc _ready() -> void:\n\tvar unused_two := 1\n";
    const r = await codeIntel(root, { op: "diagnostics", file: join(root, "main.gd"), code, pool });
    expect(r.unsaved).toBe(true);
    expect(r.diagnostics?.map((d) => `${d.line} ${d.warning}`)).toEqual(["4 UNUSED_VARIABLE"]);
    expect(readFileSync(join(root, "main.gd"), "utf8")).toBe(MAIN);
    expect(fake.opened.map((o) => o.text)).toEqual([code, MAIN]);
  });

  it("checks every script when no file is given", async () => {
    const { pool, root } = await setup({ "main.gd": MAIN, "b.gd": "extends Node\nfunc f():\n\tvar unused_b = 1\n", "notes.txt": "x" });
    const r = await codeIntel(root, { op: "diagnostics", pool });
    expect(r.scripts).toBe(2);
    expect(r.diagnostics?.map((d) => `${d.file}:${d.line}`)).toEqual(["res://b.gd:3", "res://main.gd:7", "res://main.gd:8"]);
  });

  it("answers hover, definition (also of engine symbols) and completion with 1-based places", async () => {
    const { pool, root } = await setup();
    const hover = formatCode(await codeIntel(root, { op: "hover", file: "res://main.gd", line: 3, column: 6, pool }));
    expect(hover).toMatch(/^hover res:\/\/main\.gd:3:6: var speed: float = 3\.0\ndefined in res:\/\/main\.gd\n/);
    const def = formatCode(await codeIntel(root, { op: "definition", file: "res://main.gd", line: 9, column: 8, pool }));
    expect(def).toContain("res://main.gd:3:5: var speed: float = 3.0");
    const engine = await codeIntel(root, { op: "definition", file: "res://main.gd", line: 9, column: 2, code: "extends Node\n\n\n\n\n\n\n\n\tget_parent()\n", pool });
    expect(engine.engine).toEqual({ signature: "func Node.get_parent() -> Node", lookup: "Node.get_parent" });
    expect(formatCode(engine)).toContain("Next: godot_api Node.get_parent");
    const completion = await codeIntel(root, { op: "completion", file: "res://main.gd", line: 1, column: 7, code: "add_ch\n", pool });
    expect(completion.completion).toEqual({
      prefix: "add_ch",
      total: 1,
      items: [{ label: "add_child(…)", kind: "method", detail: "func Node.add_child(node: Node) -> void" }],
    });
    const nothing = formatCode(await codeIntel(root, { op: "hover", file: "res://main.gd", line: 1, column: 1, pool }));
    expect(nothing).toContain("nothing there");
  });

  it("refuses bad input before starting anything", async () => {
    const { pool, root, starts } = await setup();
    await expect(codeIntel(root, { op: "hover", file: "res://main.gd", pool })).rejects.toThrow("hover needs line and column");
    await expect(codeIntel(root, { op: "hover", file: "res://main.gd", line: 99, column: 1, pool })).rejects.toThrow("line 99 is outside the file (1-10)");
    await expect(codeIntel(root, { op: "hover", file: "res://main.gd", line: 3, column: 80, pool })).rejects.toThrow("column 80 is outside line 3");
    await expect(codeIntel(root, { op: "diagnostics", file: "res://missing.gd", pool })).rejects.toThrow("does not exist; pass code");
    await expect(codeIntel(root, { op: "diagnostics", file: "/elsewhere/x.gd", pool })).rejects.toThrow("is not inside the project");
    await expect(codeIntel(root, { op: "diagnostics", file: "res://project.godot", pool })).rejects.toThrow("is not a GDScript file");
    expect(starts).toEqual([]);
  });

  it("keeps one warm server per project and restarts it when a class_name appears", async () => {
    const { pool, root, starts } = await setup();
    const first = await codeIntel(root, { op: "diagnostics", file: "res://main.gd", pool });
    const second = await codeIntel(root, { op: "diagnostics", file: "res://main.gd", pool });
    expect([first.server.fresh, second.server.fresh]).toEqual([true, false]);
    expect(formatCode(second)).not.toContain("started Godot");
    // An edit to an existing script without class_name: the server sees it, no restart.
    writeFileSync(join(root, "main.gd"), `${MAIN}\n`);
    expect((await codeIntel(root, { op: "diagnostics", file: "res://main.gd", pool })).server.fresh).toBe(false);
    writeFileSync(join(root, "helper.gd"), "class_name Helper\nextends RefCounted\n");
    const third = await codeIntel(root, { op: "diagnostics", file: "res://main.gd", pool });
    expect(third.server).toMatchObject({ fresh: true, restarted: "a class_name or project.godot changed since it started" });
    expect(starts).toHaveLength(2);
  });

  it("stops servers after the idle time", async () => {
    const { pool, root } = await setup();
    await codeIntel(root, { op: "diagnostics", file: "res://main.gd", pool });
    expect(pool.size).toBe(1);
    await pool.sweep(Date.now() + 60_000);
    expect(pool.size).toBe(1);
    await pool.sweep(Date.now() + 11 * 60_000);
    expect(pool.size).toBe(0);
  });

  it("fails clearly when a request times out or the port never answers", async () => {
    const { pool, root, fake } = await setup();
    fake.silent.add("textDocument/hover");
    await expect(codeIntel(root, { op: "hover", file: "res://main.gd", line: 3, column: 6, pool })).rejects.toThrow("did not answer textDocument/hover within 1 s");
    const port = await freePort();
    await expect(GodotLanguageServer.start({ root, port, startTimeoutMs: 400 })).rejects.toThrow(LanguageServerError);
    await expect(GodotLanguageServer.start({ root, port, startTimeoutMs: 400 })).rejects.toThrow(`did not answer on port ${port} within 0.4 s`);
  });

  it.skipIf(process.platform === "win32")("reports a Godot that exits before it answers, with its last output", async () => {
    const root = project({});
    const fakeGodot = join(root, "fake-godot.sh");
    writeFileSync(fakeGodot, "#!/bin/sh\necho 'ERROR: something broke' >&2\nexit 3\n", { mode: 0o755 });
    await expect(GodotLanguageServer.start({ root, godot: fakeGodot, startTimeoutMs: 5000 })).rejects.toThrow(/Godot exited \(code 3\) before its language server answered\nlast output:\nERROR: something broke/);
  });
});
