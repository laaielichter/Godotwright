import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatScript, guardFormat } from "../../src/format/format.js";
import { type ClassOutline, outlineScript } from "../../src/godot/gdscript.js";

/**
 * The formatter on real scripts: set GODOTWRIGHT_CORPUS to a folder with Godot projects. Nothing is written
 * there: every .gd file is read and formatted in memory. For every file the guard must pass or the file must
 * be skipped with a reason and returned as it was; the result must be stable; and this repository's own
 * outline of the script (functions, signals, variables, constants, enums, inner classes, and the statements
 * without their whitespace) must be the same before and after. Godot's own parser is not part of this test.
 */
const CORPUS = process.env["GODOTWRIGHT_CORPUS"];

function walk(dir: string, out: string[] = []): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (name === ".git" || name === "node_modules") continue;
    const full = join(dir, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith(".gd")) out.push(full);
  }
  return out;
}

/** The outline without line numbers. `inferred` is left out: the outline does not read `a: = 1`, which the formatter writes as `a := 1`. */
function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape);
  if (value === null || typeof value !== "object") return typeof value === "string" ? value.replace(/\s+/g, "") : value;
  const skip = new Set(["line", "endLine", "indent", "lineCount", "logicalLines", "preloads", "inferred"]);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !skip.has(key))
      .map(([key, v]) => [key, shape(v)]),
  );
}

function sameMeaning(before: string, after: string): string | undefined {
  const a = outlineScript(before);
  const b = outlineScript(after);
  if (JSON.stringify(shape(a as ClassOutline)) !== JSON.stringify(shape(b as ClassOutline))) return "the outline differs";
  if (a.logicalLines.length !== b.logicalLines.length) return `${a.logicalLines.length} statements became ${b.logicalLines.length}`;
  for (let i = 0; i < a.logicalLines.length; i++) {
    if (a.logicalLines[i]!.code.replace(/\s+/g, "") !== b.logicalLines[i]!.code.replace(/\s+/g, "")) return `statement at line ${a.logicalLines[i]!.line} differs`;
  }
  return undefined;
}

describe.skipIf(!CORPUS)("format on a corpus of real scripts", () => {
  it("never changes what a script means", { timeout: 1_800_000 }, () => {
    const files = walk(CORPUS!);
    const stats = { files: files.length, distinct: 0, changed: 0, unchanged: 0, skipped: 0, guardRefusals: 0 };
    const reasons = new Map<string, number>();
    const problems: string[] = [];
    const seen = new Map<string, { kind: "changed" | "unchanged" | "skipped"; reason?: string; problem?: string }>();
    for (const file of files) {
      const bytes = readFileSync(file);
      const source = bytes.toString("utf8");
      let result = seen.get(source);
      if (!result) {
        stats.distinct++;
        if (!Buffer.from(source, "utf8").equals(bytes)) result = { kind: "skipped", reason: "the file is not valid UTF-8" };
        else {
          const formatted = formatScript(source);
          result = { kind: formatted.skipped !== undefined ? "skipped" : formatted.changed ? "changed" : "unchanged", ...(formatted.skipped !== undefined ? { reason: formatted.skipped } : {}) };
          if (formatted.skipped !== undefined || !formatted.changed) {
            if (formatted.text !== source) result.problem = "a skipped or unchanged script came back different";
          } else {
            const again = formatScript(formatted.text);
            result.problem = guardFormat(source, formatted.text) ?? (again.text !== formatted.text || again.skipped !== undefined ? "not stable" : undefined) ?? sameMeaning(source, formatted.text);
          }
        }
        seen.set(source, result);
      }
      stats[result.kind]++;
      if (result.reason !== undefined) {
        if (result.reason.startsWith("formatter guard")) stats.guardRefusals++;
        const key = result.reason.replace(/\(lines? [\d and]+\)/g, "").replace(/line \d+/g, "line N").replace(/: ".*$/s, "").trim();
        reasons.set(key, (reasons.get(key) ?? 0) + 1);
      }
      if (result.problem !== undefined && problems.length < 20) problems.push(`${file}: ${result.problem}`);
    }
    const top = [...reasons].sort((x, y) => y[1] - x[1]).map(([reason, n]) => `  ${n} ${reason}`);
    process.stderr.write(`format corpus: ${JSON.stringify(stats)}\nskipped because:\n${top.join("\n")}\n`);
    expect(problems).toEqual([]);
    expect(stats.files).toBeGreaterThan(0);
    // A guard refusal is safe (nothing is written), but each one is a formatter bug to fix.
    expect(stats.guardRefusals).toBe(0);
    expect(stats.skipped).toBeLessThan(Math.max(5, stats.files * 0.02));
  });
});
