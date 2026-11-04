import { matchingParen, type FunctionInfo, type LogicalLine } from "../../godot/gdscript.js";
import { finding, type Finding } from "../rules.js";
import type { ProjectModel } from "../model.js";

/** Callbacks Godot runs every frame or physics tick. */
const PER_FRAME = new Set(["_process", "_physics_process", "_integrate_forces"]);

const NODE_LOOKUP = /(\$[A-Za-z_"%.]|(?<![.\w])%[A-Za-z_]|\b(get_node|get_node_or_null|find_child|find_children|find_parent|get_nodes_in_group|get_first_node_in_group)\s*\()/;
const LOAD = /(?<![.\w])(load|ResourceLoader\.load)\s*\(/;
const PRINT = /(?<![.\w])(print|prints|printt|print_rich|print_debug)\s*\(/;
const PHYSICS = /\b(move_and_slide|move_and_collide|apply_force|apply_central_force|apply_impulse|apply_central_impulse|apply_torque|apply_torque_impulse)\s*\(/;
const INSTANTIATE = /\.instantiate\s*\(/;

const SHADOW_LIGHTS = new Set(["OmniLight3D", "SpotLight3D", "DirectionalLight3D", "PointLight2D", "DirectionalLight2D"]);
const MAX_SHADOW_LIGHTS = 6;
const HUGE_SCENE = 1500;

export function checkScriptPerformance(pm: ProjectModel, path: string): Finding[] {
  const script = pm.data.scripts.get(path);
  if (!script) return [];
  const out: Finding[] = [];
  const models = pm.modelsOf(path);
  for (const model of models) {
    for (const fn of model.outline.functions) {
      if (!PER_FRAME.has(fn.name)) continue;
      const body = bodyOf(script.logicalLines, fn);
      if (body.length === 0 || body.every((l) => l.code === "pass")) {
        out.push(finding("performance/empty-callback", path, fn.line, `${fn.name}() is empty; Godot still calls it every frame.`));
        continue;
      }
      const where = `${fn.name}()`;
      const lookups = body.filter((ll) => NODE_LOOKUP.test(ll.code) && !isLazyInit(body, ll)).map((ll) => ll.line);
      if (lookups.length > 0) {
        const lines = lookups.length > 1 ? ` (lines ${lookups.slice(0, 6).join(", ")}${lookups.length > 6 ? ", ..." : ""})` : "";
        out.push(
          finding(
            "performance/node-lookup-per-frame",
            path,
            lookups[0],
            lookups.length === 1
              ? `A node lookup in ${where} runs every frame; store the node in an @onready var.`
              : `${lookups.length} node lookups in ${where} run every frame${lines}; store the nodes in @onready vars.`,
          ),
        );
      }
      for (const ll of body) {
        const code = ll.code;
        if (LOAD.test(code) && !isLazyInit(body, ll)) {
          out.push(finding("performance/load-per-frame", path, ll.line, `load() in ${where} runs every frame; use preload() or load once.`));
        }
        if (PRINT.test(code) && !isDebugGuarded(body, ll)) {
          out.push(finding("performance/print-per-frame", path, ll.line, `print() in ${where} prints every frame and slows the game.`));
        }
        if (fn.name === "_process" && PHYSICS.test(code)) {
          const call = PHYSICS.exec(code)![1];
          out.push(finding("performance/physics-in-process", path, ll.line, `${call}() is called in _process(); physics belongs in _physics_process().`));
        }
        if (INSTANTIATE.test(code)) {
          out.push(finding("performance/instantiate-per-frame", path, ll.line, `instantiate() in ${where} can run every frame; spawn on events or use a pool.`));
        }
      }
    }
  }
  return out;
}

/** Statements in a function body, including one written on the `func` line: `func _process(d): print(d)`. */
export function bodyOf(lines: LogicalLine[], fn: FunctionInfo): LogicalLine[] {
  // Logical lines are in line order: find the function's first line by bisection instead of scanning the whole script.
  let lo = 0;
  let hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]!.line < fn.line) lo = mid + 1;
    else hi = mid;
  }
  const body: LogicalLine[] = [];
  let head: LogicalLine | undefined;
  for (let i = lo; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.line > fn.endLine) break;
    if (l.line === fn.line) head ??= l;
    else if (l.line > fn.line && l.indent > fn.indent) body.push(l);
  }
  const inline = inlineBody(head, fn);
  return inline ? [inline, ...body] : body;
}

/**
 * True for a lazy cache that runs once: `x = load(...)` or `x = get_node(...)` directly under
 * `if not x:` or `if x == null:`.
 */
function isLazyInit(body: LogicalLine[], ll: LogicalLine): boolean {
  const assign = /^([A-Za-z_]\w*)\s*=(?!=)/.exec(ll.code);
  if (!assign) return false;
  const parent = [...body].reverse().find((l) => l.line < ll.line && l.indent < ll.indent);
  return parent !== undefined && new RegExp(`^if\\s+(not\\s+${assign[1]}|${assign[1]}\\s*==\\s*null)\\s*:$`).test(parent.text);
}

/** True when the statement sits under an `if` that tests a debug flag, e.g. `if OS.is_debug_build():`. */
function isDebugGuarded(body: LogicalLine[], ll: LogicalLine): boolean {
  let current = ll;
  while (true) {
    const parent = [...body].reverse().find((l) => l.line < current.line && l.indent < current.indent);
    if (parent === undefined) return false;
    if (/^if\b/.test(parent.code) && /debug/i.test(parent.code)) return true;
    current = parent;
  }
}

/** The statement after the colon that ends the `func` header, as its own line; undefined when the body is below. */
function inlineBody(line: LogicalLine | undefined, fn: FunctionInfo): LogicalLine | undefined {
  const head = line ? new RegExp(`\\bfunc\\s+${fn.name}\\s*\\(`).exec(line.code) : null;
  if (!line || !head) return undefined;
  const colon = line.code.indexOf(":", matchingParen(line.code, head.index + head[0].length - 1));
  if (colon < 0) return undefined;
  const code = line.code.slice(colon + 1).trim();
  if (code === "") return undefined;
  // `text` and `code` have the same length, so the same offset works for both.
  return { text: line.text.slice(colon + 1).trim(), code, line: line.line, endLine: line.line, indent: fn.indent + 4 };
}

export function checkScenePerformance(pm: ProjectModel): Finding[] {
  const out: Finding[] = [];
  for (const [path, file] of pm.data.resources) {
    if (file.kind !== "scene") continue;
    const shadowed = file.nodes.filter((n) => n.type && SHADOW_LIGHTS.has(n.type) && n.props["shadow_enabled"] === true);
    if (shadowed.length > MAX_SHADOW_LIGHTS) {
      out.push(
        finding(
          "performance/many-shadow-lights",
          path,
          shadowed[MAX_SHADOW_LIGHTS]!.line,
          `${shadowed.length} lights cast shadows in this scene; each one costs a shadow pass.`,
        ),
      );
    }
    if (file.nodes.length > HUGE_SCENE) {
      out.push(finding("performance/huge-scene", path, undefined, `${file.nodes.length} nodes in one scene.`));
    }
  }
  return out;
}
