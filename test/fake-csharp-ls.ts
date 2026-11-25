import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempFolder } from "./helpers.js";

/**
 * A small language server over stdin and stdout that speaks like csharp-ls 0.16.0 (the shapes are copied from the
 * real one): it asks for its configuration, loads "the solution" and says so with `$/progress`, publishes diagnostics
 * for an opened document, and answers the requests godot_code and godot_rename make. `nope` in a document is a
 * CS0103; every method it gets is appended to calls.log. The rename it answers replaces the word at the position in
 * every .cs file it knows (whole words, but not in a string and not after `SignalName.`, `MethodName.` or `PropertyName.`), as edits per
 * document; like Godot's source generators in the real one, those names exist only while a file declares the member.
 */
export function fakeCSharpLs(options: { loadMs?: number; exitAtStart?: number } = {}): { bin: string; log: string } {
  const dir = tempFolder("fake-csharp-ls-");
  const bin = join(dir, "csharp-ls");
  const log = join(dir, "calls.log");
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
const url = require("node:url");
const LOG = ${JSON.stringify(log)};
if (${options.exitAtStart ?? -1} >= 0) { process.stderr.write("boom\\n"); process.exit(${options.exitAtStart ?? 0}); }
let buffer = Buffer.alloc(0);
const docs = new Map();
const send = (m) => { const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...m })); process.stdout.write("Content-Length: " + body.length + "\\r\\n\\r\\n"); process.stdout.write(body); };
const textOf = (uri) => docs.has(uri) ? docs.get(uri) : (() => { try { return fs.readFileSync(url.fileURLToPath(uri), "utf8"); } catch { return ""; } })();
const diagnose = (uri) => textOf(uri).split("\\n").flatMap((line, i) => { const at = line.indexOf("nope"); return at < 0 ? [] : [{ range: { start: { line: i, character: at }, end: { line: i, character: at + 4 } }, severity: 1, code: "CS0103", source: "lsp", message: "The name 'nope' does not exist in the current context" }]; }).concat(generated(uri)).concat(/using System;/.test(textOf(uri)) ? [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, severity: 4, code: "IDE0005", message: "Using directive is unnecessary." }] : []);
// Like Godot's source generators in the real server: SignalName.X, MethodName.X and PropertyName.X exist only while a
// known file declares X; a method declared twice in one file is CS0111.
const declared = (kind, name) => [...known].some((uri) => new RegExp(kind === "SignalName" ? "delegate\\\\s+void\\\\s+" + name + "EventHandler\\\\b" : kind === "MethodName" ? "\\\\bvoid\\\\s+" + name + "\\\\s*\\\\(" : "\\\\b" + name + "\\\\s*\\\\{\\\\s*get").test(textOf(uri)));
const generated = (uri) => { const out = []; textOf(uri).split("\\n").forEach((line, i) => { const re = /\\b(SignalName|MethodName|PropertyName)\\.(\\w+)/g; let m; while ((m = re.exec(line))) if (!declared(m[1], m[2])) { const at = m.index + m[1].length + 1; out.push({ range: { start: { line: i, character: at }, end: { line: i, character: at + m[2].length } }, severity: 1, code: "CS0117", message: "'Hello." + m[1] + "' does not contain a definition for '" + m[2] + "'" }); } const dup = /void\\s+(\\w+)\\s*\\(/.exec(line); if (dup && textOf(uri).split("void " + dup[1] + "(").length > 2) out.push({ range: { start: { line: i, character: dup.index + 5 }, end: { line: i, character: dup.index + 5 + dup[1].length } }, severity: 1, code: "CS0111", message: "Type already defines a member called '" + dup[1] + "' with the same parameter types" }); }); return out; };
const wordAt = (uri, pos) => { const line = textOf(uri).split("\\n")[pos.line] || ""; return ((/[A-Za-z_]\\w*$/.exec(line.slice(0, pos.character)) || [""])[0]) + ((/^\\w*/.exec(line.slice(pos.character)) || [""])[0]); };
const known = new Set();
const occurrences = (word) => { const out = []; for (const uri of known) { textOf(uri).split("\\n").forEach((line, i) => { const re = new RegExp("\\\\b" + word + "\\\\b", "g"); let m; while ((m = re.exec(line))) out.push({ uri, range: { start: { line: i, character: m.index }, end: { line: i, character: m.index + word.length } } }); }); } return out; };
function handle(m) {
  fs.appendFileSync(LOG, (m.method || "response") + "\\n");
  const p = m.params || {};
  switch (m.method) {
    case "initialize":
      for (const f of fs.readdirSync(url.fileURLToPath(p.rootUri), { recursive: true })) if (String(f).endsWith(".cs")) known.add(url.pathToFileURL(require("node:path").join(url.fileURLToPath(p.rootUri), String(f))).href);
      send({ method: "window/showMessage", params: { type: 3, message: "csharp-ls: initializing, version 0.16.0.0" } });
      send({ id: m.id, result: { capabilities: { hoverProvider: true, renameProvider: { prepareProvider: true } }, serverInfo: { name: "csharp-ls", version: "0.16.0.0" } } });
      break;
    case "initialized":
      send({ id: "cfg", method: "workspace/configuration", params: { items: [{ section: "csharp" }] } });
      send({ id: "tok", method: "window/workDoneProgress/create", params: { token: "t" } });
      send({ method: "$/progress", params: { token: "t", value: { kind: "begin", title: "Loading solution" } } });
      setTimeout(() => send({ method: "$/progress", params: { token: "t", value: { kind: "end", message: "Finished loading solution" } } }), ${options.loadMs ?? 20});
      break;
    case "textDocument/didOpen":
      docs.set(p.textDocument.uri, p.textDocument.text); known.add(p.textDocument.uri);
      send({ method: "textDocument/publishDiagnostics", params: { uri: p.textDocument.uri, diagnostics: diagnose(p.textDocument.uri) } });
      break;
    case "textDocument/didChange":
      docs.set(p.textDocument.uri, p.contentChanges[0].text);
      send({ method: "textDocument/publishDiagnostics", params: { uri: p.textDocument.uri, diagnostics: diagnose(p.textDocument.uri) } });
      break;
    case "textDocument/didClose":
      break;
    case "workspace/didChangeWatchedFiles":
      for (const c of p.changes) { docs.delete(c.uri); if (c.type === 3) known.delete(c.uri); else known.add(c.uri); fs.appendFileSync(LOG, "watched " + c.type + " " + require("node:path").basename(url.fileURLToPath(c.uri)) + "\\n"); }
      break;
    case "textDocument/diagnostic":
      send({ id: m.id, result: { kind: "full", items: diagnose(p.textDocument.uri) } });
      break;
    case "textDocument/hover": {
      const word = wordAt(p.textDocument.uri, p.position);
      send({ id: m.id, result: word === "GetNode" ? { contents: { kind: "markdown", value: "\`\` Timer Node.GetNode<Timer>(NodePath path) \`\` from assembly \`\` GodotSharp \`\`\\n\\nFetches a node." } } : word ? { contents: { kind: "markdown", value: "\`\` int Player." + word + " \`\`" } } : null });
      break;
    }
    case "textDocument/definition": {
      const word = wordAt(p.textDocument.uri, p.position);
      send({ id: m.id, result: word === "Node" ? [{ uri: "csharp:/metadata/projects/Cs/assemblies/GodotSharp/symbols/Godot.Node.cs", range: { start: { line: 22, character: 13 }, end: { line: 22, character: 17 } } }] : occurrences(word).slice(0, 1) });
      break;
    }
    case "textDocument/references": {
      const word = wordAt(p.textDocument.uri, p.position);
      const found = occurrences(word);
      // As the real one does for a property: its accessors too.
      const first = found[0];
      send({ id: m.id, result: first ? [...found, { uri: first.uri, range: { start: { line: first.range.start.line, character: first.range.end.character + 3 }, end: { line: first.range.start.line, character: first.range.end.character + 6 } } }] : [] });
      break;
    }
    case "textDocument/documentSymbol":
      send({ id: m.id, result: [{ name: "Player.cs", kind: 1, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, children: [{ name: "Player", kind: 5, selectionRange: { start: { line: 2, character: 21 }, end: { line: 2, character: 27 } }, children: [{ name: "Speed", detail: "int Player.Speed", kind: 7, selectionRange: { start: { line: 4, character: 12 }, end: { line: 4, character: 17 } } }] }] }] });
      break;
    case "textDocument/completion":
      send({ id: m.id, result: { isIncomplete: true, items: [{ label: "Speed", kind: 10 }, { label: "SpeedUp", kind: 2 }, { label: "Other", kind: 7 }] } });
      break;
    case "textDocument/prepareRename": {
      const word = wordAt(p.textDocument.uri, p.position);
      send({ id: m.id, result: word && word !== "Node" ? { placeholder: word, range: { start: p.position, end: p.position } } : null });
      break;
    }
    case "textDocument/rename": {
      const word = wordAt(p.textDocument.uri, p.position);
      const byUri = new Map();
      // Not the names the source generators make: the real server does not rename those either.
      for (const o of occurrences(word).filter((o) => !/((SignalName|MethodName|PropertyName)\\.|")$/.test(textOf(o.uri).split("\\n")[o.range.start.line].slice(0, o.range.start.character)))) byUri.set(o.uri, [...(byUri.get(o.uri) || []), { range: o.range, newText: p.newName }]);
      send({ id: m.id, result: { documentChanges: [...byUri].map(([uri, edits]) => ({ textDocument: { uri, version: null }, edits })) } });
      break;
    }
    case "shutdown":
      send({ id: m.id, result: null });
      break;
    case "exit":
      process.exit(0);
    default:
      if (m.id !== undefined && m.method) send({ id: m.id, error: { code: -32601, message: "Method not found" } });
  }
}
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const end = buffer.indexOf("\\r\\n\\r\\n");
    if (end < 0) break;
    const size = Number(/content-length:\\s*(\\d+)/i.exec(buffer.subarray(0, end).toString())[1]);
    if (buffer.length < end + 4 + size) break;
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + size).toString());
    buffer = buffer.subarray(end + 4 + size);
    handle(message);
  }
});
process.stdin.on("end", () => process.exit(0));
`;
  writeFileSync(bin, script);
  chmodSync(bin, 0o755);
  return { bin, log };
}
