import { finding, type Finding } from "../rules.js";
import type { ProjectModel } from "../model.js";
import { bodyOf } from "./performance.js";

export interface TypingStats {
  typed: number;
  total: number;
}

const LONG_FUNCTION = 60;
const LONG_FILE = 600;
const DEEP_NESTING = 5;

const SNAKE = /^_{0,2}[a-z][a-z0-9_]*$/;
const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
const CONSTANT = /^_?[A-Z][A-Z0-9_]*$/;

/**
 * Static typing coverage and code-quality rules for one script.
 * Declarations count as typed when they have a type or use `:=`.
 */
export function checkScriptQuality(pm: ProjectModel, path: string): { findings: Finding[]; typing: TypingStats } {
  const script = pm.data.scripts.get(path);
  const source = pm.data.sources.get(path) ?? "";
  const out: Finding[] = [];
  const typing: TypingStats = { typed: 0, total: 0 };
  if (!script) return { findings: out, typing };

  const untyped: { line: number; what: string }[] = [];
  const count = (ok: boolean, line: number, what: string) => {
    typing.total++;
    if (ok) typing.typed++;
    else untyped.push({ line, what });
  };

  // `var x: set = _set_x` has no type: the parser reads the accessor keyword as the type.
  const declaredType = (type: string | undefined) => Boolean(type) && type !== "set" && type !== "get";
  for (const model of [...pm.allModels()].filter((m) => m.path === path)) {
    const o = model.outline;
    for (const v of o.variables) count(declaredType(v.type) || v.inferred, v.line, `var ${v.name}`);
    for (const fn of o.functions) {
      for (const p of fn.params) count(Boolean(p.type) || p.inferred, fn.line, `parameter ${p.name} of ${fn.name}()`);
      count(Boolean(fn.returnType) || fn.name === "_init", fn.line, `return type of ${fn.name}()`);
      const body = bodyOf(script.logicalLines, fn);
      for (const ll of body) {
        const local = /^var\s+([A-Za-z_]\w*)\s*(:\s*[^=]+?)?\s*(:?=)?/.exec(ll.code);
        if (local) count(Boolean(local[2]?.replace(":", "").trim()) || local[3] === ":=", ll.line, `var ${local[1]}`);
      }

      if (body.length > LONG_FUNCTION) {
        out.push(finding("quality/long-function", path, fn.line, `${fn.name}() has ${body.length} statements; aim for under ${LONG_FUNCTION}.`));
      }
      const base = fn.indent;
      const unit = indentUnit(body.map((l) => l.indent - base));
      const deepest = body.reduce((max, l) => Math.max(max, Math.round((l.indent - base) / unit)), 0);
      if (deepest > DEEP_NESTING) {
        const line = body.find((l) => Math.round((l.indent - base) / unit) === deepest)!.line;
        out.push(finding("quality/deep-nesting", path, line, `${fn.name}() nests ${deepest} levels deep.`));
      }
      if (!SNAKE.test(fn.name)) out.push(finding("quality/naming", path, fn.line, `Function "${fn.name}" should be snake_case.`));
    }
    for (const s of o.signals) if (!SNAKE.test(s.name)) out.push(finding("quality/naming", path, s.line, `Signal "${s.name}" should be snake_case.`));
    for (const c of o.constants) {
      if (!CONSTANT.test(c.name) && !PASCAL.test(c.name)) out.push(finding("quality/naming", path, c.line, `Constant "${c.name}" should be CONSTANT_CASE.`));
    }
    for (const v of o.variables) if (!SNAKE.test(v.name)) out.push(finding("quality/naming", path, v.line, `Variable "${v.name}" should be snake_case.`));
    if (o.className && !PASCAL.test(o.className)) out.push(finding("quality/naming", path, 1, `class_name "${o.className}" should be PascalCase.`));
  }

  if (untyped.length > 0) {
    const examples = untyped.slice(0, 3).map((u) => `${u.what} (line ${u.line})`).join(", ");
    out.push(
      finding(
        "quality/untyped",
        path,
        untyped[0]!.line,
        `${untyped.length} of ${typing.total} declarations have no static type, e.g. ${examples}.`,
      ),
    );
  }
  if (script.lineCount > LONG_FILE) {
    out.push(finding("quality/long-file", path, undefined, `${script.lineCount} lines; consider splitting this script.`));
  }

  for (const ll of script.logicalLines) {
    for (const m of ll.text.matchAll(/(^|[^.\w])emit_signal\s*\(\s*&?"(\w+)"/g)) {
      // `name.emit()` only works for a signal this class declares or inherits; for anything else the advice would not compile.
      const model = pm.scopeAt(path, ll.line)?.model;
      if (!model || pm.memberOf({ kind: "script", model, meta: false }, m[2]!)?.kind !== "signal") continue;
      out.push(finding("quality/string-signal", path, ll.line, `emit_signal("${m[2]}") can be ${m[2]}.emit().`));
    }
    // A method given as Callable(self, "name") only needs the connect advice when it is passed to connect().
    if (/\bconnect\s*\(\s*&?"\w+"\s*,/.test(ll.text) || /\bconnect\s*\(\s*Callable\s*\(\s*self\s*,\s*&?"/.test(ll.text)) {
      out.push(finding("quality/string-signal", path, ll.line, "Connect with the signal object and a method reference: my_signal.connect(_on_event)."));
    }
    const up = /(?:get_node(?:_or_null)?\s*\(\s*&?\^?"|\$")((?:\.\.\/){2,}[^"]*)"/.exec(ll.text);
    if (up) out.push(finding("quality/fragile-path", path, ll.line, `Node path "${up[1]}" climbs ${up[1]!.split("../").length - 1} levels up the tree.`));
  }

  source.split("\n").forEach((line, i) => {
    const todo = /#.*\b(TODO|FIXME|HACK|XXX)\b:?\s*(.*)$/.exec(line);
    if (todo) out.push(finding("quality/todo", path, i + 1, `${todo[1]}: ${todo[2]!.trim().slice(0, 80) || "(no text)"}`));
  });

  return { findings: out, typing };
}

/** Signals declared in the project (also in inner classes) but never emitted anywhere. */
export function checkUnusedSignals(pm: ProjectModel): Finding[] {
  const code = [...pm.data.sources.values()].join("\n");
  const out: Finding[] = [];
  for (const model of pm.allModels()) {
    if (model.path.startsWith("res://addons/")) continue;
    for (const s of model.outline.signals) {
      const name = s.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const emitted =
        new RegExp(`\\b${name}\\s*\\.\\s*emit\\s*\\(`).test(code) ||
        new RegExp(`emit_signal\\s*\\(\\s*&?"${name}"`).test(code) ||
        new RegExp(`\\b${name}\\s*\\.\\s*emit\\b`).test(code);
      if (!emitted) out.push(finding("quality/unused-signal", model.path, s.line, `Signal "${s.name}" is declared but never emitted.`));
    }
  }
  return out;
}

function indentUnit(widths: number[]): number {
  const positive = widths.filter((w) => w > 0);
  return positive.length ? Math.min(...positive) : 4;
}
