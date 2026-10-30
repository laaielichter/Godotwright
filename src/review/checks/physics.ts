import type { LogicalLine } from "../../godot/gdscript.js";
import { finding, type Finding } from "../rules.js";
import type { ProjectModel } from "../model.js";
import { bodyOf } from "./performance.js";

/** Signals Godot emits while it flushes physics queries; changing the physics state inside them fails. */
const OVERLAP_SIGNAL = /^(?:body|area)(?:_shape)?_(?:entered|exited)$/;
const HANDLER_NAME = /^_on_\w*(?:body|area)(?:_shape)?_(?:entered|exited)$/;
const COLLISION_OBJECTS = ["CollisionObject2D", "CollisionObject3D"];

/**
 * Setters whose first argument is a name: `bind()` adds its arguments after the ones the caller passes,
 * so `tween_method(m.set_shader_parameter.bind("amount"), ...)` calls `set_shader_parameter(value, "amount")`.
 */
const NAME_FIRST_SETTERS = ["set_shader_parameter", "set_instance_shader_parameter", "set", "set_deferred", "set_indexed", "set_meta"];
const BOUND_SETTER = new RegExp(`\\btween_method\\s*\\(\\s*[\\w.]*?\\b(${NAME_FIRST_SETTERS.join("|")})\\s*\\.\\s*bind\\s*\\(\\s*&?"([^"]*)"`);

/** Functions of a script that handle body/area entered or exited: by name, or connected in the script or a scene. */
function overlapHandlers(pm: ProjectModel, path: string, lines: LogicalLine[]): Set<string> {
  const names = new Set<string>();
  for (const ll of lines) {
    for (const m of ll.code.matchAll(/\b(\w+)\s*\.\s*connect\s*\(\s*(?:self\s*\.\s*)?([A-Za-z_]\w*)\s*[,)]/g)) {
      if (OVERLAP_SIGNAL.test(m[1]!)) names.add(m[2]!);
    }
  }
  for (const scene of pm.scenes.values()) {
    for (const c of scene.connections) {
      if (!OVERLAP_SIGNAL.test(c.signal)) continue;
      const target = scene.nodes.find((n) => n.path === c.to || (c.to === "." && n.path === "."));
      if (target?.script === path) names.add(c.method);
    }
  }
  return names;
}

/** True when the node a script adds is (or holds) a physics object: by its declared type, or by the scene it was instanced from. */
function addsCollisionObject(pm: ProjectModel, path: string, source: string, body: LogicalLine[], arg: string): boolean {
  const api = pm.api;
  const isPhysics = (type: string | undefined) => Boolean(type) && COLLISION_OBJECTS.some((base) => type === base || api.inheritsFrom(type!, base));
  const sceneHasPhysics = (scenePath: string) => {
    const scene = pm.scenes.get(scenePath);
    return Boolean(scene?.nodes.some((n) => isPhysics(n.type)));
  };
  const resolveScene = (expr: string): string | undefined => {
    const direct = /\b(?:pre)?load\s*\(\s*"(res:\/\/[^"]+\.t?scn)"/.exec(expr);
    if (direct) return direct[1];
    const name = /\b([A-Za-z_]\w*)\s*\.\s*instantiate\s*\(/.exec(expr)?.[1];
    if (!name) return undefined;
    const decl = new RegExp(`^\\s*(?:const|var|@onready\\s+var|@export\\s+var)\\s+${name}\\b[^=\\n]*=\\s*(?:pre)?load\\s*\\(\\s*"(res://[^"]+\\.t?scn)"`, "m").exec(source);
    return decl?.[1];
  };
  // A new node right in the call: add_child(Area2D.new()) or add_child(SCENE.instantiate()).
  const inline = /^([A-Z]\w*)\s*\.\s*new\s*\(/.exec(arg);
  if (inline) return isPhysics(inline[1]);
  if (/\binstantiate\s*\(/.test(arg)) {
    const scene = resolveScene(arg);
    return scene ? sceneHasPhysics(scene) : false;
  }
  const ident = /^[A-Za-z_]\w*$/.exec(arg)?.[0];
  if (!ident) return false;
  const decl = body.map((l) => new RegExp(`^var\\s+${ident}\\b\\s*(?::\\s*([A-Za-z_]\\w*))?\\s*:?=\\s*(.*)$`).exec(l.code)).find(Boolean);
  if (!decl) return false;
  if (isPhysics(decl[1])) return true;
  const expr = decl[2] ?? "";
  const made = /^([A-Z]\w*)\s*\.\s*new\s*\(/.exec(expr);
  if (made) return isPhysics(made[1]);
  const scene = resolveScene(expr);
  return scene ? sceneHasPhysics(scene) : false;
}

/** Physics changes Godot refuses while it is reporting overlaps, and tweens that call a setter with its arguments swapped. */
export function checkScriptPhysics(pm: ProjectModel, path: string): Finding[] {
  const script = pm.data.scripts.get(path);
  const source = pm.data.sources.get(path) ?? "";
  if (!script) return [];
  const out: Finding[] = [];
  const handlers = overlapHandlers(pm, path, script.logicalLines);

  for (const model of [...pm.allModels()].filter((m) => m.path === path)) {
    for (const fn of model.outline.functions) {
      if (!handlers.has(fn.name) && !HANDLER_NAME.test(fn.name)) continue;
      const body = bodyOf(script.logicalLines, fn);
      for (const ll of body) {
        const add = /(?:^|[^.\w]|\.\s*)add_child\s*\(\s*(.+?)\s*(?:,[^)]*)?\)\s*$/.exec(ll.code);
        if (add && !/add_child\s*\.\s*call_deferred/.test(ll.code) && addsCollisionObject(pm, path, source, body, add[1]!.trim())) {
          out.push(
            finding(
              "api/physics-change-in-callback",
              path,
              ll.line,
              `${fn.name}() runs while Godot reports overlaps, and adding a physics object then fails ("Can't change this state while flushing queries"). Use add_child.call_deferred(...).`,
            ),
          );
        }
        const flag = /(?:^|[^\w.]|\.)\s*(monitoring|monitorable|disabled)\s*=(?!=)/.exec(ll.code);
        if (flag) {
          out.push(
            finding(
              "api/physics-change-in-callback",
              path,
              ll.line,
              `${fn.name}() runs while Godot reports overlaps, and changing ${flag[1]} then fails. Use set_deferred("${flag[1]}", ...).`,
            ),
          );
        }
      }
    }
  }

  for (const ll of script.logicalLines) {
    // Find it in the code (not in a string or comment), then read the bound name from the text.
    const bound = BOUND_SETTER.test(ll.code) ? BOUND_SETTER.exec(ll.text) : null;
    if (bound) {
      out.push(
        finding(
          "api/bind-swaps-arguments",
          path,
          ll.line,
          `bind() adds "${bound[2]}" after the tweened value, so Godot calls ${bound[1]}(value, "${bound[2]}") and fails. Use tween_property(<object>, "${bound[1] === "set_shader_parameter" ? `shader_parameter/${bound[2]}` : bound[2]}", to, duration), or a lambda that calls ${bound[1]}("${bound[2]}", value).`,
        ),
      );
    }
  }
  return out;
}
