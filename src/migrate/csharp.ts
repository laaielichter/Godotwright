import type { GodotApi } from "../api/api.js";
import { allClasses, maskCSharp, outlineCSharp, pascalToSnake, snakeToPascal, type CsClass } from "../godot/csharp.js";
import { MOVED } from "../review/checks/api.js";
import { csprojText, DOTNET_TARGET_FRAMEWORK, GODOT_NET_SDK } from "../scaffold/project.js";
import type { Change, Leftover, ScriptMigration } from "./migrate.js";

/**
 * Godot 3 C# to Godot 4, where the rewrite is mechanical and sure. Built on the same official rename table as the
 * GDScript migration (editor/project_upgrade/renames_map_3_to_4.cpp: the class, builtin type and C# method and
 * property tables), and on what Godot's own converter does for C# (Connect to a Callable, RPC attributes), but only
 * in code (never in strings or comments) and only where the evidence says the old name means the Godot 3 API:
 *
 * - classes that derive from a Godot class get `partial` (Godot 4's source generators need it);
 * - `[Signal] delegate void Hit()` becomes `HitEventHandler`, and `nameof(Hit)` becomes `SignalName.Hit`;
 * - `Connect("s", target, nameof(M))` becomes `Connect("s", new Callable(target, nameof(M)))` (also Disconnect and
 *   IsConnected), and the multiplayer signals and members of the SceneTree move to `Multiplayer`;
 * - renamed classes and types (Spatial is Node3D, Godot.Object is GodotObject, Transform is Transform3D where it is a
 *   type), renamed methods and properties, and `OS.`/`Engine.` members that moved (Engine.EditorHint is
 *   Engine.IsEditorHint());
 * - `[Remote]`, `[Sync]`, `[Puppet]`... become `[Rpc(...)]`;
 * - `_Process(float delta)` and `_PhysicsProcess(float delta)` take a double: the body gets the float it had.
 *
 * `GetNode<T>` stays as it is. Everything else that looks like Godot 3 and that it cannot rewrite safely gets a TO DO
 * with its line. The .csproj and .sln are upgraded as Godot's editor upgrades them (ProjectUtils.UpgradeProjectIfNeeded,
 * DotNetSolution.MigrateFromOldConfigNames).
 */

/** What the migration needs to know about the whole project's C#. */
export interface CSharpProjectContext {
  /** Every class of the project, by name. */
  classes: Map<string, CsClass>;
  /** The Godot 3 signal delegates (without EventHandler), by the class that declares them. */
  signals: Map<string, Set<string>>;
  /** Every method, property, field and signal name declared in the project's C#. */
  declared: Set<string>;
}

/** Signal delegates in Godot 3 form: `[Signal] (public) delegate void Name(...)` where Name has no EventHandler. */
const SIGNAL_DELEGATE = /\[\s*(?:Godot\.)?Signal(?:Attribute)?\s*(?:\(\s*\))?\s*\]\s*((?:\[[^\]]*\]\s*)*)((?:(?:public|private|protected|internal)\s+)*)delegate\s+void\s+([A-Za-z_]\w*)\s*\(/g;

export function csharpProjectContext(sources: Iterable<string>): CSharpProjectContext {
  const ctx: CSharpProjectContext = { classes: new Map(), signals: new Map(), declared: new Set() };
  for (const source of sources) {
    const outline = outlineCSharp(source);
    const code = maskCSharp(source).code;
    const classes = allClasses(outline);
    for (const c of classes) {
      ctx.classes.set(c.name, c);
      for (const m of [...c.methods, ...c.members, ...c.exports]) ctx.declared.add(m.name);
    }
    for (const m of code.matchAll(SIGNAL_DELEGATE)) {
      const name = m[3]!;
      ctx.declared.add(name);
      if (name.endsWith("EventHandler")) continue;
      const owner = classAt(classes, m.index);
      if (!owner) continue;
      const set = ctx.signals.get(owner.name) ?? new Set<string>();
      set.add(name);
      ctx.signals.set(owner.name, set);
    }
  }
  return ctx;
}

/** The innermost class whose range holds the offset. */
function classAt(classes: CsClass[], offset: number): CsClass | undefined {
  let best: CsClass | undefined;
  for (const c of classes) if (c.range.start <= offset && offset < c.range.end && (!best || c.range.start >= best.range.start)) best = c;
  return best;
}

/** The SceneTree's multiplayer signals and members, which moved to the MultiplayerAPI (Node.Multiplayer). */
const TREE_MULTIPLAYER_SIGNALS: Record<string, string> = {
  network_peer_connected: "peer_connected",
  network_peer_disconnected: "peer_disconnected",
  connected_to_server: "connected_to_server",
  connection_failed: "connection_failed",
  server_disconnected: "server_disconnected",
};
const TREE_MULTIPLAYER_MEMBERS: Record<string, string> = {
  NetworkPeer: "MultiplayerPeer",
  IsNetworkServer: "IsServer",
  GetNetworkUniqueId: "GetUniqueId",
  GetRpcSenderId: "GetRemoteSenderId",
  GetNetworkConnectedPeers: "GetPeers",
};

/** Godot 3 RPC attributes and their Godot 4 form (Godot's converter, with the 4.x C# names). */
const RPC_ATTRIBUTES: Record<string, string | undefined> = {
  Remote: "[Rpc(MultiplayerApi.RpcMode.AnyPeer)]",
  RemoteSync: "[Rpc(MultiplayerApi.RpcMode.AnyPeer, CallLocal = true)]",
  Sync: "[Rpc(MultiplayerApi.RpcMode.AnyPeer, CallLocal = true)]",
  Puppet: "[Rpc]",
  Slave: "[Rpc]",
  PuppetSync: "[Rpc(CallLocal = true)]",
  Master: undefined,
  MasterSync: undefined,
};

/**
 * Godot 3 classes whose name Godot 4 still has for another class: Texture was the 2D texture (Texture2D), Light2D the
 * point light (PointLight2D). Godot 3 code means the old class, so they are renamed where they are a type.
 */
const STILL_NAMED: Record<string, string> = { Texture: "Texture2D", Light2D: "PointLight2D" };

/** Class renames that only C# has: Godot.Object is GodotObject in Godot 4's C# API (GDScript keeps Object). */
const CSHARP_CLASSES: Record<string, string> = { Object: "GodotObject" };

/**
 * Method renames Godot's converter does with a custom rule rather than its table (`.instance()` is `.instantiate()`):
 * the table leaves them out because the GDScript word also appears in scene files.
 */
const CSHARP_EXTRA_FUNCTIONS: Record<string, string> = { Instance: "Instantiate" };

/**
 * Godot 3's math types had lowercase fields (v.x, t.origin); Godot 4's C# types have PascalCase ones. These are
 * renamed on any receiver whose type is not known, unless the project declares a member with that name: no other
 * Godot 4 type has them in lowercase. The rest only where the receiver is known to be one of these types.
 */
const STRUCT_FIELDS_ANY = new Set(["x", "y", "z", "w", "origin", "basis"]);
const STRUCT_FIELDS: Record<string, string[]> = {
  Vector2: ["x", "y"], Vector2i: ["x", "y"], Vector3: ["x", "y", "z"], Vector3i: ["x", "y", "z"], Vector4: ["x", "y", "z", "w"],
  Quaternion: ["x", "y", "z", "w"], Color: ["r", "g", "b", "a", "h", "s", "v", "r8", "g8", "b8", "a8"], Basis: ["x", "y", "z"],
  Transform2D: ["x", "y", "origin"], Transform3D: ["basis", "origin"], Rect2: ["position", "size", "end"], Rect2i: ["position", "size", "end"],
  Aabb: ["position", "size", "end"], AABB: ["position", "size", "end"], Plane: ["normal", "d", "x", "y", "z"],
};
/** The Godot 3 names of those types, as C# wrote them. */
const STRUCT_TYPES_3: Record<string, string> = { Quat: "Quaternion", Transform: "Transform3D", AABB: "Aabb" };

/** Renames that hold on these classes only, beyond the typed ones of Godot's table (which marks them as risky elsewhere). */
const CSHARP_TYPED: Record<string, { to: string; classes: string[] }> = {
  Frames: { to: "SpriteFrames", classes: ["AnimatedSprite2D", "AnimatedSprite3D"] },
};

/** System.String members, which a StringName does not have: Node.Name is a StringName in Godot 4. */
const STRING_MEMBERS = new Set(["ToLower", "ToUpper", "ToLowerInvariant", "ToUpperInvariant", "Contains", "StartsWith", "EndsWith", "Substring", "Length", "Replace", "Split", "Trim", "TrimStart", "TrimEnd", "IndexOf", "LastIndexOf", "PadLeft", "PadRight", "Insert", "Remove", "Equals", "CompareTo", "Format", "Chars"]);

interface Edit {
  start: number;
  end: number;
  text: string;
  rule: string;
}

class CSharpMigrator {
  private source: string;
  private readonly changes: Change[] = [];
  private readonly left: Leftover[] = [];
  private readonly notes: string[] = [];
  private readonly members4: Set<string>;
  private readonly usesGodot: boolean;

  constructor(
    private readonly api: GodotApi,
    private readonly ctx: CSharpProjectContext,
    source: string,
  ) {
    this.source = source;
    this.members4 = new Set();
    for (const cls of api.classes.values()) for (const list of [cls.methods, cls.members, cls.signals, cls.constants]) for (const item of list ?? []) this.members4.add(item.name);
    this.usesGodot = /^\s*using\s+Godot\s*;/m.test(maskCSharp(source).code) || /\bnamespace\s+Godot\b/.test(source);
  }

  private lineOf(offset: number, text = this.source): number {
    let n = 1;
    for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
    return n;
  }

  private todo(offset: number, message: string): void {
    const line = this.lineOf(offset);
    if (!this.left.some((l) => l.line === line && l.message === message)) this.left.push({ line, message });
  }

  /** Applies edits (non-overlapping; a later one that overlaps is dropped) to the source and records them. */
  private apply(edits: Edit[]): void {
    const sorted = edits.sort((a, b) => a.start - b.start);
    const kept: Edit[] = [];
    for (const e of sorted) if (!kept.length || e.start >= kept[kept.length - 1]!.end) kept.push(e);
    let out = this.source;
    for (const e of [...kept].reverse()) {
      this.changes.push({ line: this.lineOf(e.start), rule: e.rule, from: this.source.slice(e.start, e.end), to: e.text });
      out = out.slice(0, e.start) + e.text + out.slice(e.end);
    }
    this.source = out;
  }

  /** The Godot 4 name of a Godot 3 class or builtin type, or undefined. */
  private renamedType(name: string): string | undefined {
    const r = this.api.data.renames;
    if (this.ctx.classes.has(name)) return undefined;
    // C# only: the class is still Object in Godot 4's API data, but GodotObject in its C# bindings.
    if (CSHARP_CLASSES[name]) return CSHARP_CLASSES[name];
    if (STILL_NAMED[name]) return STILL_NAMED[name];
    const to = r.classes?.[name] ?? r.builtinTypes?.[name];
    return to && !this.api.classes.has(name) ? to : undefined;
  }

  /** The Godot 4 class a project class finally derives from, or undefined when it is no Godot class. */
  private godotBase(cls: CsClass | undefined, seen = new Set<string>()): string | undefined {
    for (let c = cls; c && c.base && !seen.has(c.name); c = this.ctx.classes.get(bare(c.base))) {
      seen.add(c.name);
      const base = bare(c.base);
      const g4 = this.renamedType(base) ?? base;
      if (this.api.classes.has(g4)) return g4;
      if (!this.ctx.classes.has(base)) return undefined;
    }
    return undefined;
  }

  /** Whether the Godot 4 class (or an ancestor) has a member with this C# name. */
  private has4(cls: string, csharp: string): boolean {
    const snake = pascalToSnake(csharp);
    return this.api.ancestors(cls).some((c) => [c.methods, c.members, c.signals, c.constants].some((list) => (list ?? []).some((m) => m.name === snake)));
  }

  migrate(): ScriptMigration {
    this.attributes();
    this.signals();
    this.partial();
    this.connects();
    this.treeMultiplayer();
    this.types();
    this.members();
    this.structFields();
    this.playing();
    this.moveAndCollide();
    this.stringNames();
    this.dictionaries();
    this.moved();
    this.processDelta();
    this.leftovers();
    return { code: this.source, changes: this.changes.sort((a, b) => a.line - b.line), left: this.left.sort((a, b) => a.line - b.line), ...(this.notes.length ? { notes: this.notes } : {}) };
  }

  private attributes(): void {
    const code = maskCSharp(this.source).code;
    const edits: Edit[] = [];
    for (const m of code.matchAll(/\[\s*(Remote|RemoteSync|Sync|Puppet|Slave|PuppetSync|Master|MasterSync)(?:Attribute)?\s*(?:\(\s*\))?\s*\]/g)) {
      const to = RPC_ATTRIBUTES[m[1]!];
      if (to) edits.push({ start: m.index, end: m.index + m[0].length, text: to, rule: "rpc" });
      else this.todo(m.index, `[${m[1]}] has no Godot 4 form (master RPCs are not supported): use [Rpc] and check Multiplayer.GetRemoteSenderId() in the method`);
    }
    // ResourceType hints name classes in a string: [Export(PropertyHint.ResourceType, "Texture")].
    for (const m of this.source.matchAll(/PropertyHint\.ResourceType\s*,\s*"([A-Za-z_]\w*)"/g)) {
      const to = this.renamedType(m[1]!);
      if (to && code.slice(m.index, m.index + 10) === this.source.slice(m.index, m.index + 10)) {
        const at = m.index + m[0].lastIndexOf(m[1]!);
        edits.push({ start: at, end: at + m[1]!.length, text: to, rule: "export" });
      }
    }
    this.apply(edits);
  }

  private signals(): void {
    const code = maskCSharp(this.source).code;
    const outline = outlineCSharp(this.source);
    const classes = allClasses(outline);
    const edits: Edit[] = [];
    for (const m of code.matchAll(SIGNAL_DELEGATE)) {
      const name = m[3]!;
      if (name.endsWith("EventHandler")) continue;
      const at = m.index + m[0].lastIndexOf(name);
      edits.push({ start: at, end: at + name.length, text: `${name}EventHandler`, rule: "signal" });
    }
    // nameof(Hit) is the signal's name in Godot 3; in Godot 4 that is SignalName.Hit (nameof(Hit) names the event).
    for (const m of code.matchAll(/\bnameof\s*\(\s*(?:([A-Za-z_]\w*)\s*\.\s*)?([A-Za-z_]\w*)\s*\)/g)) {
      const owner = m[1] ?? this.signalOwner(classAt(classes, m.index), m[2]!);
      if (!owner || !this.ctx.signals.get(owner)?.has(m[2]!)) continue;
      edits.push({ start: m.index, end: m.index + m[0].length, text: m[1] ? `${m[1]}.SignalName.${m[2]}` : `SignalName.${m[2]}`, rule: "signal" });
    }
    this.apply(edits);
  }

  /** The class (this one or a base in the project) that declares a signal. */
  private signalOwner(cls: CsClass | undefined, name: string): string | undefined {
    for (let c = cls, n = 0; c && n < 32; c = c.base ? this.ctx.classes.get(bare(c.base)) : undefined, n++) if (this.ctx.signals.get(c.name)?.has(name)) return c.name;
    return undefined;
  }

  private partial(): void {
    const code = maskCSharp(this.source).code;
    const edits: Edit[] = [];
    for (const c of allClasses(outlineCSharp(this.source))) {
      if (c.partial || c.kind !== "class" || !this.godotBase(c)) continue;
      const head = new RegExp(`\\bclass\\s+${c.name}\\b`, "g");
      head.lastIndex = c.range.start;
      const m = head.exec(code);
      if (!m || m.index > c.range.end) continue;
      edits.push({ start: m.index, end: m.index, text: "partial ", rule: "partial" });
    }
    this.apply(edits);
  }

  /** The arguments of the call whose `(` is at `open`, split at top-level commas, with offsets; and where `)` is. */
  private args(code: string, open: number): { list: { start: number; end: number }[]; close: number } | undefined {
    const list: { start: number; end: number }[] = [];
    let depth = 0;
    let start = open + 1;
    for (let i = open; i < code.length; i++) {
      const ch = code[i];
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") {
        depth--;
        if (depth === 0) {
          if (code.slice(start, i).trim()) list.push({ start, end: i });
          return { list, close: i };
        }
      } else if (ch === "," && depth === 1) {
        list.push({ start, end: i });
        start = i + 1;
      }
    }
    return undefined;
  }

  private connects(): void {
    const code = maskCSharp(this.source).code;
    const edits: Edit[] = [];
    const text = (r: { start: number; end: number }) => this.source.slice(r.start, r.end).trim();
    for (const m of code.matchAll(/(?<![\w])(Connect|Disconnect|IsConnected)\s*\(/g)) {
      // A declaration (void Connect(...)) or a call that is already Godot 4 (a Callable) is left alone.
      if (/\b(?:void|bool|Error|int)\s+$/.test(code.slice(Math.max(0, m.index - 12), m.index))) continue;
      const open = m.index + m[0].length - 1;
      const a = this.args(code, open);
      if (!a) continue;
      const n = a.list.length;
      if (n < 3) continue;
      const [sig, target, method] = a.list as [{ start: number; end: number }, { start: number; end: number }, { start: number; end: number }];
      const callable = `new Callable(${text(target)}, ${text(method)})`;
      let rest: string[] | undefined;
      if (m[1] === "Connect") {
        if (n === 3) rest = [];
        else if (n === 4 && text(a.list[3]!) === "null") rest = [];
        else if (n === 5 && text(a.list[3]!) === "null") rest = [text(a.list[4]!)];
      } else if (n === 3) rest = [];
      if (!rest) {
        this.todo(m.index, `${m[1]} with binds: Godot 4 takes a Callable; bind the extra arguments with Callable.From(() => Method(...)) or a lambda, as in Connect(${text(sig)}, Callable.From(...))`);
        continue;
      }
      edits.push({ start: a.list[0]!.start, end: a.close, text: `${this.source.slice(sig.start, sig.end)}, ${callable}${rest.map((r) => `, ${r}`).join("")}`, rule: "connect" });
    }
    this.apply(edits);
    this.signalStrings();
  }

  /** Renamed Godot signals named in a string as the first argument of Connect/Disconnect/IsConnected/ToSignal/EmitSignal. */
  private signalStrings(): void {
    const masked = maskCSharp(this.source);
    const edits: Edit[] = [];
    const renames = this.api.data.renames.signals ?? {};
    const signals4 = new Set<string>();
    for (const cls of this.api.classes.values()) for (const s of cls.signals ?? []) signals4.add(s.name);
    for (const l of masked.literals.values()) {
      const before = masked.code.slice(Math.max(0, l.start - 40), l.start);
      if (!/\b(?:Connect|Disconnect|IsConnected|EmitSignal)\s*\(\s*$|\bToSignal\s*\([^,()]*,\s*$/.test(before)) continue;
      const to = renames[l.value];
      // The SceneTree's multiplayer signals change their receiver too: treeMultiplayer does both, or a TO DO.
      if (!to || signals4.has(l.value) || l.value in TREE_MULTIPLAYER_SIGNALS) continue;
      edits.push({ start: l.start + 1, end: l.end, text: to, rule: "signal" });
    }
    this.apply(edits);
  }

  /** GetTree().Connect("network_peer_connected", ...) and GetTree().NetworkPeer: the MultiplayerAPI has them now. */
  private treeMultiplayer(): void {
    const masked = maskCSharp(this.source);
    const classes = allClasses(outlineCSharp(this.source));
    const edits: Edit[] = [];
    const inNode = (offset: number) => {
      const base = this.godotBase(classAt(classes, offset));
      return base !== undefined && this.api.inheritsFrom(base, "Node");
    };
    for (const m of masked.code.matchAll(/\bGetTree\s*\(\s*\)\s*\.\s*(Connect|Disconnect|IsConnected)\s*\(\s*"/g)) {
      const quote = m.index + m[0].length - 1;
      const lit = masked.literals.get(quote);
      if (!lit) continue;
      const to = TREE_MULTIPLAYER_SIGNALS[lit.value];
      if (!to) continue;
      if (!inNode(m.index)) {
        this.todo(m.index, `the SceneTree signal "${lit.value}" is on the MultiplayerAPI in Godot 4 (Multiplayer.${snakeToPascal(to)})`);
        continue;
      }
      const tree = /^GetTree\s*\(\s*\)/.exec(masked.code.slice(m.index))![0];
      edits.push({ start: m.index, end: m.index + tree.length, text: "Multiplayer", rule: "multiplayer" });
      if (to !== lit.value) edits.push({ start: lit.start + 1, end: lit.end, text: to, rule: "multiplayer" });
    }
    for (const m of masked.code.matchAll(/\bGetTree\s*\(\s*\)\s*\.\s*([A-Z]\w*)\b/g)) {
      const to = TREE_MULTIPLAYER_MEMBERS[m[1]!];
      if (!to) continue;
      if (!inNode(m.index)) {
        this.todo(m.index, `SceneTree.${m[1]} is Multiplayer.${to} in Godot 4`);
        continue;
      }
      edits.push({ start: m.index, end: m.index + m[0].length, text: `Multiplayer.${to}`, rule: "multiplayer" });
    }
    this.apply(edits);
  }

  private types(): void {
    const code = maskCSharp(this.source).code;
    const edits: Edit[] = [];
    for (const m of code.matchAll(/(?<![\w.])(?:(Godot)\s*\.\s*)?([A-Z]\w*)\b/g)) {
      const name = m[2]!;
      // Object is only Godot's Object with `using Godot;` (or written Godot.Object).
      if (name === "Object" && !m[1] && !this.usesGodot) continue;
      const after = code.slice(m.index + m[0].length, m.index + m[0].length + 40);
      if (name === "Viewport" && !m[1] && !/^\s*\.\s*[A-Z]/.test(after)) {
        this.todo(m.index, "Godot 3's Viewport node is SubViewport in Godot 4 (GetViewport() still returns a Viewport): use SubViewport where this is the node");
        continue;
      }
      const to = this.renamedType(name);
      if (!to) continue;
      const before = code.slice(Math.max(0, m.index - 20), m.index);
      // A namespace or a declaration of something with that name is not the Godot type.
      if (/\b(?:namespace|class|struct|enum|interface)\s+$/.test(before)) continue;
      // A name that is also a member in Godot 4 (Transform is a property of Node3D) is renamed only where it is a type:
      // a declaration, new, a cast, a generic argument, typeof, is/as, or a static member of the type.
      if ((this.members4.has(pascalToSnake(name)) || STILL_NAMED[name]) && !m[1]) {
        const isType =
          /^\s*(?:\[\s*\]\s*)?[A-Za-z_@]\w*\s*[=;,)]/.test(after) ||
          /^\s*\?\s*[A-Za-z_]/.test(after) ||
          /\bnew\s+$/.test(before) ||
          /(?:^|[^\w)\]])\(\s*$/.test(before) && /^\s*\)\s*[\w(@]/.test(after) ||
          /<\s*$|,\s*$/.test(before) && /^\s*[>,]/.test(after) ||
          /\b(?:typeof|default)\s*\(\s*$/.test(before) ||
          /\b(?:is|as)\s+$/.test(before) ||
          (/^\s*\.\s*([A-Z]\w*)/.test(after) && this.api.getClass(to) !== undefined && this.staticOf(to, /^\s*\.\s*([A-Z]\w*)/.exec(after)![1]!));
        if (!isType) continue;
      }
      const at = m.index + m[0].length - name.length;
      edits.push({ start: at, end: at + name.length, text: to, rule: "class" });
    }
    this.apply(edits);
  }

  /** A constant or static of a Godot 4 builtin type or class (Transform3D.Identity, Vector3.Up). */
  private staticOf(cls: string, member: string): boolean {
    const c = this.api.getClass(cls);
    if (!c) return false;
    const snake = pascalToSnake(member);
    return (c.constants ?? []).some((k) => k.name === snake.toUpperCase() || k.name === snake) || (c.methods ?? []).some((x) => x.name === snake && /\bstatic\b/.test(x.qualifiers ?? ""));
  }

  /** The Godot 3 type of a receiver expression, from what this file says, or undefined. */
  private receiverType(code: string, offset: number, classes: CsClass[]): string | undefined {
    const before = code.slice(Math.max(0, offset - 200), offset);
    const generic = /\bGetNode(?:OrNull)?\s*<\s*([A-Z]\w*)\s*>\s*\([^()]*\)\s*$/.exec(before);
    if (generic) return generic[1];
    const cast = /\(\s*\(\s*([A-Z]\w*)\s*\)[^()]*\)\s*$/.exec(before);
    if (cast) return cast[1];
    // A chain: the type of a.b is the type of member b on the type of a.
    const chain = /\.\s*([A-Za-z_]\w*)\s*$/.exec(before);
    if (chain) {
      const owner = this.receiverType(code, offset - chain[0].length, classes);
      if (!owner || owner === "!static") return undefined;
      return this.memberType(owner, chain[1]!);
    }
    // A static receiver: a Godot 4 class (Input.IsActionPressed) is that class; GD, Mathf and other C#-only
    // classes have APIs of their own, which the rename tables (written for GDScript's global scope) do not describe.
    const upper = /(?<![\w.])([A-Z]\w*)\s*$/.exec(before);
    if (upper) {
      const name = upper[1]!;
      // A property of the class itself (Position, Velocity, Transform): the type of that member.
      const own = classAt(classes, offset);
      const member = own ? [...own.members, ...own.exports].find((x) => x.name === name) : undefined;
      if (member) return bare(member.type);
      const base = this.godotBase(own);
      if (base) {
        const snake = pascalToSnake(name);
        for (const c of this.api.ancestors(base)) {
          const prop = (c.members ?? []).find((x) => x.name === snake);
          if (prop) return prop.type;
        }
      }
      if (this.ctx.classes.has(name)) return name;
      if (this.api.classes.has(this.renamedType(name) ?? name)) return name;
      return "!static";
    }
    const ident = /(?<![\w.])(this|base|[a-z_@][\w]*)\s*$/.exec(before);
    if (!ident) return undefined;
    if (ident[1] === "this" || ident[1] === "base") return this.godotBase(classAt(classes, offset));
    const name = ident[1]!.replace(/^@/, "");
    // `value` in a setter has the property's type: the nearest property header above it.
    if (name === "value") {
      const lines = code.slice(0, offset).split("\n").reverse();
      for (const l of lines.slice(0, 40)) {
        const head = /^\s*(?:(?:public|private|protected|internal|static|override|virtual|new)\s+)+([A-Z]\w*)\s+[A-Z]\w*\s*(?:\{|$)/.exec(l);
        if (head) return head[1];
        if (/\)\s*\{?\s*$/.test(l) && /\(/.test(l)) break;
      }
    }
    const scope = code.slice(0, offset);
    const decl = new RegExp(`\\b([A-Z]\\w*)(?:<[^<>]*>)?\\s+@?${name}\\s*[=;,)]`, "g");
    let found: string | undefined;
    for (const d of scope.matchAll(decl)) found = d[1];
    if (found && found !== "var") return found;
    const inferred = new RegExp(`\\bvar\\s+@?${name}\\s*=\\s*(?:\\(\\s*([A-Z]\\w*)\\s*\\)|new\\s+([A-Z]\\w*)\\b|GetNode(?:OrNull)?\\s*<\\s*([A-Z]\\w*)\\s*>|[^;]*\\bas\\s+([A-Z]\\w*)\\s*;)`, "g");
    for (const d of scope.matchAll(inferred)) found = d[1] ?? d[2] ?? d[3] ?? d[4];
    return found;
  }

  /** The type of a member on a type: a project class's own member, else Godot 4's property of that class. */
  private memberType(type: string, member: string): string | undefined {
    const cls = this.ctx.classes.get(type);
    if (cls) {
      const own = [...cls.members, ...cls.exports].find((x) => x.name === member);
      if (own) return bare(own.type);
      const base = this.godotBase(cls);
      return base ? this.memberType(base, member) : undefined;
    }
    const t4 = STRUCT_TYPES_3[type] ?? this.renamedType(type) ?? type;
    const snake = pascalToSnake(member);
    for (const c of this.api.ancestors(t4)) {
      const prop = (c.members ?? []).find((x) => x.name === snake);
      if (prop) return prop.type;
    }
    return undefined;
  }

  /** Renamed methods and properties (the C# tables of Godot's rename map), where the evidence says they are Godot's. */
  private members(): void {
    const r = this.api.data.renames;
    const functions = r.csharpFunctions ?? {};
    const properties = r.csharpProperties ?? {};
    const code = maskCSharp(this.source).code;
    const classes = allClasses(outlineCSharp(this.source));
    const edits: Edit[] = [];
    for (const m of code.matchAll(/(\.\s*)?\b([A-Z_]\w*)\b(\s*(?:<[^<>()]*>)?\s*\()?/g)) {
      const name = m[2]!;
      const call = m[3] !== undefined;
      const dotted = m[1] !== undefined;
      const typed = (call ? r.typedFunctions : r.typedProperties)?.[pascalToSnake(name)] ?? (call ? undefined : CSHARP_TYPED[name] && { ...CSHARP_TYPED[name]!, to: pascalToSnake(CSHARP_TYPED[name]!.to) });
      const to = (call ? (functions[name] ?? CSHARP_EXTRA_FUNCTIONS[name]) : properties[name]) ?? (typed && dotted ? snakeToPascal(typed.to) : undefined);
      if (!to || to === name) continue;
      const at = m.index + (m[1]?.length ?? 0);
      const before = code.slice(Math.max(0, at - 30), at);
      const isDeclaration = /\b(?:void|override|public|private|protected|internal|static)\s+(?:[\w<>[\],\s]+\s+)?$/.test(before) && !dotted;
      // A method the project declares itself (a non-override) is its own, not Godot's.
      if (this.ctx.declared.has(name) && !/\boverride\b/.test(code.slice(Math.max(0, at - 60), at))) continue;
      if (isDeclaration && !/\boverride\b/.test(before)) continue;
      let sure = false;
      let unknown = false;
      if (dotted) {
        const type = this.receiverType(code, m.index, classes);
        if (type === "!static") continue;
        unknown = type === undefined;
        const t4 = type ? (this.renamedType(type) ?? type) : undefined;
        const tableHas = (call ? functions[name] ?? CSHARP_EXTRA_FUNCTIONS[name] : properties[name]) !== undefined;
        // A project class: what it inherits from Godot decides, unless it declares the name itself.
        const g4 = t4 && this.ctx.classes.has(t4) && !this.ctx.declared.has(name) ? this.godotBase(this.ctx.classes.get(t4)) : t4;
        if (g4 && this.api.classes.has(g4)) {
          sure = this.has4(g4, to) && !this.has4(g4, name) && (tableHas || (typed?.classes.some((c) => this.api.inheritsFrom(g4, c)) ?? false));
        } else if (t4 && this.api.classes.has(t4)) {
          sure = this.has4(t4, to) && !this.has4(t4, name) && (tableHas || (typed?.classes.some((c) => this.api.inheritsFrom(t4, c)) ?? false));
        } else if (tableHas && (!type || !this.ctx.classes.has(type))) sure = !this.members4.has(pascalToSnake(name)) && this.members4.has(pascalToSnake(to));
      } else {
        // Bare: a member of the class's own Godot base.
        const base = this.godotBase(classAt(classes, m.index));
        sure = base !== undefined && this.has4(base, to) && !this.has4(base, name);
      }
      if (!sure) {
        // The type is not known here and Godot 4 still has a member with the old name: it may be either.
        if (unknown && this.members4.has(pascalToSnake(name))) this.todo(m.index, `${name} may be Godot 3's ${name}, which is ${to} in Godot 4; check the type it is called on`);
        continue;
      }
      edits.push({ start: at, end: at + name.length, text: to, rule: "rename" });
      if (isDeclaration) this.todo(at, `${name} is ${to} in Godot 4: check its parameters and return type against the Godot 4 API (godot_api)`);
    }
    this.apply(edits);
  }

  /** v.x is v.X: Godot 4's C# math types have PascalCase fields. */
  private structFields(): void {
    const code = maskCSharp(this.source).code;
    const classes = allClasses(outlineCSharp(this.source));
    const edits: Edit[] = [];
    for (const m of code.matchAll(/\.\s*([a-z]\w*)\b(?!\s*\()/g)) {
      const field = m[1]!;
      const type = this.receiverType(code, m.index, classes);
      const t4 = type && type !== "!static" ? (STRUCT_TYPES_3[type] ?? this.renamedType(type) ?? type) : undefined;
      // A known Godot math type is renamed whatever the project declares; an unknown receiver only when no project
      // type has a member with that name (a struct of the project's own with a field x).
      const ok = t4 && STRUCT_FIELDS[t4] ? STRUCT_FIELDS[t4]!.includes(field) : type === undefined && STRUCT_FIELDS_ANY.has(field) && !this.ctx.declared.has(field);
      if (!ok) continue;
      const at = m.index + m[0].length - field.length;
      edits.push({ start: at, end: at + field.length, text: field.length <= 2 && /\d/.test(field) ? field.toUpperCase() : field[0]!.toUpperCase() + field.slice(1), rule: "field" });
    }
    this.apply(edits);
  }

  /** AnimatedSprite.Playing is gone in Godot 4: `sprite.Playing = true;` is `sprite.Play();`, false is Stop(). */
  private playing(): void {
    const code = maskCSharp(this.source).code;
    const classes = allClasses(outlineCSharp(this.source));
    const edits: Edit[] = [];
    for (const m of code.matchAll(/(?<![\w.])([A-Za-z_]\w*)\s*\.\s*Playing\s*=\s*(true|false)\s*;/g)) {
      const type = this.receiverType(code, m.index + m[1]!.length, classes);
      const t4 = type && type !== "!static" ? (this.renamedType(type) ?? type) : undefined;
      if (!t4 || !(this.api.inheritsFrom(t4, "AnimatedSprite2D") || this.api.inheritsFrom(t4, "AnimatedSprite3D"))) {
        this.todo(m.index, "Playing is gone in Godot 4: call Play() or Stop() (AnimatedSprite2D/3D), or set the animation player's state");
        continue;
      }
      edits.push({ start: m.index, end: m.index + m[0].length, text: `${m[1]}.${m[2] === "true" ? "Play" : "Stop"}();`, rule: "rename" });
    }
    for (const m of code.matchAll(/\.\s*CompressionMode\s*=/g)) this.todo(m.index, "ENet compression is set on the host in Godot 4, after it is created: peer.Host.Compress(ENetConnection.CompressionMode...)");
    this.apply(edits);
  }

  /**
   * MoveAndCollide(motion, infiniteInertia, excludeRaycastShapes, testOnly) in Godot 3 is
   * MoveAndCollide(motion, testOnly) in Godot 4: the two removed flags are dropped, testOnly keeps its value.
   */
  private moveAndCollide(): void {
    const code = maskCSharp(this.source).code;
    const edits: Edit[] = [];
    for (const m of code.matchAll(/\bMoveAndCollide\s*\(/g)) {
      const a = this.args(code, m.index + m[0].length - 1);
      if (!a || a.list.length < 2) continue;
      const arg = (i: number) => this.source.slice(a.list[i]!.start, a.list[i]!.end).trim();
      if (!a.list.slice(1).every((_, i) => /^(true|false)$/.test(arg(i + 1)))) continue;
      const kept = a.list.length >= 4 && arg(3) === "true" ? `${arg(0)}, true` : arg(0);
      edits.push({ start: a.list[0]!.start, end: a.close, text: kept, rule: "rename" });
    }
    this.apply(edits);
  }

  /** Node.Name is a StringName in Godot 4: a string member on it goes through ToString() (Name.ToLower()). */
  private stringNames(): void {
    const code = maskCSharp(this.source).code;
    const classes = allClasses(outlineCSharp(this.source));
    const edits: Edit[] = [];
    for (const m of code.matchAll(/(?<![\w])((?:[a-z_]\w*\s*\.\s*)?Name)\s*\.\s*([A-Z]\w*)\b/g)) {
      if (!STRING_MEMBERS.has(m[2]!)) continue;
      const own = !m[1]!.includes(".");
      const base = own ? this.godotBase(classAt(classes, m.index)) : (() => {
        const type = this.receiverType(code, m.index + m[1]!.lastIndexOf("."), classes);
        return type && type !== "!static" ? (this.renamedType(type) ?? type) : undefined;
      })();
      if (!base || !this.api.inheritsFrom(base, "Node") || this.ctx.declared.has("Name")) continue;
      const end = m.index + m[1]!.length;
      edits.push({ start: end, end, text: ".ToString()", rule: "stringname" });
    }
    this.apply(edits);
  }

  /** Godot.Collections.Dictionary.Contains is ContainsKey in Godot 4 (System's Dictionary never had Contains). */
  private dictionaries(): void {
    const code = maskCSharp(this.source).code;
    const classes = allClasses(outlineCSharp(this.source));
    const edits: Edit[] = [];
    for (const m of code.matchAll(/\.\s*Contains\s*\(/g)) {
      const type = this.receiverType(code, m.index, classes);
      if (type !== "Dictionary") continue;
      const at = m.index + m[0].indexOf("Contains");
      edits.push({ start: at, end: at + "Contains".length, text: "ContainsKey", rule: "rename" });
    }
    this.apply(edits);
  }

  /** OS. and Engine. members that moved (the MOVED table of the review, in C# names). */
  private moved(): void {
    const code = maskCSharp(this.source).code;
    const edits: Edit[] = [];
    for (const [from, to] of Object.entries(MOVED)) {
      const [cls, member] = from.split(".") as [string, string];
      const cs = `${cls}.${snakeToPascal(member)}`;
      const re = new RegExp(`(?<![\\w.])${cls}\\s*\\.\\s*${snakeToPascal(member)}\\b(\\s*\\()?`, "g");
      for (const m of code.matchAll(re)) {
        const simple = /^(\w+)\.(\w+)\(\)$/.exec(to);
        if (!simple) {
          this.todo(m.index, `${cs} moved in Godot 4: ${to.replace(/\b([a-z_]+)\(/g, (_x, f: string) => `${snakeToPascal(f)}(`)}`);
          continue;
        }
        const target = `${simple[1]}.${snakeToPascal(simple[2]!)}`;
        const wasCall = m[1] !== undefined;
        const name = m[0].replace(/\s*\($/, "");
        edits.push({ start: m.index, end: m.index + name.length, text: wasCall ? target : `${target}()`, rule: "moved" });
      }
    }
    this.apply(edits);
  }

  /** Godot 4 passes delta as a double: `_Process(double deltaDouble) { float delta = (float)deltaDouble; ...`. */
  private processDelta(): void {
    const code = maskCSharp(this.source).code;
    const edits: Edit[] = [];
    for (const m of code.matchAll(/\boverride\s+void\s+(_Process|_PhysicsProcess)\s*\(\s*(float|real_t|Single|System\.Single)\s+([A-Za-z_]\w*)\s*\)\s*(\{|=>)/g)) {
      const name = m[3]!;
      const floatType = m[2]!;
      if (m[4] === "=>") {
        this.todo(m.index, `${m[1]} takes a double in Godot 4: change float ${name} to double ${name} and cast where a float is needed`);
        continue;
      }
      const open = m[0].indexOf("(");
      const paramAt = m.index + m[0].indexOf(floatType, open);
      const paramEnd = m.index + m[0].indexOf(")", open);
      const brace = m.index + m[0].length;
      const lineStart = this.source.lastIndexOf("\n", m.index) + 1;
      const indent = /^\s*/.exec(this.source.slice(lineStart))![0];
      const inner = indent.includes("\t") ? `${indent}\t` : `${indent}    `;
      edits.push({ start: paramAt, end: paramEnd, text: `double ${name}Double`, rule: "delta" });
      edits.push({ start: brace, end: brace, text: `\n${inner}${floatType} ${name} = (${floatType})${name}Double;`, rule: "delta" });
    }
    this.apply(edits);
  }

  private leftovers(): void {
    const code = maskCSharp(this.source).code;
    const at = (re: RegExp, message: string) => {
      for (const m of code.matchAll(re)) this.todo(m.index, message);
    };
    at(/\bMoveAndSlide\s*\(\s*[^)\s]/g, "MoveAndSlide takes no arguments in Godot 4: set Velocity (and UpDirection, FloorStopOnSlope...) first, call MoveAndSlide(), and read Velocity after it");
    at(/\bMoveAndSlideWithSnap\s*\(/g, "MoveAndSlideWithSnap is gone in Godot 4: set FloorSnapLength, then call MoveAndSlide()");
    at(/\b(?:Rset|RsetId|RsetUnreliable|RsetUnreliableId)\s*\(/g, "Rset is gone in Godot 4: call an [Rpc] method that sets the value");
    at(/\b(?:RpcUnreliable|RpcUnreliableId)\s*\(/g, "RpcUnreliable is gone in Godot 4: mark the method [Rpc(TransferMode = MultiplayerPeer.TransferModeEnum.Unreliable)] and call Rpc()");
    at(/\bGetTree\s*\(\s*\)\s*\.\s*(?:SetNetworkPeer|HasNetworkPeer|IsNetworkServer|RefuseNewNetworkConnections)\b/g, "the SceneTree's multiplayer API is on Multiplayer in Godot 4");
    for (const [cls, set] of this.ctx.signals) {
      for (const s of set) {
        // A Godot 3 signal delegate used as a type somewhere else: its name is s + EventHandler now.
        const re = new RegExp(`(?<![\\w.])${s}\\b(?!\\s*(?:EventHandler|\\())`, "g");
        for (const m of code.matchAll(re)) {
          const ctxBefore = code.slice(Math.max(0, m.index - 12), m.index);
          if (/SignalName\.\s*$|nameof\s*\(\s*$/.test(ctxBefore)) continue;
          if (/\bdelegate\s+void\s+$/.test(ctxBefore)) continue;
          if (this.ctx.classes.get(cls) && code.slice(m.index - 1, m.index) === ".") continue;
          this.todo(m.index, `${s} was ${cls}'s signal delegate; in Godot 4 the delegate is ${s}EventHandler and ${s} is its event (SignalName.${s} is its name)`);
        }
      }
    }
  }
}

function bare(type: string): string {
  return type.replace(/<.*$/, "").split(".").pop()!.trim();
}

/** Migrates one Godot 3 C# file; `ctx` describes the whole project (from csharpProjectContext). */
export function migrateCSharp(source: string, api: GodotApi, ctx: CSharpProjectContext = csharpProjectContext([source])): ScriptMigration {
  return new CSharpMigrator(api, ctx, source).migrate();
}

/**
 * Upgrades a .csproj as Godot 4.7's editor does when it opens a Godot 3 project: an old-style project (no Sdk) is
 * generated again, the Sdk becomes Godot.NET.Sdk/4.7.2, and a TargetFramework below net8.0 becomes net8.0.
 */
export function migrateCsproj(text: string, name: string): ScriptMigration {
  const changes: Change[] = [];
  const left: Leftover[] = [];
  const sdk = /<Project\b[^>]*\bSdk="([^"]*)"/.exec(text);
  if (!sdk) {
    const code = csprojText(name);
    changes.push({ line: 1, rule: "csproj", from: "an old-style .csproj (no Sdk)", to: `a new ${GODOT_NET_SDK} project, as Godot generates it` });
    left.push({ line: 1, message: "the old .csproj was replaced as Godot replaces it: add back any NuGet packages or references it had" });
    return { code, changes, left };
  }
  let code = text;
  const lineOf = (offset: number) => code.slice(0, offset).split("\n").length;
  if (!/^Godot\.NET\.Sdk\//i.test(sdk[1]!) || sdk[1] !== GODOT_NET_SDK) {
    if (/^Godot\.NET\.Sdk\//i.test(sdk[1]!)) {
      const at = sdk.index + sdk[0].indexOf(sdk[1]!);
      changes.push({ line: lineOf(at), rule: "csproj", from: sdk[1]!, to: GODOT_NET_SDK });
      code = code.slice(0, at) + GODOT_NET_SDK + code.slice(at + sdk[1]!.length);
    } else left.push({ line: lineOf(sdk.index), message: `the project's Sdk is ${sdk[1]}, not Godot.NET.Sdk: Godot 4 builds a project with Sdk="${GODOT_NET_SDK}"` });
  }
  // The TargetFramework without a condition (Godot looks at that one), when it is older than net8.0.
  const tfm = /<TargetFramework>\s*([^<\s]+)\s*<\/TargetFramework>/.exec(code);
  const old = (v: string) => /^net(4\d{1,2}|standard[\d.]+|coreapp[\d.]+|[5-7]\.0)$/i.test(v);
  if (tfm && old(tfm[1]!)) {
    const at = tfm.index + tfm[0].indexOf(tfm[1]!);
    changes.push({ line: lineOf(at), rule: "csproj", from: tfm[1]!, to: DOTNET_TARGET_FRAMEWORK });
    code = code.slice(0, at) + DOTNET_TARGET_FRAMEWORK + code.slice(at + tfm[1]!.length);
  } else if (!tfm) {
    const group = /<PropertyGroup>\s*\n?/.exec(code);
    if (group) {
      const at = group.index + group[0].length;
      code = `${code.slice(0, at)}    <TargetFramework>${DOTNET_TARGET_FRAMEWORK}</TargetFramework>\n${code.slice(at)}`;
      changes.push({ line: lineOf(at), rule: "csproj", from: "(no TargetFramework)", to: DOTNET_TARGET_FRAMEWORK });
    }
  }
  return { code, changes, left };
}

/** The old solution configurations, renamed as Godot's DotNetSolution.MigrateFromOldConfigNames does. */
export function migrateSln(text: string): ScriptMigration {
  if (!text.includes("Tools|Any CPU")) return { code: text, changes: [], left: [] };
  const map: Record<string, string> = { "Debug|Any CPU": "Debug|Any CPU", "Release|Any CPU": "ExportDebug|Any CPU", "Tools|Any CPU": "ExportRelease|Any CPU" };
  const changes: Change[] = [];
  const lines = text.split("\n").map((line, i) => {
    const out = line.replace(/Debug\|Any CPU|Release\|Any CPU|Tools\|Any CPU/g, (m) => map[m]!);
    if (out !== line) changes.push({ line: i + 1, rule: "sln", from: line.trim(), to: out.trim() });
    return out;
  });
  return { code: lines.join("\n"), changes, left: [] };
}
