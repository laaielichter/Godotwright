import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runOutput } from "../check/check.js";
import { findGodot, runGodot } from "../check/godot.js";
import { parseExitLeaks, type ExitLeaks } from "../check/exit-leaks.js";
import { parseGodotLog, type Diagnostic } from "../check/log.js";
import { parseProjectSettings } from "../godot/project-settings.js";
import { parseResourceText } from "../godot/scene.js";
import { isObject, parseVariant } from "../godot/variant.js";
import { findProjectRoot, fromResPath } from "../project/files.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { inputEventText } from "../settings/edit.js";

export { demangle, parseExitLeaks, type ExitLeaks } from "../check/exit-leaks.js";

export class PlayError extends Error {}

/** One step of the input timeline, on a physics frame. */
export interface InputStep {
  frame: number;
  down: boolean;
  /** An input action, or an event such as Key:Space. */
  input: string;
}

export interface PlayOptions {
  godot?: string;
  /** res:// scene to run; default the main scene. */
  scene?: string;
  /** Timeline text: "10 press jump; 30 release jump; 40 hold right 20; 50 tap Key:Space". */
  input?: string;
  /** What to sample: Node/Path.property(.sub), e.g. Player.position or Player.velocity.y. */
  watch?: string[];
  /** Physics frames to run, numbered from 0 (default 120). */
  frames?: number;
  /** Sample every N frames (default 10); frames with input and the last frame are always sampled. Samples are taken after that frame's physics step. */
  every?: number;
  /** Run `--import` first (default true). */
  import?: boolean;
  timeoutMs?: number;
  /** Stop at the first frame where this holds: "Hero.is_on_floor() == true", "Hero.position.y < 10". */
  until?: string;
  /** Signals to record with the frame they fire on: "Hero.landed", "Deck.body_entered" (or a signal of the scene root). */
  signals?: string[];
  /** Also time every frame (physics step, the rest of the frame) and count nodes, from this frame on (godot_perf). */
  perfFrom?: number;
  /**
   * Run the scene in cycles of `frames` frames, `count` times, and snapshot the live objects at the end of each
   * (godot_leaks). With `reload` (default true) the scene is freed at the end of a cycle and made again for the next;
   * the input timeline replays inside every cycle. `frames`, `every`, `watch`, `until` and `signals` are not used.
   */
  cycles?: { count: number; frames: number; reload?: boolean };
  /** Run Godot with --verbose, so it lists the objects and resources still alive at exit (godot_leaks). */
  verbose?: boolean;
}

/** One group of nodes in a snapshot: how many roots, how many nodes with their children, and where (a parent path). */
export type SnapshotGroup = [roots: number, nodes: number, where: string, whereScript: string];

/** The live objects at the end of a cycle. Group keys are "class|script path|scene path|owner's scene path". */
export interface LeakSnapshot {
  cycle: number;
  objects: number;
  /** Nodes in the tree (Performance.OBJECT_NODE_COUNT). */
  nodes: number;
  /** Orphan nodes, children included (Performance.OBJECT_ORPHAN_NODE_COUNT). */
  orphanNodes: number;
  resources: number;
  /** Static memory in bytes (debug builds). */
  memory: number;
  /** Orphan subtrees (nodes outside the tree with no parent), by key. `where` is the parent they were removed from, "" when never in the tree. */
  orphans: Record<string, SnapshotGroup>;
  /** Nodes in the tree, by key; `where` is the parent path of the first one. */
  tree: Record<string, SnapshotGroup>;
}

/** Per-frame timings of a run, in microseconds, and node counts: what godot_perf summarises. */
export interface PlayTimings {
  from: number;
  frame: number[];
  physics: number[];
  process: number[];
  nodes: number[];
  orphans: number[];
}

/** A signal that fired during a play run. */
export interface PlaySignal {
  frame: number;
  signal: string;
  args: string[];
}

export interface PlaySample {
  frame: number;
  values: Record<string, string>;
}

export interface PlayReport {
  scene: string;
  frames: number;
  fps: number;
  steps: InputStep[];
  watch: string[];
  samples: PlaySample[];
  diagnostics: Diagnostic[];
  /** What the game printed, without the samples. */
  output: string;
  warnings: string[];
  /** False when the run ended before the last frame (a crash, an error that stopped it, a timeout). */
  finished: boolean;
  signals?: PlaySignal[];
  /** The until condition, and the frame it first held (undefined: it never did). */
  until?: { condition: string; frame?: number };
  timings?: PlayTimings;
  /** One snapshot per cycle, when `cycles` was set. */
  snapshots?: LeakSnapshot[];
  /** What Godot listed at exit, when `verbose` was set. */
  atExit?: ExitLeaks;
}

const UNTIL = /^\s*(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+?)\s*$/;

/** "Hero.position.y < 10" as node path, property path, operator and the expected value as text. */
export function parseCondition(text: string): { node: string; prop: string; op: string; value: string } {
  const m = UNTIL.exec(text);
  if (!m) throw new PlayError(`cannot read the condition "${text}": write it as <Node.property> <==|!=|>=|<=|>|<> <value>, e.g. "Hero.is_on_floor() == true"`);
  const [node, prop] = splitWatch(m[1]!);
  return { node, prop, op: m[2]!, value: m[3]!.replace(/^"(.*)"$/, "$1") };
}

/** "Hero.velocity.y" into the node ("Hero") and the property path ("velocity:y"); a bare name is a property of the root. */
function splitWatch(w: string): [string, string] {
  const dot = w.indexOf(".");
  return [dot < 0 ? "." : w.slice(0, dot), dot < 0 ? w : w.slice(dot + 1).replace(/\./g, ":")];
}

const MARK = "GODOTWRIGHT_PLAY";

/** Members the cycle mode (godot_leaks) adds to the play script. */
const CYCLE_VARS = `var _packed: PackedScene
var _cycle := 0
var _cycle_frame := 0
var _settle := false
## Where each node that left the tree was: [parent path, parent script]. Pruned to live orphans at every snapshot.
var _where := {}
`;

/** Functions of the cycle mode: free and remake the scene, wait a frame for queued frees, then snapshot. */
const CYCLE_FUNCS = `

func _cycle_step() -> void:
	if _settle:
		# A scene the game switched to in the last frame (change_scene_to_*) is added only now; a real switch
		# would free it too, so it is no leak.
		if _free_switched():
			return
		_settle = false
		_snapshot()
		if _cycle >= CYCLES:
			_finish()
			return
		_scene = _packed.instantiate()
		root.add_child(_scene)
		current_scene = _scene
		_cycle_frame = 0
		_apply(0)
		return
	if _cycle_frame < CYCLE_FRAMES - 1:
		_cycle_frame += 1
		_apply(_cycle_frame)
		return
	_cycle += 1
	if RELOAD:
		if is_instance_valid(_scene):
			current_scene = null
			_scene.free()
		_scene = null
		_free_switched()
		# One more frame, so what the scene queued (queue_free, call_deferred) has run before the snapshot.
		_settle = true
		return
	_snapshot()
	if _cycle >= CYCLES:
		_finish()
		return
	_cycle_frame = 0
	_apply(0)


## Frees the scene the game switched to (change_scene_to_file/_packed, reload_current_scene): the harness only
## made its own instance, and a real scene switch frees the one before. True when there was one.
func _free_switched() -> bool:
	var other := current_scene
	if other == null or other == _scene or not is_instance_valid(other):
		return false
	current_scene = null
	other.free()
	return true


func _finish() -> void:
	print("${MARK}_DONE")
	# What Godot prints after this line is its own clean-up at exit.
	printerr("${MARK}_EXIT")
	quit()


func _on_removed(node: Node) -> void:
	var parent := node.get_parent()
	if parent == null:
		return
	var script: Script = parent.get_script()
	_where[node.get_instance_id()] = [str(parent.get_path()), script.resource_path if script else parent.scene_file_path]


func _group_key(node: Node) -> String:
	var script: Script = node.get_script()
	# A node inside an instanced scene has no scene path of its own: its owner's tells where it comes from.
	var owner_scene := node.owner.scene_file_path if node.owner != null and node.scene_file_path == "" else ""
	return "%s|%s|%s|%s" % [node.get_class(), script.resource_path if script else "", node.scene_file_path, owner_scene]


func _size(node: Node) -> int:
	var n := 1
	for child in node.get_children(true):
		n += _size(child)
	return n


func _walk(node: Node, out: Dictionary) -> void:
	for child in node.get_children():
		var key := _group_key(child)
		var group: Array = out.get(key, [0, 0, str(node.get_path()), ""])
		group[0] += 1
		group[1] += 1
		out[key] = group
		_walk(child, out)


func _snapshot() -> void:
	var orphans := {}
	var kept := {}
	var root_id := root.get_instance_id()
	# Static: Node.get_orphan_node_ids() works without a node, and only in debug builds.
	for id: int in Node.get_orphan_node_ids():
		if id == root_id:
			continue
		var node := instance_from_id(id) as Node
		# Children of an orphan are orphans too; count them with their top node.
		if node == null or node.get_parent() != null:
			continue
		var where: Array = _where.get(id, ["", ""])
		kept[id] = where
		var key := _group_key(node)
		var group: Array = orphans.get(key, [0, 0, where[0], where[1]])
		group[0] += 1
		group[1] += _size(node)
		orphans[key] = group
	_where = kept
	var tree := {}
	_walk(root, tree)
	print("${MARK}_SNAP ", JSON.stringify({
		"cycle": _cycle,
		"objects": int(Performance.get_monitor(Performance.OBJECT_COUNT)),
		"nodes": int(Performance.get_monitor(Performance.OBJECT_NODE_COUNT)),
		"orphanNodes": maxi(0, int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT)) - 1),
		"resources": int(Performance.get_monitor(Performance.OBJECT_RESOURCE_COUNT)),
		"memory": OS.get_static_memory_usage(),
		"orphans": orphans,
		"tree": tree,
	}))
`;
const PLAY_DIR = ".godot/godotwright";

/** Reads "10 press jump; 30 release jump; 40 hold right 20; 50 tap Key:Space" (a colon after the frame is fine too). */
export function parseTimeline(text: string): InputStep[] {
  const steps: InputStep[] = [];
  for (const raw of text.split(/[;\n]/).map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d+)\s*:?\s*(press|release|hold|tap)\s+(\S+)(?:\s+(\d+))?$/i.exec(raw);
    if (!m) throw new PlayError(`"${raw}" is not a timeline step; write "<frame> press|release|tap <action>" or "<frame> hold <action> <frames>", e.g. "10 press jump"`);
    const frame = Number(m[1]);
    const verb = (m[2] ?? "").toLowerCase();
    const input = m[3] ?? "";
    if (verb === "hold" && !m[4]) throw new PlayError(`"${raw}": hold needs a number of frames, e.g. "40 hold right 20"`);
    if (verb !== "hold" && m[4]) throw new PlayError(`"${raw}": only hold takes a number of frames`);
    if (verb === "press" || verb === "hold" || verb === "tap") steps.push({ frame, down: true, input });
    if (verb === "release") steps.push({ frame, down: false, input });
    if (verb === "tap") steps.push({ frame: frame + 1, down: false, input });
    if (verb === "hold") steps.push({ frame: frame + Number(m[4]), down: false, input });
  }
  return steps.sort((a, b) => a.frame - b.frame || Number(b.down) - Number(a.down));
}

/** GDScript that makes the event for Key:Space, Mouse:Left, JoyButton:0 or JoyAxis:1-, from the same table project input uses. */
function eventCode(input: string): string {
  const value = parseVariant(inputEventText(input));
  if (!isObject(value)) throw new PlayError(`"${input}" is not an input event`);
  const p = value.props;
  switch (value.class) {
    case "InputEventKey":
      return `_key(${Number(p["physical_keycode"])}, ${p["ctrl_pressed"] === true}, ${p["shift_pressed"] === true}, ${p["alt_pressed"] === true}, down)`;
    case "InputEventMouseButton":
      return `_mouse(${Number(p["button_index"])}, down)`;
    case "InputEventJoypadButton":
      return `_joy_button(${Number(p["button_index"])}, down)`;
    default:
      return `_joy_axis(${Number(p["axis"])}, ${Number(p["axis_value"])}, down)`;
  }
}

const gdString = (s: string): string => JSON.stringify(s);

/** The SceneTree script that runs the scene, plays the timeline and prints the samples. */
export function playScript(scene: string, steps: InputStep[], watch: string[], frames: number, every: number, extra: { until?: string; signals?: string[]; perfFrom?: number; cycles?: PlayOptions["cycles"] } = {}): string {
  const byFrame = new Map<number, string[]>();
  for (const s of steps) {
    const call = /^[A-Za-z]+:/.test(s.input)
      ? eventCode(s.input).replace(/\bdown\)$/, `${s.down})`)
      : s.down
        ? `Input.action_press(${gdString(s.input)})`
        : `Input.action_release(${gdString(s.input)})`;
    byFrame.set(s.frame, [...(byFrame.get(s.frame) ?? []), call]);
  }
  const cases = [...byFrame.entries()].map(([f, calls]) => `\t\t${f}:\n${calls.map((c) => `\t\t\t${c}`).join("\n")}`).join("\n");
  const watchList = watch.map((w) => {
    const [node, prop] = splitWatch(w);
    return `[${gdString(node)}, ${gdString(prop)}, ${gdString(w)}]`;
  });
  const until = extra.until ? parseCondition(extra.until) : undefined;
  const untilList = until ? `[${gdString(until.node)}, ${gdString(until.prop)}, ${gdString(until.op)}, ${gdString(until.value)}]` : "[]";
  const signalList = (extra.signals ?? []).map((sig) => {
    const dot = sig.lastIndexOf(".");
    return `[${gdString(dot < 0 ? "." : sig.slice(0, dot))}, ${gdString(dot < 0 ? sig : sig.slice(dot + 1))}, ${gdString(sig)}]`;
  });
  const inputFrames = [...byFrame.keys()];
  const cycles = extra.cycles;
  return `extends SceneTree
# Written by godotwright play; removed after the run.

const WATCH: Array = [${watchList.join(", ")}]
const INPUT_FRAMES: Array = [${inputFrames.join(", ")}]
const FRAMES := ${frames}
const EVERY := ${every}
# A var, not a const: Godot refuses an index into a constant empty array when it parses the script.
var UNTIL: Array = ${untilList}
const SIGNALS: Array = [${signalList.join(", ")}]
const PERF_FROM := ${extra.perfFrom ?? -1}
${cycles ? `const CYCLES := ${cycles.count}\nconst CYCLE_FRAMES := ${cycles.frames}\nconst RELOAD := ${cycles.reload !== false}\n` : ""}
var _frame := 0
var _scene: Node
var _t_physics := 0
var _t_process := 0
var _t_frame := 0
var _perf := {"frame": [], "physics": [], "process": [], "nodes": [], "orphans": []}
${cycles ? CYCLE_VARS : ""}

func _initialize() -> void:
	var packed := load(${gdString(scene)}) as PackedScene
	if packed == null:
		printerr("${MARK}_FAILED could not load ${scene}")
		quit(1)
		return
	_scene = packed.instantiate()
	root.add_child(_scene)
	current_scene = _scene
${cycles ? "\t_packed = packed\n\tnode_removed.connect(_on_removed)\n" : ""}	for s: Array in SIGNALS:
		var node := _node(s[0])
		if node == null or not node.has_signal(s[1]):
			printerr("${MARK}_NOSIGNAL ", s[2])
			continue
		node.connect(s[1], _on_signal.bind(s[2]))
	# Input for a frame goes in at the end of the frame before (or here, for frame 0), so the game's
	# _physics_process sees it on that very frame, is_action_just_pressed() included.
	_apply(0)
	process_frame.connect(_on_frame_done)
	if PERF_FROM >= 0:
		physics_frame.connect(_on_physics_start)


## Timing: a physics step starts here; the frame before it ended here too.
func _on_physics_start() -> void:
	var now := Time.get_ticks_usec()
	if _t_frame > 0 and _frame > PERF_FROM:
		_perf.frame.append(now - _t_frame)
		_perf.process.append(now - _t_process)
		_perf.nodes.append(int(Performance.get_monitor(Performance.OBJECT_NODE_COUNT)))
		# In -s mode the root Window counts as an orphan itself.
		_perf.orphans.append(maxi(0, int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT)) - 1))
	_t_frame = now
	_t_physics = now


## Runs once per frame, after the physics step: sample frame _frame, then give the input for the next one.
func _on_frame_done() -> void:
${cycles ? "\t_cycle_step()\n\treturn\n" : ""}	if PERF_FROM >= 0:
		_t_process = Time.get_ticks_usec()
		if _frame >= PERF_FROM:
			_perf.physics.append(_t_process - _t_physics)
	var met := not UNTIL.is_empty() and _holds()
	if _frame % EVERY == 0 or _frame == FRAMES - 1 or INPUT_FRAMES.has(_frame) or met:
		_sample()
	if met:
		print("${MARK}_UNTIL ", _frame)
		print("${MARK}_DONE")
		quit()
		return
	if _frame >= FRAMES - 1:
		if PERF_FROM >= 0:
			print("${MARK}_PERF ", JSON.stringify(_perf))
		print("${MARK}_DONE")
		quit()
		return
	_frame += 1
	_apply(_frame)


func _apply(frame: int) -> void:
	match frame:
${cases || "\t\t_:\n\t\t\tpass"}
${cycles ? CYCLE_FUNCS : ""}

func _node(path: String) -> Node:
	var node: Node = _scene.get_node_or_null(NodePath(path)) if path != "." else _scene
	# Autoloads hang under /root, next to the scene: Score.points finds /root/Score.
	if node == null:
		node = root.get_node_or_null(NodePath(path))
	return node


func _value(path: String, prop: String) -> Variant:
	var node := _node(path)
	if node == null:
		return null
	var value: Variant = node.get_indexed(NodePath(prop.trim_suffix("()")))
	# A method such as is_on_floor is read by calling it.
	if value is Callable:
		value = (value as Callable).call()
	return value


func _sample() -> void:
	var values := {}
	for w: Array in WATCH:
		values[w[2]] = "<no node>" if _node(w[0]) == null else var_to_str(_value(w[0], w[1]))
	print("${MARK} ", JSON.stringify([_frame, values]))


## The until condition: as numbers when both sides are numbers, else as the text var_to_str() gives.
func _holds() -> bool:
	if _node(UNTIL[0]) == null:
		return false
	var actual := var_to_str(_value(UNTIL[0], UNTIL[1]))
	var expected: String = UNTIL[3]
	if actual.is_valid_float() and expected.is_valid_float():
		var a := actual.to_float()
		var b := expected.to_float()
		match UNTIL[2]:
			"==": return absf(a - b) < 0.000001
			"!=": return absf(a - b) >= 0.000001
			">=": return a >= b
			"<=": return a <= b
			">": return a > b
			"<": return a < b
	match UNTIL[2]:
		"==": return actual == expected
		"!=": return actual != expected
	return false


func _on_signal(...args: Array) -> void:
	var name: String = args.pop_back()
	print("${MARK}_SIGNAL ", JSON.stringify([_frame, name, args.map(func(v: Variant) -> String: return var_to_str(v))]))


func _key(code: int, ctrl: bool, shift: bool, alt: bool, down: bool) -> void:
	var ev := InputEventKey.new()
	ev.physical_keycode = code as Key
	ev.keycode = code as Key
	ev.ctrl_pressed = ctrl
	ev.shift_pressed = shift
	ev.alt_pressed = alt
	ev.pressed = down
	Input.parse_input_event(ev)


func _mouse(button: int, down: bool) -> void:
	var ev := InputEventMouseButton.new()
	ev.button_index = button as MouseButton
	ev.pressed = down
	Input.parse_input_event(ev)


func _joy_button(button: int, down: bool) -> void:
	var ev := InputEventJoypadButton.new()
	ev.button_index = button as JoyButton
	ev.pressed = down
	Input.parse_input_event(ev)


func _joy_axis(axis: int, value: float, down: bool) -> void:
	var ev := InputEventJoypadMotion.new()
	ev.axis = axis as JoyAxis
	ev.axis_value = value if down else 0.0
	Input.parse_input_event(ev)
`;
}

/**
 * Runs a scene headless for a number of physics frames, plays an input timeline into it (actions, keys, buttons),
 * and samples the properties you name, so an agent can see what the game does without a screen.
 */
export async function playScene(path: string, options: PlayOptions = {}): Promise<PlayReport> {
  const root = findProjectRoot(path);
  if (!root) throw new ProjectNotFoundError(path);
  const settingsText = existsSync(join(root, "project.godot")) ? readFileSync(join(root, "project.godot"), "utf8") : "";
  const settings = parseProjectSettings(settingsText);
  const scene = options.scene ? (options.scene.startsWith("res://") ? options.scene : `res://${options.scene.replace(/^\/+/, "")}`) : settings.mainScene;
  if (!scene) throw new PlayError("no scene: pass --scene res://..., or set a main scene (application/run/main_scene)");
  if (!existsSync(fromResPath(root, scene))) throw new PlayError(`${scene} does not exist in the project`);
  const frames = options.frames ?? 120;
  const every = options.every ?? 10;
  if (!(Number.isInteger(frames) && frames > 0 && frames <= 100_000)) throw new PlayError("frames must be a whole number from 1 to 100000");
  if (!(Number.isInteger(every) && every > 0)) throw new PlayError("every must be a whole number above 0");
  const steps = parseTimeline(options.input ?? "");
  const watch = options.watch ?? [];
  const warnings: string[] = [];

  // Catch the usual mistakes before Godot runs: an action that is not in the input map, a node that is not in the scene.
  const actions = new Set(settings.inputActions.map((a) => a.name));
  for (const input of new Set(steps.map((s) => s.input))) {
    if (/^[A-Za-z]+:/.test(input)) continue;
    if (!actions.has(input) && !input.startsWith("ui_")) warnings.push(`"${input}" is not an input action in project.godot, so pressing it does nothing (add it with godotwright project input add)`);
  }
  if (scene.endsWith(".tscn")) {
    const paths = new Set([...parseResourceText(readFileSync(fromResPath(root, scene), "utf8")).nodes.map((n) => n.path), ...settings.autoloads.map((a) => a.name)]);
    for (const w of watch) {
      const node = w.includes(".") ? w.slice(0, w.indexOf(".")) : ".";
      if (!paths.has(node) && !node.startsWith("/root/")) warnings.push(`${node} is not a node in ${scene} (it may be made at run time)`);
    }
  }
  const fps = Number(settings.values["physics/common/physics_ticks_per_second"] ?? 60) || 60;

  const bin = findGodot(options.godot);
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  const base = ["--headless", "--path", root];
  if (options.import !== false) await runGodot(bin, [...base, "--import"], { cwd: root, timeoutMs });
  const dir = join(root, ...PLAY_DIR.split("/"));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "play.gd");
  if (options.until) parseCondition(options.until);
  writeFileSync(
    file,
    playScript(scene, steps, watch, frames, every, {
      ...(options.until ? { until: options.until } : {}),
      ...(options.signals?.length ? { signals: options.signals } : {}),
      ...(options.perfFrom !== undefined ? { perfFrom: options.perfFrom } : {}),
      ...(options.cycles ? { cycles: options.cycles } : {}),
    }),
  );
  try {
    // A fixed frame rate makes every run the same: one physics step per frame, whatever the machine.
    const result = await runGodot(bin, [...base, ...(options.verbose ? ["--verbose"] : []), "--fixed-fps", String(fps), "-s", `res://${PLAY_DIR}/play.gd`], { cwd: root, timeoutMs });
    // Godot's own clean-up at exit comes after the exit mark: with --verbose it lists what was still alive.
    const exitAt = result.stderr.indexOf(`${MARK}_EXIT`);
    const runErr = exitAt < 0 ? result.stderr : result.stderr.slice(0, exitAt);
    const snapshots: LeakSnapshot[] = [];
    const samples: PlaySample[] = [];
    const signals: PlaySignal[] = [];
    let untilFrame: number | undefined;
    let timings: PlayTimings | undefined;
    const rest: string[] = [];
    for (const line of result.stdout.split(/\r?\n/)) {
      if (line.startsWith(`${MARK} `)) {
        const [frame, values] = JSON.parse(line.slice(MARK.length + 1)) as [number, Record<string, string>];
        samples.push({ frame, values });
      } else if (line.startsWith(`${MARK}_SIGNAL `)) {
        const [frame, signal, args] = JSON.parse(line.slice(MARK.length + 8)) as [number, string, string[]];
        signals.push({ frame, signal, args });
      } else if (line.startsWith(`${MARK}_PERF `)) {
        timings = { from: options.perfFrom ?? 0, ...(JSON.parse(line.slice(MARK.length + 6)) as Omit<PlayTimings, "from">) };
      } else if (line.startsWith(`${MARK}_SNAP `)) {
        snapshots.push(JSON.parse(line.slice(MARK.length + 6)) as LeakSnapshot);
      } else if (options.verbose && VERBOSE_NOISE.some((re) => re.test(line))) {
        // --verbose engine lines (loading, exit lists) are not the game's output.
      } else if (line.startsWith(`${MARK}_UNTIL `)) {
        untilFrame = Number(line.slice(MARK.length + 7));
      } else if (!line.startsWith(`${MARK}_DONE`)) rest.push(line);
    }
    for (const m of result.stderr.matchAll(new RegExp(`${MARK}_NOSIGNAL (\\S+)`, "g"))) warnings.push(`${m[1]} is not a signal of a node in the scene, so it was not recorded`);
    const diagnostics = parseGodotLog(options.verbose ? runErr : result.stderr, "play").filter((d) => d.file !== `res://${PLAY_DIR}/play.gd` || d.severity === "error");
    const loadFailed = result.stderr.includes(`${MARK}_FAILED`);
    if (loadFailed) diagnostics.push({ severity: "error", message: `could not load ${scene}`, source: "play" });
    return {
      scene,
      frames,
      fps,
      steps,
      watch,
      samples,
      diagnostics,
      output: runOutput(rest.join("\n")),
      warnings,
      finished: result.stdout.includes(`${MARK}_DONE`) && !result.timedOut,
      ...(signals.length || options.signals?.length ? { signals } : {}),
      ...(options.until ? { until: { condition: options.until, ...(untilFrame !== undefined ? { frame: untilFrame } : {}) } } : {}),
      ...(timings ? { timings } : {}),
      ...(options.cycles ? { snapshots } : {}),
      ...(options.verbose ? { atExit: parseExitLeaks(`${result.stdout}\n${result.stderr}`) } : {}),
    };
  } finally {
    rmSync(file, { force: true });
  }
}

/** Lines --verbose adds to stdout that say nothing about the game. */
const VERBOSE_NOISE = [
  /^Loading resource: /,
  /^Completed load for: /,
  /^Orphan StringName: /,
  /^StringName: \d+ unclaimed string names/,
  /^Leaked instance: /,
  /^Hint: Leaked instances /,
  /^Resource still in use: /,
  /^(TextServer|XR|SDL|WorkerThreadPool|SceneTreeFTI|CORE API HASH|EDITOR API HASH|Loaded system CA|Using ".*" pen tablet|Shader '|Vulkan|OpenGL)/,
  /RID allocations of type .* were leaked at exit/,
];

/** Numbers in a value as Godot prints it: "Vector3(1, 2.5, -3)" gives [1, 2.5, -3], "true" gives []. */
function numbers(value: string): number[] {
  return [...value.matchAll(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi)].map((m) => Number(m[0]));
}

/** One line per watched value instead of a table: start, end, range, the first frame it changed and how often it did. */
export function summarizePlay(r: PlayReport): string[] {
  const out: string[] = [];
  for (const w of r.watch) {
    const series = r.samples.filter((s) => s.values[w] !== undefined).map((s) => ({ frame: s.frame, value: s.values[w]! }));
    if (!series.length) {
      out.push(`${w}: not sampled`);
      continue;
    }
    const first = series[0]!;
    const last = series.at(-1)!;
    let changes = 0;
    let firstChange: number | undefined;
    for (let i = 1; i < series.length; i++) {
      if (series[i]!.value !== series[i - 1]!.value) {
        changes++;
        firstChange ??= series[i]!.frame;
      }
    }
    const parts = [`start ${first.value}`, `end ${last.value}`];
    const scalar = series.every((p) => numbers(p.value).length === 1 && /^-?[\d.e+-]+$/i.test(p.value.trim()));
    if (scalar) {
      const values = series.map((p) => Number(p.value));
      const min = Math.min(...values);
      const max = Math.max(...values);
      parts.push(`min ${min} (frame ${series[values.indexOf(min)]!.frame})`, `max ${max} (frame ${series[values.indexOf(max)]!.frame})`);
    }
    parts.push(firstChange === undefined ? "never changed" : `first change at frame ${firstChange}, ${changes} change${changes === 1 ? "" : "s"} in ${series.length} samples`);
    out.push(`${w}: ${parts.join(", ")}`);
  }
  return out;
}

/** The samples as a table (one row per sampled frame, one column per watched value), then errors and prints. */
export function formatPlay(r: PlayReport, options: { summary?: boolean } = {}): string {
  const input = r.steps.map((s) => `${s.frame} ${s.down ? "press" : "release"} ${s.input}`).join(", ");
  const stopped = r.until?.frame !== undefined ? `; stopped at frame ${r.until.frame}: ${r.until.condition}` : r.until ? `; ${r.until.condition} never held in ${r.frames} frames` : "";
  const out = [`play ${r.scene}: ${r.frames} physics frames at ${r.fps}/s${input ? `; input: ${input}` : ""}${stopped}${r.finished ? "" : "; the run did NOT reach the last frame"}`];
  for (const w of r.warnings) out.push(`warning: ${w}`);
  if (r.signals?.length) {
    out.push("signals:");
    for (const s of r.signals.slice(0, 60)) out.push(`  frame ${s.frame} ${s.signal}(${s.args.join(", ")})`);
    if (r.signals.length > 60) out.push(`  +${r.signals.length - 60} more`);
  } else if (r.signals) out.push("signals: none fired");
  if (options.summary && r.watch.length && r.samples.length) out.push(...summarizePlay(r));
  else if (r.watch.length && r.samples.length) {
    const cols = ["frame", ...r.watch];
    const rows = r.samples.map((s) => [String(s.frame), ...r.watch.map((w) => s.values[w] ?? "")]);
    const width = cols.map((c, i) => Math.min(40, Math.max(c.length, ...rows.map((row) => (row[i] ?? "").length))));
    const pad = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padStart(width[0] ?? 5) : c.padEnd(width[i] ?? 0))).join("  ").trimEnd();
    out.push(pad(cols), ...rows.map(pad));
  } else if (r.watch.length) out.push("no samples: the scene did not run (see the errors)");
  for (const d of r.diagnostics.slice(0, 20)) out.push(`${d.severity}: ${d.file ? `${d.file}${d.line ? `:${d.line}` : ""}  ` : ""}${d.message}`);
  if (r.output.trim()) out.push("printed:", r.output.trim());
  return `${out.join("\n")}\n`;
}
