import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { findGodot, runGodot } from "../check/godot.js";
import { parseGodotLog, type Diagnostic } from "../check/log.js";
import { parseProjectSettings } from "../godot/project-settings.js";
import { findProjectRoot, fromResPath } from "../project/files.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { BaselineError, baselineFiles, baselineName, compareBaseline, formatBaseline, readBaselineMeta, type BaselineMeta, type BaselineResult } from "./baseline.js";
import { imageStats } from "./diff.js";
import { decodePng, PngError } from "./png.js";

export class ScreenshotError extends Error {}

export type View = "front" | "back" | "side" | "top" | "iso";
export const VIEWS: View[] = ["front", "back", "side", "top", "iso"];

export interface ScreenshotOptions {
  godot?: string;
  /** A res:// scene of the project (default: the main scene). */
  scene?: string;
  /** A .glb/.gltf file to look at instead of a scene; it is framed by a camera and lit. */
  model?: string;
  /** Camera views for a model, or for a 3D scene without a camera (default: iso). Several make a grid. */
  views?: View[];
  width?: number;
  height?: number;
  /** Frames to run before the picture (default 10), so the scene has settled. */
  frames?: number;
  /** Where to write the PNG (default: .godot/godotwright/screenshot.png in the project, or next to the model). */
  out?: string;
  timeoutMs?: number;
  /** Compare the picture with the baseline of this name (made when it is missing); its settings fill in the rest. */
  baseline?: string;
  /** Replace the baseline with this picture. */
  update?: boolean;
  /** Folder for baselines (default .godotwright/baselines in the project). */
  baselineDir?: string;
  /** Make a missing baseline (default true); false reports it as missing, as CI does. */
  createMissing?: boolean;
  /** Per-channel tolerance 0..255 (default 16, or the baseline's). */
  tolerance?: number;
  /** Largest share of changed pixels in percent that still passes (default 0.1, or the baseline's). */
  maxChanged?: number;
}

export interface ScreenshotReport {
  file: string;
  width: number;
  height: number;
  /** What the picture is of: the scene, or the model and its views. */
  subject: string;
  views: View[];
  /** Share of the picture that is not background, and the box it fills, per view (or one for a scene). */
  coverage: { view: string; percent: number; box?: { x0: number; y0: number; x1: number; y1: number } }[];
  /** The res:// scene that was rendered (not set for a model). */
  scene?: string;
  /** True when Godot put a camera in because the 3D scene had none. */
  autoCamera: boolean;
  renderer: string;
  diagnostics: Diagnostic[];
  /** Set when the picture shows nothing useful: black, white, fully transparent or one colour. */
  blank?: string;
  /** Godot version and graphics driver that drew it. */
  godot?: string;
  adapter?: string;
  /** The comparison with a baseline, when one was asked for. */
  baseline?: BaselineResult;
}

const MARK = "GODOTWRIGHT_SHOT";

/** How to give Godot a screen: the real one, or a virtual one with xvfb-run on a Linux machine without a display. */
export function screen(): { command: string; prefix: string[] } | { error: string } {
  if (process.platform !== "linux" || process.env["DISPLAY"] || process.env["WAYLAND_DISPLAY"]) return { command: "", prefix: [] };
  if (spawnSync("which", ["xvfb-run"]).status === 0) return { command: "xvfb-run", prefix: ["-a", "-s", "-screen 0 1920x1080x24"] };
  return { error: "no screen to render on: this Linux machine has no display and no xvfb-run. Install it (sudo apt-get install xvfb libgl1-mesa-dri) and try again." };
}

/** The script that loads the scene or model, frames it when needed, renders and writes the PNG and the coverage. */
export function screenshotScript(o: { scene?: string; model?: string; views: View[]; frames: number; out: string; width: number; height: number }): string {
  const views = JSON.stringify(o.views);
  return `extends SceneTree
# Written by godotwright screenshot; removed after the run.

const VIEWS: Array = ${views}
const FRAMES := ${o.frames}
const OUT := ${JSON.stringify(o.out)}
const BACKGROUND := Color(0.3, 0.3, 0.3)

var _frame := 0
var _content: Node
var _camera: Camera3D
var _images: Array[Image] = []
var _view := 0
var _auto := false


func _initialize() -> void:
	RenderingServer.set_default_clear_color(BACKGROUND)
	${o.model ? `_content = _load_model(${JSON.stringify(o.model)})` : `var packed := load(${JSON.stringify(o.scene ?? "")}) as PackedScene
	_content = packed.instantiate() if packed != null else null`}
	if _content == null:
		printerr("${MARK}_FAILED could not load ${o.model ?? o.scene}")
		quit(1)
		return
	root.add_child(_content)
	process_frame.connect(_tick)


func _load_model(path: String) -> Node:
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	if doc.append_from_file(path, state) != OK:
		return null
	return doc.generate_scene(state)


func _tick() -> void:
	_frame += 1
	if _frame == 2:
		_place_camera()
	if _frame < FRAMES:
		return
	_images.append(root.get_texture().get_image())
	_view += 1
	if _auto and _view < VIEWS.size():
		_aim(VIEWS[_view])
		_frame = FRAMES - 3
		return
	_finish()


## A 3D scene without a camera (and every model) gets one that frames everything that is drawn.
func _place_camera() -> void:
	if _content is Node2D or _content is Control:
		return
	if root.get_viewport().get_camera_3d() != null:
		return
	_auto = true
	_camera = Camera3D.new()
	root.add_child(_camera)
	_camera.current = true
	if root.find_children("*", "Light3D", true, false).is_empty():
		var light := DirectionalLight3D.new()
		light.rotation_degrees = Vector3(-50, 35, 0)
		light.light_energy = 1.2
		root.add_child(light)
		var env := WorldEnvironment.new()
		env.environment = Environment.new()
		env.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
		env.environment.ambient_light_color = Color(0.55, 0.55, 0.6)
		root.add_child(env)
	_aim(VIEWS[0])


func _bounds() -> AABB:
	var box := AABB()
	var first := true
	for node: Node in root.find_children("*", "VisualInstance3D", true, false):
		var visual := node as VisualInstance3D
		if visual is Light3D:
			continue
		var part := visual.global_transform * visual.get_aabb()
		box = part if first else box.merge(part)
		first = false
	return box if not first else AABB(Vector3(-1, -1, -1), Vector3(2, 2, 2))


func _aim(view: String) -> void:
	var box := _bounds()
	var centre := box.get_center()
	var radius := maxf(box.size.length() * 0.5, 0.01)
	# Models face +Z, so "front" looks at them from +Z.
	var directions := {"front": Vector3(0, 0.15, 1), "back": Vector3(0, 0.15, -1), "side": Vector3(1, 0.15, 0), "top": Vector3(0, 1, 0.001), "iso": Vector3(1, 0.8, 1)}
	var direction: Vector3 = (directions.get(view, Vector3(1, 0.8, 1)) as Vector3).normalized()
	var up := Vector3.UP if view != "top" else Vector3(0, 0, -1)
	# Point the camera first, then find the distance at which every corner of the box is inside the
	# picture with a margin: corner offset across / (distance - corner offset towards the camera) <= tan(half fov).
	_camera.look_at_from_position(centre + direction, centre, up)
	var basis := _camera.global_transform.basis
	var size := Vector2(root.get_viewport().get_visible_rect().size)
	var tan_v := tan(deg_to_rad(_camera.fov * 0.5)) * 0.85
	var tan_h := tan_v * size.x / size.y
	var distance := 0.0
	for i in 8:
		var offset := box.get_endpoint(i) - centre
		var across := absf(offset.dot(basis.x))
		var upward := absf(offset.dot(basis.y))
		var towards := offset.dot(basis.z)
		distance = maxf(distance, maxf(towards + across / tan_h, towards + upward / tan_v))
	distance = maxf(distance, radius * 0.1)
	_camera.near = maxf(distance * 0.01, 0.01)
	_camera.far = distance * 4.0 + radius * 4.0
	_camera.look_at_from_position(centre + direction * distance, centre, up)


func _finish() -> void:
	var first := _images[0]
	var w := first.get_width()
	var h := first.get_height()
	var columns := 1 if _images.size() == 1 else 2
	var rows := ceili(float(_images.size()) / columns)
	var sheet := Image.create(w * columns, h * rows, false, first.get_format())
	sheet.fill(BACKGROUND)
	for i in _images.size():
		var image := _images[i]
		sheet.blit_rect(image, Rect2i(0, 0, w, h), Vector2i((i % columns) * w, (i / columns) * h))
		print("${MARK}_VIEW ", JSON.stringify(_coverage(image, VIEWS[i] if _auto else "scene")))
	sheet.save_png(OUT)
	var version: Dictionary = Engine.get_version_info()
	print("${MARK}_ENV ", JSON.stringify({"godot": version.get("string", ""), "adapter": RenderingServer.get_video_adapter_name()}))
	print("${MARK}_DONE ", sheet.get_width(), " ", sheet.get_height(), " ", _auto, " ", RenderingServer.get_current_rendering_method())
	quit()


## How much of the picture is not background, and where: enough for a model that cannot see the image.
## It compares with the clear colour, not with a corner pixel: a panel in the corner is drawn too.
func _coverage(image: Image, view: String) -> Dictionary:
	var w := image.get_width()
	var h := image.get_height()
	var bg := BACKGROUND
	var x0 := w
	var y0 := h
	var x1 := -1
	var y1 := -1
	var count := 0
	var step := 2
	for y in range(0, h, step):
		for x in range(0, w, step):
			var c := image.get_pixel(x, y)
			if absf(c.r - bg.r) + absf(c.g - bg.g) + absf(c.b - bg.b) > 0.06:
				count += 1
				x0 = mini(x0, x)
				y0 = mini(y0, y)
				x1 = maxi(x1, x)
				y1 = maxi(y1, y)
	var total := ceili(float(w) / step) * ceili(float(h) / step)
	var result := {"view": view, "percent": snappedf(100.0 * count / total, 0.1)}
	if count > 0:
		result["box"] = {"x0": x0, "y0": y0, "x1": x1, "y1": y1}
	return result
`;
}

/**
 * Renders a scene, or a .glb model, to a PNG with Godot (the Compatibility renderer, which also runs on software
 * OpenGL), and says how much of the picture is drawn, so an agent can look at its work. With `baseline` it also
 * compares the picture with the stored one of that name.
 */
export async function takeScreenshot(path: string, options: ScreenshotOptions = {}): Promise<ScreenshotReport> {
  if (!options.baseline) return render(path, options);
  let name: string;
  try {
    name = baselineName(options.baseline);
  } catch (error) {
    throw new ScreenshotError((error as Error).message);
  }
  // Baselines belong to the project; a model outside a project keeps them in the folder given.
  const root = findProjectRoot(path) ?? resolve(path);
  const meta = readBaselineMeta(root, name, options.baselineDir);
  if (meta?.scenario) throw new ScreenshotError(`baseline ${name} belongs to the scenario ${meta.scenario}; run that scenario to compare it`);
  const settings = { ...options };
  if (meta) {
    const stored: Partial<ScreenshotOptions> = {
      ...(meta.scene ? { scene: meta.scene } : {}),
      ...(meta.model ? { model: resolve(root, meta.model) } : {}),
      ...(meta.views?.length ? { views: meta.views as View[] } : {}),
      width: meta.width,
      height: meta.height,
      frames: meta.frames,
    };
    if (!options.update) {
      const normal = (k: keyof ScreenshotOptions, v: unknown) => (k === "model" && typeof v === "string" ? (isAbsolute(v) ? v : resolve(path, v)) : k === "scene" && typeof v === "string" && !v.startsWith("res://") ? `res://${v.replace(/^\/+/, "")}` : v);
      const asked = (k: keyof ScreenshotOptions, v: unknown, shown: string) => (v === undefined || JSON.stringify(normal(k, v)) === JSON.stringify(normal(k, stored[k])) ? [] : [`${k} ${shown}`]);
      const differ = [
        ...asked("scene", options.scene, `${options.scene} (baseline: ${meta.scene ?? "a model"})`),
        ...asked("model", options.model, `${options.model} (baseline: ${meta.model ?? "a scene"})`),
        ...asked("views", options.views, `${options.views?.join(",")} (baseline: ${meta.views?.join(",") ?? "none"})`),
        ...asked("width", options.width, `${options.width} (baseline: ${meta.width})`),
        ...asked("height", options.height, `${options.height} (baseline: ${meta.height})`),
        ...asked("frames", options.frames, `${options.frames} (baseline: ${meta.frames})`),
      ];
      if (differ.length) throw new ScreenshotError(`baseline ${name} was taken with other settings: ${differ.join(", ")}. Leave them out to compare like for like, or pass update to replace the baseline.`);
    }
    for (const [k, v] of Object.entries(stored) as [keyof ScreenshotOptions, never][]) if (settings[k] === undefined) settings[k] = v;
  }
  const files = baselineFiles(root, name, options.baselineDir);
  const report = await render(path, { ...settings, out: options.out ?? files.actual });
  const model = settings.model ? (isAbsolute(settings.model) ? settings.model : resolve(path, settings.model)) : undefined;
  const taken: BaselineMeta = {
    ...(report.scene ? { scene: report.scene } : {}),
    ...(model ? { model: relative(root, model).split(sep).join("/") } : {}),
    ...(report.views.length ? { views: report.views } : settings.views?.length ? { views: settings.views } : {}),
    width: settings.width ?? 640,
    height: settings.height ?? 360,
    frames: Math.max(3, settings.frames ?? 10),
    renderer: report.renderer,
    ...(report.godot ? { godot: report.godot } : {}),
    ...(report.adapter ? { adapter: report.adapter } : {}),
  };
  try {
    report.baseline = compareBaseline(root, name, report.file, {
      ...(options.baselineDir ? { dir: options.baselineDir } : {}),
      ...(options.update ? { update: true } : {}),
      ...(options.createMissing === false ? { createMissing: false } : {}),
      ...(options.tolerance !== undefined ? { tolerance: options.tolerance } : {}),
      ...(options.maxChanged !== undefined ? { maxChanged: options.maxChanged } : {}),
      meta: taken,
    });
  } catch (error) {
    if (error instanceof BaselineError) throw new ScreenshotError(error.message);
    throw error;
  }
  return report;
}

async function render(path: string, options: ScreenshotOptions): Promise<ScreenshotReport> {
  const width = options.width ?? 640;
  const height = options.height ?? 360;
  if (!(width >= 16 && width <= 3840 && height >= 16 && height <= 2160)) throw new ScreenshotError("size must be from 16x16 to 3840x2160");
  const frames = Math.max(3, options.frames ?? 10);
  const views = options.views?.length ? options.views : ["iso" as View];
  for (const v of views) if (!VIEWS.includes(v)) throw new ScreenshotError(`"${v}" is not a view; use ${VIEWS.join(", ")}`);

  let root: string;
  let temp: string | undefined;
  let scene: string | undefined;
  let model: string | undefined;
  if (options.model) {
    model = isAbsolute(options.model) ? options.model : resolve(path, options.model);
    if (!existsSync(model)) throw new ScreenshotError(`${options.model} does not exist`);
    if (!/\.(glb|gltf)$/i.test(model)) throw new ScreenshotError("a model is a .glb or .gltf file");
    // Godot needs a project to run in; an empty one is enough to load a glTF file at run time.
    temp = mkdtempSync(join(tmpdir(), "godotwright-shot-"));
    writeFileSync(join(temp, "project.godot"), 'config_version=5\n\n[application]\n\nconfig/name="Screenshot"\n\n[rendering]\n\nrenderer/rendering_method="gl_compatibility"\n');
    root = temp;
  } else {
    const found = findProjectRoot(path);
    if (!found) throw new ProjectNotFoundError(path);
    root = found;
    const settings = parseProjectSettings(readFileSync(join(root, "project.godot"), "utf8"));
    scene = options.scene ? (options.scene.startsWith("res://") ? options.scene : `res://${options.scene.replace(/^\/+/, "")}`) : settings.mainScene;
    if (!scene) throw new ScreenshotError("no scene: pass --scene res://..., or set a main scene (application/run/main_scene)");
    if (!existsSync(fromResPath(root, scene))) throw new ScreenshotError(`${scene} does not exist in the project`);
  }
  const how = screen();
  if ("error" in how) {
    if (temp) rmSync(temp, { recursive: true, force: true });
    throw new ScreenshotError(how.error);
  }
  const out = resolve(options.out ?? (model ? model.replace(/\.(glb|gltf)$/i, ".png") : join(root, ".godot", "godotwright", "screenshot.png")));
  mkdirSync(dirname(out), { recursive: true });
  rmSync(out, { force: true });

  const dir = join(root, ".godot", "godotwright");
  mkdirSync(dir, { recursive: true });
  const script = join(dir, "screenshot.gd");
  writeFileSync(script, screenshotScript({ ...(scene ? { scene } : {}), ...(model ? { model } : {}), views, frames, out, width, height }));
  const bin = findGodot(options.godot);
  const timeoutMs = options.timeoutMs ?? 3 * 60_000;
  try {
    if (!model) await runGodot(bin, ["--headless", "--path", root, "--import"], { cwd: root, timeoutMs });
    // A fixed frame rate makes every run draw the same frames: anything driven by delta (animations, shaders on
    // TIME read through a script, tweens) is at the same point each time, so baselines compare like for like.
    const godotArgs = ["--path", root, "--rendering-driver", "opengl3", "--rendering-method", "gl_compatibility", "--resolution", `${width}x${height}`, "--audio-driver", "Dummy", "--fixed-fps", "60", "-s", "res://.godot/godotwright/screenshot.gd"];
    const result = how.command ? await runGodot(how.command, [...how.prefix, bin, ...godotArgs], { cwd: root, timeoutMs }) : await runGodot(bin, godotArgs, { cwd: root, timeoutMs });
    const done = new RegExp(`^${MARK}_DONE (\\d+) (\\d+) (true|false) (\\S+)`, "m").exec(result.stdout);
    const diagnostics = parseGodotLog(result.stderr, "screenshot").filter((d) => d.severity === "error" && !/V-Sync|ALSA|audio/i.test(d.message));
    if (!done || !existsSync(out)) {
      const why = result.stderr.includes(`${MARK}_FAILED`) ? `Godot could not load ${options.model ?? scene}` : `Godot did not finish the picture (exit code ${result.code}${result.timedOut ? ", timed out" : ""})`;
      throw new ScreenshotError(`${why}${diagnostics.length ? `: ${diagnostics.slice(0, 3).map((d) => d.message).join("; ")}` : ""}`);
    }
    const coverage = [...result.stdout.matchAll(new RegExp(`^${MARK}_VIEW (.+)$`, "gm"))].map((m) => JSON.parse(m[1] ?? "{}") as ScreenshotReport["coverage"][number]);
    const autoCamera = done[3] === "true";
    const env = /^GODOTWRIGHT_SHOT_ENV (.+)$/m.exec(result.stdout);
    const machine = env ? (JSON.parse(env[1] ?? "{}") as { godot?: string; adapter?: string }) : {};
    let blank: string | undefined;
    try {
      blank = imageStats(decodePng(readFileSync(out))).blank;
    } catch (error) {
      if (!(error instanceof PngError)) throw error;
      blank = `Godot wrote a PNG this reader cannot check: ${error.message}`;
    }
    return {
      file: out,
      width: Number(done[1]),
      height: Number(done[2]),
      subject: model ? `model ${options.model}` : `scene ${scene}`,
      views: autoCamera ? views : [],
      coverage,
      autoCamera,
      renderer: done[4] ?? "",
      diagnostics,
      ...(scene ? { scene } : {}),
      ...(blank ? { blank } : {}),
      ...(machine.godot ? { godot: machine.godot } : {}),
      ...(machine.adapter ? { adapter: machine.adapter } : {}),
    };
  } finally {
    rmSync(script, { force: true });
    if (temp) rmSync(temp, { recursive: true, force: true });
  }
}

/** A few lines about the picture, for agents that cannot read images, and the file to open for those that can. */
export function formatScreenshot(r: ScreenshotReport, accept = "run again with update: true"): string {
  const out = [`screenshot of ${r.subject}: ${r.file} (${r.width}x${r.height}, ${r.renderer} renderer${r.autoCamera ? `, camera placed by Godotwright: ${r.views.join(", ")}` : ""})`];
  for (const c of r.coverage) {
    const where = c.box ? `, from (${c.box.x0}, ${c.box.y0}) to (${c.box.x1}, ${c.box.y1})` : "";
    const hint = c.percent === 0 ? "  <- nothing drawn: the camera sees nothing, or everything is off screen" : c.percent > 97 ? "  <- the picture is full: the camera may be inside something" : "";
    out.push(`  ${c.view}: ${c.percent}% drawn${where}${hint}`);
  }
  if (r.blank) out.push(`  warning: the picture is blank: ${r.blank}`);
  for (const d of r.diagnostics.slice(0, 10)) out.push(`  error: ${d.file ? `${d.file}${d.line ? `:${d.line}` : ""}  ` : ""}${d.message}`);
  if (r.baseline) out.push(...formatBaseline({ ...r.baseline, blank: undefined }, accept));
  return `${out.join("\n")}\n`;
}
