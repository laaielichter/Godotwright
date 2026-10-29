import type { GodotApi } from "../api/api.js";
import type { ClassOutline, FunctionInfo, LogicalLine, ScriptOutline } from "../godot/gdscript.js";
import { resolveResPath } from "../project/files.js";
import type { ProjectData } from "../scan/scan.js";
import type { NodeInfo, SceneInfo } from "../scan/types.js";

/** A GDScript class: a script file or an inner class. */
export interface ClassModel {
  id: string;
  /** Script file that holds the class. */
  path: string;
  name?: string;
  outline: ClassOutline;
  script: ScriptOutline;
  parent?: ClassModel;
  /** Raw `extends` value, or undefined for the default (RefCounted). */
  extendsRaw?: string;
  /** Set when `extends` names a Godot 3 class; `native` is then its Godot 4 name. */
  renamedBase?: string;
  /** The built-in class at the top of the chain. */
  native: string;
  /** Inner classes by name. */
  inner: Map<string, ClassModel>;
  /** Owner class for inner classes. */
  owner?: ClassModel;
  /** True when the class defines _get/_set, so members can be dynamic. */
  dynamic: boolean;
  firstLine: number;
  lastLine: number;
}

/** What a value or name refers to, as far as static analysis can tell. */
export type GType =
  | { kind: "native"; name: string; meta: boolean }
  | { kind: "script"; model: ClassModel; meta: boolean; node?: string }
  | { kind: "enum" };

export type MemberKind = "method" | "property" | "constant" | "signal" | "enum" | "class";

export interface MemberResult {
  kind: MemberKind;
  /** Type of the value, or the return type for methods. */
  type?: GType;
  /** Where it is defined: a native class name or a script path. */
  owner: string;
  /** For methods: how many arguments it takes (max is Infinity for varargs). */
  args?: { min: number; max: number };
}

function argRange(params: { hasDefault?: boolean; default?: string }[] | undefined, vararg = false): { min: number; max: number } {
  const list = params ?? [];
  const min = list.filter((p) => p.default === undefined && !p.hasDefault).length;
  return { min, max: vararg ? Number.POSITIVE_INFINITY : list.length };
}

/** Built-in value types (Variant types that are not Objects). */
export const VALUE_TYPES = new Set([
  "AABB", "Array", "Basis", "bool", "Callable", "Color", "Dictionary", "float", "int", "NodePath",
  "PackedByteArray", "PackedColorArray", "PackedFloat32Array", "PackedFloat64Array", "PackedInt32Array",
  "PackedInt64Array", "PackedStringArray", "PackedVector2Array", "PackedVector3Array", "PackedVector4Array",
  "Plane", "Projection", "Quaternion", "Rect2", "Rect2i", "RID", "Signal", "String", "StringName",
  "Transform2D", "Transform3D", "Vector2", "Vector2i", "Vector3", "Vector3i", "Vector4", "Vector4i",
]);

export const native = (name: string, meta = false): GType => ({ kind: "native", name, meta });

/** Class reference types: `Node[]` is a typed Array, `Dictionary[String, int]` a Dictionary. */
export function docType(type: string | undefined): string | undefined {
  if (!type) return undefined;
  if (type.endsWith("[]")) return "Array";
  if (type.startsWith("Dictionary[")) return "Dictionary";
  return type;
}

export class ProjectModel {
  readonly scripts = new Map<string, ClassModel>();
  readonly classNames = new Map<string, ClassModel>();
  readonly autoloads = new Map<string, GType>();
  readonly scenes = new Map<string, SceneInfo>();
  /** Script path -> nodes that use it as their script. */
  readonly attachments = new Map<string, { scene: string; node: string }[]>();
  readonly singletons: Set<string>;
  /** Enum names of @GlobalScope, e.g. Error, Key, MouseButton, Variant.Type. */
  readonly globalEnums: Set<string>;
  private readonly belowNative = new Map<string, Set<string>>();
  private readonly belowScript = new Map<ClassModel, Set<string>>();
  /** Constants whose type is being resolved, so `const A: A` stops instead of recursing. */
  private readonly constsBusy = new Set<string>();

  constructor(
    readonly data: ProjectData,
    readonly api: GodotApi,
  ) {
    this.singletons = new Set((api.getClass("@GlobalScope")?.members ?? []).map((m) => m.name));
    this.globalEnums = new Set((api.getClass("@GlobalScope")?.constants ?? []).flatMap((c) => (c.enum ? [c.enum] : [])));
    for (const [path, outline] of data.scripts) {
      const model = this.makeModel(path, outline, outline, undefined, 1, outline.lineCount);
      this.scripts.set(path, model);
      if (outline.className) this.classNames.set(outline.className, model);
    }
    for (const model of this.allModels()) this.link(model);
    for (const scene of data.map.scenes) {
      this.scenes.set(scene.path, scene);
      for (const node of scene.nodes) {
        if (!node.script) continue;
        const list = this.attachments.get(node.script) ?? [];
        list.push({ scene: scene.path, node: node.path });
        this.attachments.set(node.script, list);
      }
    }
    for (const autoload of data.map.autoloads) {
      if (!autoload.singleton) continue;
      const type = autoload.path.endsWith(".gd")
        ? this.scriptType(autoload.path, false)
        : (this.sceneRootType(autoload.path) ?? undefined);
      if (type) this.autoloads.set(autoload.name, type);
    }
  }

  private makeModel(
    path: string,
    outline: ClassOutline,
    script: ScriptOutline,
    owner: ClassModel | undefined,
    firstLine: number,
    lastLine: number,
    name?: string,
  ): ClassModel {
    const model: ClassModel = {
      id: owner ? `${owner.id}::${name}` : path,
      path,
      name: name ?? outline.className,
      outline,
      script,
      extendsRaw: outline.extends,
      native: "RefCounted",
      inner: new Map(),
      owner,
      dynamic: outline.functions.some((f) => f.name === "_get" || f.name === "_set" || f.name === "_get_property_list"),
      firstLine,
      lastLine,
    };
    for (const inner of outline.innerClasses) {
      model.inner.set(inner.name, this.makeModel(path, inner, script, model, inner.line, inner.endLine, inner.name));
    }
    return model;
  }

  *allModels(): Generator<ClassModel> {
    const walk = function* (m: ClassModel): Generator<ClassModel> {
      yield m;
      for (const inner of m.inner.values()) yield* walk(inner);
    };
    for (const model of this.scripts.values()) yield* walk(model);
  }

  private link(model: ClassModel): void {
    const raw = model.extendsRaw;
    if (!raw) return;
    const parent = this.resolveClassRef(raw, model);
    if (parent?.kind === "script" && parent.model !== model) {
      model.parent = parent.model;
    } else if (parent?.kind === "native") {
      model.native = parent.name;
    } else if (!parent) {
      // A Godot 3 base such as KinematicBody2D: check the rest against its Godot 4 class.
      const renamed = this.api.renamedClass(raw.trim());
      if (renamed && this.api.getClass(renamed.to)) {
        model.native = renamed.to;
        model.renamedBase = raw.trim();
      } else {
        // Unknown base (reported on its own): its members are unknown too.
        model.dynamic = true;
      }
    }
  }

  /** Native base of a class, following script parents. */
  nativeOf(model: ClassModel): string {
    let m = model;
    for (let depth = 0; m.parent && depth < 32; depth++) m = m.parent;
    return m.native;
  }

  /** Chain of script classes, nearest first. */
  chain(model: ClassModel): ClassModel[] {
    const out: ClassModel[] = [];
    for (let m: ClassModel | undefined = model; m && out.length < 32; m = m.parent) {
      if (out.includes(m)) break;
      out.push(m);
    }
    return out;
  }

  scriptType(path: string, meta: boolean): GType | undefined {
    const model = this.scripts.get(path);
    return model ? { kind: "script", model, meta } : undefined;
  }

  /**
   * Type of the root node of a scene: its script, the base scene's root for
   * inherited scenes, or its built-in type. Null when the script is not GDScript.
   */
  sceneRootType(path: string, depth = 0): GType | undefined | null {
    const scene = this.scenes.get(path);
    const root = scene?.nodes[0];
    if (!scene || !root || depth > 8) return undefined;
    return this.nodeType(root, depth);
  }

  /** Resolves `extends` targets and type names: paths, class_names, inner classes and built-ins. */
  resolveClassRef(raw: string, from: ClassModel): GType | undefined {
    const text = raw.trim();
    if (/^(res:\/\/|\.\.?\/)|\.gd$/.test(text) || text.includes(".gd.")) {
      const [file, ...inner] = text.split(/(?<=\.gd)\./);
      let model = this.scripts.get(resolveResPath(from.path, file!));
      for (const name of inner.join(".").split(".").filter(Boolean)) model = model?.inner.get(name);
      return model ? { kind: "script", model, meta: true } : undefined;
    }
    return this.resolveTypeName(text, from, true);
  }

  /** Resolves a type name as written in code, e.g. `Player`, `Node2D`, `Array[int]`, `Player.State`. */
  resolveTypeName(name: string, from: ClassModel | undefined, meta = false): GType | undefined {
    const base = name.replace(/\[.*\]$/, "").trim();
    if (base === "" || base === "void" || base === "Variant") return undefined;
    if (this.globalEnums.has(base)) return { kind: "enum" };
    const parts = base.split(".");
    let type = this.resolveSimpleName(parts[0]!, from, meta);
    for (const part of parts.slice(1)) {
      if (!type) return undefined;
      if (type.kind === "script") {
        const inner = this.findInner(type.model, part);
        if (inner) type = { kind: "script", model: inner, meta };
        else if (this.chain(type.model).some((c) => c.outline.enums.some((e) => e.name === part))) type = { kind: "enum" };
        else return undefined;
      } else if (type.kind === "native") {
        const cls = this.api.getClass(type.name);
        if (cls && this.api.enums(cls).some((e) => e.name === part)) type = { kind: "enum" };
        else if (this.api.ancestors(type.name).some((c) => this.api.enums(c).some((e) => e.name === part))) type = { kind: "enum" };
        else return undefined;
      } else {
        return undefined;
      }
    }
    return type;
  }

  private findInner(model: ClassModel, name: string): ClassModel | undefined {
    for (const m of this.chain(model)) {
      const inner = m.inner.get(name);
      if (inner) return inner;
    }
    return undefined;
  }

  private resolveSimpleName(name: string, from: ClassModel | undefined, meta: boolean): GType | undefined {
    // Inner classes and enums visible from the current class (own chain and outer classes).
    for (let scope = from; scope; scope = scope.owner) {
      const inner = this.findInner(scope, name);
      if (inner) return { kind: "script", model: inner, meta };
      if (this.chain(scope).some((c) => c.outline.enums.some((e) => e.name === name))) return { kind: "enum" };
      const preloaded = this.constType(scope, name);
      if (preloaded?.kind === "script") return { ...preloaded, meta };
    }
    const named = this.classNames.get(name);
    if (named) return { kind: "script", model: named, meta };
    if (this.api.getClass(name)?.name === name && !name.startsWith("@")) return native(name, meta);
    // Enums of the native base, e.g. `ProcessMode` inside a Node script.
    if (from && this.api.ancestors(this.nativeOf(from)).some((c) => this.api.enums(c).some((e) => e.name === name))) {
      return { kind: "enum" };
    }
    const autoload = this.autoloads.get(name);
    if (autoload?.kind === "script") return { ...autoload, meta: true };
    return undefined;
  }

  /** Type of a constant such as `const Bullet = preload("res://bullet.gd")`. */
  constType(model: ClassModel, name: string): GType | undefined {
    for (const m of this.chain(model)) {
      const c = m.outline.constants.find((k) => k.name === name);
      if (!c) continue;
      const key = `${m.id}\u0000${name}`;
      // Invalid code such as `const A: A = 1` names itself: stop here, the type stays unknown.
      if (this.constsBusy.has(key)) return undefined;
      this.constsBusy.add(key);
      try {
        if (c.type) return this.resolveTypeName(c.type, m);
        const line = this.lineAt(m.script, c.line);
        const value = line ? /=\s*(.*)$/.exec(line.text)?.[1] : undefined;
        return value ? this.literalType(value, m) : undefined;
      } finally {
        this.constsBusy.delete(key);
      }
    }
    return undefined;
  }

  /** Best-effort type of simple initializers: literals, preload(), Type.new(), `as` casts. */
  literalType(expr: string, from: ClassModel): GType | undefined {
    const e = expr.trim();
    let m: RegExpExecArray | null;
    if ((m = /^preload\(\s*"([^"]+)"\s*\)$/.exec(e))) {
      const path = resolveResPath(from.path, m[1]!);
      if (path.endsWith(".gd")) return this.scriptType(path, true);
      if (path.endsWith(".tscn") || path.endsWith(".scn")) return native("PackedScene");
      return undefined;
    }
    if ((m = /\bas\s+([A-Za-z_][\w.]*)\s*$/.exec(e))) return this.resolveTypeName(m[1]!, from);
    // `X.new(...)` only when the call is the whole expression, not `X.new().f()`.
    if ((m = /^([A-Za-z_][\w.]*)\.new\(.*\)$/.exec(e)) && closingParen(e, m[1]!.length + 4) === e.length - 1) {
      const t = this.resolveTypeName(m[1]!, from);
      return t && t.kind !== "enum" ? { ...t, meta: false } : undefined;
    }
    if ((m = /^([A-Z][A-Za-z0-9_]*)\(.*\)$/.exec(e)) && VALUE_TYPES.has(m[1]!) && closingParen(e, m[1]!.length) === e.length - 1) return native(m[1]!);
    if (/^-?\d+$/.test(e)) return native("int");
    if (/^-?(\d+\.\d*|\.\d+|\d+e-?\d+)$/i.test(e)) return native("float");
    if (/^(true|false)$/.test(e)) return native("bool");
    // A literal types the value only when it is the whole expression: `"a,b".split(",")` is not a String.
    if (/^["']/.test(e) && stringEnd(e) === e.length - 1) return native("String");
    if (/^\[/.test(e) && closingParen(e, 0) === e.length - 1) return native("Array");
    if (/^\{/.test(e) && closingParen(e, 0) === e.length - 1) return native("Dictionary");
    return undefined;
  }

  lineAt(script: ScriptOutline, line: number): LogicalLine | undefined {
    return script.logicalLines.find((l) => l.line === line);
  }

  /** Type from a type annotation string, as an instance. */
  typeFromAnnotation(annotation: string | undefined, from: ClassModel): GType | undefined {
    if (!annotation) return undefined;
    const t = this.resolveTypeName(annotation, from);
    if (!t) return undefined;
    return t.kind === "enum" ? native("int") : { ...t, meta: false };
  }

  /** Finds a member on a type: script chain first, then the native base and its parents. */
  memberOf(type: GType, name: string): MemberResult | undefined {
    if (type.kind === "enum") return undefined;
    if (type.kind === "native") return this.nativeMember(type.name, name);
    for (const m of this.chain(type.model)) {
      const o = m.outline;
      const fn = o.functions.find((f) => f.name === name);
      if (fn) return { kind: "method", type: this.typeFromAnnotation(fn.returnType, m), owner: m.id, args: argRange(fn.params) };
      const v = o.variables.find((x) => x.name === name);
      if (v) return { kind: "property", type: this.varType(m, v.name), owner: m.id };
      const c = o.constants.find((x) => x.name === name);
      if (c) return { kind: "constant", type: this.constType(m, name), owner: m.id };
      if (o.signals.some((s) => s.name === name)) return { kind: "signal", type: native("Signal"), owner: m.id };
      if (o.enums.some((e) => e.name === name)) return { kind: "enum", type: { kind: "enum" }, owner: m.id };
      const inner = m.inner.get(name);
      if (inner) return { kind: "class", type: { kind: "script", model: inner, meta: true }, owner: m.id };
      if (o.enums.some((e) => !e.name && e.values.includes(name))) return { kind: "constant", type: native("int"), owner: m.id };
      if (o.enums.some((e) => e.name && e.values.includes(name))) return { kind: "constant", type: native("int"), owner: m.id };
    }
    return this.nativeMember(type.node ?? this.nativeOf(type.model), name);
  }

  nativeMember(className: string, name: string): MemberResult | undefined {
    if (name === "new") return { kind: "method", owner: className };
    const found = this.api.member(className, name).filter((e) => e.kind !== "theme_item");
    const entry = found.find((e) => e.kind === "method") ?? found[0];
    if (!entry) {
      // Property setters and getters are callable methods too (set_text, get_size, ...).
      for (const cls of this.api.ancestors(className)) {
        const prop = cls.members?.find((m) => m.setter === name || m.getter === name);
        if (prop) {
          const t = prop.enum ? "int" : docType(prop.type);
          const args = prop.getter === name ? { min: 0, max: 0 } : { min: 1, max: 1 };
          return { kind: "method", type: prop.getter === name && t && t !== "Variant" ? native(t) : undefined, owner: cls.name, args };
        }
      }
      return undefined;
    }
    const item = entry.item as {
      returns?: string;
      returnEnum?: string;
      type?: string;
      enum?: string;
      value?: string;
      params?: { default?: string }[];
      qualifiers?: string;
    };
    switch (entry.kind) {
      case "method": {
        const t = item.returnEnum ? "int" : docType(item.returns);
        return {
          kind: "method",
          type: t && t !== "void" && t !== "Variant" ? native(t) : undefined,
          owner: entry.owner,
          args: argRange(item.params, item.qualifiers?.split(" ").includes("vararg")),
        };
      }
      case "property": {
        const t = item.enum ? "int" : docType(item.type);
        return { kind: "property", type: t && t !== "Variant" ? native(t) : undefined, owner: entry.owner };
      }
      case "constant": {
        const ctor = /^([A-Z]\w*)\(/.exec(item.value ?? "")?.[1];
        return { kind: "constant", type: ctor && VALUE_TYPES.has(ctor) ? native(ctor) : native("int"), owner: entry.owner };
      }
      case "signal":
        return { kind: "signal", type: native("Signal"), owner: entry.owner };
      case "enum":
        return { kind: "enum", type: { kind: "enum" }, owner: entry.owner };
      default:
        return { kind: "property", owner: entry.owner };
    }
  }

  /** Declared or inferred type of a member variable. */
  varType(model: ClassModel, name: string): GType | undefined {
    const v = model.outline.variables.find((x) => x.name === name);
    if (!v) return undefined;
    if (v.type) return this.typeFromAnnotation(v.type, model);
    const line = this.lineAt(model.script, v.line);
    const init = line ? /:?=\s*(.*?)(?::\s*)?$/.exec(line.text.replace(/^.*?\bvar\s+\w+\s*/, ""))?.[1] : undefined;
    return init && v.inferred ? this.literalType(init, model) : undefined;
  }

  /** The class (inner or top-level) and function that contain a line of a script. */
  scopeAt(path: string, line: number): { model: ClassModel; fn?: FunctionInfo } | undefined {
    const top = this.scripts.get(path);
    if (!top) return undefined;
    let model = top;
    for (;;) {
      const inner = [...model.inner.values()].find((c) => line >= c.firstLine && line <= c.lastLine);
      if (!inner) break;
      model = inner;
    }
    const fn = model.outline.functions.find((f) => line >= f.line && line <= f.endLine);
    return { model, fn };
  }

  /** Resolves a node path used from a node of a scene; null means it does not exist there. */
  resolveNode(scenePath: string, fromNode: string, rawPath: string, depth = 0): { node: NodeInfo; scene: string } | null | undefined {
    const scene = this.scenes.get(scenePath);
    if (!scene || depth > 8) return undefined;
    if (rawPath.startsWith("/")) return undefined;
    const parts = (fromNode === "." ? [] : fromNode.split("/")).concat(rawPath.split("/").filter((p) => p !== "" && p !== "."));
    const stack: string[] = [];
    for (const part of parts) {
      if (part === "..") {
        if (stack.length === 0) return undefined;
        stack.pop();
      } else {
        stack.push(part);
      }
    }
    const target = stack.length === 0 ? "." : stack.join("/");
    const direct = scene.nodes.find((n) => n.path === target);
    if (direct) return { node: direct, scene: scenePath };
    // Walk into instanced sub-scenes.
    for (let i = stack.length - 1; i >= 1; i--) {
      const holder = scene.nodes.find((n) => n.path === stack.slice(0, i).join("/"));
      if (!holder) continue;
      if (holder.instance) return this.resolveNode(holder.instance, ".", stack.slice(i).join("/"), depth + 1);
      // A real node of this scene: the child is missing. An override (no type) comes from a base scene.
      if (holder.type) return null;
    }
    // Inherited scene: the root instances a base scene that holds the other nodes.
    const root = scene.nodes[0];
    if (root?.instance) return this.resolveNode(root.instance, ".", target, depth + 1);
    return null;
  }

  /** Member names defined on a native class or any class below it (native or project script). */
  membersBelow(nativeName: string): Set<string> {
    let set = this.belowNative.get(nativeName);
    if (set) return set;
    set = new Set();
    for (const cls of this.api.classes.values()) {
      if (!this.api.inheritsFrom(cls.name, nativeName)) continue;
      for (const list of [cls.methods, cls.members, cls.signals, cls.constants]) for (const x of list ?? []) set.add(x.name);
      for (const m of cls.members ?? []) {
        if (m.setter) set.add(m.setter);
        if (m.getter) set.add(m.getter);
      }
    }
    // A script extending Node can sit on a Node2D, so scripts above the type count too.
    for (const model of this.allModels()) {
      const base = this.nativeOf(model);
      if (this.api.inheritsFrom(base, nativeName) || this.api.inheritsFrom(nativeName, base)) {
        for (const n of this.ownNames(model)) set.add(n);
      }
    }
    this.belowNative.set(nativeName, set);
    return set;
  }

  /** Member names defined by a script class or any project script below it. */
  membersBelowScript(model: ClassModel): Set<string> {
    let set = this.belowScript.get(model);
    if (set) return set;
    set = new Set();
    for (const other of this.allModels()) {
      if (this.chain(other).includes(model)) for (const n of this.ownNames(other)) set.add(n);
    }
    this.belowScript.set(model, set);
    return set;
  }

  private ownNames(model: ClassModel): string[] {
    const o = model.outline;
    return [...o.functions, ...o.variables, ...o.constants, ...o.signals].map((x) => x.name).concat(o.enums.flatMap((e) => (e.name ? [e.name] : [])));
  }

  /** Finds a %UniqueName node in a scene. */
  uniqueNode(scenePath: string, name: string): NodeInfo | undefined {
    return this.scenes.get(scenePath)?.nodes.find((n) => n.uniqueName && n.name === name);
  }

  /**
   * Static type of a node from a scene: its script (on its built-in node type),
   * the instanced scene's root, or its class. Null when the script is not GDScript.
   */
  nodeType(node: NodeInfo, depth = 0): GType | undefined | null {
    if (node.script) {
      const model = this.scripts.get(node.script);
      if (!model) return null;
      const nodeClass = node.type && this.api.inheritsFrom(node.type, this.nativeOf(model)) ? node.type : undefined;
      return { kind: "script", model, meta: false, node: nodeClass };
    }
    if (node.instance) {
      const root = this.sceneRootType(node.instance, depth + 1);
      if (root !== undefined) return root;
    }
    return node.type ? native(node.type) : undefined;
  }
}

/** Index of the last quote of the string literal at the start of `text` (triple quotes included); -1 when unclosed. */
function stringEnd(text: string): number {
  const quote = text.startsWith('"""') || text.startsWith("'''") ? text.slice(0, 3) : text[0]!;
  for (let i = quote.length; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text.startsWith(quote, i)) return i + quote.length - 1;
  }
  return -1;
}

/** Index of the `)` that closes the `(` at `open`, skipping strings; -1 when unclosed. */
function closingParen(text: string, open: number): number {
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
