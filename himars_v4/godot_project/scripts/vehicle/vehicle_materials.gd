class_name VehicleMaterials
extends RefCounted
## Binds the generated texture sets (albedo, normal, ORM) to the HIMARS GLB materials by name.
## Only the names in BINDS change. Every other surface keeps its GLB material.
## The ORM packing is R = AO, G = roughness, B = metallic.

const TEX_DIR := "res://textures/"

# GLB material name -> texture set, metres per tile (from textures/manifest.json), albedo tint.
# paint_tan is not in the current GLB. It is listed so a tan paint works without code changes.
const BINDS := {
	"paint_od": {"set": "carc_green", "m": 1.6, "tint": Color(1, 1, 1)},  # v4: solid CARC Green 383 as in the photos
	"paint_tan": {"set": "camo_od", "m": 1.6, "tint": Color(0.8, 0.8, 0.8)},
	"steel": {"set": "steel", "m": 0.7, "tint": Color(1, 1, 1)},
	"steel_dark": {"set": "steel_dark", "m": 0.7, "tint": Color(1, 1, 1)},
	"rubber": {"set": "rubber", "m": 0.6, "tint": Color(1, 1, 1)},
	"canvas": {"set": "canvas", "m": 0.35, "tint": Color(1, 1, 1)},
	"interior_grey": {"set": "interior_grey", "m": 0.5, "tint": Color(1, 1, 1)},
}


## Walks root and every node below it. Each MeshInstance3D surface whose material name is in BINDS
## gets a surface override with the matching set. The override is per instance, so the shared mesh is untouched.
static func apply(root: Node) -> void:
	var made := {}  # GLB name -> StandardMaterial3D, shared by all surfaces with that name
	_walk(root, made)


static func _walk(node: Node, made: Dictionary) -> void:
	var mi := node as MeshInstance3D
	if mi != null and mi.mesh != null:
		for s in mi.mesh.get_surface_count():
			_bind_surface(mi, s, made)
	for child in node.get_children():
		_walk(child, made)


static func _bind_surface(mi: MeshInstance3D, s: int, made: Dictionary) -> void:
	# The name comes from the active material. If that is unnamed, use the surface's own material.
	var mat: Material = mi.get_active_material(s)
	if mat == null or mat.resource_name.is_empty():
		mat = mi.mesh.surface_get_material(s)
	if mat == null:
		return
	var nm := mat.resource_name
	if nm == "glass":
		if not made.has(nm):
			made[nm] = _make_glass()
		mi.set_surface_override_material(s, made[nm] as StandardMaterial3D)
		return
	if not BINDS.has(nm):
		return
	if not made.has(nm):
		made[nm] = _make(nm)
	var bound := made[nm] as StandardMaterial3D
	if bound != null:
		mi.set_surface_override_material(s, bound)


static func _make(nm: String) -> StandardMaterial3D:
	var bind: Dictionary = BINDS[nm]
	var set_name: String = bind["set"]
	var albedo := load(TEX_DIR + set_name + "_albedo.png") as Texture2D
	var normal := load(TEX_DIR + set_name + "_normal.png") as Texture2D
	var orm := load(TEX_DIR + set_name + "_orm.png") as Texture2D
	if albedo == null or normal == null or orm == null:
		push_warning("VehicleMaterials: texture set %s is missing, %s keeps the GLB material" % [set_name, nm])
		return null
	var tint: Color = bind["tint"]
	var metres: float = bind["m"]
	var m := StandardMaterial3D.new()
	m.resource_name = nm
	m.albedo_color = tint
	m.albedo_texture = albedo
	m.uv1_triplanar = true
	m.uv1_scale = Vector3(1, 1, 1) / metres
	m.normal_enabled = true
	m.normal_texture = normal
	m.ao_enabled = true
	m.ao_texture = orm
	m.ao_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_RED
	m.roughness = 1.0
	m.roughness_texture = orm
	m.roughness_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_GREEN
	m.metallic = 1.0
	m.metallic_texture = orm
	m.metallic_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_BLUE
	return m


## Tinted, see-through glass so the cab interior (seats, dashboard, fire-control console) is visible.
static func _make_glass() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.resource_name = "glass"
	m.albedo_color = Color(0.10, 0.16, 0.20, 0.22)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.roughness = 0.05
	m.metallic = 0.0
	m.specular_mode = BaseMaterial3D.SPECULAR_SCHLICK_GGX
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	return m
