import type { GodotApi } from "../api/api.js";
import { allClasses, maskCSharp, outlineCSharp, snakeToPascal, type CsClass } from "../godot/csharp.js";
import { CSHARP_CLASS_NAMES } from "./csharp-names.js";
import type { Change, Leftover, ScriptMigration } from "./migrate.js";

/**
 * Godot 3 C# to Godot 4 C#, where the change is mechanical and certain; what is not is listed as a TO DO with its
 * line, as for GDScript. It works on the text, with strings and comments masked (src/godot/csharp.ts), and needs no
 * compiler. The class, method, property and signal renames come from Godot's own 3-to-4 table (the same one the
 * GDScript migration uses, bundled from editor/project_upgrade/renames_map_3_to_4.cpp), with the snake_case names
 * turned into the C# names of both versions.
 */

/** What the migration of one file must know of the rest of the project. */
export interface CSharpMigrationContext {
  /** Classes the project declares: a Godot 3 class name that is also the project's is left alone. */
  classes: Set<string>;
  /** Methods the project declares, for the same reason. */
  methods: Set<string>;
  /** Lower-case members the project declares (`x`, `position`): then `.x` may be the project's, and is not rewritten. */
  lowerMembers: Set<string>;
  /** [Signal] names by declaring class, without EventHandler. */
  signals: Map<string, Set<string>>;
  /** Base class by class. */
  bases: Map<string, string>;
  /** The declared type of each member, by class: `spatialPosition` of Transform25D is a Vector3. */
  memberTypes: Map<string, Map<string, string>>;
}

export function csharpMigrationContext(sources: Iterable<string>): CSharpMigrationContext {
  const ctx: CSharpMigrationContext = { classes: new Set(), methods: new Set(), lowerMembers: new Set(), signals: new Map(), bases: new Map(), memberTypes: new Map() };
  for (const source of sources) {
    let classes: CsClass[];
    try {
      classes = allClasses(outlineCSharp(source));
    } catch {
      continue;
    }
    for (const c of classes) {
      ctx.classes.add(c.name);
      if (c.base) ctx.bases.set(c.name, c.base.replace(/<[\s\S]*$/, "").replace(/^.*\./, ""));
      for (const m of c.methods) ctx.methods.add(m.name);
      for (const m of c.members) if (/^[a-z]/.test(m.name)) ctx.lowerMembers.add(m.name);
      const types = ctx.memberTypes.get(c.name) ?? new Map<string, string>();
      for (const m of [...c.members, ...c.exports]) types.set(m.name, m.type.replace(/<[\s\S]*$/, "").replace(/^.*\./, "").replace(/\?$/, ""));
      ctx.memberTypes.set(c.name, types);
      if (c.signals.length) ctx.signals.set(c.name, new Set([...(ctx.signals.get(c.name) ?? []), ...c.signals.map((s) => s.name)]));
    }
  }
  return ctx;
}

/** The Godot 3 C# name of an engine member: `deg2rad` was Deg2Rad, `is_network_server` IsNetworkServer. */
export function godot3CSharpName(snake: string): string {
  const lead = /^_*/.exec(snake)![0];
  return (
    lead +
    snake
      .slice(lead.length)
      .split("_")
      .filter(Boolean)
      .map((part) => part[0]!.toUpperCase() + part.slice(1).replace(/(\d)([a-z])/g, (_m, d: string, c: string) => d + c.toUpperCase()))
      .join("")
  );
}

/** Members of OS, Engine and JSON that moved, one to one. The value is the whole replacement for `Class.Member`; `call` keeps the argument list. */
const MOVED: Record<string, { to: string; call: boolean }> = {
  "OS.GetTicksMsec": { to: "Time.GetTicksMsec", call: true },
  "OS.GetTicksUsec": { to: "Time.GetTicksUsec", call: true },
  "OS.GetDatetime": { to: "Time.GetDatetimeDictFromSystem", call: true },
  "OS.GetDate": { to: "Time.GetDateDictFromSystem", call: true },
  "OS.GetTime": { to: "Time.GetTimeDictFromSystem", call: true },
  "OS.GetScreenSize": { to: "DisplayServer.ScreenGetSize", call: true },
  "OS.SetWindowTitle": { to: "DisplayServer.WindowSetTitle", call: true },
  "OS.GetClipboard": { to: "DisplayServer.ClipboardGet", call: true },
  "OS.SetClipboard": { to: "DisplayServer.ClipboardSet", call: true },
  "OS.HasTouchscreenUiHint": { to: "DisplayServer.IsTouchscreenAvailable", call: true },
  "OS.GetScreenCount": { to: "DisplayServer.GetScreenCount", call: true },
  "OS.GetScreenDpi": { to: "DisplayServer.ScreenGetDpi", call: true },
  "JSON.Print": { to: "Json.Stringify", call: true },
  "Engine.EditorHint": { to: "Engine.IsEditorHint()", call: false },
};

/** Members that moved without a one-to-one form: named in a TO DO. */
const MOVED_TODO: Record<string, string> = {
  "OS.WindowFullscreen": "DisplayServer.WindowSetMode(DisplayServer.WindowMode.Fullscreen) / WindowGetMode()",
  "OS.WindowSize": "DisplayServer.WindowGetSize() / WindowSetSize(), or GetWindow().Size",
  "OS.WindowPosition": "GetWindow().Position",
  "OS.WindowBorderless": "GetWindow().Borderless",
  "OS.WindowMaximized": "DisplayServer.WindowSetMode(DisplayServer.WindowMode.Maximized)",
  "OS.WindowMinimized": "DisplayServer.WindowSetMode(DisplayServer.WindowMode.Minimized)",
  "OS.WindowResizable": "GetWindow().Unresizable (the meaning is reversed)",
  "OS.VsyncEnabled": "DisplayServer.WindowSetVsyncMode()",
  "OS.GetUnixTime": "Time.GetUnixTimeFromSystem(), which returns a double (it was a ulong)",
  "OS.GetSystemTimeMsecs": "(ulong)(Time.GetUnixTimeFromSystem() * 1000)",
  "OS.GetWindowSafeArea": "DisplayServer.GetDisplaySafeArea()",
  "OS.KeepScreenOn": "DisplayServer.ScreenSetKeepOn()",
  "JSON.Parse": "Json.ParseString(text) (null on error), or new Json().Parse(text) with Data and GetErrorMessage()",
};

/** RPC attributes, as the GDScript migration maps the keywords. */
const RPC_ATTRIBUTES: Record<string, string | undefined> = {
  Remote: "Rpc(MultiplayerApi.RpcMode.AnyPeer)",
  RemoteSync: "Rpc(MultiplayerApi.RpcMode.AnyPeer, CallLocal = true)",
  Sync: "Rpc(MultiplayerApi.RpcMode.AnyPeer, CallLocal = true)",
  Puppet: "Rpc",
  Slave: "Rpc",
  PuppetSync: "Rpc(CallLocal = true)",
  Master: undefined,
  MasterSync: undefined,
};

/** SceneTree members and signals that live on the MultiplayerApi in Godot 4 (`Multiplayer` on a Node). */
const TREE_MULTIPLAYER: Record<string, string> = {
  IsNetworkServer: "IsServer",
  GetNetworkUniqueId: "GetUniqueId",
  GetRpcSenderId: "GetRemoteSenderId",
  GetNetworkConnectedPeers: "GetPeers",
  HasNetworkPeer: "HasMultiplayerPeer",
  NetworkPeer: "MultiplayerPeer",
};
const TREE_SIGNALS: Record<string, string> = {
  network_peer_connected: "peer_connected",
  network_peer_disconnected: "peer_disconnected",
  connected_to_server: "connected_to_server",
  connection_failed: "connection_failed",
  server_disconnected: "server_disconnected",
};

/** Renamed methods that Godot's table lists only for C# (its csharp_function_renames, which the bundled data does not carry). */
const EXTRA_FUNCTIONS: Record<string, string> = { GetPositionInParent: "GetIndex" };

/** Godot 3 names the rename table changes for GDScript but that the C# API of Godot 4 still has (GD.RandRange). */
const KEPT_IN_CSHARP = new Set(["RandRange"]);

/**
 * Members renamed on one class only, where the same name is still right on others, so the table cannot be applied by
 * name. Rewritten where the receiver is a variable this file declares with that type; else named in a TO DO.
 */
const TYPED_RENAMES: Record<string, Record<string, string>> = {
  PathFollow2D: { Offset: "Progress", UnitOffset: "ProgressRatio" },
  PathFollow3D: { Offset: "Progress", UnitOffset: "ProgressRatio" },
  AnimatedSprite2D: { Frames: "SpriteFrames" },
  AnimatedSprite3D: { Frames: "SpriteFrames" },
};

/** Members that are gone from one class, with what to write instead. */
const TYPED_TODO: Record<string, Record<string, string>> = {
  AnimatedSprite2D: { Playing: "AnimatedSprite2D.Playing is gone in Godot 4: IsPlaying() reads it, Play() and Stop() set it" },
  AnimatedSprite3D: { Playing: "AnimatedSprite3D.Playing is gone in Godot 4: IsPlaying() reads it, Play() and Stop() set it" },
  ENetMultiplayerPeer: { CompressionMode: "ENetMultiplayerPeer.CompressionMode is gone in Godot 4: after CreateServer or CreateClient, call peer.Host.Compress(ENetConnection.CompressionMode.RangeCoder)" },
};

/** Fields of Godot's structs, lower-case in Godot 3 and PascalCase in Godot 4. */
const STRUCT_FIELDS = ["x", "y", "z", "w", "r", "g", "b", "a", "origin", "basis", "position", "size", "end", "normal"];

const GODOT_STRUCTS = new Set(["Vector2", "Vector3", "Vector4", "Vector2I", "Vector3I", "Vector4I", "Color", "Rect2", "Rect2I", "Transform2D", "Transform3D", "Transform", "Basis", "Quaternion", "Quat", "Plane", "Aabb", "AABB", "Projection"]);

/** [Export] hints that changed. */
const HINTS: Record<string, string> = {
  Layers2dRender: "Layers2DRender",
  Layers2dPhysics: "Layers2DPhysics",
  Layers3dRender: "Layers3DRender",
  Layers3dPhysics: "Layers3DPhysics",
};

/** Whether the name at [start, end) stands where a type does: a declaration, a base class, a cast, `new`, a type argument, a static member. */
function typePosition(code: string, start: number, end: number): boolean {
  const before = code.slice(Math.max(0, start - 24), start);
  const after = code.slice(end, end + 24);
  if (/^\s+[A-Za-z_@]/.test(after) && !/^\s+(is|as|in|and|or)\b/.test(after)) return true;
  if (/^\s*(\.|\[|\?|>|<)/.test(after)) return true;
  if (/(\bnew|\bis|\bas|:|<|\btypeof\s*\(|\bnameof\s*\(|\bdefault\s*\()\s*$/.test(before)) return true;
  if (/\(\s*$/.test(before) && /^\s*\)\s*[\w(@"]/.test(after)) return true;
  if (/,\s*$/.test(before) && /^\s*>/.test(after)) return true;
  return false;
}

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
  private readonly godot4 = new Set<string>();
  private readonly functions = new Map<string, string>();
  private readonly properties = new Map<string, string>();
  private readonly classes = new Map<string, string>();

  constructor(
    private readonly api: GodotApi,
    source: string,
    private readonly ctx: CSharpMigrationContext,
  ) {
    this.source = source;
    for (const cls of api.classes.values()) for (const list of [cls.methods, cls.members, cls.signals, cls.constants]) for (const item of list ?? []) this.godot4.add(item.name);
    const r = api.data.renames;
    for (const [from, to] of Object.entries(r.functions ?? {})) {
      const old = godot3CSharpName(from);
      const now = snakeToPascal(to);
      // A name Godot 4 still has (on some class) may be meant as it is.
      if (old !== now && !this.godot4.has(from) && !ctx.methods.has(old) && !KEPT_IN_CSHARP.has(old)) this.functions.set(old, now);
    }
    for (const [old, now] of Object.entries(EXTRA_FUNCTIONS)) if (!ctx.methods.has(old)) this.functions.set(old, now);
    for (const [from, to] of Object.entries(r.properties ?? {})) {
      const old = godot3CSharpName(from);
      const now = snakeToPascal(to);
      if (old !== now && !this.godot4.has(from)) this.properties.set(old, now);
    }
    const csharp = (name: string) => CSHARP_CLASS_NAMES[name] ?? name;
    for (const [from, to] of Object.entries({ ...r.builtinTypes, ...r.classes })) {
      // Pool*Array were plain arrays in C#; only real types are renamed.
      if (/^Pool\w+Array$/.test(from)) continue;
      if (!api.classes.has(from) && !ctx.classes.has(from)) this.classes.set(from, csharp(to));
    }
    // Godot 3 C# used the engine's spelling for classes whose Godot 4 C# name writes the acronym as a word.
    for (const [engine, name] of Object.entries(CSHARP_CLASS_NAMES)) if (!ctx.classes.has(engine) && !this.classes.has(engine)) this.classes.set(engine, name);
  }

  private lineOf(offset: number): number {
    let line = 1;
    for (let i = 0; i < offset && i < this.source.length; i++) if (this.source.charCodeAt(i) === 10) line++;
    return line;
  }

  private todo(offset: number, message: string): void {
    const line = this.lineOf(offset);
    if (!this.left.some((l) => l.line === line && l.message === message)) this.left.push({ line, message });
  }

  /** Applies edits (offsets in the current source), from the end, and records them. */
  private apply(edits: Edit[]): void {
    const sorted = edits.filter((e) => this.source.slice(e.start, e.end) !== e.text).sort((a, b) => a.start - b.start);
    const kept: Edit[] = [];
    let last = -1;
    for (const e of sorted) {
      if (e.start < last) continue;
      kept.push(e);
      last = e.end;
    }
    for (const e of kept) this.changes.push({ line: this.lineOf(e.start), rule: e.rule, from: this.source.slice(e.start, e.end), to: e.text });
    for (const e of kept.reverse()) this.source = this.source.slice(0, e.start) + e.text + this.source.slice(e.end);
  }

  /** Every match of `re` in the code (strings and comments masked); `fn` gives the replacement, or undefined to keep it. */
  private pass(rule: string, re: RegExp, fn: (m: RegExpExecArray, code: string) => string | undefined): void {
    const code = maskCSharp(this.source).code;
    const edits: Edit[] = [];
    re.lastIndex = 0;
    for (let m = re.exec(code); m; m = re.exec(code)) {
      if (m[0] === "") re.lastIndex++;
      const text = fn(m, code);
      if (text !== undefined) edits.push({ start: m.index, end: m.index + m[0].length, text, rule });
    }
    this.apply(edits);
  }

  /** The arguments of the call whose `(` is at `open`: their offsets in the source, and the offset of the `)`. */
  private args(code: string, open: number): { list: { start: number; end: number }[]; close: number } | undefined {
    const list: { start: number; end: number }[] = [];
    let depth = 0;
    let start = open + 1;
    for (let i = open; i < code.length; i++) {
      const ch = code[i]!;
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") {
        depth--;
        if (depth === 0) {
          if (code.slice(start, i).trim() || list.length) list.push({ start, end: i });
          return { list, close: i };
        }
      } else if (ch === "," && depth === 1) {
        list.push({ start, end: i });
        start = i + 1;
      } else if (ch === ";" && depth <= 1) return undefined;
    }
    return undefined;
  }

  migrate(): ScriptMigration {
    const first = maskCSharp(this.source).code;
    // Not a Godot script: nothing here is Godot's API.
    if (!/\busing\s+Godot\b/.test(first) && !/\bGodot\s*\./.test(first)) return { code: this.source, changes: [], left: [] };
    this.partialClasses();
    this.signals();
    this.multiplayer();
    this.connects();
    this.callbacks();
    this.moved();
    this.attributes();
    this.renames();
    this.typedMembers();
    this.stringNames();
    this.variants();
    this.structFields();
    this.moveAndCollide();
    this.textures();
    this.leftovers();
    this.changes.sort((a, b) => a.line - b.line);
    this.left.sort((a, b) => a.line - b.line);
    return { code: this.source, changes: this.changes, left: this.left };
  }

  /** Godot 4's source generators need every class that derives from a Godot class, and the classes around it, to be partial. */
  private partialClasses(): void {
    const outline = outlineCSharp(this.source);
    const code = maskCSharp(this.source).code;
    const edits: Edit[] = [];
    const visit = (c: CsClass, outer: CsClass[]): boolean => {
      let needs = c.kind === "class" && c.base !== undefined && !c.static;
      for (const n of c.nested) if (visit(n, [...outer, c])) needs = true;
      if (needs && !c.partial && (c.kind === "class" || c.kind === "struct")) {
        const at = new RegExp(`\\b${c.kind}\\s+${c.name}\\b`, "g");
        at.lastIndex = c.range.start;
        const m = at.exec(code);
        if (m && m.index <= c.range.end) edits.push({ start: m.index, end: m.index, text: "partial ", rule: "partial" });
      }
      return needs;
    };
    for (const c of outline.classes) visit(c, []);
    // An insertion has no old text to compare: apply by hand.
    for (const e of edits.sort((a, b) => b.start - a.start)) {
      this.changes.push({ line: this.lineOf(e.start), rule: e.rule, from: "class", to: "partial class" });
      this.source = this.source.slice(0, e.start) + e.text + this.source.slice(e.start);
    }
  }

  /** `[Signal] delegate void Hit()` is HitEventHandler, and the signal is named SignalName.Hit. */
  private signals(): void {
    const outline = outlineCSharp(this.source);
    const own = new Set<string>();
    const renamed = new Set<string>();
    const classes = allClasses(outline);
    for (const c of classes) {
      for (const s of c.signals) {
        own.add(s.name);
        if (!s.delegate.endsWith("EventHandler")) renamed.add(s.delegate);
      }
    }
    if (renamed.size) {
      this.pass("signal", /\bdelegate\s+void\s+(\w+)(?=\s*\()/g, (m) => (renamed.has(m[1]!) ? `${m[0]}EventHandler` : undefined));
    }
    // Signals this file's classes inherit from the project's classes.
    const inherited = new Set<string>();
    for (const c of classes) {
      let base = c.base?.replace(/<[\s\S]*$/, "").replace(/^.*\./, "");
      for (let depth = 0; base && depth < 16; depth++) {
        for (const s of this.ctx.signals.get(base) ?? []) inherited.add(s);
        base = this.ctx.bases.get(base);
      }
    }
    const known = (name: string) => own.has(name) || inherited.has(name);
    // nameof(Hit) named the delegate, which is now HitEventHandler.
    this.pass("signal", /\bnameof\s*\(\s*(?:(\w+)\s*\.\s*)?(\w+)\s*\)/g, (m) => {
      const [, owner, name] = m;
      if (owner) return this.ctx.signals.get(owner)?.has(name!) ? `${owner}.SignalName.${name}` : undefined;
      if (known(name!)) return `SignalName.${name}`;
      if ([...this.ctx.signals.values()].some((set) => set.has(name!)) && !this.ctx.methods.has(name!)) {
        this.todo(m.index, `nameof(${name}) names a [Signal] of another class, whose delegate is now ${name}EventHandler: write TheClass.SignalName.${name}`);
      }
      return undefined;
    });
    // EmitSignal("Hit") of a signal declared here.
    const masked = maskCSharp(this.source);
    const edits: Edit[] = [];
    const call = /\b(EmitSignal|ToSignal)\s*\(/g;
    for (let m = call.exec(masked.code); m; m = call.exec(masked.code)) {
      const args = this.args(masked.code, m.index + m[0].length - 1);
      const arg = args?.list[m[1] === "ToSignal" ? 1 : 0];
      if (!arg) continue;
      const text = this.source.slice(arg.start, arg.end).trim();
      const literal = /^"(\w+)"$/.exec(text);
      // ToSignal(x, "Sig") waits for a signal of x, which may be another class: only EmitSignal is this class for sure.
      if (literal && m[1] === "EmitSignal" && known(literal[1]!)) {
        const at = this.source.indexOf(text, arg.start);
        edits.push({ start: at, end: at + text.length, text: `SignalName.${literal[1]}`, rule: "signal" });
      }
    }
    this.apply(edits);
  }

  /** Connect("sig", target, nameof(M)) takes a Callable in Godot 4. */
  private connects(): void {
    const masked = maskCSharp(this.source);
    const code = masked.code;
    const edits: Edit[] = [];
    const call = /\b(Connect|Disconnect|IsConnected)\s*\(/g;
    for (let m = call.exec(code); m; m = call.exec(code)) {
      const open = m.index + m[0].length - 1;
      const args = this.args(code, open);
      if (!args || args.list.length < 3) continue;
      const text = (i: number) => this.source.slice(args.list[i]!.start, args.list[i]!.end).trim();
      const method = text(2);
      // The Godot 3 form: a target object, then the method by name.
      if (!/^(nameof\s*\(|@?"|\$")/.test(method)) continue;
      let extra = "";
      if (m[1] === "Connect" && args.list.length >= 4) {
        const binds = text(3).replace(/\s+/g, "");
        if (!/^(null|new(Godot\.Collections\.)?Array\(\)|new(Godot\.Collections\.)?Array\{\})$/.test(binds)) {
          this.todo(m.index, "Connect with bound arguments: Godot 4 takes a Callable; bind the arguments in a lambda (Callable.From(() => Method(args))) or with new Callable(target, name).Bind(args)");
          continue;
        }
        if (args.list.length >= 5) extra = `, (uint)(${text(4)})`;
      } else if (args.list.length > 3) continue;
      let signal = text(0);
      const named = /^"(\w+)"$/.exec(signal);
      const renamedSignal = named ? this.api.data.renames.signals?.[named[1]!] : undefined;
      if (named && renamedSignal && !this.godot4.has(named[1]!)) signal = `"${renamedSignal}"`;
      edits.push({ start: open + 1, end: args.close, text: `${signal}, new Callable(${text(1)}, ${method})${extra}`, rule: "connect" });
    }
    this.apply(edits);
  }

  /** `_Process(float delta)` takes a double in Godot 4; the body keeps computing in float. */
  private callbacks(): void {
    const outline = outlineCSharp(this.source);
    const code = maskCSharp(this.source).code;
    const edits: Edit[] = [];
    for (const c of allClasses(outline)) {
      for (const method of c.methods) {
        if (!method.override || !/^_(Process|PhysicsProcess)$/.test(method.name) || method.params.length !== 1 || method.params[0]!.type === "double") continue;
        const name = method.params[0]!.name;
        // float, or an alias of it (`using real_t = System.Single;`): the body keeps computing in that type.
        const type = method.params[0]!.type;
        if (!/^[A-Za-z_]\w*$/.test(type)) continue;
        const header = new RegExp(`\\b${method.name}\\s*\\(\\s*${type}(\\s+${name}\\s*\\))`, "g");
        const from = this.source.split("\n").slice(0, method.line - 1).join("\n").length;
        header.lastIndex = Math.max(0, from - 1);
        const m = header.exec(code);
        if (!m) continue;
        const at = m.index + m[0].indexOf(type, method.name.length);
        edits.push({ start: at, end: at + type.length, text: "double", rule: "callback" });
        if (!method.body) continue;
        const use = new RegExp(`(?<![\\w.@])${name}(?!\\w)`, "g");
        use.lastIndex = method.body.start;
        for (let u = use.exec(code); u && u.index < method.body.end; u = use.exec(code)) {
          // Already cast, or passed on to the base class, which takes the double.
          const before = code.slice(Math.max(0, u.index - 12), u.index);
          // Assigned to (`delta /= 2`): the variable itself, not its value.
          if (/^\s*(?:[+\-*/%]?=(?!=)|\+\+|--)/.test(code.slice(u.index + name.length)) || /(\+\+|--)\s*$/.test(before)) continue;
          if (/\(\s*\w+\s*\)\s*$/.test(before) || /base\s*\.\s*_\w+\s*\(\s*$/.test(code.slice(Math.max(0, u.index - 40), u.index))) continue;
          edits.push({ start: u.index, end: u.index + name.length, text: `(${type})${name}`, rule: "callback" });
        }
      }
    }
    this.apply(edits);
  }

  /** The networking members of SceneTree are on the MultiplayerApi: `Multiplayer` on a node. */
  private multiplayer(): void {
    this.pass("multiplayer", /\bGetTree\s*\(\s*\)\s*\.\s*(IsNetworkServer|GetNetworkUniqueId|GetRpcSenderId|GetNetworkConnectedPeers|HasNetworkPeer|NetworkPeer)\b/g, (m) => `Multiplayer.${TREE_MULTIPLAYER[m[1]!]}`);
    // GetTree().Connect("network_peer_connected", ...): the signal is the MultiplayerApi's.
    const masked = maskCSharp(this.source);
    const edits: Edit[] = [];
    const call = /\bGetTree\s*\(\s*\)\s*\.\s*(?:Connect|Disconnect|IsConnected)\s*\(\s*(?=")/g;
    for (let m = call.exec(masked.code); m; m = call.exec(masked.code)) {
      const literal = masked.literals.get(m.index + m[0].length);
      const to = literal ? TREE_SIGNALS[literal.value] : undefined;
      if (!literal || to === undefined) continue;
      edits.push({ start: m.index, end: m.index + m[0].indexOf("."), text: "Multiplayer", rule: "multiplayer" });
      edits.push({ start: literal.start, end: literal.end + 1, text: `"${to}"`, rule: "multiplayer" });
    }
    this.apply(edits);
    this.pass("multiplayer", /\bIsNetworkMaster\s*\(/g, () => "IsMultiplayerAuthority(");
    this.pass("multiplayer", /\bSetNetworkMaster\s*\(/g, () => "SetMultiplayerAuthority(");
    this.pass("multiplayer", /\bGetNetworkMaster\s*\(/g, () => "GetMultiplayerAuthority(");
  }

  private moved(): void {
    this.pass("moved", /(?<![\w.])(OS|Engine|JSON)\s*\.\s*(\w+)\b(\s*\()?/g, (m) => {
      const key = `${m[1]}.${m[2]}`;
      const to = MOVED[key];
      if (to) return to.call ? `${to.to}${m[3] ?? ""}` : m[3] ? undefined : to.to;
      const todo = MOVED_TODO[key];
      if (todo) this.todo(m.index, `${key} is gone in Godot 4: use ${todo}`);
      return undefined;
    });
  }

  private attributes(): void {
    this.pass("rpc", /\[\s*(Remote|RemoteSync|Sync|Puppet|Slave|PuppetSync|Master|MasterSync)\s*\]/g, (m) => {
      const to = RPC_ATTRIBUTES[m[1]!];
      if (to === undefined) this.todo(m.index, `[${m[1]}] is gone in Godot 4: use [Rpc] and check IsMultiplayerAuthority() in the method`);
      return to === undefined ? undefined : `[${to}]`;
    });
    this.pass("export", /\bPropertyHint\s*\.\s*(Layers2dRender|Layers2dPhysics|Layers3dRender|Layers3dPhysics)\b/g, (m) => `PropertyHint.${HINTS[m[1]!]}`);
    // ExpRange is Range with "exp" in the hint string.
    const masked = maskCSharp(this.source);
    const edits: Edit[] = [];
    const exp = /\bPropertyHint\s*\.\s*ExpRange\s*,\s*(?=")/g;
    for (let m = exp.exec(masked.code); m; m = exp.exec(masked.code)) {
      const literal = masked.literals.get(m.index + m[0].length);
      if (!literal) continue;
      const at = m.index + m[0].indexOf("ExpRange");
      edits.push({ start: at, end: at + "ExpRange".length, text: "Range", rule: "export" });
      edits.push({ start: literal.end, end: literal.end, text: ",exp", rule: "export" });
    }
    // Insertions before the closing quote: apply by hand, from the end.
    for (const e of edits.sort((a, b) => b.start - a.start)) {
      if (e.start !== e.end) this.changes.push({ line: this.lineOf(e.start), rule: e.rule, from: "PropertyHint.ExpRange", to: 'PropertyHint.Range with ",exp"' });
      this.source = this.source.slice(0, e.start) + e.text + this.source.slice(e.end);
    }
    this.pass("export", /\bPropertyHint\s*\.\s*Length\b/g, (m) => {
      this.todo(m.index, "PropertyHint.Length is gone in Godot 4: use PropertyHint.Range");
      return undefined;
    });
  }

  private renames(): void {
    this.pass("class", /\bGodot\s*\.\s*Object\b/g, () => "GodotObject");
    const code = maskCSharp(this.source).code;
    // `Object` is Godot's where only Godot is imported (with System too it was ambiguous, and had to be written out).
    if (/\busing\s+Godot\s*;/.test(code) && !/\busing\s+System\s*;/.test(code)) this.pass("class", /(?<![\w.@])Object\b(?!\s*\.\s*(Equals|ReferenceEquals)\b)/g, () => "GodotObject");
    this.pass("rename", /\.\s*Instance\s*\(\s*\)/g, () => ".Instantiate()");
    this.pass("class", /(?<![\w.@])(?:(Godot\s*\.\s*))?([A-Z]\w*)\b/g, (m, masked) => {
      const name = m[2]!;
      const to = this.classes.get(name);
      if (!to) return undefined;
      // `Area = 3`, `Print(Area)`: a member of that name, not the class. Only where a type can stand.
      return m[1] || typePosition(masked, m.index, m.index + m[0].length) ? `${m[1] ?? ""}${to}` : undefined;
    });
    this.pass("rename", /(?<=\.\s*|(?<![\w.@]))([A-Z_]\w*)(?=\s*(<[^<>()]*>)?\s*\()/g, (m) => this.functions.get(m[1]!));
    this.pass("rename", /(?<=\.\s*)([A-Z]\w*)\b(?!\s*[(<])/g, (m) => this.properties.get(m[1]!));
    // A property of the class itself, written without `this.`: only where it is read or assigned (a type of that name
    // is followed by a name), and not a member this file declares.
    const declared = new Set(allClasses(outlineCSharp(this.source)).flatMap((c) => [...c.members.map((x) => x.name), ...c.methods.map((x) => x.name)]));
    this.pass("rename", /(?<![\w.@])([A-Z]\w*)\b(?=\s*(?:[+\-*/%]?=(?!=)|\.|;|\)|,|[+\-*/]))/g, (m, masked) => {
      const to = this.properties.get(m[1]!);
      if (!to || declared.has(m[1]!) || this.ctx.classes.has(m[1]!)) return undefined;
      // `new Translation()`, `Translation.Something` on the Godot 4 class of that name, a declaration or a type argument.
      if (/(\bnew|<|:|\bas|\bis)\s*$/.test(masked.slice(Math.max(0, m.index - 8), m.index))) return undefined;
      return to;
    });
    this.pass("rename", /(?<![\w.])(KeyList|ButtonList)\s*\./g, (m) => (m[1] === "KeyList" ? "Key." : "MouseButton."));
  }

  /** The type a variable of this file was declared with: `PathFollow2D x`, `x = GetNode<PathFollow2D>(...)`, `x = new PathFollow2D()`. */
  private declaredType(code: string, name: string): string | undefined {
    const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Also a qualified type (Godot.Collections.Dictionary x) and a generic one (Dictionary<string, int> x): the last name counts.
    const typed = new RegExp(`(?<![\\w.])(?:[A-Za-z_]\\w*\\s*\\.\\s*)*([A-Z]\\w*)(?:\\s*<[^;(){}]*>)?\\s+${n}\\s*[=;,)]`).exec(code);
    if (typed) return typed[1];
    const assigned = new RegExp(`(?<![\\w.])${n}\\s*=\\s*(?:\\(\\s*([A-Z]\\w*)\\s*\\)|(?:[\\w.()]*\\.)?GetNode(?:OrNull)?\\s*<\\s*([A-Z]\\w*)\\s*>|new\\s+([A-Z]\\w*)\\b|[^;=]*\\bas\\s+([A-Z]\\w*)\\s*;)`).exec(code);
    return assigned ? (assigned[1] ?? assigned[2] ?? assigned[3] ?? assigned[4]) : undefined;
  }

  /**
   * The type of the value before the `.` that ends at `offset`, where this file says it: a variable or field declared
   * here (declaredType), `value` in a property's setter (the property's type), or a chain `a.b` (the type of member b
   * on the type of a, from the project's own classes).
   */
  private receiverType(code: string, offset: number, depth = 0): string | undefined {
    const before = code.slice(0, offset);
    const dot = /\.\s*$/.exec(before);
    if (!dot || depth > 6) return undefined;
    const head = before.slice(0, dot.index);
    const ident = /([A-Za-z_]\w*)\s*$/.exec(head);
    if (!ident) return undefined;
    const name = ident[1]!;
    const start = head.length - ident[0].length;
    // A chain: a.b.x is the field x of member b of a.
    if (/\.\s*$/.test(head.slice(0, start))) {
      const owner = this.receiverType(code, start, depth + 1);
      return owner ? this.ctx.memberTypes.get(owner)?.get(name) : undefined;
    }
    if (name === "value") {
      // The nearest property header above: `public Vector3 Row0` ... `set { x.x = value.x; }`.
      for (const line of head.split("\n").reverse().slice(0, 40)) {
        const property = /^\s*(?:(?:public|private|protected|internal|static|override|virtual|new)\s+)*([A-Z]\w*)\s+[A-Z]\w*\s*(?:\{|$)/.exec(line);
        if (property) return property[1];
        if (/\(.*\)\s*\{?\s*$/.test(line) && !/\bset\b|\bget\b/.test(line)) break;
      }
      return undefined;
    }
    return this.declaredType(code, name);
  }

  /**
   * MoveAndCollide(motion, infiniteInertia, excludeRaycastShapes, testOnly) in Godot 3 is MoveAndCollide(motion, testOnly)
   * in Godot 4: the two flags that are gone are dropped, and testOnly keeps its value. Only for literal true/false.
   */
  private moveAndCollide(): void {
    const code = maskCSharp(this.source).code;
    const edits: Edit[] = [];
    for (const m of code.matchAll(/(?<![\w])MoveAndCollide\s*\(/g)) {
      const a = this.args(code, m.index + m[0].length - 1);
      if (!a || a.list.length < 2) continue;
      const arg = (i: number) => this.source.slice(a.list[i]!.start, a.list[i]!.end).trim();
      if (!a.list.slice(1).every((_, i) => /^(true|false)$/.test(arg(i + 1)))) continue;
      edits.push({ start: a.list[0]!.start, end: a.close, text: a.list.length >= 4 && arg(3) === "true" ? `${arg(0)}, true` : arg(0), rule: "rename" });
    }
    this.apply(edits);
  }

  /** Godot 3's Texture was the 2D texture: where it is a type (a declaration, a generic argument, a cast) it is Texture2D. */
  private textures(): void {
    if (this.ctx.classes.has("Texture")) return;
    const to = () => "Texture2D";
    this.pass("class", /(?<![\w.])Texture(?=\s+[A-Za-z_@]\w*\s*[;=,)])/g, to);
    this.pass("class", /(?<=<\s*)Texture(?=\s*>)/g, to);
    this.pass("class", /(?<=\(\s*)Texture(?=\s*\)\s*[A-Za-z_(])/g, to);
  }

  /** Members renamed or removed on one class: `follow.Offset` is Progress on a PathFollow2D only. */
  private typedMembers(): void {
    const members = new Set([...Object.values(TYPED_RENAMES), ...Object.values(TYPED_TODO)].flatMap((m) => Object.keys(m)));
    const classes = [...new Set([...Object.keys(TYPED_RENAMES), ...Object.keys(TYPED_TODO)])];
    const code = maskCSharp(this.source).code;
    const mentioned = classes.filter((c) => new RegExp(`\\b${c}\\b`).test(code));
    if (!mentioned.length) return;
    // sprite.Playing = true is sprite.Play(), where the sprite is declared here.
    this.pass("rename", /(?<![\w.])(\w+)(\s*\.\s*)Playing\s*=\s*(true|false)\s*(?=;)/g, (m, masked) => (/^AnimatedSprite[23]D$/.test(this.declaredType(masked, m[1]!) ?? "") ? `${m[1]}${m[2]}${m[3] === "true" ? "Play" : "Stop"}()` : undefined));
    this.pass("rename", new RegExp(`(?<![\\w.])(\\w+)(\\s*\\.\\s*)(${[...members].join("|")})\\b(?!\\s*\\()`, "g"), (m, masked) => {
      const [, receiver, dot, member] = m;
      const type = this.declaredType(masked, receiver!);
      const to = type ? TYPED_RENAMES[type]?.[member!] : undefined;
      if (to) return `${receiver}${dot}${to}`;
      const todo = type ? TYPED_TODO[type]?.[member!] : undefined;
      if (todo) this.todo(m.index, todo);
      else if (!type) {
        // The receiver's type is not declared here: say what it would be on the classes this file uses.
        const maybe = mentioned.flatMap((c) => (TYPED_RENAMES[c]?.[member!] ? [`${c}.${member} is ${TYPED_RENAMES[c]![member!]}`] : TYPED_TODO[c]?.[member!] ? [TYPED_TODO[c]![member!]!] : []));
        if (maybe.length) this.todo(m.index, `${receiver}.${member}: if ${receiver} is one of these, ${maybe.join("; ")}`);
      }
      return undefined;
    });
  }

  /** Godot's untyped Dictionary and Array hold Variant in Godot 4, and so does what Call() returns. */
  private variants(): void {
    const code = maskCSharp(this.source).code;
    const godotCollections = /\busing\s+Godot\s*\.\s*Collections\s*;/.test(code) && !/\busing\s+System\s*\.\s*Collections\s*\.\s*Generic\s*;/.test(code);
    const qualified = /\bGodot\s*\.\s*Collections\s*\.\s*(Dictionary|Array)\b/.test(code);
    if (!godotCollections && !qualified && !/\.\s*Call\s*\(/.test(code)) return;
    // dict.Contains(key) is ContainsKey, where the receiver is declared here as Godot's Dictionary.
    this.pass("rename", /(?<![\w.])(\w+)(\s*\.\s*)Contains(?=\s*\()/g, (m, masked) => {
      const declared = new RegExp(`(?<![\\w.])((?:Godot\\s*\\.\\s*Collections\\s*\\.\\s*)?)Dictionary\\s+${m[1]}\\s*[=;,)]`).exec(masked);
      return declared && (declared[1] || godotCollections) ? `${m[1]}${m[2]}ContainsKey` : undefined;
    });
    const now = maskCSharp(this.source).code;
    const each = (re: RegExp, message: string) => {
      for (let m = re.exec(now); m; m = re.exec(now)) this.todo(m.index, message);
    };
    if (godotCollections || qualified) {
      each(/\bswitch\s*\(\s*\w+\s*\)/g, "if this switches on an element or key of a Godot collection, that is a Variant in Godot 4 and the cases do not compile: cast it first, switch ((string)key)");
      each(/\(\s*(?!string\b|int\b|long\b|float\b|double\b|bool\b|uint\b|ulong\b|short\b|byte\b)[A-Z]\w*\??\s*\)\s*\w+\s*\[/g, "an element of a Godot collection is a Variant in Godot 4: a cast to an enum needs the number first, (TheEnum)(int)element; a Godot object comes out with element.As<T>()");
      each(/\w\s*\[[^\]\n]*\]\s+(?:as|is)\s+[A-Za-z_]/g, "an element of a Godot collection is a Variant in Godot 4: `as` and `is` do not work on it, use element.As<T>() or check element.VariantType");
    }
    each(/\.\s*Call(?:Deferred)?\s*\([^;]*\)\s*as\s+[A-Za-z_]/g, "Call() returns a Variant in Godot 4: `as` does not work on it, use .As<T>() (or .AsBool(), .AsInt32()...)");
  }

  /** Node.Name is a StringName in Godot 4: a string method on it needs ToString() first (which is harmless on a string). */
  private stringNames(): void {
    this.pass("stringname", /(?<![\w@])Name(?=\s*\.\s*(ToLower|ToUpper|Contains|StartsWith|EndsWith|Split|Replace|Substring|Trim|TrimStart|TrimEnd|IndexOf|LastIndexOf|PadLeft|PadRight|Insert|Remove|Length|BeginsWith|Capitalize|IsValidInteger|ToInt|ToFloat)\b)/g, () => "Name.ToString()");
  }

  /** `velocity.x` is `velocity.X` in Godot 4. Left alone (with a TO DO) for a name the project declares itself. */
  private structFields(): void {
    const fields = new RegExp(`(?<=[\\w)\\]>]\\s*\\.\\s*)(${STRUCT_FIELDS.join("|")})\\b(?!\\s*\\()`, "g");
    this.pass("field", fields, (m, code) => {
      const name = m[1]!;
      if (this.ctx.lowerMembers.has(name)) {
        // The project has a member of that name too: only a receiver declared here as a Godot struct is certain.
        const type = this.receiverType(code, m.index);
        if (type && GODOT_STRUCTS.has(type)) return name[0]!.toUpperCase() + name.slice(1);
        this.todo(m.index, `.${name} is .${name[0]!.toUpperCase()}${name.slice(1)} in Godot 4 when this is a Godot struct (Vector2, Vector3, Color, Transform...); the project also has a member "${name}" of its own and the type is not declared in this file, so it was not rewritten`);
        return undefined;
      }
      return name[0]!.toUpperCase() + name.slice(1);
    });
  }

  private leftovers(): void {
    const code = maskCSharp(this.source).code;
    const each = (re: RegExp, message: string | ((m: RegExpExecArray) => string)) => {
      for (let m = re.exec(code); m; m = re.exec(code)) this.todo(m.index, typeof message === "string" ? message : message(m));
    };
    each(/\b(RpcUnreliable|RpcUnreliableId|Rset|RsetId|RsetUnreliable|RsetUnreliableId|RsetConfig|RpcConfig)\s*\(/g, (m) =>
      /^Rset/.test(m[1]!)
        ? `${m[1]}() is gone in Godot 4: properties are synchronised with a MultiplayerSynchronizer, or by an [Rpc] method that sets them`
        : `${m[1]}() is gone in Godot 4: mark the method [Rpc(TransferMode = MultiplayerPeer.TransferModeEnum.Unreliable)] and call Rpc()`,
    );
    each(/\bnew\s+(File|Directory)\s*\(/g, (m) => `new ${m[1]}() is gone in Godot 4: use ${m[1] === "File" ? "FileAccess.Open(path, mode)" : "DirAccess.Open(path)"}`);
    each(/\bGetTree\s*\(\s*\)\s*\.\s*(SetScreenStretch|RefuseNewNetworkConnections|SetAutoAcceptQuit|SetQuitOnGoBack)\b/g, (m) => `SceneTree.${m[1]} is gone in Godot 4: see the Window (GetWindow()) and the project settings`);
    each(/\bJoystickList\s*\./g, "JoystickList is split in Godot 4: JoyButton and JoyAxis");
    each(/(?<![\w])MoveAndSlide\s*\(\s*(?!\))/g, "MoveAndSlide() takes no arguments in Godot 4: set Velocity (and UpDirection) first, call MoveAndSlide(), and read Velocity afterwards");
    each(/(?<![\w])MoveAndSlideWithSnap\s*\(/g, "MoveAndSlideWithSnap() is gone in Godot 4: set Velocity and FloorSnapLength, then call MoveAndSlide()");
    each(/(?<![\w])MoveAndCollide\s*\([^;]*?,\s*(?!true\b|false\b)[^,;)]+,/g, "MoveAndCollide() is (motion, testOnly = false, safeMargin = 0.08f, recoveryAsCollision = false, maxCollisions = 1) in Godot 4: check the arguments");
    // Elements of the untyped collections are Variant now.
    const collection = /\b(?:Godot\s*\.\s*)?Collections\s*\.\s*(Dictionary|Array)\b(?!\s*<)/.exec(code);
    if (collection) {
      this.todo(
        collection.index,
        `Godot.Collections.${collection[1]} holds Variant in Godot 4: \`x as T\`, \`x is T y\` and \`switch\` on an element do not compile (use element.As<T>() or a cast), Dictionary.Contains is ContainsKey, and a C# object that is not a Godot type cannot be stored`,
      );
    }
    each(/\byield\s+return\b|\bGDScriptFunctionState\b/g, "check this coroutine: GDScriptFunctionState is gone in Godot 4 (await ToSignal(...) still works)");
    each(/\bInputEventMouseButton\b[^;]*\.ButtonIndex\s*==\s*\(int\)/g, "ButtonIndex is a MouseButton in Godot 4: compare with MouseButton.Left without the cast");
    each(/\bVisualServer\b|\bPhysics2DServer\b|\bPhysicsServer\b(?!2D|3D)/g, "a server singleton that the rename table did not cover: check its Godot 4 name (RenderingServer, PhysicsServer2D, PhysicsServer3D)");
  }
}

/** Rewrites one C# source from Godot 3 to Godot 4 where that is mechanical, and lists what is left to do by hand. */
export function migrateCSharp(source: string, api: GodotApi, ctx: CSharpMigrationContext = csharpMigrationContext([source])): ScriptMigration {
  return new CSharpMigrator(api, source, ctx).migrate();
}

/**
 * The project file: the Godot 3 SDK and target framework become the ones a new Godot 4 C# project has (see
 * csprojText in src/scaffold/project.ts). A project file that is not in the SDK style (Godot 3.0 to 3.2.2 wrote the
 * long MSBuild form) is left alone, with a TO DO.
 */
export function migrateCsproj(text: string, sdk: string, framework: string): ScriptMigration {
  const changes: Change[] = [];
  const left: Leftover[] = [];
  const lines = text.split("\n");
  const lineOf = (re: RegExp) => Math.max(1, lines.findIndex((l) => re.test(l)) + 1);
  const sdkMatch = /<Project\s+Sdk="Godot\.NET\.Sdk\/([^"]+)"/.exec(text);
  if (!sdkMatch) {
    if (/<Project\b[^>]*ToolsVersion=|<Reference\s+Include="GodotSharp"/.test(text)) {
      left.push({ line: 1, message: `this project file is in the old MSBuild form of Godot 3.0 to 3.2: replace it with an SDK-style one (<Project Sdk="${sdk}"> with <TargetFramework>${framework}</TargetFramework> and <EnableDynamicLoading>true</EnableDynamicLoading>), which Godot 4 makes with Project > Tools > C# > Create C# solution` });
    }
    return { code: text, changes, left };
  }
  if (Number(/^(\d+)/.exec(sdkMatch[1]!)?.[1]) >= 4) return { code: text, changes, left };
  let code = text;
  const replace = (re: RegExp, to: string, rule: string) => {
    const m = re.exec(code);
    if (!m || m[0] === to) return;
    changes.push({ line: lineOf(re), rule, from: m[0], to });
    code = code.replace(re, to);
  };
  replace(/<Project\s+Sdk="Godot\.NET\.Sdk\/[^"]+"/, `<Project Sdk="${sdk}"`, "sdk");
  if (/<TargetFramework>[^<]*<\/TargetFramework>/.test(code)) replace(/<TargetFramework>[^<]*<\/TargetFramework>/, `<TargetFramework>${framework}</TargetFramework>`, "framework");
  else left.push({ line: 1, message: `add <TargetFramework>${framework}</TargetFramework> to the PropertyGroup` });
  if (!/<EnableDynamicLoading>/.test(code)) {
    const m = /^([ \t]*)<TargetFramework>[^<]*<\/TargetFramework>[ \t]*\r?$/m.exec(code);
    if (m) {
      const eol = m[0].endsWith("\r") ? "\r" : "";
      const added = `${m[1]}<EnableDynamicLoading>true</EnableDynamicLoading>`;
      changes.push({ line: lineOf(/<TargetFramework>/), rule: "framework", from: "", to: added.trim() });
      code = code.replace(m[0], `${m[0].replace(/\r$/, "")}${eol}\n${added}${eol}`);
    }
  }
  // Godot 3 needed these for its own build; the Godot 4 SDK brings what it needs.
  for (const m of text.matchAll(/<PackageReference\s+Include="(Microsoft\.NETFramework\.ReferenceAssemblies|Godot\.NET\.Sdk)"[^>]*\/?>/g)) {
    left.push({ line: text.slice(0, m.index).split("\n").length, message: `remove the reference to ${m[1]}: the Godot 4 SDK does not use it` });
  }
  if (/<LangVersion>/.test(code)) left.push({ line: lineOf(/<LangVersion>/), message: `check <LangVersion>: ${framework} has a newer C# than Godot 3's Mono, and Godot 4's generators need C# 10 or later` });
  return { code, changes, left };
}
