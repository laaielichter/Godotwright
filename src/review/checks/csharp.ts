import { allClasses, bareType, CSHARP_CALLBACKS, maskCSharp, scriptClass, snakeToPascal, type CsClass } from "../../godot/csharp.js";
import { csharpClassIndex, resolveClass } from "../../scan/csharp.js";
import { nearest } from "../../api/api.js";
import { withoutSubResource } from "../../project/files.js";
import type { ProjectModel } from "../model.js";
import { finding, type Finding } from "../rules.js";

export interface CSharpCheckOptions {
  /** Actions of the Input Map (and those GDScript adds in code). */
  inputActions: Set<string>;
  /** Only these files are under review. */
  inScope: (file: string) => boolean;
}

/** Callbacks Godot runs every frame or physics tick, in C#. */
const PER_FRAME = new Set(["_Process", "_PhysicsProcess", "_IntegrateForces"]);
const PRINT = /\bGD\s*\.\s*(Print|PrintS|PrintT|PrintRich|PrintErr|PrintRaw)\s*\(/g;
/** The GDScript spelling of each callback: valid C#, but a method Godot never calls. */
const SNAKE_CALLBACKS = new Map(Object.keys(CSHARP_CALLBACKS).map((name) => [name.replace(/(?<=[a-z])([A-Z])/g, "_$1").toLowerCase(), name]));
/** .NET types with the name of a Godot class: `class Ticker : Timer` may be System.Timers.Timer. */
const DOTNET_NAMESAKES = new Set(["Timer", "Thread", "Mutex", "Semaphore", "Object", "Range", "Environment", "Path"]);

/**
 * The review of C# scripts, from the files alone. Few rules, each one certain: what stops `dotnet build`, what stops
 * Godot from finding the script's class, and names that do not exist in the project (node paths, input actions).
 * The compiler has the last word on everything else (`godot_check` runs it when dotnet is installed).
 */
export function checkCSharp(pm: ProjectModel, options: CSharpCheckOptions): Finding[] {
  const out: Finding[] = [];
  const { data, api } = pm;
  if (data.csharp.size === 0) return out;
  const index = csharpClassIndex([...data.csharp.values()].map((c) => c.outline));

  // Where each file is used as a script: scene nodes, resources and autoloads.
  const attachedTo = new Map<string, { scene: string; node: string }[]>();
  const used = new Set<string>();
  for (const scene of data.map.scenes) {
    for (const node of scene.nodes) {
      if (!node.script?.endsWith(".cs")) continue;
      used.add(node.script);
      attachedTo.set(node.script, [...(attachedTo.get(node.script) ?? []), { scene: scene.path, node: node.path }]);
    }
  }
  for (const r of data.map.resources) if (r.script?.endsWith(".cs")) used.add(r.script);
  for (const a of data.map.autoloads) if (a.path.endsWith(".cs")) used.add(a.path);

  // Actions C# adds in code count; when one is added from a variable, any name may be an action.
  const actions = new Set(options.inputActions);
  let actionsKnown = true;
  // Names a child gets at run time: the root of an instanced scene, or a Name set in code.
  const runtimeNames = new Set(data.map.scenes.flatMap((s) => (s.rootName ? [s.rootName] : [])));
  for (const { source } of data.csharp.values()) {
    for (const m of source.matchAll(/\bInputMap\s*\.\s*AddAction\s*\(\s*"([^"]+)"/g)) actions.add(m[1]!);
    if (/\bInputMap\s*\.\s*AddAction\s*\(\s*(?!")\S/.test(source)) actionsKnown = false;
    for (const m of source.matchAll(/\bName\s*=\s*"([^"]+)"/g)) runtimeNames.add(m[1]!);
  }

  for (const [file, { source, outline }] of data.csharp) {
    if (!options.inScope(file)) continue;
    const fileName = file.slice(file.lastIndexOf("/") + 1).replace(/\.cs$/, "");
    const main = scriptClass(outline, file);
    const classes = allClasses(outline);
    const usesGodot = outline.usings.includes("Godot") || /^Godot(\.|$)/.test(outline.namespace ?? "");
    /** The base is Godot's class of that name, not a .NET namesake or an alias. */
    const godotBase = (cls: CsClass): string | undefined => {
      const resolved = resolveClass(cls, index);
      const native = resolved.nativeBase;
      if (!native || !resolved.complete) return undefined;
      const written = resolved.parts.find((p) => p.base && bareType(p.base) === native)?.base ?? native;
      const qualified = /^(global::)?Godot\.\w+$/.test(written.replace(/<.*$/, ""));
      if (!qualified) {
        if (written.includes(".") || !usesGodot || DOTNET_NAMESAKES.has(native)) return undefined;
        if (outline.usings.some((u) => new RegExp(`^${native}\\s*=`).test(u))) return undefined;
      }
      const name = native === "GodotObject" ? "Object" : native;
      return api.getClass(name)?.name === name ? name : undefined;
    };

    // The class Godot looks for has the name of the file.
    if (used.has(file) && !main) {
      const found = outline.classes.filter((c) => c.kind === "class").map((c) => c.name);
      const near = found.find((n) => n.toLowerCase() === fileName.toLowerCase()) ?? found[0];
      out.push(
        finding(
          "api/csharp-class-name",
          file,
          outline.classes.find((c) => c.name === near)?.line,
          `${file} is used as a script, but it has no class named ${fileName}${near ? ` (it declares ${near})` : ""}. Godot finds a C# script's class by the name of its file, so the script does not load: "Cannot find class ${fileName} for script ${file}".`,
        ),
      );
    }

    for (const cls of classes) {
      if (cls.kind !== "class") continue;
      const base = godotBase(cls);

      if (base && !cls.partial && !cls.static) {
        out.push(
          finding("api/csharp-not-partial", file, cls.line, `class ${cls.name} derives from ${base} but is not partial. Godot 4's source generators add to every class that derives from a Godot class, so the build fails with GD0001: write \`public partial class ${cls.name} : ${cls.base ?? base}\`.`),
        );
      }

      for (const s of cls.signals) {
        if (!s.delegate.endsWith("EventHandler")) {
          out.push(finding("api/csharp-signal-name", file, s.line, `[Signal] delegate ${s.delegate} must end with EventHandler (the build fails with GD0201). Name it ${s.delegate}EventHandler: the signal is then ${s.delegate}.`));
        }
      }

      // A base or export type that is a Godot 3 class.
      const direct = cls.base && !index.has(bareType(cls.base)) && usesGodot && !cls.base.includes(".") ? bareType(cls.base) : undefined;
      for (const [type, line, what] of [...(direct ? [[direct, cls.line, `the base class of ${cls.name}`] as const] : []), ...(usesGodot ? cls.exports.map((e) => [bareType(e.type), e.line, `the type of [Export] ${e.name}`] as const) : [])]) {
        if (api.getClass(type) || index.has(type) || DOTNET_NAMESAKES.has(type) || outline.usings.some((u) => new RegExp(`^${type}\\s*=`).test(u))) continue;
        const renamed = api.renamedClass(type);
        if (renamed?.kind === "class") out.push(finding("api/unknown-type", file, line, `${type} (${what}) is a Godot 3 class; it is ${renamed.to} in Godot 4.`));
      }

      if (!base) continue;
      for (const m of cls.methods) {
        const pascal = SNAKE_CALLBACKS.get(m.name);
        if (pascal && m.name !== pascal && !cls.methods.some((o) => o.name === pascal)) {
          out.push(finding("api/csharp-callback", file, m.line, `${m.name}() is GDScript's name; in C# Godot calls ${snakeToPascal(m.name)}: write \`public override void ${pascal}(${callbackParams(pascal)})\`.`));
          continue;
        }
        const expected = CSHARP_CALLBACKS[m.name];
        if (!expected || m.static) continue;
        // An overload next to the real override is the author's own method.
        if (cls.methods.some((o) => o !== m && o.name === m.name)) continue;
        if (m.params.length !== expected.length) {
          out.push(finding("api/csharp-callback", file, m.line, `${m.name}(${m.params.map((p) => p.type).join(", ")}) is not Godot's ${m.name}(${expected.join(", ")}), so Godot never calls it: write \`public override void ${m.name}(${callbackParams(m.name)})\`.`));
        } else if (expected[0] === "double" && m.params[0]!.type === "float") {
          out.push(finding("api/csharp-callback", file, m.line, `${m.name}(float) does not override Godot's ${m.name}(double): delta is a double in Godot 4. Write \`public override void ${m.name}(double delta)\` and cast where a float is needed.`));
        }
      }

      // GD.Print in a per-frame callback (the same rule as print() in _process for GDScript).
      for (const m of cls.methods) {
        if (!PER_FRAME.has(m.name) || !m.body) continue;
        const body = maskedOf(file, source).code.slice(m.body.start, m.body.end);
        if (/debug/i.test(source.slice(m.body.start, m.body.end))) continue;
        for (const hit of body.matchAll(PRINT)) {
          out.push(finding("performance/print-per-frame", file, lineOf(source, m.body.start + hit.index), `GD.${hit[1]}() in ${m.name}() prints every frame and slows the game.`));
        }
      }
    }

    for (const use of outline.usages) {
      if (use.kind === "input action" && actionsKnown && !actions.has(use.name) && !use.name.startsWith("ui_")) {
        const near = nearest(use.name, [...actions], 3);
        out.push(finding("api/unknown-input-action", file, use.line, `Input action "${use.name}" is not in the Input Map.${near.length ? ` Did you mean ${near.map((n) => `"${n}"`).join(", ")}?` : ""}`));
      }
    }

    // GetNode("Path") on the script's own node, against every scene that attaches the script.
    const uses = attachedTo.get(file) ?? [];
    if (main && uses.length) {
      for (const use of outline.usages) {
        if ((use.kind !== "node" && use.kind !== "unique node") || !use.self || use.optional || use.class !== main.name) continue;
        const first = use.name.split("/").find((p) => p !== "" && p !== ".");
        if (use.name.startsWith("/") || !first || first === ".." || runtimeNames.has(first)) continue;
        for (const at of uses) {
          if (use.kind === "unique node" || use.name.startsWith("%")) {
            const name = use.name.replace(/^%/, "").split("/")[0]!;
            if (!pm.uniqueNode(at.scene, name) && !inheritsScene(pm, at.scene)) {
              out.push(finding("structure/missing-node", file, use.line, `%${name} is not a unique-name node in ${at.scene}.`));
              break;
            }
            continue;
          }
          if (pm.resolveNode(at.scene, at.node, use.name) === null) {
            const from = at.node === "." ? "the root node" : `node "${at.node}"`;
            out.push(finding("structure/missing-node", file, use.line, `Node "${use.name}" does not exist under ${from} in ${at.scene}.`));
            break;
          }
        }
      }
    }
  }
  return out.filter((f) => options.inScope(withoutSubResource(f.file)));
}

/** A scene whose root instances another scene: its unique nodes may come from there. */
function inheritsScene(pm: ProjectModel, scene: string): boolean {
  return Boolean(pm.scenes.get(scene)?.nodes[0]?.instance);
}

function callbackParams(name: string): string {
  const names: Record<string, string> = { double: "double delta", InputEvent: "InputEvent @event", int: "int what" };
  return (CSHARP_CALLBACKS[name] ?? []).map((t) => names[t] ?? t).join(", ");
}

let lastMasked: { file: string; source: string; masked: ReturnType<typeof maskCSharp> } | undefined;
function maskedOf(file: string, source: string): ReturnType<typeof maskCSharp> {
  if (lastMasked?.file !== file || lastMasked.source !== source) lastMasked = { file, source, masked: maskCSharp(source) };
  return lastMasked.masked;
}

function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) if (source[i] === "\n") line++;
  return line;
}
