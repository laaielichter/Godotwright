import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup } from "./check.js";
import { findGodot, godotVersion, runGodot } from "./godot.js";
import { MARKER, parseGodotLog, type Diagnostic } from "./log.js";

/**
 * Compiles shaders with real Godot, headless. Under --headless Godot's dummy renderer still runs the full shader
 * compiler, but only when a shader is used: load() alone does not compile it, get_rid() does. No display, no GPU and
 * no frame are needed, so this works in CI.
 */

export interface ShaderToCompile {
  /** `res://` path: a .gdshader file, a .tres whose root is a Shader, or `res://scene.tscn::Id` for one in a scene. */
  path: string;
  /** Code to compile instead of the file on disk (unsaved code, or code stored in a scene or resource). */
  code?: string;
  /** For code stored in a scene or resource: the line its first line is on there. */
  embedded?: number;
}

export interface ShaderCompileResult {
  godot: string;
  godotVersion: string;
  compiled: number;
  diagnostics: Diagnostic[];
  ms: number;
  timedOut: boolean;
}

const SCRIPT = `extends SceneTree

const MARKER: String = "${MARKER}"


func _initialize() -> void:
	var list: Array = JSON.parse_string(FileAccess.get_file_as_string(MANIFEST))
	for item: Dictionary in list:
		var path: String = item["path"]
		printerr(MARKER + "_SHADER " + path)
		var shader: Shader = null
		if item.has("code"):
			shader = Shader.new()
			# The path makes relative #include lines resolve as they do for the real resource.
			shader.resource_path = path
			shader.code = item["code"]
		else:
			shader = ResourceLoader.load(path, "", ResourceLoader.CACHE_MODE_IGNORE) as Shader
		if shader == null:
			printerr("ERROR: Failed to load shader: " + path)
		else:
			var _rid: RID = shader.get_rid()
		printerr(MARKER + "_END " + path)
	printerr(MARKER + "_DONE " + str(list.size()))
	quit(0)
`;

/** Compiles the given shaders of the project at `root` in one headless Godot run and returns Godot's errors with file:line. */
export async function compileShaders(root: string, shaders: ShaderToCompile[], options: { godot?: string; timeoutMs?: number } = {}): Promise<ShaderCompileResult> {
  const bin = findGodot(options.godot);
  const version = await godotVersion(bin);
  const dirName = `shaders-${process.pid}-${Date.now()}`;
  const dir = join(root, ".godot", "godotwright", dirName);
  const res = `res://.godot/godotwright/${dirName}`;
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(join(dir, "shaders.json"), JSON.stringify(shaders.map((s) => (s.code !== undefined ? { path: s.path, code: s.code } : { path: s.path }))));
    writeFileSync(join(dir, "compile.gd"), SCRIPT.replace('const MARKER: String', `const MANIFEST: String = "${res}/shaders.json"\nconst MARKER: String`));
    const result = await runGodot(bin, ["--headless", "--path", root, "--script", `${res}/compile.gd`], { cwd: root, timeoutMs: options.timeoutMs ?? 5 * 60_000 });
    const done = new RegExp(`${MARKER}_DONE (\\d+)`).exec(result.stderr);
    const offsets = new Map(shaders.filter((s) => s.embedded).map((s) => [s.path, s.embedded! - 1]));
    const diagnostics = cleanup(
      parseGodotLog(result.stderr, "shader")
        // Only what is about a project file: engine start-up messages are not the shaders' problem.
        .filter((d) => d.file?.startsWith("res://") && !d.file.startsWith(res))
        .map((d) => {
          const offset = d.file && d.line ? offsets.get(d.file) : undefined;
          return { ...d, source: "shader", ...(offset ? { line: d.line! + offset } : {}) };
        }),
    );
    if (!done && !result.timedOut) {
      const tail = result.stderr.trim().split(/\r?\n/).slice(-3).join(" | ").slice(0, 400);
      diagnostics.push({ severity: "error", message: `the shader compile run did not finish (exit code ${result.code}): ${tail || "(no output)"}`, source: "shader" });
    }
    if (result.timedOut) diagnostics.push({ severity: "error", message: `the shader compile run timed out after ${Math.round((options.timeoutMs ?? 300_000) / 1000)} s`, source: "shader" });
    return { godot: bin, godotVersion: version, compiled: done ? Number(done[1]) : 0, diagnostics, ms: result.ms, timedOut: result.timedOut };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
