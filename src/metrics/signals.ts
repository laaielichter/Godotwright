import { GodotApi } from "../api/api.js";
import { formatParams, matchingParen, splitTopLevel, type LogicalLine } from "../godot/gdscript.js";
import { withoutSubResource } from "../project/files.js";
import { ProjectModel, type ClassModel, type GType } from "../review/model.js";
import { loadProject } from "../scan/scan.js";
import type { MetricsOptions } from "./complexity.js";

/**
 * The signal flow of a project, read from its scripts and scenes: every signal, who emits it, who connects to it and
 * with which method, and three lists that are almost always bugs: a signal that is declared but never emitted, one
 * that is emitted but that nobody listens to, and a connection to a method the target script does not have (Godot
 * only reports that one when the scene loads, as an error in the log). No Godot needed.
 */

export interface SignalSite {
  file: string;
  line: number;
}

export interface SignalConnection extends SignalSite {
  /** A `[connection]` in a scene, a `.connect(...)` in code, or an `await` on the signal. */
  via: "scene" | "code" | "await";
  /** The emitting node (scene) or expression (code); absent for the script's own signal. */
  from?: string;
  /** The receiving node (scene) or expression (code); absent for the script itself. */
  to?: string;
  /** The method that is called; "(lambda)" for an inline function. */
  method?: string;
  /** The script that must hold the method, when it is known. */
  targetScript?: string;
  /** The target script (and its base classes) has no such method. */
  missing?: true;
}

export interface SignalFlow {
  name: string;
  /** Declared in a script of the project, or a signal of a Godot class that the project connects or emits. */
  kind: "script" | "builtin";
  /** The script (`res://a.gd`, `res://a.gd::Inner`) or the Godot class that declares it ("" when the class is not known). */
  owner: string;
  /** Parameters as written, e.g. `amount: int`. */
  params: string[];
  /** Where a script declares it. */
  file?: string;
  line?: number;
  emits: SignalSite[];
  connections: SignalConnection[];
}

export interface SignalProblem extends SignalSite {
  signal: string;
}

export interface MissingMethod extends SignalSite {
  signal: string;
  method: string;
  /** The script that should have the method. */
  target: string;
  via: "scene" | "code";
}

export interface SignalReport {
  ok: boolean;
  project: string;
  signals: SignalFlow[];
  /** Declared, but no `.emit()` or `emit_signal()` anywhere. */
  neverEmitted: SignalProblem[];
  /** Emitted, but no scene connection, `.connect()` or `await` anywhere. */
  neverConnected: SignalProblem[];
  /** Connections whose method does not exist in the target script. */
  missingMethods: MissingMethod[];
}

/** An expression chain such as `$Box/Button`, `get_node("x").timer` or `a.b[0]`, at the end of the text. */
const CHAIN_PART = String.raw`(?:\$"[^"]*"|\$'[^']*'|%"[^"]*"|[$%][\w/]+|\w+)(?:\([^()]*\)|\[[^\[\]]*\])*`;
const CHAIN_END = new RegExp(String.raw`(${CHAIN_PART}(?:\s*\.\s*\w+(?:\([^()]*\)|\[[^\[\]]*\])*)*)\s*\.\s*$`, "u");
const CHAIN_START = new RegExp(String.raw`^\s*(${CHAIN_PART}(?:\s*\.\s*\w+(?:\([^()]*\)|\[[^\[\]]*\])*)*)`, "u");

/** Splits `a.b.sig` into the receiver `a.b` and the name `sig`; undefined when the last part is not a plain name. */
function lastName(chain: string): { receiver: string; name: string } | undefined {
  const m = /^(?:(.*?)\s*\.\s*)?(\w+)$/su.exec(chain.trim());
  return m && !/^\d/.test(m[2]!) ? { receiver: (m[1] ?? "").trim(), name: m[2]! } : undefined;
}

/** `x.method.bind(a).unbind(1)` without its trailing bind calls: one pass over the text, brackets counted. */
function withoutBinds(arg: string): string {
  const BIND = /^\s*\.\s*(?:bind|bindv|unbind)\s*\(/u;
  let depth = 0;
  for (let i = 0; i < arg.length; i++) {
    const ch = arg[i]!;
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (depth === 0 && (ch === "." || /\s/u.test(ch)) && BIND.test(arg.slice(i)) && onlyBinds(arg.slice(i), BIND)) return arg.slice(0, i);
  }
  return arg;
}

/** Whether the text is bind calls and nothing else, to its end. */
function onlyBinds(rest: string, bind: RegExp): boolean {
  let text = rest;
  while (text.trim() !== "") {
    const m = bind.exec(text);
    if (!m) return false;
    let depth = 1;
    let i = m[0].length;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
    }
    if (depth !== 0) return false;
    text = text.slice(i);
  }
  return true;
}

export function signalFlow(path: string, options: MetricsOptions = {}): SignalReport {
  const data = loadProject(path, options);
  const api = GodotApi.load();
  const pm = new ProjectModel(data, api);
  const own = (file: string): boolean => !data.external.has(withoutSubResource(file)) && (options.includeAddons || !file.startsWith("res://addons/"));

  const flows = new Map<string, SignalFlow>();
  const byName = new Map<string, SignalFlow[]>();
  for (const model of pm.allModels()) {
    for (const s of model.outline.signals) {
      const flow: SignalFlow = { name: s.name, kind: "script", owner: model.id, params: s.params.map((p) => formatParams([p])), file: model.path, line: s.line, emits: [], connections: [] };
      flows.set(`${model.id}\u0000${s.name}`, flow);
      byName.set(s.name, [...(byName.get(s.name) ?? []), flow]);
    }
  }
  let builtinNames: Set<string> | undefined;
  const isBuiltinName = (name: string): boolean => {
    builtinNames ??= new Set([...api.classes.values()].flatMap((c) => (c.signals ?? []).map((s) => s.name)));
    return builtinNames.has(name);
  };
  const builtin = (cls: string, name: string): SignalFlow => {
    const key = `builtin\u0000${cls}\u0000${name}`;
    let flow = flows.get(key);
    if (!flow) {
      const item = cls ? (api.member(cls, name).find((e) => e.kind === "signal")?.item as { params?: { name: string; type?: string }[] } | undefined) : undefined;
      flow = { name, kind: "builtin", owner: cls, params: (item?.params ?? []).map((p) => (p.type ? `${p.name}: ${p.type}` : p.name)), emits: [], connections: [] };
      flows.set(key, flow);
    }
    return flow;
  };
  /** The signal `name` of a type: one a script in its chain declares, or one of its Godot class. */
  const onType = (type: GType | null | undefined, name: string): SignalFlow | undefined => {
    if (!type || type.kind === "enum") return undefined;
    const member = pm.memberOf(type, name);
    if (member?.kind !== "signal") return undefined;
    return flows.get(`${member.owner}\u0000${name}`) ?? builtin(member.owner, name);
  };
  const scriptType = (model: ClassModel): GType => ({ kind: "script", model, meta: false });

  /**
   * The signals a name in code can mean. Without a receiver (or on self) it is the signal of the class around the
   * line. On an autoload it is that autoload's. On anything else the receiver's type is not known here: every script
   * signal with that name counts, so the bug lists stay quiet when in doubt; a name no script declares is a Godot one.
   */
  const resolve = (file: string, line: number, receiver: string, name: string): SignalFlow[] => {
    const model = pm.scopeAt(file, line)?.model;
    if (receiver === "" || receiver === "self") {
      const found = model ? onType(scriptType(model), name) : undefined;
      return found ? [found] : [];
    }
    const autoload = onType(pm.autoloads.get(receiver), name);
    if (autoload) return [autoload];
    const declared = byName.get(name);
    if (declared) return declared;
    if (!isBuiltinName(name)) return [];
    // The receiver's class is not known here: when the scenes connect one Godot signal of that name, it is that one.
    const known = [...flows.values()].filter((f) => f.kind === "builtin" && f.name === name && f.owner !== "");
    return [known.length === 1 ? known[0]! : builtin("", name)];
  };

  const missingMethods: MissingMethod[] = [];
  /** Whether the type has the method; undefined when it cannot be known (dynamic members, an unknown base). */
  const hasMethod = (type: GType | null | undefined, method: string): boolean | undefined => {
    if (!type || type.kind === "enum") return undefined;
    if (type.kind === "script" && pm.chain(type.model).some((m) => m.dynamic)) return undefined;
    return pm.memberOf(type, method) !== undefined;
  };

  // Scenes: [connection signal="..." from="..." to="..." method="..."].
  for (const scene of data.map.scenes) {
    for (const c of scene.connections) {
      const from = pm.resolveNode(scene.path, ".", c.from);
      const fromType = from ? pm.nodeType(from.node) : undefined;
      const flow = onType(fromType, c.signal) ?? (byName.get(c.signal)?.length === 1 && !fromType ? byName.get(c.signal)![0]! : builtin(from?.node.type && isBuiltinName(c.signal) ? (api.member(from.node.type, c.signal).find((e) => e.kind === "signal")?.owner ?? "") : "", c.signal));
      const to = pm.resolveNode(scene.path, ".", c.to);
      const toType = to ? pm.nodeType(to.node) : undefined;
      const targetScript = toType && toType.kind === "script" ? toType.model.path : undefined;
      const missing = hasMethod(toType, c.method) === false;
      flow.connections.push({ file: scene.path, line: c.line, via: "scene", from: c.from, to: c.to, method: c.method, ...(targetScript ? { targetScript } : {}), ...(missing ? { missing: true as const } : {}) });
      if (missing && own(scene.path)) missingMethods.push({ file: scene.path, line: c.line, signal: c.signal, method: c.method, target: targetScript ?? (toType?.kind === "native" ? toType.name : c.to), via: "scene" });
    }
  }

  // Code: sig.emit(), emit_signal("sig"), sig.connect(method), x.connect("sig", method), await sig.
  const CALL = /(?<![\w$%])(connect|emit_signal|emit)\b\s*(\()?/gu;
  for (const [file, script] of data.scripts) {
    const source = data.sources.get(file) ?? "";
    /** A plain name in a script is a method, or a variable that holds a Callable: only a name nothing declares is missing. */
    const declaredLocally = (name: string): boolean => new RegExp(`\\b(?:var|const|for)\\s+${name}\\b|\\bfunc\\b[^(]*\\([^)]*\\b${name}\\b`, "u").test(source);
    for (const ll of script.logicalLines) {
      if (!/\b(?:connect|emit|emit_signal|await)\b/.test(ll.code)) continue;
      for (const m of ll.code.matchAll(CALL)) {
        const before = ll.code.slice(0, m.index);
        if (/\bfunc\s*$/.test(before)) continue;
        const chain = /\.\s*$/.test(before) ? CHAIN_END.exec(before)?.[1] : "";
        if (chain === undefined) continue;
        const open = m[2] ? m.index + m[0].length - 1 : -1;
        const close = open >= 0 ? matchingParen(ll.code, open) : -1;
        const args = open >= 0 ? splitTopLevel(ll.code.slice(open + 1, close)) : [];
        // Strings are blanked in `code`; `text` has the same length, so the name is read there.
        const argText = (i: number): string => {
          let at = open + 1;
          for (let k = 0; k < i; k++) at = ll.code.indexOf(args[k]!, at) + args[k]!.length;
          const start = ll.code.indexOf(args[i]!, at);
          return ll.text.slice(start, start + args[i]!.length);
        };
        const stringName = (i: number): string | undefined => (args[i] !== undefined ? /^[&^]?["'](\w+)["']$/u.exec(argText(i))?.[1] : undefined);
        const site = { file, line: ll.line };

        if (m[1] === "emit_signal") {
          const name = stringName(0);
          if (name) for (const flow of resolve(file, ll.line, chain, name)) flow.emits.push(site);
          continue;
        }
        if (m[1] === "emit") {
          const target = lastName(chain);
          if (target) for (const flow of resolve(file, ll.line, target.receiver, target.name)) flow.emits.push(site);
          continue;
        }
        if (open < 0) continue;
        const named = stringName(0);
        const target = named ? { receiver: chain, name: named } : lastName(chain);
        if (!target || (!named && chain === "")) continue;
        const found = resolve(file, ll.line, target.receiver, target.name);
        if (found.length === 0) continue;
        const callable = connectTarget(ll, args, named ? 1 : 0, argText);
        const connection: SignalConnection = { ...site, via: "code", ...(target.receiver && target.receiver !== "self" ? { from: target.receiver } : {}) };
        if (callable) {
          connection.method = callable.method;
          const model = pm.scopeAt(file, ll.line)?.model;
          const type = callable.on === "self" ? (model ? scriptType(model) : undefined) : pm.autoloads.get(callable.on);
          if (callable.on !== "self") connection.to = callable.on;
          if (type?.kind === "script" && callable.method !== "(lambda)") {
            connection.targetScript = type.model.path;
            if (hasMethod(type, callable.method) === false && (callable.literal || !declaredLocally(callable.method))) connection.missing = true;
          }
        }
        for (const flow of found) flow.connections.push(connection);
        if (connection.missing && own(file)) missingMethods.push({ ...site, signal: target.name, method: connection.method!, target: connection.targetScript!, via: "code" });
      }
      for (const m of ll.code.matchAll(/\bawait\s+/gu)) {
        const rest = ll.code.slice(m.index + m[0].length);
        const chain = CHAIN_START.exec(rest)?.[1];
        const target = chain ? lastName(chain) : undefined;
        if (!target || KEYWORD_VALUES.has(target.name)) continue;
        for (const flow of resolve(file, ll.line, target.receiver, target.name)) flow.connections.push({ file, line: ll.line, via: "await", ...(target.receiver && target.receiver !== "self" ? { from: target.receiver } : {}) });
      }
    }
  }

  const bySite = (a: SignalSite, b: SignalSite): number => a.file.localeCompare(b.file) || a.line - b.line;
  const signals = [...flows.values()]
    .filter((f) => (f.kind === "script" ? own(f.file!) : f.emits.some((s) => own(s.file)) || f.connections.some((s) => own(s.file))))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "script" ? -1 : 1) || (a.file ?? a.owner).localeCompare(b.file ?? b.owner) || (a.line ?? 0) - (b.line ?? 0) || a.name.localeCompare(b.name));
  for (const f of signals) {
    f.emits.sort(bySite);
    f.connections.sort(bySite);
  }
  const declared = signals.filter((f) => f.kind === "script");
  const problem = (f: SignalFlow): SignalProblem => ({ signal: f.name, file: f.file!, line: f.line! });
  const neverEmitted = declared.filter((f) => f.emits.length === 0).map(problem);
  const neverConnected = declared.filter((f) => f.emits.length > 0 && f.connections.length === 0).map(problem);
  missingMethods.sort(bySite);
  return { ok: neverEmitted.length + neverConnected.length + missingMethods.length === 0, project: data.root, signals, neverEmitted, neverConnected, missingMethods };
}

const KEYWORD_VALUES = new Set(["self", "super", "null", "true", "false"]);

/** The method a connect() call gives: `_on_x`, `self._on_x`, `other._on_x`, `Callable(obj, "name")`, with or without `.bind()`. */
function connectTarget(ll: LogicalLine, args: string[], index: number, argText: (i: number) => string): { on: string; method: string; literal?: true } | undefined {
  const arg = args[index]?.trim();
  if (!arg) return undefined;
  if (/^func\b/.test(arg)) return { on: "self", method: "(lambda)" };
  const made = /^Callable\s*\(\s*(.+?)\s*,\s*[&^]?["']/su.exec(arg);
  if (made) {
    const name = /,\s*[&^]?["'](\w+)["']\s*\)/u.exec(argText(index))?.[1];
    return name ? { on: made[1]!, method: name, literal: true } : undefined;
  }
  const plain = withoutBinds(arg);
  const target = lastName(plain);
  if (!target || !/^[\w.$%/"' ()[\]]*$/u.test(plain)) return undefined;
  return { on: target.receiver === "" ? "self" : target.receiver, method: target.name };
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
const short = (path: string): string => path.replace(/res:\/\//g, "");

function receiver(c: SignalConnection): string {
  if (c.via === "await") return `await in ${c.file}`;
  const where = c.targetScript ?? (c.via === "scene" ? `${c.file}:${c.to}` : (c.to ?? c.file));
  return c.method === "(lambda)" ? `${where} (lambda)` : `${where}.${c.method ?? "?"}()`;
}

/** The signal flow as compact text: the three bug lists first, then each signal with who emits it and who listens. */
export function formatSignals(r: SignalReport, limit = 30): string {
  if (r.signals.length === 0) return "signals: the project declares no signals and connects none\n";
  const out: string[] = [];
  const declared = r.signals.filter((s) => s.kind === "script").length;
  const emits = r.signals.reduce((n, s) => n + s.emits.length, 0);
  const connections = r.signals.reduce((n, s) => n + s.connections.length, 0);
  out.push(`signals: ${declared} declared, ${r.signals.length - declared} built-in in use, ${plural(emits, "emit")}, ${plural(connections, "connection")}; ${r.neverEmitted.length} never emitted, ${r.neverConnected.length} never connected, ${plural(r.missingMethods.length, "missing method")}`);
  const list = <T>(title: string, items: T[], line: (item: T) => string): void => {
    if (!items.length) return;
    out.push(title);
    for (const item of items.slice(0, limit)) out.push(`  ${line(item)}`);
    if (items.length > limit) out.push(`  ... ${items.length - limit} more`);
  };
  list("connected to a method that does not exist (Godot only says so when it runs):", r.missingMethods, (m) => `${m.file}:${m.line}  ${m.signal} -> ${m.target}.${m.method}()`);
  list("declared but never emitted:", r.neverEmitted, (p) => `${p.file}:${p.line}  ${p.signal}`);
  list("emitted but nobody listens (no connection, no await):", r.neverConnected, (p) => `${p.file}:${p.line}  ${p.signal}`);
  out.push("signals (emit = who sends it, -> = who receives it):");
  for (const s of r.signals.slice(0, limit)) {
    const where = s.kind === "script" ? `${s.owner}:${s.line}` : `built-in${s.owner ? ` ${s.owner}` : ""}`;
    out.push(`  ${s.name}${s.params.length ? `(${s.params.join(", ")})` : ""}  ${where}`);
    if (s.emits.length) out.push(`    emit ${s.emits.slice(0, 4).map((e) => `${e.file}:${e.line}`).join(", ")}${s.emits.length > 4 ? `, +${s.emits.length - 4} more` : ""}`);
    for (const c of s.connections.slice(0, 4)) out.push(`    -> ${receiver(c)}  [${c.via} ${c.file}:${c.line}${c.from ? `, from ${c.from}` : ""}]${c.missing ? "  <- no such method" : ""}`);
    if (s.connections.length > 4) out.push(`    ... ${plural(s.connections.length - 4, "more connection")}`);
  }
  if (r.signals.length > limit) out.push(`  ... ${plural(r.signals.length - limit, "more signal")}`);
  return `${out.join("\n")}\n`;
}

/** The signal flow as a mermaid diagram: emitter --> signal --> receiver. Signals nobody emits or receives are left out. */
export function formatSignalsMermaid(r: SignalReport, limit = 30): string {
  const out = ["flowchart LR"];
  const ids = new Map<string, string>();
  const label = (text: string): string => text.replace(/"/g, "'").replace(/[\r\n]+/g, " ");
  const node = (prefix: string, text: string, shape: (t: string) => string): string => {
    const key = `${prefix}\u0000${text}`;
    let id = ids.get(key);
    if (!id) {
      id = `${prefix}${ids.size}`;
      ids.set(key, id);
      out.push(`  ${id}${shape(label(text))}`);
    }
    return id;
  };
  const box = (t: string): string => `["${t}"]`;
  const edges = new Set<string>();
  const edge = (a: string, b: string, dashed = false): void => {
    const line = `  ${a} ${dashed ? "-.->" : "-->"} ${b}`;
    if (!edges.has(line)) {
      edges.add(line);
      out.push(line);
    }
  };
  let shown = 0;
  let left = 0;
  for (const s of r.signals) {
    // In a scene the node that is connected is the emitter, also when no code calls emit().
    const emitters = new Set([...s.emits.map((e) => short(e.file)), ...s.connections.filter((c) => c.via === "scene").map((c) => `${short(c.file)}:${c.from}`)]);
    if (emitters.size === 0 && s.connections.length === 0) continue;
    if (shown >= limit) {
      left++;
      continue;
    }
    shown++;
    const sig = node("s", `${s.kind}\u0000${s.owner}\u0000${s.name}`, () => `(["${label(s.name)}"])`);
    for (const e of emitters) edge(node("n", e, box), sig);
    for (const c of s.connections) edge(sig, node("n", short(receiver(c)), box), c.missing === true);
  }
  if (left) out.push(`  %% ${plural(left, "more signal")} not shown`);
  return `${out.join("\n")}\n`;
}
