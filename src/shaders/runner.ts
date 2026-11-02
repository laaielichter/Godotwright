/**
 * The GDScript that compiles the project's shaders. Headless Godot uses the dummy renderer, which compiles nothing for
 * the GPU, so this runs with a window (a real display or xvfb) on the Compatibility renderer:
 *
 * 1. load every file it is given and find the shaders in it (a .gdshader, a Shader or VisualShader resource, or one
 *    embedded in a material, mesh or scene), then call get_shader_uniform_list() on each, which makes Godot's shader
 *    compiler parse it: language errors come out here, with the file and line;
 * 2. draw each shader for a few frames on an object that fits its shader_type (a box for spatial, a ColorRect for
 *    canvas_item, GPU particles for particles, the sky of a WorldEnvironment for sky): the OpenGL driver compiles and
 *    links the program only on its first draw, and errors it finds there (a uniform block too big for the GPU) name
 *    no file, so the shader being drawn is printed before each one.
 *
 * Fog shaders only exist in Forward+, which needs Vulkan or Direct3D 12; the Compatibility renderer refuses them. They
 * are parsed in a second, headless run (RENDER false, FOG true): the dummy renderer still runs the shader compiler.
 */
export const SHADER_MARK = "GODOTWRIGHT_SHADERS";

export interface RunnerOptions {
  /** res:// files to load. */
  files: string[];
  /** res:// folders whose shaders are skipped. */
  exclude: string[];
  /** Draw the shaders (false: only parse them). */
  render: boolean;
  /** Compile fog shaders (headless run) instead of the others. */
  fog: boolean;
  /** Frames each shader is drawn. */
  frames: number;
}

const SCRIPT = `extends SceneTree

const MARK: String = "GODOTWRIGHT_SHADERS"
const FILES: Array[String] = []
const EXCLUDE: Array[String] = []
const RENDER: bool = true
const FOG: bool = false
const FRAMES: int = 2

var _shaders: Array[Shader] = []
var _seen: Dictionary = {}
var _index: int = -1
var _tick: int = 0
var _started: int = 0
var _node: Node = null


func _initialize() -> void:
	# Autoloads are in the tree already, but not ready yet: one that changes the scene, quits or covers the screen
	# would stop or hide the check, so they go before they start.
	for child: Node in root.get_children():
		root.remove_child(child)
		child.free()
	for path: String in FILES:
		printerr(MARK + "_FILE\\t" + path)
		var res: Resource = ResourceLoader.load(path)
		if res == null:
			printerr(MARK + "_UNLOADABLE\\t" + path)
		else:
			_walk(res, path, 0)
	printerr(MARK + "_PARSED\\t" + str(_shaders.size()))
	if not RENDER:
		_done()
		quit(0)
		return
	var camera: Camera3D = Camera3D.new()
	root.add_child(camera)
	var sun: DirectionalLight3D = DirectionalLight3D.new()
	sun.rotation = Vector3(-0.8, 0.6, 0.0)
	root.add_child(sun)


func _process(_delta: float) -> bool:
	if not RENDER:
		return true
	if _index >= 0:
		_tick += 1
		if _tick == 1:
			printerr(MARK + "_MS\\t" + str(snappedf((Time.get_ticks_usec() - _started) / 1000.0, 0.1)) + "\\t" + _name(_shaders[_index]))
		if _tick < FRAMES:
			return false
		if _node != null:
			_node.queue_free()
			_node = null
	_index += 1
	if _index >= _shaders.size():
		_done()
		return true
	_tick = 0
	var shader: Shader = _shaders[_index]
	printerr(MARK + "_DRAW\\t" + _name(shader))
	_node = _show(shader)
	_started = Time.get_ticks_usec()
	return false


func _done() -> void:
	var adapter: String = RenderingServer.get_video_adapter_name()
	printerr(MARK + "_DONE\\t" + str(_shaders.size()) + "\\t" + RenderingServer.get_current_rendering_driver_name() + "\\t" + RenderingServer.get_current_rendering_method() + "\\t" + adapter)


func _name(shader: Shader) -> String:
	return shader.resource_path if shader.resource_path != "" else "(unnamed)"


func _excluded(path: String) -> bool:
	for folder: String in EXCLUDE:
		if path.begins_with(folder + "/"):
			return true
	return false


## Finds the shaders a loaded resource holds: itself, its properties, or the nodes of a scene.
func _walk(value: Variant, file: String, depth: int) -> void:
	if depth > 12:
		return
	if value is Shader:
		_found(value as Shader, file)
	elif value is PackedScene:
		var key: int = (value as Object).get_instance_id()
		if _seen.has(key):
			return
		_seen[key] = true
		var state: SceneState = (value as PackedScene).get_state()
		for node: int in state.get_node_count():
			for prop: int in state.get_node_property_count(node):
				_walk(state.get_node_property_value(node, prop), file, depth + 1)
	elif value is Resource:
		var res: Resource = value as Resource
		var key: int = res.get_instance_id()
		if _seen.has(key) or res is Script or res is Texture or res is AudioStream:
			return
		_seen[key] = true
		for prop: Dictionary in res.get_property_list():
			var kind: int = prop["type"]
			if (int(prop["usage"]) & PROPERTY_USAGE_STORAGE) != 0 and (kind == TYPE_OBJECT or kind == TYPE_ARRAY or kind == TYPE_DICTIONARY):
				_walk(res.get(prop["name"]), file, depth + 1)
	elif value is Array:
		for item: Variant in value:
			_walk(item, file, depth + 1)
	elif value is Dictionary:
		for item: Variant in (value as Dictionary).values():
			_walk(item, file, depth + 1)


func _found(shader: Shader, file: String) -> void:
	var key: int = shader.get_instance_id()
	if _seen.has(key):
		return
	_seen[key] = true
	var name: String = _name(shader)
	if _excluded(name):
		return
	var mode: int = shader.get_mode()
	printerr(MARK + "_SHADER\\t" + str(mode) + "\\t" + shader.get_class() + "\\t" + name + "\\t" + file)
	if (mode == Shader.MODE_FOG) != FOG:
		return
	# Parsing happens here, with errors as file:line.
	var _uniforms: Array = shader.get_shader_uniform_list()
	_shaders.append(shader)


## Puts the shader on something that draws it.
func _show(shader: Shader) -> Node:
	var material: ShaderMaterial = ShaderMaterial.new()
	material.shader = shader
	var node: Node
	match shader.get_mode():
		Shader.MODE_CANVAS_ITEM:
			var rect: ColorRect = ColorRect.new()
			rect.size = Vector2(96, 96)
			rect.material = material
			node = rect
		Shader.MODE_PARTICLES:
			var particles: GPUParticles3D = GPUParticles3D.new()
			particles.amount = 8
			particles.process_material = material
			particles.draw_pass_1 = QuadMesh.new()
			particles.position = Vector3(0.0, 0.0, -3.0)
			node = particles
		Shader.MODE_SKY:
			var environment: Environment = Environment.new()
			environment.background_mode = Environment.BG_SKY
			environment.sky = Sky.new()
			environment.sky.sky_material = material
			var world: WorldEnvironment = WorldEnvironment.new()
			world.environment = environment
			node = world
		_:
			var mesh: MeshInstance3D = MeshInstance3D.new()
			mesh.mesh = BoxMesh.new()
			mesh.material_override = material
			mesh.position = Vector3(0.0, 0.0, -3.0)
			mesh.rotation = Vector3(0.4, 0.6, 0.0)
			node = mesh
	root.add_child(node)
	return node
`;

/** The runner with its settings filled in. */
export function shaderRunnerSource(options: RunnerOptions): string {
  const list = (items: string[]) => items.map((p) => JSON.stringify(p)).join(", ");
  // Replacer functions, so "$" sequences in file names are inserted as written.
  return SCRIPT.replace("const FILES: Array[String] = []", () => `const FILES: Array[String] = [${list(options.files)}]`)
    .replace("const EXCLUDE: Array[String] = []", () => `const EXCLUDE: Array[String] = [${list(options.exclude)}]`)
    .replace("const RENDER: bool = true", () => `const RENDER: bool = ${options.render}`)
    .replace("const FOG: bool = false", () => `const FOG: bool = ${options.fog}`)
    .replace("const FRAMES: int = 2", () => `const FRAMES: int = ${Math.max(1, Math.round(options.frames))}`);
}
