import { allClasses, bareType, scriptClass, type CSharpOutline, type CsClass, type CsExport, type CsMethod, type CsSignal } from "../godot/csharp.js";

/**
 * A C# script class as Godot sees it: every `partial` part of the class, in any file of the project, and the classes
 * it inherits from in the project, down to the first class that is not the project's (a Godot class, or one from a
 * library).
 */
export interface ResolvedCSharpClass {
  /** The class named after the file. */
  cls: CsClass;
  /** Every part of the class and of its project base classes, nearest first. */
  parts: CsClass[];
  /** The first base class the project does not declare, without namespace or type arguments: a Godot class when the API knows it. */
  nativeBase?: string;
  /** False when a base class is generic or declared more than once with different bases, so members may be missing. */
  complete: boolean;
  signals: CsSignal[];
  methods: CsMethod[];
  exports: CsExport[];
}

/** Classes by name over a set of outlines (nested classes too). */
export function csharpClassIndex(outlines: Iterable<CSharpOutline>): Map<string, CsClass[]> {
  const index = new Map<string, CsClass[]>();
  for (const outline of outlines) {
    for (const c of allClasses(outline)) {
      const list = index.get(c.name);
      if (list) list.push(c);
      else index.set(c.name, [c]);
    }
  }
  return index;
}

/** The script class of `path` with its partial parts and project base classes; undefined when the file has no class named after it. */
export function resolveCSharpClass(outline: CSharpOutline, path: string, index: Map<string, CsClass[]>): ResolvedCSharpClass | undefined {
  const cls = scriptClass(outline, path);
  return cls ? resolveClass(cls, index) : undefined;
}

/** A class with its partial parts and project base classes. */
export function resolveClass(cls: CsClass, index: Map<string, CsClass[]>): ResolvedCSharpClass {
  const parts: CsClass[] = [];
  let complete = true;
  let nativeBase: string | undefined;
  let current: CsClass | undefined = cls;
  for (let depth = 0; current && depth < 16; depth++) {
    const name: string = current.name;
    const namespace: string | undefined = current.namespace;
    // Parts of one class share its name and namespace.
    const same: CsClass[] = (index.get(name) ?? [current]).filter((c) => c === current || (c.partial && c.namespace === namespace));
    for (const part of same.includes(current) ? same : [current, ...same]) if (!parts.includes(part)) parts.push(part);
    const base: string | undefined = same.find((c) => c.base)?.base;
    if (!base) break;
    const bare = bareType(base);
    const candidates: CsClass[] = (index.get(bare) ?? []).filter((c) => c.kind === "class" || c.kind === "record");
    // A qualified Godot class (Godot.Node) is never the project's own class of that name.
    if (candidates.length === 0 || /^(global::)?Godot\./.test(base)) {
      nativeBase = bare;
      break;
    }
    if (base.includes("<") || new Set(candidates.map((c) => c.namespace ?? "")).size > 1) complete = false;
    const next: CsClass = candidates[0]!;
    if (parts.includes(next)) break;
    current = next;
  }
  return {
    cls,
    parts,
    ...(nativeBase ? { nativeBase } : {}),
    complete,
    signals: parts.flatMap((p) => p.signals),
    methods: parts.flatMap((p) => p.methods),
    exports: parts.flatMap((p) => p.exports),
  };
}

/** The Godot type a C# type is stored as in a scene, where the two differ; undefined for types that cannot be told. */
export function godotTypeOf(csharp: string): string | undefined {
  const type = csharp.replace(/\?$/, "");
  if (/^(int|long|short|byte|sbyte|uint|ulong|ushort)$/.test(type)) return "int";
  if (/^(float|double)$/.test(type)) return "float";
  if (type === "string") return "String";
  if (type === "bool") return "bool";
  if (/^(Godot\.)?(StringName|NodePath|Vector[234]I?|Color|Rect2I?|Quaternion|Basis|Transform[23]D|Plane|Aabb|Projection|Rid)$/.test(type)) return bareType(type).replace(/^(Vector[234]|Rect2)I$/, "$1i").replace(/^Aabb$/, "AABB").replace(/^Rid$/, "RID");
  return undefined;
}
