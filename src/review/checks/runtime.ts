import type { FunctionInfo } from "../../godot/gdscript.js";
import { finding, type Finding } from "../rules.js";
import type { ProjectModel } from "../model.js";
import { splitStatements } from "./api.js";
import { bodyOf } from "./performance.js";

/**
 * More runtime pitfalls from real projects (data/lessons.json names the lesson behind each): things Godot accepts when
 * it loads the script, and that fail, do nothing or cost a lot only while the game runs.
 */

const TICK_CALLBACKS = new Set(["_physics_process", "_process"]);
/** Statements that start with a keyword are not expression statements. */
const KEYWORD_START = /^(?:if|elif|else|for|while|match|return|var|const|func|static|signal|class|class_name|extends|enum|await|pass|break|continue|assert|@)/;
const DEBUG_ONLY_MONITORS = ["OBJECT_ORPHAN_NODE_COUNT", "MEMORY_STATIC", "MEMORY_STATIC_MAX"];

/** The index of a top-level assignment in a statement (`=`, `:=`, `+=`, ...; not `==`, `!=`, `<=`, `>=`), or -1. */
function assignmentAt(code: string): number {
  let depth = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i]!;
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
    // `=`, `:=` and compound assignments such as `+=` assign; `==`, `!=`, `<=` and `>=` compare.
    else if (c === "=" && depth === 0 && code[i + 1] !== "=" && !"=!<>".includes(code[i - 1] ?? "")) return i;
  }
  return -1;
}

/** Functions of the script (and the scripts it extends) whose own body awaits: Godot treats them as coroutines. */
function coroutines(pm: ProjectModel, path: string): Set<string> {
  const out = new Set<string>();
  const model = [...pm.allModels()].find((m) => m.path === path && !m.owner);
  if (!model) return out;
  const seen = new Set<string>();
  for (const m of pm.chain(model)) {
    const lines = pm.data.scripts.get(m.path)?.logicalLines ?? [];
    for (const fn of m.outline.functions) {
      if (seen.has(fn.name)) continue;
      seen.add(fn.name);
      const body = bodyOf(lines, fn);
      const top = Math.min(...body.map((l) => l.indent));
      // An `await` inside a lambda makes the lambda a coroutine, not the function around it.
      if (body.some((l) => l.indent === top && /(?:^|[^\w.])await\b/.test(l.code) && !/\bfunc\s*\(/.test(l.code))) out.add(fn.name);
    }
  }
  return out;
}

function functionsOf(pm: ProjectModel, path: string): FunctionInfo[] {
  return [...pm.allModels()].filter((m) => m.path === path).flatMap((m) => m.outline.functions);
}

export function checkScriptRuntime(pm: ProjectModel, path: string): Finding[] {
  const script = pm.data.scripts.get(path);
  const source = pm.data.sources.get(path) ?? "";
  if (!script) return [];
  const out: Finding[] = [];
  const lines = script.logicalLines;
  const functions = functionsOf(pm, path);

  // A coroutine whose result is used without await: Godot stops with an error when it loads the script.
  const co = coroutines(pm, path);
  if (co.size) {
    const names = [...co].join("|");
    const call = new RegExp(`(?<![\\w.]|\\.\\s)(?:self\\s*\\.\\s*)?\\b(${names})\\s*\\(`, "g");
    for (const fn of functions) {
      for (const st of splitStatements(bodyOf(lines, fn))) {
        for (const m of st.code.matchAll(call)) {
          const before = st.code.slice(0, m.index);
          if (/\bawait\s*(?:self\s*\.\s*)?$/.test(before)) continue;
          // A call that is the whole statement (also after `if x:`, after `;` or in a one-line lambda) may drop its result.
          if (/^\s*$/.test(before) || /[:;]\s*$/.test(before)) continue;
          if (/\bfunc\s*\([^)]*\)\s*(?:->\s*\w+\s*)?:\s*$/.test(before)) continue;
          // A lambda over several lines is joined into one line here, so where its statements start is unknown.
          if (st.endLine > st.line && /\bfunc\s*\(/.test(before)) continue;
          out.push(
            finding(
              "api/coroutine-without-await",
              path,
              st.line,
              `${m[1]}() awaits, so it is a coroutine; its result is used here without await. Godot stops with "Function "${m[1]}()" is a coroutine, so it must be called with "await"". Write \`await ${m[1]}(...)\` (and the caller becomes a coroutine too).`,
            ),
          );
        }
      }
    }
  }

  for (const fn of functions) {
    const body = splitStatements(bodyOf(lines, fn));

    // Timer.new() started before it is in the tree: start() fails and the timer never fires.
    const timers = new Map<string, number>();
    const added = new Set<string>();
    for (const st of body) {
      const made = /^(?:var\s+)?([A-Za-z_]\w*)\s*(?::\s*Timer\s*)?:?=\s*Timer\s*\.\s*new\s*\(\s*\)/.exec(st.code);
      if (made) {
        timers.set(made[1]!, st.line);
        added.delete(made[1]!);
        continue;
      }
      for (const m of st.code.matchAll(/\badd_child\s*\(\s*([A-Za-z_]\w*)/g)) added.add(m[1]!);
      for (const m of st.code.matchAll(/(?<![\w.])([A-Za-z_]\w*)\s*\.\s*start\s*\(/g)) {
        if (timers.has(m[1]!) && !added.has(m[1]!)) {
          out.push(
            finding(
              "api/timer-start-outside-tree",
              path,
              st.line,
              `${m[1]}.start() runs before ${m[1]} is added to the tree, so it fails ("Unable to start the timer because it's not inside the scene tree") and the timer never fires. Call add_child(${m[1]}) first, or set autostart = true before adding it.`,
            ),
          );
          timers.delete(m[1]!);
        }
      }
    }

    // MultiMesh format changed after instance_count: the change is ignored.
    const counted = new Map<string, number>();
    for (const st of body) {
      // A MultiMesh made anew (often once per loop pass) starts with instance_count 0.
      const fresh = /^(?:var\s+)?([A-Za-z_][\w.]*)\s*(?::\s*\w+\s*)?:?=(?!=)\s*MultiMesh\s*\.\s*new\s*\(/.exec(st.code.trim());
      if (fresh) {
        counted.delete(fresh[1]!);
        continue;
      }
      const count = /(?<![\w.])([A-Za-z_][\w.]*)\s*\.\s*(?:instance_count\s*=(?!=)\s*(.+)|set_instance_count\s*\((.+)\))\s*$/.exec(st.code);
      if (count) {
        const value = (count[2] ?? count[3] ?? "").trim();
        if (/^0+$/.test(value)) counted.delete(count[1]!);
        else counted.set(count[1]!, st.line);
        continue;
      }
      const format = /(?<![\w.])([A-Za-z_][\w.]*)\s*\.\s*(?:(use_custom_data|use_colors|transform_format)\s*=(?!=)|set_(use_custom_data|use_colors|transform_format)\s*\()/.exec(st.code);
      if (format && counted.has(format[1]!)) {
        const prop = format[2] ?? format[3]!;
        out.push(
          finding(
            "api/multimesh-format-after-count",
            path,
            st.line,
            `${format[1]}.${prop} is set after instance_count (line ${counted.get(format[1]!)}); a MultiMesh only takes a new format while instance_count is 0, so this does nothing and the instances get no ${prop === "transform_format" ? "new format" : prop === "use_colors" ? "colours" : "custom data"}. Set it before instance_count.`,
          ),
        );
      }
    }

    if (TICK_CALLBACKS.has(fn.name)) {
      // `int(t * k) % n == 0` is true for a whole window of frames, not once per period.
      for (const st of body) {
        // Only as the condition that triggers work; `int(t * 6) % 2 == 0` as a value is a blink, true half the time on purpose.
        if (!/^(?:if|elif|while)\b/.test(st.code.trim())) continue;
        const m = /\bint\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*%\s*([\w.]+)\s*==\s*0\b/.exec(st.code);
        if (!m || m[2] === "2" || !/[*/]/.test(m[1]!) || /frame/i.test(m[1]!)) continue;
        if (!/\b(?:time|elapsed|clock|age|t|_t|seconds?|secs|now|timer)\b|get_ticks_(?:msec|usec)|get_unix_time/i.test(m[1]!)) continue;
        out.push(
          finding(
            "quality/time-modulo-window",
            path,
            st.line,
            `int(${m[1]!.trim()}) % ... == 0 is true for every frame while the value stays the same, so the work below runs many frames in a row, not once per period. Keep the next due time instead: \`if now >= next_at: next_at += period\`.`,
          ),
        );
      }
    }

    // A ternary on its own: the value is thrown away, and with void calls Godot does not load the script.
    for (const st of body) {
      const code = afterHeader(st.code.trim());
      if (!code || KEYWORD_START.test(code) || assignmentAt(code) >= 0 || /:\s*$/.test(code)) continue;
      if (!/\S\s+if\s+\S.*\s+else\s+\S/.test(topLevel(code)) || /\bfunc\s*\(/.test(code)) continue;
      out.push(
        finding(
          "quality/standalone-ternary",
          path,
          st.line,
          "This line is only a ternary (`a if c else b`): its value is thrown away, and when both sides are calls to void functions Godot does not load the script. Write an if/else statement.",
        ),
      );
    }
  }

  // world_3d of the viewport a node is in: null when that viewport uses its parent's world.
  for (const st of splitStatements(lines)) {
    // Only 3D: every viewport has a World2D of its own, but world_3d is null on one that uses its parent's world.
    const m = /(?:^|\.\s*)(world_3d)\s*=(?!=)\s*(.*\bget_viewport\s*\(\s*\))\s*\.\s*(world_3d)\s*$/.exec(st.code.trim());
    if (!m) continue;
    out.push(
      finding(
        "api/viewport-world-borrowed",
        path,
        st.line,
        `${m[2]!.trim()}.${m[3]} is only set when that viewport has a world of its own; a viewport that shows its parent's world returns null here, and this one renders an empty world. Use ${m[2]!.trim()}.find_world_3d() instead.`,
      ),
    );
  }

  // find_children() for a type this script makes and adds: nodes added with add_child() have no owner and are skipped.
  if (/\badd_child\s*\(/.test(source)) {
    const made = new Set([...source.matchAll(/\b([A-Z]\w*)\s*\.\s*new\s*\(/g)].map((m) => m[1]!));
    const call = lines.find((l) => {
      for (const m of l.code.matchAll(/\bfind_children\s*\(/g)) {
        const open = l.code.indexOf("(", m.index);
        const args = splitArgs(l.text.slice(open + 1, closing(l.code, open)));
        const type = /^&?"(\w+)"$/.exec(args[1] ?? "")?.[1];
        if (args.length < 4 && type && made.has(type)) return true;
      }
      return false;
    });
    if (call) {
      out.push(
        finding(
          "quality/find-children-unowned",
          path,
          call.line,
          "find_children() only looks at nodes with an owner unless `owned` is false, and the nodes of this type that this script makes and adds with add_child() have none: they are skipped without a word. Pass owned = false (the last argument), or keep references to the nodes you make.",
        ),
      );
    }
  }

  // WorkerThreadPool tasks that nobody waits for.
  const task = lines.find((l) => /\bWorkerThreadPool\s*\.\s*add_(?:group_)?task\s*\(/.test(l.code));
  if (task && !/\bwait_for_(?:group_)?task_completion\s*\(/.test(source)) {
    out.push(
      finding(
        "quality/worker-task-not-waited",
        path,
        task.line,
        "WorkerThreadPool tasks must each be waited for (wait_for_task_completion() or wait_for_group_task_completion()); this script never waits, so a task can still run after its node is freed, and its resources are not cleaned up. Keep the id and wait for it, at the latest in _exit_tree().",
      ),
    );
  }

  // A SubViewport switched to UPDATE_ALWAYS and never switched back renders every frame, seen or not.
  // Test runners, capture tools and editor scripts render on purpose.
  const top = [...pm.allModels()].find((m) => m.path === path && !m.owner);
  const tooling = script.tool || /\/(?:tests?|qa)\//.test(path) || (top !== undefined && ["SceneTree", "EditorScript"].includes(pm.nativeOf(top)));
  const always = tooling ? undefined : lines.find((l) => /\brender_target_update_mode\s*=(?!=)\s*(?:SubViewport\s*\.\s*)?(?:UPDATE_ALWAYS|4)\s*$/.test(l.code));
  if (always && !/\bUPDATE_(?:DISABLED|ONCE|WHEN_VISIBLE|WHEN_PARENT_VISIBLE)\b|render_target_update_mode\s*=(?!=)\s*[0-3]\b/.test(source)) {
    out.push(
      finding(
        "performance/subviewport-always",
        path,
        always.line,
        "This SubViewport is set to UPDATE_ALWAYS and never switched back, so it renders a whole extra view every frame, also when nothing on screen shows it. Switch it to UPDATE_DISABLED when its screen is hidden or out of view, or use UPDATE_WHEN_VISIBLE.",
      ),
    );
  }

  // Monitors that read 0 in a release export.
  for (const ll of lines) {
    const m = new RegExp(`\\bget_monitor\\s*\\(\\s*Performance\\s*\\.\\s*(${DEBUG_ONLY_MONITORS.join("|")})\\b`).exec(ll.code);
    if (!m || /\bis_debug_build\s*\(/.test(source)) continue;
    out.push(
      finding(
        "api/debug-only-monitor",
        path,
        ll.line,
        `Performance.${m[1]} is only counted in debug builds and reads 0 in a release export, so a log from players looks healthy when it is not. Guard it with OS.is_debug_build(), or report it as unknown there.`,
      ),
    );
    break;
  }
  return out;
}

/**
 * The statement after a header on the same line: the body of a match branch (`"key": body`), of `if x: body` or of
 * `else: body`. A line without such a header comes back as it is; a header without a body comes back empty.
 */
function afterHeader(code: string): string {
  const top = topLevel(code);
  for (let i = 0; i < top.length; i++) {
    if (top[i] !== ":" || top[i + 1] === "=") continue;
    const head = code.slice(0, i).trim();
    // A match pattern (a literal, a name, an enum value, `_`, several of them) or a block keyword ends at this colon.
    if (/^(?:if|elif|else|for|while|match)\b/.test(head) || /^(?:&?"[^"]*"|'[^']*'|-?[\d.]+|[A-Za-z_][\w.]*|_)(?:\s*,\s*(?:&?"[^"]*"|'[^']*'|-?[\d.]+|[A-Za-z_][\w.]*))*$/.test(head)) {
      return code.slice(i + 1).trim();
    }
    return code;
  }
  return code;
}

/** The text outside any brackets, with bracketed parts blanked: `print(a if b else c)` has no top-level ternary. */
function topLevel(code: string): string {
  let depth = 0;
  let out = "";
  for (const c of code) {
    if ("([{".includes(c)) depth++;
    out += depth > 0 ? " " : c;
    if (")]}".includes(c)) depth = Math.max(0, depth - 1);
  }
  return out;
}

/** Index of the parenthesis that closes the one at `open`, or the end of the text. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i;
  }
  return text.length;
}

/** Top-level arguments of a call's argument text. */
function splitArgs(text: string): string[] {
  if (!text.trim()) return [];
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map((a) => a.trim()).filter(Boolean);
}

