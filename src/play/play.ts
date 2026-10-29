import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runOutput } from "../check/check.js";
import { findGodot, runGodot } from "../check/godot.js";
import { parseGodotLog, type Diagnostic } from "../check/log.js";
import { parseProjectSettings } from "../godot/project-settings.js";
import { parseResourceText } from "../godot/scene.js";
import { isObject, parseVariant } from "../godot/variant.js";
import { findProjectRoot, fromResPath } from "../project/files.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { inputEventText } from "../settings/edit.js";

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
}

const MARK = "GODOTWRIGHT_PLAY";
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
export function playScript(scene: string, steps: InputStep[], watch: string[], frames: number, every: number): string {
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
    const dot = w.indexOf(".");
    return `[${gdString(dot < 0 ? "." : w.slice(0, dot))}, ${gdString(dot < 0 ? w : w.slice(dot + 1).replace(/\./g, ":"))}, ${gdString(w)}]`;
  });
  const inputFrames = [...byFrame.keys()];
  return `extends SceneTree
# Written by godotwright play; removed after the run.

const WATCH: Array = [${watchList.join(", ")}]
const INPUT_FRAMES: Array = [${inputFrames.join(", ")}]
const FRAMES := ${frames}
const EVERY := ${every}

var _frame := 0
var _scene: Node


func _initialize() -> void:
	var packed := load(${gdString(scene)}) as PackedScene
	if packed == null:
		printerr("${MARK}_FAILED could not load ${scene}")
		quit(1)
		return
	_scene = packed.instantiate()
	root.add_child(_scene)
	current_scene = _scene
	# Input for a frame goes in at the end of the frame before (or here, for frame 0), so the game's
	# _physics_process sees it on that very frame, is_action_just_pressed() included.
	_apply(0)
	process_frame.connect(_on_frame_done)


## Runs once per frame, after the physics step: sample frame _frame, then give the input for the next one.
func _on_frame_done() -> void:
	if _frame % EVERY == 0 or _frame == FRAMES - 1 or INPUT_FRAMES.has(_frame):
		_sample()
	if _frame >= FRAMES - 1:
		print("${MARK}_DONE")
		quit()
		return
	_frame += 1
	_apply(_frame)


func _apply(frame: int) -> void:
	match frame:
${cases || "\t\t_:\n\t\t\tpass"}


func _sample() -> void:
	var values := {}
	for w: Array in WATCH:
		var node: Node = _scene.get_node_or_null(NodePath(w[0])) if w[0] != "." else _scene
		if node == null:
			values[w[2]] = "<no node>"
		else:
			var value: Variant = node.get_indexed(NodePath(w[1].trim_suffix("()")))
			# A method such as is_on_floor is read by calling it.
			if value is Callable:
				value = (value as Callable).call()
			values[w[2]] = var_to_str(value)
	print("${MARK} ", JSON.stringify([_frame, values]))


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
    const paths = new Set(parseResourceText(readFileSync(fromResPath(root, scene), "utf8")).nodes.map((n) => n.path));
    for (const w of watch) {
      const node = w.includes(".") ? w.slice(0, w.indexOf(".")) : ".";
      if (!paths.has(node)) warnings.push(`${node} is not a node in ${scene} (it may be made at run time)`);
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
  writeFileSync(file, playScript(scene, steps, watch, frames, every));
  try {
    // A fixed frame rate makes every run the same: one physics step per frame, whatever the machine.
    const result = await runGodot(bin, [...base, "--fixed-fps", String(fps), "-s", `res://${PLAY_DIR}/play.gd`], { cwd: root, timeoutMs });
    const samples: PlaySample[] = [];
    const rest: string[] = [];
    for (const line of result.stdout.split(/\r?\n/)) {
      if (line.startsWith(`${MARK} `)) {
        const [frame, values] = JSON.parse(line.slice(MARK.length + 1)) as [number, Record<string, string>];
        samples.push({ frame, values });
      } else if (!line.startsWith(`${MARK}_DONE`)) rest.push(line);
    }
    const diagnostics = parseGodotLog(result.stderr, "play").filter((d) => d.file !== `res://${PLAY_DIR}/play.gd` || d.severity === "error");
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
    };
  } finally {
    rmSync(file, { force: true });
  }
}

/** The samples as a table (one row per sampled frame, one column per watched value), then errors and prints. */
export function formatPlay(r: PlayReport): string {
  const input = r.steps.map((s) => `${s.frame} ${s.down ? "press" : "release"} ${s.input}`).join(", ");
  const out = [`play ${r.scene}: ${r.frames} physics frames at ${r.fps}/s${input ? `; input: ${input}` : ""}${r.finished ? "" : "; the run did NOT reach the last frame"}`];
  for (const w of r.warnings) out.push(`warning: ${w}`);
  if (r.watch.length && r.samples.length) {
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
