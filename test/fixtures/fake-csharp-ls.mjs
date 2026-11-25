#!/usr/bin/env node
// A small C# language server over stdio for the tests: the LSP shapes a Roslyn-based server (csharp-ls) answers with.
// Every message it gets is appended to $FAKE_LOG as one JSON line. $FAKE_PULL=1 makes it answer pull diagnostics.
// It knows one symbol: a method named in $FAKE_SYMBOL (default OnBodyEntered), and renames it everywhere it is
// named in the .cs files it has seen on disk under its working directory.
import { appendFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const log = process.env.FAKE_LOG;
const symbol = process.env.FAKE_SYMBOL ?? "OnBodyEntered";
const docs = new Map();
let buffer = Buffer.alloc(0);
let nextId = 1000;

const send = (message) => {
  const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }), "utf8");
  process.stdout.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
};

function csFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...csFiles(full));
    else if (name.endsWith(".cs")) out.push(full);
  }
  return out;
}

const textOf = (uri) => docs.get(uri) ?? readFileSync(fileURLToPath(uri), "utf8");

/** Every place the symbol is named, as LSP locations. */
function places() {
  const out = [];
  for (const file of csFiles(process.cwd())) {
    const uri = pathToFileURL(file).href;
    textOf(uri)
      .split("\n")
      .forEach((line, i) => {
        const re = new RegExp(`\\b${symbol}\\b`, "g");
        for (let m = re.exec(line); m; m = re.exec(line)) out.push({ uri, range: { start: { line: i, character: m.index }, end: { line: i, character: m.index + symbol.length } } });
      });
  }
  return out;
}

const at = (p) => (textOf(p.textDocument.uri).split("\n")[p.position.line] ?? "").includes(symbol);

function handle(m) {
  if (log) appendFileSync(log, `${JSON.stringify({ method: m.method, params: m.params })}\n`);
  const p = m.params ?? {};
  switch (m.method) {
    case "initialize":
      // Like csharp-ls: it asks for its settings before it answers.
      send({ id: nextId++, method: "workspace/configuration", params: { items: [{ section: "csharp" }] } });
      send({
        id: m.id,
        result: {
          capabilities: {
            hoverProvider: true,
            definitionProvider: true,
            referencesProvider: true,
            documentSymbolProvider: true,
            renameProvider: { prepareProvider: true },
            ...(process.env.FAKE_PULL ? { diagnosticProvider: { interFileDependencies: true, workspaceDiagnostics: false } } : {}),
          },
        },
      });
      break;
    case "textDocument/didOpen": {
      const { uri, text } = p.textDocument;
      docs.set(uri, text);
      if (process.env.FAKE_PULL) break;
      const diagnostics = [];
      text.split("\n").forEach((line, i) => {
        if (line.includes("missingName")) diagnostics.push({ range: { start: { line: i, character: 17 }, end: { line: i, character: 28 } }, severity: 1, code: "CS0103", source: "csharp", message: "The name 'missingName' does not exist in the current context" });
      });
      // First the syntax pass (nothing), then the semantic one.
      send({ method: "textDocument/publishDiagnostics", params: { uri, diagnostics: [] } });
      setTimeout(() => send({ method: "textDocument/publishDiagnostics", params: { uri, diagnostics } }), 100);
      break;
    }
    case "textDocument/didClose":
      docs.delete(p.textDocument.uri);
      break;
    case "textDocument/diagnostic": {
      const items = textOf(p.textDocument.uri).includes("missingName") ? [{ range: { start: { line: 7, character: 17 }, end: { line: 7, character: 28 } }, severity: 1, code: "CS0103", message: "The name 'missingName' does not exist in the current context" }] : [];
      send({ id: m.id, result: { kind: "full", items } });
      break;
    }
    case "textDocument/hover":
      send({ id: m.id, result: at(p) ? { contents: { kind: "markdown", value: "```csharp\nprivate void AreaTriggerT.OnBodyEntered(Node2D body)\n```\n\nRuns when a body enters." } } : (textOf(p.textDocument.uri).split("\n")[p.position.line] ?? "").includes("IsInGroup") ? { contents: { kind: "markdown", value: "```csharp\nbool Godot.Node.IsInGroup(StringName group)\n```" } } : null });
      break;
    case "textDocument/definition":
      send({ id: m.id, result: at(p) ? places().slice(0, 1) : [] });
      break;
    case "textDocument/references":
      send({ id: m.id, result: at(p) ? places() : [] });
      break;
    case "textDocument/documentSymbol":
      send({
        id: m.id,
        result: [
          {
            name: "AreaTriggerT",
            kind: 5,
            range: { start: { line: 5, character: 0 }, end: { line: 30, character: 1 } },
            selectionRange: { start: { line: 5, character: 21 }, end: { line: 5, character: 33 } },
            children: [
              { name: "TriggeredEventHandler", kind: 24, range: { start: { line: 8, character: 1 }, end: { line: 8, character: 50 } }, selectionRange: { start: { line: 8, character: 22 }, end: { line: 8, character: 43 } } },
              { name: "_Ready", kind: 6, detail: "void AreaTriggerT._Ready()", range: { start: { line: 16, character: 1 }, end: { line: 19, character: 2 } }, selectionRange: { start: { line: 16, character: 22 }, end: { line: 16, character: 28 } } },
            ],
          },
        ],
      });
      break;
    case "textDocument/prepareRename":
      send({ id: m.id, result: at(p) ? { range: places()[0].range, placeholder: symbol } : null });
      break;
    case "textDocument/rename": {
      if (!at(p)) {
        send({ id: m.id, error: { code: -32602, message: "No symbol to rename at this position" } });
        break;
      }
      const changes = {};
      for (const loc of places()) (changes[loc.uri] ??= []).push({ range: loc.range, newText: p.newName });
      send({ id: m.id, result: process.env.FAKE_DOCUMENT_CHANGES ? { documentChanges: Object.entries(changes).map(([uri, edits]) => ({ textDocument: { uri, version: null }, edits })) } : { changes } });
      break;
    }
    case "shutdown":
      send({ id: m.id, result: null });
      break;
    case "exit":
      process.exit(0);
      break;
    default:
      if (m.id !== undefined && m.method) send({ id: m.id, result: null });
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const end = buffer.indexOf("\r\n\r\n");
    if (end < 0) return;
    const length = Number(/content-length:\s*(\d+)/i.exec(buffer.subarray(0, end).toString())?.[1] ?? 0);
    if (buffer.length < end + 4 + length) return;
    const body = buffer.subarray(end + 4, end + 4 + length).toString("utf8");
    buffer = buffer.subarray(end + 4 + length);
    const message = JSON.parse(body);
    // A response to our own request (workspace/configuration): just log it.
    if (message.method === undefined) {
      if (log) appendFileSync(log, `${JSON.stringify({ response: message.id, result: message.result })}\n`);
      continue;
    }
    handle(message);
  }
});
