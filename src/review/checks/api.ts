import { closest } from "../../api/api.js";
import { resolveResPath } from "../../project/files.js";
import { removedClass, removedMember, removedNote, renamedMember } from "../../api/removed.js";
import { matchingParen, splitAnnotations, type FunctionInfo, type LogicalLine } from "../../godot/gdscript.js";
import { finding, type Finding } from "../rules.js";
import { native, VALUE_TYPES, type ClassModel, type GType, type ProjectModel } from "../model.js";
import { closeIndex, isIdent, KEYWORDS, tokenize, type Token } from "../tokens.js";

interface Value {
  type?: GType;
  /** True when the runtime type is exactly the static type (self, singletons, autoloads, class access). */
  exact: boolean;
}

/** Godot 3 code that does not exist in Godot 4, with the Godot 4 way. */
const GODOT3_SYNTAX: [RegExp, string][] = [
  [/^export\b(?!_)/, "`export var` is `@export var` in Godot 4"],
  [/^onready\s+var\b/, "`onready var` is `@onready var` in Godot 4"],
  [/^tool\s*$/, "`tool` is `@tool` in Godot 4"],
  [/\bsetget\b/, "`setget` is gone in Godot 4; use `var x: T: set = _set_x, get = _get_x` or set()/get blocks"],
  [/\byield\s*\(/, "`yield()` is `await` in Godot 4, e.g. `await get_tree().create_timer(1.0).timeout`"],
  [/^(remote|master|puppet|remotesync|mastersync|puppetsync|sync|slave)\s+(func|var)\b/, "network keywords are `@rpc(...)` annotations in Godot 4"],
  [/\bfuncref\s*\(/, "`funcref()` is a Callable in Godot 4: `object.method` or `Callable(object, \"method\")`"],
  [/\bconnect\(\s*"[^"]*"\s*,\s*[^,()"]+\s*,\s*"[^"]*"/, "`connect(\"signal\", target, \"method\")` is `signal_name.connect(target.method)` in Godot 4"],
  [/^\.[A-Za-z_]\w*\s*\(/, "`.method()` super calls are `super.method()` in Godot 4"],
];

/** Godot 3 members that moved to another class in Godot 4. */
export const MOVED: Record<string, string> = {
  "OS.get_ticks_msec": "Time.get_ticks_msec()",
  "OS.get_ticks_usec": "Time.get_ticks_usec()",
  "OS.get_unix_time": "Time.get_unix_time_from_system()",
  "OS.get_system_time_msecs": "int(Time.get_unix_time_from_system() * 1000)",
  "OS.get_datetime": "Time.get_datetime_dict_from_system()",
  "OS.get_date": "Time.get_date_dict_from_system()",
  "OS.get_time": "Time.get_time_dict_from_system()",
  "OS.window_fullscreen": "DisplayServer.window_set_mode()",
  "OS.window_size": "DisplayServer.window_get_size() / window_set_size()",
  "OS.window_position": "get_window().position",
  "OS.min_window_size": "get_window().min_size",
  "OS.max_window_size": "get_window().max_size",
  "OS.window_borderless": "get_window().borderless",
  "OS.set_window_title": "DisplayServer.window_set_title() or get_window().title",
  "OS.get_screen_size": "DisplayServer.screen_get_size()",
  "OS.vsync_enabled": "DisplayServer.window_set_vsync_mode()",
  "Engine.editor_hint": "Engine.is_editor_hint()",
};

/**
 * Godot 3 global functions removed without a one-to-one rename, so Godot's rename table does not know them.
 * `canvas` marks functions that only mean this on a CanvasItem.
 */
export const REMOVED_FUNCTIONS: Record<string, { to: string; canvas?: boolean }> = {
  to_json: { to: "JSON.stringify(v)" },
  parse_json: { to: "JSON.parse_string(s)" },
  polar2cartesian: { to: "Vector2.from_angle(a) * r" },
  cartesian2polar: { to: "Vector2(x, y).length() and Vector2(x, y).angle()" },
  ColorN: { to: 'Color("red") or Color.RED' },
  update: { to: "queue_redraw()", canvas: true },
};

/** `.instance()` is Godot 3's PackedScene call. Scripts may define their own `instance()`, so see checkScriptApi. */
const PACKED_INSTANCE = /\.instance\(\s*\)/;

const INPUT_ONE = /\b(?:is_action_pressed|is_action_just_pressed|is_action_just_released|is_action_released|get_action_strength|get_action_raw_strength|is_action|action_press|action_release)\s*\(\s*&?"([^"]+)"/g;
const INPUT_AXIS = /\bget_axis\s*\(\s*&?"([^"]+)"\s*,\s*&?"([^"]+)"/g;
const INPUT_VECTOR = /\bget_vector\s*\(\s*&?"([^"]+)"\s*,\s*&?"([^"]+)"\s*,\s*&?"([^"]+)"\s*,\s*&?"([^"]+)"/g;
const SIGNAL_BY_NAME = /(^|[^.\w])(emit_signal|connect|disconnect|is_connected)\s*\(\s*&?"([^"]+)"/g;
const ADD_USER_SIGNAL = /\badd_user_signal\s*\(\s*&?"([^"]+)"/g;

export interface ApiCheckOptions {
  /** Project uses C# or GDExtension, so unknown class names may be real. */
  foreignClasses: boolean;
  inputActions: Set<string>;
  /** The project moves to Godot 4.7 from an older release: also report what only may break (see checks/version.ts). */
  migrating?: boolean;
}

/**
 * Statements joined with `;` on one line (`var a := f(); var b := g()`) as statements of their own, so a local declared
 * after a `;` is known. `code` has string contents blanked, so a `;` inside a string does not split.
 */
export function splitStatements(lines: LogicalLine[]): LogicalLine[] {
  const out: LogicalLine[] = [];
  for (const ll of lines) {
    if (!ll.code.includes(";")) {
      out.push(ll);
      continue;
    }
    let depth = 0;
    let start = 0;
    const cut = (end: number) => {
      const lead = ll.code.slice(start, end).length - ll.code.slice(start, end).trimStart().length;
      const text = ll.text.slice(start + lead, end).trimEnd();
      if (text) out.push({ ...ll, text, code: ll.code.slice(start + lead, start + lead + text.length) });
    };
    for (let i = 0; i < ll.code.length; i++) {
      const c = ll.code[i]!;
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
      else if (c === ";" && depth === 0) {
        cut(i);
        start = i + 1;
      }
    }
    cut(ll.code.length);
  }
  return out;
}

export function checkScriptApi(pm: ProjectModel, path: string, options: ApiCheckOptions): Finding[] {
  const script = pm.data.scripts.get(path);
  const top = pm.scripts.get(path);
  if (!script || !top) return [];
  const out: Finding[] = [];
  const seen = new Set<string>();
  const report = (rule: string, line: number, message: string, severity?: Finding["severity"]) => {
    const key = `${rule}|${line}|${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(finding(rule, path, line, message, severity));
  };
  const api = pm.api;

  const typeLabel = (type: GType): string =>
    type.kind === "native" ? type.name : type.kind === "script" ? (type.model.name ?? type.model.path) : "enum";

  const renameHint = (name: string, kind: "type" | "member" | "function"): string => {
    const r = kind === "type" ? api.renamedClass(name) : api.renamedMember(name);
    return r ? ` In Godot 4 it is \`${r.to}\` (Godot 3 name).` : "";
  };

  /**
   * True when a script in the chain (or around an inner class) extends something that does not resolve: a missing
   * file, or one only the shipped game holds. Its constants, enums and inner classes are unknown, so names that could
   * come from it are not reported; the base itself is reported once (or not at all when the game ships it).
   */
  const unresolvedBase = (model: ClassModel): boolean => {
    for (let scope: ClassModel | undefined = model; scope; scope = scope.owner) {
      if (pm.chain(scope).some((c) => c.extendsRaw && !c.parent && !c.renamedBase && !pm.resolveClassRef(c.extendsRaw, c))) return true;
    }
    return false;
  };
  /** A constant alias of a script, `const Flight = preload("res://missing.gd")`: a broken path is reported on its own. */
  const isConstAlias = (name: string, from: ClassModel): boolean => {
    const head = name.split(".")[0]!;
    for (let scope: ClassModel | undefined = from; scope; scope = scope.owner) {
      const aliases = (c: ClassModel) =>
        c.outline.constants.some((k) => k.name === head && !k.type && /=\s*(?:pre)?load\(/.test(pm.lineAt(c.script, k.line)?.text ?? ""));
      if (pm.chain(scope).some(aliases)) return true;
    }
    return false;
  };

  // --- type names -------------------------------------------------------
  const checkTypeName = (raw: string | undefined, line: number, from: ClassModel) => {
    if (!raw) return;
    for (const name of raw.split(/[[\],\s]+/).filter(Boolean)) {
      if (pm.resolveTypeName(name, from) || name === "void" || name === "Variant") continue;
      if (options.foreignClasses) continue;
      const hint = renameHint(name, "type");
      if (!hint && (isConstAlias(name, from) || unresolvedBase(from))) continue;
      const near = hint ? "" : suggest(name, [...api.classes.keys(), ...pm.classNames.keys()]);
      report("api/unknown-type", line, `Type "${name}" does not exist in Godot 4.7 or this project.${removedNote(removedClass(name))}${hint}${near}`);
    }
  };

  /** `extends "res://x.gd"` where only the shipped game holds x.gd (a .pck file list): it exists, its code is unknown. */
  const shippedScript = (model: ClassModel): boolean => {
    const raw = model.extendsRaw!.trim().replace(/^"|"$/g, "");
    if (!/^(res:\/\/|\.\.?\/)|\.gd$/.test(raw)) return false;
    return pm.data.shipped.has(resolveResPath(model.path, raw.split(/(?<=\.gd)\./)[0]!));
  };

  for (const model of pm.modelsOf(path)) {
    if (model.extendsRaw && !pm.resolveClassRef(model.extendsRaw, model) && !options.foreignClasses && !shippedScript(model)) {
      const line = model.owner ? model.firstLine : (script.logicalLines.find((l) => /^(@\w+\s+)*(class_name\b.*\b)?extends\b/.test(l.text))?.line ?? 1);
      const name = model.extendsRaw.replace(/^"|"$/g, "");
      const hint = renameHint(name, "type");
      report("api/unknown-type", line, `Cannot extend "${name}": it does not exist in Godot 4.7 or this project.${removedNote(removedClass(name))}${hint}`);
    }
    for (const fn of model.outline.functions) {
      for (const p of fn.params) checkTypeName(p.type, fn.line, model);
      checkTypeName(fn.returnType, fn.line, model);
    }
    for (const v of model.outline.variables) checkTypeName(v.type, v.line, model);
    for (const c of model.outline.constants) checkTypeName(c.type, c.line, model);
    for (const s of model.outline.signals) for (const p of s.params) checkTypeName(p.type, s.line, model);
  }

  const source = pm.data.sources.get(path) ?? "";
  const duckTyped = new Set([...source.matchAll(/\b(?:has_method|has_signal|has_meta)\s*\(\s*&?"(\w+)"/g)].map((m) => m[1]!));
  /** Signals that a script adds at runtime with add_user_signal(), in it or in a script it extends. */
  const runtimeSignals = (model: ClassModel): Set<string> =>
    new Set(pm.chain(model).flatMap((c) => [...(pm.data.sources.get(c.path) ?? "").matchAll(ADD_USER_SIGNAL)].map((m) => m[1]!)));
  // Without a receiver type, `x.instance()` is Godot 3 only when no script (or foreign class) in the project defines `instance`.
  let definesInstance: boolean | undefined;
  const hasInstanceMethod = (): boolean =>
    (definesInstance ??= options.foreignClasses || [...pm.allModels()].some((m) => m.outline.functions.some((f) => f.name === "instance")));

  // --- per statement ----------------------------------------------------
  let currentFn: FunctionInfo | undefined;
  let locals = new Map<string, GType | undefined>();
  /** Locals whose static type is Variant: untyped parameters, `var x` without a value, loop variables over untyped collections. */
  let variants = new Set<string>();
  /** Locals that are an untyped Array or Dictionary: their elements are Variant. */
  let containers = new Set<string>();
  let currentTokens: Token[] = [];
  let currentOpen = 0;
  /** True while the whole statement is analysed, so a chain at its start can be an assignment target. */
  let statementLevel = false;

  for (const ll of splitStatements(script.logicalLines)) {
    const scope = pm.scopeAt(path, ll.line);
    if (!scope) continue;
    const { model, fn } = scope;
    if (fn !== currentFn) {
      currentFn = fn;
      locals = new Map();
      variants = new Set();
      containers = new Set();
      for (const p of fn?.params ?? []) {
        locals.set(p.name, p.type ? pm.typeFromAnnotation(p.type, model) : p.inferred && p.default ? pm.literalType(p.default, model) : undefined);
        if (!p.type && !p.inferred) variants.add(p.name);
        else if (p.type === "Variant") variants.add(p.name);
        else if (p.type === "Array" || p.type === "Dictionary") containers.add(p.name);
      }
    }

    // Matched on the blanked code, so words inside string literals are not syntax.
    for (const [re, message] of GODOT3_SYNTAX) {
      if (re.test(ll.code)) report("api/godot3-syntax", ll.line, `Godot 3 syntax: ${message}.`);
    }
    if (PACKED_INSTANCE.test(ll.code) && !hasInstanceMethod()) {
      report("api/godot3-syntax", ll.line, "Godot 3 syntax: `PackedScene.instance()` is `instantiate()` in Godot 4.");
    }
    for (const name of inputActions(ll.text)) {
      if (!options.inputActions.has(name) && !name.startsWith("ui_")) {
        report("api/unknown-input-action", ll.line, `Input action "${name}" is not in the Input Map.${suggest(name, [...options.inputActions])}`);
      }
    }

    const selfType: GType = { kind: "script", model, meta: false };
    for (const m of ll.text.matchAll(SIGNAL_BY_NAME)) {
      const name = m[3]!;
      const member = pm.memberOf(selfType, name);
      if (!member && !model.dynamic && !runtimeSignals(model).has(name)) {
        report("api/unknown-signal", ll.line, `Signal "${name}" is not declared on this class or its parents.${suggestSignals(pm, selfType, name)}`);
      } else if (member && member.kind !== "signal") {
        report("api/unknown-signal", ll.line, `"${name}" is a ${member.kind}, not a signal.`);
      }
    }

    const { annotations, rest } = splitAnnotations(ll.code);
    const offset = ll.code.length - rest.length;
    const analyze = (from: number, to = rest.length) => analyzeExpr(rest.slice(from, to), offset + from);

    let m: RegExpExecArray | null;
    if ((m = /^(static\s+)?func\b/.exec(rest))) {
      const open = rest.indexOf("(");
      if (open < 0) continue;
      const close = matchingParen(rest, open);
      const colon = rest.indexOf(":", close);
      if (colon >= 0 && rest.slice(colon + 1).trim() !== "") analyze(colon + 1);
      continue;
    }
    if ((m = /^(static\s+)?var\s+([A-Za-z_]\w*)\s*(?::\s*([^=]*?))?\s*(:?=)\s*/.exec(rest))) {
      const body = rest.slice(m[0].length).replace(/:\s*$/, "");
      const inferred = /:\s*=\s*$/.test(m[0]) && !m[3]?.trim();
      if (inferred) {
        checkInferVariant(m[2]!, body, ll.line);
        if (fn) checkInferFromVariant(m[2]!, body, ll.line);
      }
      if (fn) trackVariant(m[2]!, m[3]?.trim() || undefined, inferred ? body : undefined, true);
      const result = analyzeExpr(body, offset + m[0].length);
      if (fn && !annotations.length) {
        checkTypeName(m[3]?.trim() || undefined, ll.line, model);
        const declared = m[3]?.trim() ? pm.typeFromAnnotation(m[3].trim(), model) : undefined;
        locals.set(m[2]!, declared ?? result ?? pm.literalType(textOf(ll, offset + m[0].length, body.length), model));
      }
      continue;
    }
    if ((m = /^(static\s+)?var\s+([A-Za-z_]\w*)\s*(?::\s*([^=:]*))?\s*:?\s*$/.exec(rest))) {
      if (fn) trackVariant(m[2]!, m[3]?.trim(), undefined, false);
      if (fn) {
        checkTypeName(m[3]?.trim() || undefined, ll.line, model);
        locals.set(m[2]!, m[3]?.trim() ? pm.typeFromAnnotation(m[3].trim(), model) : undefined);
      }
      continue;
    }
    if ((m = /^const\s+([A-Za-z_]\w*)\s*(?::\s*([^=]*?))?\s*:?=\s*/.exec(rest))) {
      const result = analyzeExpr(rest.slice(m[0].length), offset + m[0].length);
      if (fn) locals.set(m[1]!, m[2]?.trim() ? pm.typeFromAnnotation(m[2].trim(), model) : result);
      continue;
    }
    if ((m = /^for\s+([A-Za-z_]\w*)\s*(?::\s*([\w.[\], ]+?))?\s+in\s+/.exec(rest))) {
      checkTypeName(m[2]?.trim() || undefined, ll.line, model);
      if (!m[2]?.trim() && variantElements(rest.slice(m[0].length))) variants.add(m[1]!);
      else variants.delete(m[1]!);
      containers.delete(m[1]!);
      locals.set(m[1]!, m[2]?.trim() ? pm.typeFromAnnotation(m[2].trim(), model) : undefined);
      analyze(m[0].length);
      continue;
    }
    if (/^(signal|class_name|extends|enum|class)\b/.test(rest)) continue;
    if ((m = /^(set|get)\b\s*(\([^)]*\))?\s*:/.exec(rest))) {
      if (m[2]) for (const name of m[2].slice(1, -1).split(",")) locals.set(name.split(":")[0]!.trim(), undefined);
      analyze(m[0].length);
      continue;
    }
    statementLevel = true;
    analyze(0);
    statementLevel = false;

    function textOf(line: LogicalLine, from: number, length: number): string {
      return line.text.slice(from, from + length);
    }

    /** Remembers what a local's static type says about Variant: the type written, or the value of `:=`. */
    function trackVariant(name: string, annotation: string | undefined, inferredFrom: string | undefined, hasValue: boolean): void {
      variants.delete(name);
      containers.delete(name);
      if (annotation === "Variant" || (!annotation && !hasValue)) variants.add(name);
      else if (annotation === "Array" || annotation === "Dictionary" || (!annotation && inferredFrom !== undefined && /^[[{]/.test(inferredFrom.trim()))) containers.add(name);
      else if (!annotation && inferredFrom === undefined && hasValue) containers.add(name);
    }

    /** True when the elements of a `for` loop's collection have no static type: a literal array or an untyped Array or Dictionary. */
    function variantElements(iterable: string): boolean {
      const e = iterable.replace(/:\s*$/, "").trim();
      if (e.startsWith("[")) return true;
      const id = /^([A-Za-z_]\w*)(?:\s*\.\s*(?:keys|values)\s*\(\s*\))?$/.exec(e);
      if (!id) return false;
      const name = id[1]!;
      if (variants.has(name) || containers.has(name)) return true;
      if (locals.has(name)) return false;
      const member = model.outline.variables.find((v) => v.name === name);
      return Boolean(member && (member.type === "Array" || member.type === "Dictionary" || (!member.type && !member.inferred && member.hasDefault)));
    }

    /**
     * `var x := site.x + 1.0` where `site` is a Variant: Godot cannot infer a type from a Variant and stops with
     * "Cannot infer the type of "x" variable because the value doesn't have a set type". Found three times in one
     * project: loop variables over literal arrays, and Dictionary access.
     */
    function checkInferFromVariant(name: string, code: string, line: number): void {
      const expr = code.trim();
      if (/\b(?:as|if|and|or|not|in|is)\b|==|!=|<|>/.test(expr.replace(/"[^"]*"/g, '""'))) return;
      // `"name_%d" % v` formats a String: the result has a type whatever v is.
      if (/^[&^]?(["'])(?:\\.|(?!\1).)*\1\s*%/.test(expr)) return;
      for (const operand of topLevelOperands(expr)) {
        const chain = /^([A-Za-z_]\w*)((?:\s*(?:\.\s*[A-Za-z_]\w*|\[[^\]]*\]))*)$/.exec(operand.replace(/^[-+]\s*/, ""));
        if (!chain) continue;
        const [, root, access] = chain as unknown as [string, string, string];
        const member = locals.has(root) ? undefined : model.outline.variables.find((v) => v.name === root);
        const memberContainer = Boolean(member && (member.type === "Array" || member.type === "Dictionary"));
        let why: string | undefined;
        if (variants.has(root)) why = `"${root}" has no static type (it is a Variant)`;
        else if (access.trim().startsWith("[") && (containers.has(root) || memberContainer)) why = `an element of the untyped Array or Dictionary "${root}" is a Variant`;
        if (!why) continue;
        report("api/infer-variant", line, `Cannot infer the type of "${name}": ${why}, so "${operand.trim()}" has no type. Give "${name}" a type (var ${name}: float = ...) or type the collection (Array[Vector3], for p: Vector3 in ...).`);
        return;
      }
    }

    /** Walks one expression; returns its type when the whole expression is a single chain. */
    /** `var x := abs(v)`: Godot cannot infer a type from a function that returns Variant, and stops with an error. */
    function checkInferVariant(name: string, code: string, line: number): void {
      const call = /^([a-z_]\w*)\s*\(/.exec(code.trim());
      if (!call || !VARIANT_FUNCTIONS.has(call[1]!) || closeParenAt(code.trim(), call[0].length - 1) !== code.trim().length - 1) return;
      if (pm.chain(model).some((c) => c.outline.functions.some((f) => f.name === call[1]))) return;
      const typed = TYPED_VERSIONS[call[1]!];
      report(
        "api/infer-variant",
        line,
        `Cannot infer the type of "${name}": ${call[1]}() returns Variant. Give it a type${typed ? ` or use ${typed}` : ""}.`,
      );
    }

    /**
     * `x is T` and `x as T` where the static type of x can never be a T: two Godot classes where neither inherits from
     * the other, a class and a built-in type, or (for `is` only) two different built-in types. Godot stops with a parse
     * error on these; each case was checked against Godot 4.7.2. Script types are left out:
     * a node may carry a script that extends a base class of the node's own class.
     */
    function checkTypeTest(op: string, expr: string, from: GType, targetName: string): void {
      const to = pm.typeFromAnnotation(targetName, model);
      if (from.kind !== "native" || to?.kind !== "native" || from.meta || to.meta) return;
      const a = from.name;
      const b = to.name;
      if (a === b) return;
      const valueA = VALUE_TYPES.has(a);
      const valueB = VALUE_TYPES.has(b);
      const classA = !valueA && pm.api.getClass(a) !== undefined;
      const classB = !valueB && pm.api.getClass(b) !== undefined;
      if (!(valueA || classA) || !(valueB || classB)) return;
      if (classA && classB && (pm.api.inheritsFrom(a, b) || pm.api.inheritsFrom(b, a))) return;
      // `as` between two built-in types converts (float as int, String as StringName); only `is` cannot match.
      if (op === "as" && valueA && valueB) return;
      const message =
        op === "as"
          ? `Invalid cast: "${expr}" has type ${a}, which can never be converted to ${b}. Godot stops with a parse error.`
          : `"${expr}" has type ${a}, so "${expr} is ${b}" can never be true${classA && classB ? " (neither class inherits from the other)" : ""}. Godot stops with a parse error.`;
      report("api/impossible-type-test", ll.line, message);
    }

    function analyzeExpr(code: string, base: number): GType | undefined {
      const tokens = tokenize(code);
      let whole: GType | undefined;
      // The last name chain, so `x is T` / `x as T` can compare the type of x with T.
      let lastChain: { start: number; end: number; type?: GType } | undefined;
      for (let k = 0; k < tokens.length; k++) {
        const tok = tokens[k]!;
        const prev = tokens[k - 1]?.t;
        if (prev === "." || prev === "@") continue;
        if (tok.t === "func" && tokens[k + 1]?.t === "(") {
          // Lambda: its parameters are locals of unknown type.
          const close = closeIndex(tokens, k + 1);
          for (let p = k + 2; p < close; p++) if (isIdent(tokens[p]!.t) && tokens[p - 1]!.t !== ":") locals.set(tokens[p]!.t, undefined);
          k = close;
          continue;
        }
        if ((tok.t === "is" || tok.t === "as") && isIdent(tokens[k + 1]?.t)) {
          let name = tokens[k + 1]!.t;
          let j = k + 1;
          while (tokens[j + 1]?.t === "." && isIdent(tokens[j + 2]?.t)) {
            name += `.${tokens[j + 2]!.t}`;
            j += 2;
          }
          if (tok.t === "is" && name === "not") continue;
          checkTypeName(name, ll.line, model);
          if (lastChain && lastChain.end === k - 1 && lastChain.type) checkTypeTest(tok.t, tokens.slice(lastChain.start, k).map((t) => t.t).join(""), lastChain.type, name);
          k = j;
          continue;
        }
        // funcref() is already reported as Godot 3 syntax above. Treat its name as a
        // legacy construct rather than also reporting it as an unknown function.
        if (tok.t === "funcref" && tokens[k + 1]?.t === "(") continue;
        const startsChain =
          (isIdent(tok.t) && (!KEYWORDS.has(tok.t) || tok.t === "self" || tok.t === "super")) ||
          tok.t.startsWith("$") ||
          (tok.t.startsWith("%") && tok.t.length > 1);
        if (!startsChain) continue;
        // `{key = value}` dictionary keys are not names.
        if (tokens[k + 1]?.t === "=" && (prev === "{" || prev === ",")) continue;
        const type = walkChain(tokens, k, base);
        lastChain = { start: k, end: type.end, type: type.value?.type };
        if (k === 0) whole = type.end === tokens.length - 1 ? type.value?.type : undefined;
      }
      return whole;
    }

    function walkChain(tokens: Token[], k: number, base: number): { value?: Value; end: number } {
      const t0 = tokens[k]!.t;
      let j = k;
      let value: Value | undefined;
      if (t0 === "self") {
        // `self.x` is checked like any typed value: the node may be a subclass of the script's base.
        value = { type: selfType, exact: false };
      } else if (t0 === "super") {
        if (tokens[k + 1]?.t === "(") {
          // `super(...)` calls this same function on the parent: its value is what that returns.
          const parentType: GType | undefined = model.parent ? { kind: "script", model: model.parent, meta: false } : undefined;
          const found = fn && parentType ? pm.memberOf(parentType, fn.name) : undefined;
          value = found?.kind === "method" && (found.type?.kind === "native" || found.type?.kind === "script") ? { type: found.type, exact: false } : undefined;
          j = closeIndex(tokens, k + 1);
        } else {
          // An unknown base (a missing script) leaves `super` unknown too.
          value = model.parent
            ? { type: { kind: "script", model: model.parent, meta: false }, exact: true }
            : model.dynamic && model.extendsRaw
              ? undefined
              : { type: native(pm.nativeOf(model)), exact: true };
        }
      } else if (t0.startsWith("$") || t0.startsWith("%")) {
        value = nodeRef(t0.startsWith("%") ? "%" : "$", nodeText(tokens[k]!, base));
      } else if (tokens[k + 1]?.t === "(") {
        const close = closeIndex(tokens, k + 1);
        value = selfCall(t0, tokens, k, base);
        j = close;
      } else {
        value = resolveName(t0, tokens[k + 1]?.t === ".");
        if (!locals.has(t0) && !KEYWORDS.has(t0)) afterProperty({ type: selfType, exact: false }, t0, tokens, k, k);
      }

      while (tokens[j + 1]?.t === "." && isIdent(tokens[j + 2]?.t)) {
        const name = tokens[j + 2]!.t;
        const isCall = tokens[j + 3]?.t === "(";
        currentTokens = tokens;
        currentOpen = j + 3;
        const receiver = value;
        value = member(value, name, isCall);
        if (isCall) imageUnitArgs(receiver, name, tokens, j + 3);
        else afterProperty(receiver, name, tokens, k, j + 2);
        j = isCall ? closeIndex(tokens, j + 3) : j + 2;
        while (tokens[j + 1]?.t === "[") {
          j = closeIndex(tokens, j + 1);
          value = undefined;
        }
      }
      return { value, end: j };
    }

    /**
     * Godot 4.7 changes for a property read at tokens[at] (verified in 4.6.2 against 4.7.2):
     * - `obj.packed[i] = v` no longer calls the setter: on an engine property the write is lost, and a script
     *   variable's set() block does not run (GH-113228).
     * - keyboard and mouse events have device 16 and 32, so `event.device == 0` is never true for them (GH-116274).
     */
    function afterProperty(receiver: Value | undefined, name: string, tokens: Token[], start: number, at: number): void {
      const type = receiver?.type;
      if (!type || type.kind === "enum" || type.meta) return;
      const found = pm.memberOf(type, name);
      if (found?.kind !== "property") return;
      const engine = api.getClass(found.owner) !== undefined;
      if (statementLevel && start === 0 && tokens[at + 1]?.t === "[") {
        let e = closeIndex(tokens, at + 1);
        // `points[0].x = 1` writes into the element too.
        while (tokens[e + 1]?.t === "[" || (tokens[e + 1]?.t === "." && isIdent(tokens[e + 2]?.t) && tokens[e + 3]?.t !== "(")) {
          e = tokens[e + 1]!.t === "[" ? closeIndex(tokens, e + 1) : e + 2;
        }
        const packed = found.type?.kind === "native" && /^Packed\w+Array$/.test(found.type.name);
        if (packed && assignsAt(tokens, e + 1)) {
          const target = tokens.slice(start, at + 1).map((t) => t.t).join("");
          const owner = engine ? found.owner : undefined;
          if (owner) {
            report(
              "api/packed-element-write",
              ll.line,
              `In Godot 4.7 writing one element of ${owner}.${name} changes a copy: the ${owner} keeps the old array and nothing warns. Copy it, change the copy, assign it back: var p := ${target}; p[...] = ...; ${target} = p.`,
            );
          } else if (type.kind === "script" && hasSetter(pm, type.model, found.owner, name)) {
            report(
              "quality/packed-setter-skipped",
              ll.line,
              `In Godot 4.7 writing one element of "${name}" no longer runs its set() block (it did in 4.6): the array changes, but the setter's work (signals, redraws, saving) does not happen. Assign the whole array: var p := ${target}; p[...] = ...; ${target} = p.`,
            );
          }
        }
      }
      if (name === "device" && engine && (found.owner === "InputEvent" || api.inheritsFrom(found.owner, "InputEvent"))) deviceZero(type, tokens, start, at);
    }

    function deviceZero(type: GType, tokens: Token[], start: number, at: number): void {
      const after = (tokens[at + 1]?.t === "==" || tokens[at + 1]?.t === "!=") && tokens[at + 2]?.t === "0" && !/^[.[(]$/.test(tokens[at + 3]?.t ?? "");
      const before = (tokens[start - 1]?.t === "==" || tokens[start - 1]?.t === "!=") && tokens[start - 2]?.t === "0" && !/^[-+*/%.]$/.test(tokens[start - 3]?.t ?? "");
      if (!after && !before) return;
      if (/\bInputEventJoypad/.test(ll.code)) return;
      if (type.kind === "enum") return;
      const cls = type.kind === "native" ? type.name : pm.nativeOf(type.model);
      const keyOrMouse = (c: string) => c === "InputEventKey" || c === "InputEventMouse" || api.inheritsFrom(c, "InputEventMouse");
      const tested = /\bis\s+(InputEventKey|InputEventMouse\w*)\b/.exec(ll.code)?.[1];
      if (keyOrMouse(cls) || tested) {
        const which = keyOrMouse(cls) ? cls : tested!;
        const id = which === "InputEventKey" ? "DEVICE_ID_KEYBOARD (16)" : "DEVICE_ID_MOUSE (32)";
        report(
          "api/input-device-zero",
          ll.line,
          `In Godot 4.7 an ${which} has device InputEvent.${id}, not 0, so this comparison with 0 never matches a real ${which === "InputEventKey" ? "keyboard" : "mouse"} event. Compare with InputEvent.${id.split(" ")[0]} or test the event type.`,
        );
      } else if (options.migrating && (cls === "InputEvent" || cls === "InputEventWithModifiers" || cls === "InputEventFromWindow")) {
        report(
          "api/input-device-zero",
          ll.line,
          "Before Godot 4.7, device 0 meant keyboard, mouse or the first joypad; in 4.7 keyboard and mouse events have device InputEvent.DEVICE_ID_KEYBOARD (16) and DEVICE_ID_MOUSE (32). If this test means keyboard or mouse, test the event type or compare with those constants.",
          "info",
        );
      }
    }

    /** RichTextLabel.add_image()/update_image(): Godot 4.7 made width_unit and height_unit an ImageUnit enum, and a bool there is a parse error. */
    function imageUnitArgs(receiver: Value | undefined, name: string, tokens: Token[], open: number): void {
      const type = receiver?.type;
      if (type?.kind !== "native" || type.meta || (name !== "add_image" && name !== "update_image")) return;
      if (type.name !== "RichTextLabel" && !api.inheritsFrom(type.name, "RichTextLabel")) return;
      const args = splitArgs(tokens, open);
      const first = name === "add_image" ? 9 : 10;
      for (const i of [first, first + 1]) {
        const arg = args[i];
        if (arg?.length !== 1 || (arg[0]!.t !== "true" && arg[0]!.t !== "false")) continue;
        const param = i === first ? "width_unit" : "height_unit";
        report(
          "api/image-unit-bool",
          ll.line,
          `${name}() argument ${i + 1} is ${param}, a RichTextLabel.ImageUnit in Godot 4.7 (it was the bool ${param.replace("_unit", "_in_percent")}): ${arg[0]!.t} stops the script with "Cannot pass a value of type bool". Pass RichTextLabel.${arg[0]!.t === "true" ? "IMAGE_UNIT_PERCENT" : "IMAGE_UNIT_PIXEL"}.`,
        );
      }
    }

    function checkArgs(name: string, args: { min: number; max: number } | undefined, tokens: Token[], open: number): void {
      if (!args || tokens[open]?.t !== "(") return;
      const n = argCount(tokens, open);
      if (n >= args.min && n <= args.max) return;
      const expected = args.min === args.max ? `${args.min}` : args.max === Number.POSITIVE_INFINITY ? `at least ${args.min}` : `${args.min} to ${args.max}`;
      const godot3 = name === "move_and_slide" && n > 0 ? " In Godot 4 set `velocity` and call move_and_slide() without arguments." : "";
      report("api/wrong-arguments", ll.line, `${name}() takes ${expected} argument${expected === "1" ? "" : "s"}, but ${n} ${n === 1 ? "is" : "are"} given.${godot3}`);
    }

    function nodeText(tok: Token, base: number): string {
      const raw = tok.t.slice(1);
      if (raw.startsWith('"')) return ll.text.slice(base + tok.i + 2, base + tok.i + tok.t.length - 1);
      return raw;
    }

    function nodeRef(kind: "$" | "%", nodePath: string, optional = false): Value | undefined {
      if (model.owner) return undefined;
      const uses = pm.attachments.get(path) ?? [];
      if (uses.length === 0 || nodePath === "") return undefined;
      const types: (GType | undefined)[] = [];
      for (const use of uses) {
        if (kind === "%" || nodePath.startsWith("%")) {
          const name = nodePath.replace(/^%/, "").split("/")[0]!;
          const node = pm.uniqueNode(use.scene, name);
          if (!node) {
            if (!optional) report("structure/missing-node", ll.line, `%${name} is not a unique-name node in ${use.scene}.`);
            return undefined;
          }
          types.push(nodePath.includes("/") ? undefined : (pm.nodeType(node) ?? undefined));
          continue;
        }
        const found = pm.resolveNode(use.scene, use.node, nodePath);
        if (found === null) {
          if (!optional) {
            const from = use.node === "." ? "the root node" : `node "${use.node}"`;
            report("structure/missing-node", ll.line, `Node "${nodePath}" does not exist under ${from} in ${use.scene}.`);
          }
          return undefined;
        }
        types.push(found ? (pm.nodeType(found.node) ?? undefined) : undefined);
      }
      const first = types[0];
      const same = types.every((t) => t && first && typeLabel(t) === typeLabel(first));
      return same && first ? { type: first, exact: false } : undefined;
    }

    function selfCall(name: string, tokens: Token[], k: number, base: number): Value | undefined {
      if (locals.has(name)) return undefined;
      const close = closeIndex(tokens, k + 1);
      if ((name === "get_node" || name === "get_node_or_null" || name === "find_child") && tokens[k + 2]?.t.startsWith('"') && close === k + 3) {
        const arg = tokens[k + 2]!;
        const text = ll.text.slice(base + arg.i + 1, base + arg.i + arg.t.length - 1);
        if (name !== "find_child") {
          const ref = nodeRef("$", text, name === "get_node_or_null");
          if (ref) return ref;
        }
      }
      const found = pm.memberOf(selfType, name) ?? outerMember(name);
      if (found) {
        if (found.kind !== "method") return undefined;
        checkArgs(name, found.args, tokens, k + 1);
        if (name === "add_image" || name === "update_image") imageUnitArgs({ type: native(pm.nativeOf(model)), exact: false }, name, tokens, k + 1);
        return { type: found.type, exact: false };
      }
      const global = api.globalFunction(name);
      if (global) {
        const vararg = global.qualifiers?.split(" ").includes("vararg") ?? false;
        const params = global.params ?? [];
        checkArgs(name, { min: params.filter((p) => p.default === undefined).length, max: vararg ? Number.POSITIVE_INFINITY : params.length }, tokens, k + 1);
        const ret = global.returnEnum ? "int" : global.returns;
        return { type: ret && ret !== "void" && ret !== "Variant" ? native(ret) : undefined, exact: false };
      }
      const ctor = pm.resolveTypeName(name, model);
      if (ctor && ctor.kind !== "enum") return { type: { ...ctor, meta: false }, exact: false };
      if (model.dynamic || (options.foreignClasses && /^[A-Z]/.test(name))) return undefined;
      const removed = REMOVED_FUNCTIONS[name];
      const removedHint =
        removed && (!removed.canvas || api.ancestors(pm.nativeOf(model)).some((c) => c.name === "CanvasItem"))
          ? ` In Godot 4 use \`${removed.to}\`.`
          : "";
      const hint = renameHint(name, "function") || (/^[A-Z]/.test(name) ? renameHint(name, "type") : "") || removedHint;
      // An unresolved parent class is already reported; only Godot 3 names are certain then.
      const unresolved = pm.chain(model).some((c) => c.extendsRaw && !c.parent && !c.renamedBase && !pm.resolveClassRef(c.extendsRaw, c));
      if (unresolved && !hint) return undefined;
      const names = [
        ...pm.chain(model).flatMap((c) => c.outline.functions.map((f) => f.name)),
        ...api.ancestors(pm.nativeOf(model)).flatMap((c) => (c.methods ?? []).map((x) => x.name)),
        ...(api.getClass("@GlobalScope")?.methods ?? []).map((x) => x.name),
        ...(api.getClass("@GDScript")?.methods ?? []).map((x) => x.name),
      ];
      const where = model.name ? `"${model.name}"` : `this script (${pm.nativeOf(model)})`;
      report("api/unknown-function", ll.line, `Function "${name}()" does not exist in ${where}, its parents or the global scope.${hint}${hint ? "" : suggest(name, names)}`);
      return undefined;
    }

    function outerMember(name: string) {
      for (let o = model.owner; o; o = o.owner) {
        const found = pm.memberOf({ kind: "script", model: o, meta: true }, name);
        if (found) return found;
      }
      return undefined;
    }

    function resolveName(name: string, followedByDot: boolean): Value | undefined {
      if (locals.has(name)) return { type: locals.get(name), exact: false };
      const own = pm.memberOf(selfType, name) ?? outerMember(name);
      if (own) {
        if (own.kind === "method") return { type: native("Callable"), exact: false };
        return { type: own.type, exact: own.kind === "class" || own.type?.kind === "script" && own.type.meta };
      }
      const autoload = pm.autoloads.get(name);
      if (autoload) return { type: autoload, exact: true };
      if (pm.singletons.has(name)) return { type: native(name), exact: true };
      const cls = pm.resolveTypeName(name, model, true);
      if (cls) return { type: cls, exact: true };
      if (api.lookup(name).entries.some((e) => e.owner === "@GlobalScope" || e.owner === "@GDScript")) return undefined;
      // `Variant` is the namespace of the dotted global enums (`Variant.Type`, `Variant.Operator`), not a missing class.
      const enumNamespace = [...pm.globalEnums].some((e) => e.startsWith(`${name}.`));
      if (followedByDot && /^[A-Z]/.test(name) && !options.foreignClasses && !enumNamespace) {
        const hint = renameHint(name, "type");
        // A constant or inner class of a base that does not resolve, or a const alias of a broken preload.
        if (!hint && (unresolvedBase(model) || isConstAlias(name, model))) return undefined;
        report(
          "api/unknown-type",
          ll.line,
          `"${name}" is not a class, singleton, autoload or variable in Godot 4.7 or this project.${hint}${hint ? "" : suggest(name, [...api.classes.keys(), ...pm.classNames.keys()])}`,
        );
      }
      return undefined;
    }

    function member(value: Value | undefined, name: string, isCall: boolean): Value | undefined {
      const type = value?.type;
      if (!type || type.kind === "enum") return undefined;
      // `dict.key` reads a key, even when a method has the same name (`dict.size`).
      if (type.kind === "native" && type.name === "Dictionary" && !type.meta && !isCall) return undefined;
      const found = pm.memberOf(type, name);
      if (found) {
        if (isCall && found.kind === "method") checkArgs(name, found.args, currentTokens, currentOpen);
        if (isCall) return found.kind === "method" ? { type: found.type?.kind === "native" || found.type?.kind === "script" ? found.type : undefined, exact: false } : undefined;
        if (found.kind === "method") return { type: native("Callable"), exact: false };
        if (found.kind === "class") return { type: found.type, exact: true };
        return { type: found.type, exact: false };
      }
      if (type.kind === "script" && runtimeSignals(type.model).has(name)) return { type: native("Signal"), exact: false };
      if (name === "new" && type.meta) return { type: { ...type, meta: false }, exact: false };
      if (type.kind === "script" && pm.chain(type.model).some((c) => c.dynamic)) return undefined;
      const label = typeLabel(type);
      const valueType = type.kind === "native" && VALUE_TYPES.has(type.name);
      const certain = valueType || type.meta || value!.exact;
      if (!certain) {
        // The object may be a subclass: only report names that no subclass defines,
        // and names the code does not duck-type with has_method()/has_signal().
        if (duckTyped.has(name)) return undefined;
        const below =
          type.kind === "native"
            ? pm.membersBelow(type.name)
            : new Set([...pm.membersBelowScript(type.model), ...pm.membersBelow(pm.nativeOf(type.model))]);
        if (below.has(name)) return undefined;
      }
      const moved = MOVED[`${label}.${name}`];
      const renamed = type.kind === "native" ? renamedMember(api, type.name, name) : undefined;
      const hint = moved ? ` In Godot 4 use ${moved}.` : renamed ? ` Godot ${renamed.to} renamed it to ${renamed.replacement}.` : renameHint(name, "member");
      const names =
        type.kind === "native"
          ? api.ancestors(type.name).flatMap((c) => [...(c.methods ?? []), ...(c.members ?? []), ...(c.signals ?? []), ...(c.constants ?? [])].map((x) => x.name))
          : pm.chain(type.model).flatMap((c) => [...c.outline.functions, ...c.outline.variables, ...c.outline.signals, ...c.outline.constants].map((x) => x.name));
      const what = isCall ? `Method "${name}()"` : `"${name}"`;
      const old = type.kind === "native" ? removedMember(api, type.name, name) : undefined;
      if (old?.compat) {
        report(
          "api/unsafe-member",
          ll.line,
          `${what} on ${label} is an old name: Godot ${old.last} documented it, and Godot 4.7 still accepts it only so old projects load. Move to the current name.${hint}${hint ? "" : suggest(name, names)}`,
          "info",
        );
        return undefined;
      }
      const gone = removedNote(old);
      // A known Godot 3 name that no class below defines is certainly wrong.
      if (certain || hint) {
        report("api/unknown-member", ll.line, `${what} does not exist on ${label} in Godot 4.7.${gone}${hint}${hint ? "" : suggest(name, names)}`);
      } else {
        report(
          "api/unsafe-member",
          ll.line,
          `${what} is not a member of ${label} or of any class below it in Godot 4.7 or this project.${gone}${hint}${hint ? "" : suggest(name, names)}`,
        );
      }
      return undefined;
    }
  }
  return out;
}

/** The tokens of each argument of a call whose `(` is at `open`. */
function splitArgs(tokens: Token[], open: number): Token[][] {
  const close = closeIndex(tokens, open);
  const out: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;
  for (let j = open + 1; j < close; j++) {
    const t = tokens[j]!.t;
    if (t === "(" || t === "[" || t === "{") depth++;
    else if (t === ")" || t === "]" || t === "}") depth--;
    if (t === "," && depth === 0) {
      out.push(current);
      current = [];
    } else current.push(tokens[j]!);
  }
  if (current.length) out.push(current);
  return out;
}

/** True when tokens[i] starts an assignment operator: `=`, `+=`, `<<=`, ... (`==` is one token). */
function assignsAt(tokens: Token[], i: number): boolean {
  const t = tokens[i]?.t;
  if (t === "=") return true;
  return t !== undefined && /^(?:[-+*/%&|^]|\*\*|<<|>>)$/.test(t) && tokens[i + 1]?.t === "=";
}

/** True when the script variable `name` of class `ownerId` (in the chain of `model`) has a setter: a set() block or `set = fn`. */
function hasSetter(pm: ProjectModel, model: ClassModel, ownerId: string, name: string): boolean {
  const owner = pm.chain(model).find((m) => m.id === ownerId);
  const variable = owner?.outline.variables.find((v) => v.name === name);
  if (!owner || !variable) return false;
  const lines = owner.script.logicalLines;
  const i = lines.findIndex((l) => l.line === variable.line);
  if (i < 0) return false;
  if (/\bset\s*=\s*[A-Za-z_]/.test(lines[i]!.code)) return true;
  for (let k = i + 1; k < lines.length && lines[k]!.indent > lines[i]!.indent; k++) if (/^\s*set\s*[(:]/.test(lines[k]!.code)) return true;
  return false;
}

/** Number of arguments in a call whose `(` is at `open`. */
function argCount(tokens: Token[], open: number): number {
  const close = closeIndex(tokens, open);
  if (close === open + 1) return 0;
  let count = 1;
  let depth = 0;
  for (let j = open + 1; j < close; j++) {
    const t = tokens[j]!.t;
    if (t === "(" || t === "[" || t === "{") depth++;
    else if (t === ")" || t === "]" || t === "}") depth--;
    else if (t === "," && depth === 0) count++;
  }
  // A trailing comma does not start another argument.
  if (tokens[close - 1]?.t === ",") count--;
  return count;
}

function inputActions(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(INPUT_ONE)) out.push(m[1]!);
  for (const m of text.matchAll(INPUT_AXIS)) out.push(m[1]!, m[2]!);
  for (const m of text.matchAll(INPUT_VECTOR)) out.push(m[1]!, m[2]!, m[3]!, m[4]!);
  return out;
}

function suggestSignals(pm: ProjectModel, type: GType, name: string): string {
  if (type.kind !== "script") return "";
  const names = [
    ...pm.chain(type.model).flatMap((c) => c.outline.signals.map((s) => s.name)),
    ...pm.api.ancestors(pm.nativeOf(type.model)).flatMap((c) => (c.signals ?? []).map((s) => s.name)),
  ];
  return suggest(name, names);
}

function suggest(name: string, candidates: string[]): string {
  const near = closest(name, [...new Set(candidates)], 3);
  return near.length ? ` Did you mean: ${near.join(", ")}?` : "";
}

/** Global functions that return Variant, so `var x := f(...)` does not compile. */
const VARIANT_FUNCTIONS = new Set(["abs", "bytes_to_var", "bytes_to_var_with_objects", "ceil", "clamp", "convert", "floor", "lerp", "max", "min", "round", "sign", "snapped", "str_to_var", "type_convert", "weakref", "wrap"]);

const TYPED_VERSIONS: Record<string, string> = {
  abs: "absf() or absi()",
  ceil: "ceilf() or ceili()",
  clamp: "clampf() or clampi()",
  floor: "floorf() or floori()",
  lerp: "lerpf()",
  max: "maxf() or maxi()",
  min: "minf() or mini()",
  round: "roundf() or roundi()",
  sign: "signf() or signi()",
  snapped: "snappedf() or snappedi()",
  wrap: "wrapf() or wrapi()",
};

/** Index of the `)` closing the `(` at `open`, skipping strings; -1 when unclosed. */
/** The operands of `a + b * c` at the top level (not inside brackets or strings). A leading sign stays with its operand. */
function topLevelOperands(expr: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  let lastSignificant = "";
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      lastSignificant = c;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (depth === 0 && "+-*/%".includes(c) && /[\w)\]"']/.test(lastSignificant)) {
      out.push(expr.slice(start, i));
      start = i + 1;
      lastSignificant = c;
      continue;
    }
    if (!/\s/.test(c)) lastSignificant = c;
  }
  out.push(expr.slice(start));
  return out.map((o) => o.trim()).filter(Boolean);
}

function closeParenAt(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'") {
      const end = text.indexOf(ch, i + 1);
      if (end < 0) return -1;
      i = end;
    } else if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
