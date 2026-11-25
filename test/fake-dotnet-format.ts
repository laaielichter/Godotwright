import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempFolder } from "./helpers.js";

/**
 * A `dotnet` that formats and builds like the real one is called (the argument shapes are the real ones; see
 * test/integration/format-csharp.test.ts for the real tool). `dotnet format`: trailing spaces go, runs of spaces
 * between code become one, `{get;set;}` gets its spaces. A file with `// evil` also gets its first string literal
 * changed, and a `break` block comment becomes `BROKEN;`, which `dotnet build` then reports as an error in that file. A file with
 * `NEVER_BUILDS` fails every build. Every call is appended to calls.log.
 */
export function fakeDotnetFormat(): { bin: string; log: string } {
  const dir = tempFolder("fake-dotnet-");
  const bin = join(dir, "dotnet");
  const log = join(dir, "calls.log");
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
const format = (text) => {
  let out = text.split("\\n").map((line) => { const indent = /^[ \\t]*/.exec(line)[0]; return indent + line.slice(indent.length).replace(/[ \\t]+$/, "").split(/("[^"]*")/).map((part, i) => i % 2 ? part : part.replace(/  +/g, " ").replace("{get;set;}", "{ get; set; }")).join(""); }).join("\\n");
  if (out.includes("// evil")) out = out.replace(/"[^"]*"/, '"changed"');
  return out.replace("/*break*/", "BROKEN;");
};
const all = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.name.startsWith(".") ? [] : e.isDirectory() ? all(path.join(dir, e.name)) : e.name.endsWith(".cs") ? [path.join(dir, e.name)] : []);
if (args[0] === "format") {
  const at = args.indexOf("--include");
  const files = [];
  for (let i = at + 1; at >= 0 && i < args.length && !args[i].startsWith("-"); i++) files.push(path.resolve(args[i]));
  const verify = args.includes("--verify-no-changes");
  const report = [];
  for (const file of at >= 0 ? files : all(process.cwd())) {
    const before = fs.readFileSync(file, "utf8");
    const after = format(before);
    if (after === before) continue;
    const a = before.split("\\n"), b = after.split("\\n");
    report.push({ FileName: path.basename(file), FilePath: file, FileChanges: a.flatMap((l, i) => l === b[i] ? [] : [{ LineNumber: i + 1, CharNumber: 1, DiagnosticId: "WHITESPACE", FormatDescription: "Fix whitespace formatting." }]) });
    if (!verify) fs.writeFileSync(file, after);
  }
  const dirAt = args.indexOf("--report");
  if (dirAt >= 0) fs.writeFileSync(path.join(args[dirAt + 1], "format-report.json"), JSON.stringify(report));
  process.exit(verify && report.length ? 2 : 0);
}
if (args[0] === "build") {
  let failed = false;
  for (const file of all(process.cwd())) {
    const lines = fs.readFileSync(file, "utf8").split("\\n");
    lines.forEach((l, i) => { if (l.includes("BROKEN;") || l.includes("NEVER_BUILDS")) { failed = true; process.stdout.write(file + "(" + (i + 1) + ",1): error CS0103: The name '" + (l.includes("BROKEN;") ? "BROKEN" : "NEVER_BUILDS") + "' does not exist in the current context [" + path.join(process.cwd(), "Cs.csproj") + "]\\n"); } });
  }
  process.exit(failed ? 1 : 0);
}
process.exit(0);
`,
  );
  chmodSync(bin, 0o755);
  return { bin, log };
}
