class_name RocketFX
extends Node

## Exhaust of one RocketProjectile. Attached to the rocket (local frame): plume with Mach-diamond
## bands, nozzle glow and one exhaust light. In world space: a dense white solid-motor smoke trail
## (camera-facing ribbon plus puffs through FXDirector) that drifts with FXDirector.WIND, ends
## abruptly at burnout and lingers for TRAIL_LIFE. The motor lights once the rocket is IGNITE_DIST m
## out of the tube (the muzzle flash and ejection puff come from FXDirector.launch_burst).
## Sibling of the rocket, not a child, so the trail outlives it; frees itself when the trail is gone.
## set_thrust() takes a throttle 0..1 (1 = full motor thrust).

const NOZZLE_Z := 1.95
const FADE_TIME := 2.0           # s the rocket node stays after impact (RocketProjectile.FREE_DELAY)
const IGNITE_DIST := 7.0         # m the rocket centre travels before the motor lights (nozzle ~3 m past the mouth)
const IGNITE_RAMP := 0.06        # s to full plume
const SHUTDOWN := 0.25           # s plume collapse at burnout
const TRAIL_MAX := 72            # ribbon points (budget: <= ~72 per ribbon)
const SAMPLE_DT := 0.05          # s between ribbon points
const TRAIL_LIFE := 9.0          # s a ribbon point lives
const TRAIL_RISE := 0.25         # m/s, the warm smoke rises a little while it drifts
const PUFF_NEAR := 2.5           # m between smoke puffs close to the launcher
const PUFF_FAR := 12.0           # m between smoke puffs further out
const PUFF_NEAR_DIST := 60.0     # m
const PUFF_MAX := 70             # puffs per rocket
const PLUME_LEN := 7.5           # m at full thrust (sea level, solid motor)
const NOZZLE_R := 0.09           # m exit radius
const DIAMOND_SPACING := 0.36    # m, about 2 x exit diameter
## Mach diamonds are strong below DIAMOND_FADE_ALT.x and gone above .y (m above ground).
const DIAMOND_FADE_ALT := Vector2(1500.0, 6000.0)
const LIGHT_ENERGY := 10.0
const LIGHT_RANGE := 26.0
const MAX_LIGHTS := 2            # plume lights alive at once (budget: 1-2)
const GLOW_SIZE := 1.6           # m, nozzle glow sprite
const RING_SEGS := 20
const RING_ROWS := 24

const PLUME_CODE := """shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, shadows_disabled;

uniform float plume_length = 7.5;
uniform float nozzle_radius = 0.09;
uniform float intensity = 0.0;
uniform float diamonds = 1.0;
uniform float diamond_spacing = 0.36;
uniform vec3 core_color : source_color = vec3(1.0, 0.97, 0.88);
uniform vec3 edge_color : source_color = vec3(1.0, 0.6, 0.2);

varying float v_ax;
varying float v_len;

float hash21(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
		mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}

void vertex() {
	float ax = UV.y;
	float len = ax * plume_length;
	vec2 ring = VERTEX.xy;
	float flick = vnoise(vec2(UV.x * 9.0, len * 1.4 - TIME * 45.0));
	float d = len / diamond_spacing;
	float pinch = 1.0 - 0.14 * diamonds * (0.5 + 0.5 * cos(d * 6.2831853)) * (1.0 - smoothstep(1.0, 7.0, d));
	float r = (nozzle_radius * 1.1 + 0.04 * len + 0.003 * len * len) * pinch * (0.88 + 0.24 * flick * ax);
	v_ax = ax;
	v_len = len;
	VERTEX = vec3(ring * r, len);
	NORMAL = vec3(ring, 0.0);
}

void fragment() {
	float facing = abs(dot(normalize(NORMAL), normalize(VIEW)));
	float core = facing * facing;
	float d = v_len / diamond_spacing - 0.6;
	float fr = fract(d + 0.5) - 0.5;
	float band = d > -0.5 ? exp(-fr * fr * 36.0) * (1.0 - smoothstep(2.0, 7.0, d)) : 0.0;
	float hot = exp(-v_len * 0.5);
	vec3 col = mix(edge_color, core_color, clamp(hot * 1.3 + core * 0.45, 0.0, 1.0));
	col += core_color * band * diamonds * 1.8 * (0.3 + core);
	float a = intensity * smoothstep(0.0, 0.025, v_ax) * pow(1.0 - v_ax, 1.5) * (0.3 + 0.9 * core) * (0.65 + 0.9 * hot);
	ALBEDO = col;
	ALPHA = clamp(a, 0.0, 1.0);
}
""";

const TRAIL_CODE := """shader_type spatial;
render_mode unshaded, blend_mix, cull_disabled, depth_draw_never, shadows_disabled;

uniform sampler2D noise_tex : filter_linear_mipmap, repeat_enable;

void fragment() {
	float x = UV.x * 2.0 - 1.0;
	float n = texture(noise_tex, vec2(UV.y * 0.045, UV.x * 0.35 + UV.y * 0.011)).r;
	float n2 = texture(noise_tex, vec2(UV.y * 0.13 + 0.5, UV.x * 0.8)).r;
	float edge = 1.0 - smoothstep(0.2 + 0.35 * n, 1.0, abs(x));
	float shade = mix(0.82, 1.04, n2) * (1.0 - 0.12 * x);
	ALBEDO = COLOR.rgb * shade;
	ALPHA = clamp(COLOR.a * edge * (0.65 + 0.55 * n), 0.0, 1.0) * smoothstep(0.6, 4.0, -VERTEX.z);
}
""";

static var _cone_mesh: ArrayMesh = null
static var _plume_shader: Shader = null
static var _trail_shader: Shader = null
static var _glow_mat: StandardMaterial3D = null
static var _lights_on := 0

var _rocket: Node3D = null
var _world: AirbaseWorld = null
var _director: FXDirector = null
var _origin := Vector3.ZERO
var _has_origin := false
var _built := false
var _detached := false
var _ignited := false
var _has_light := false
var _thrust_target := 0.0
var _thrust := 0.0
var _clock := 0.0
var _sample_timer := 0.0
var _puff_acc := 0.0
var _puffs := 0
var _prev_nozzle := Vector3.ZERO
var _pts := PackedVector3Array()
var _birth := PackedFloat32Array()
var _plume: MeshInstance3D = null
var _plume_mat: ShaderMaterial = null
var _glow: MeshInstance3D = null
var _trail: MeshInstance3D = null
var _trail_mesh: ImmediateMesh = null
var _light: OmniLight3D = null


## launch_origin is the rocket centre in the tube; the motor lights IGNITE_DIST m from it.
func attach(rocket: Node3D, world: AirbaseWorld, launch_origin: Vector3 = Vector3.INF) -> void:
	_rocket = rocket
	_world = world
	_has_origin = launch_origin != Vector3.INF
	_origin = launch_origin if _has_origin else rocket.global_position


func set_thrust(t: float) -> void:
	if not _detached:
		_thrust_target = clampf(t, 0.0, 1.0)


## Motor off (burnout or impact): the plume collapses in SHUTDOWN s, the trail stops growing and
## lingers; this node frees itself when the last trail point has faded.
func detach_and_fade() -> void:
	if _detached:
		return
	_detached = true
	_thrust_target = 0.0
	_release_light()


func is_burning() -> bool:
	return _ignited and not _detached


func _process(delta: float) -> void:
	if not _built:
		_build()
		_built = true
	_clock += delta
	if not _detached and not is_instance_valid(_rocket):
		detach_and_fade()
	_drift_trail(delta)
	if not _detached:
		_update_motor(delta)
	else:
		_thrust = move_toward(_thrust, 0.0, delta / SHUTDOWN)
		if _thrust > 0.0 and is_instance_valid(_rocket):
			_place_exhaust(_nozzle())
		_set_exhaust_visible(_thrust > 0.002)
	_draw_trail()
	if _detached and _thrust <= 0.0 and _pts.is_empty():
		set_process(false)
		queue_free()


func _exit_tree() -> void:
	_release_light()


func _build() -> void:
	_director = FXDirector.for_world(_world if is_instance_valid(_world) else get_parent())
	_plume = MeshInstance3D.new()
	_plume.name = "Plume"
	_plume.mesh = _get_cone_mesh()
	_plume_mat = ShaderMaterial.new()
	_plume_mat.shader = _get_plume_shader()
	_plume_mat.set_shader_parameter(&"plume_length", PLUME_LEN)
	_plume_mat.set_shader_parameter(&"nozzle_radius", NOZZLE_R)
	_plume_mat.set_shader_parameter(&"diamond_spacing", DIAMOND_SPACING)
	_plume.material_override = _plume_mat
	_plume.custom_aabb = AABB(Vector3(-3.0, -3.0, -1.0), Vector3(6.0, 6.0, PLUME_LEN + 3.0))
	_plume.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_plume.visible = false
	add_child(_plume)

	var quad := QuadMesh.new()
	quad.size = Vector2.ONE * GLOW_SIZE
	_glow = MeshInstance3D.new()
	_glow.name = "NozzleGlow"
	_glow.mesh = quad
	_glow.material_override = _get_glow_mat()
	_glow.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_glow.visible = false
	add_child(_glow)

	_trail_mesh = ImmediateMesh.new()
	var trail_mat := ShaderMaterial.new()
	trail_mat.shader = _get_trail_shader()
	trail_mat.set_shader_parameter(&"noise_tex", FXDirector.noise_texture())
	_trail = MeshInstance3D.new()
	_trail.name = "Trail"
	_trail.mesh = _trail_mesh
	_trail.material_override = trail_mat
	_trail.top_level = true
	_trail.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_trail.custom_aabb = AABB(Vector3(-6000.0, -1000.0, -6000.0), Vector3(12000.0, 6000.0, 12000.0))
	add_child(_trail)

	_light = OmniLight3D.new()
	_light.name = "Exhaust"
	_light.light_color = Color(1.0, 0.72, 0.42)
	_light.omni_range = LIGHT_RANGE
	_light.shadow_enabled = false
	_light.light_energy = 0.0
	_light.visible = false
	add_child(_light)


func _nozzle() -> Transform3D:
	return _rocket.global_transform * Transform3D(Basis.IDENTITY, Vector3(0.0, 0.0, NOZZLE_Z))


func _update_motor(delta: float) -> void:
	var nozzle := _nozzle()
	if not _ignited:
		if _rocket.global_position.distance_to(_origin) < IGNITE_DIST:
			return
		_ignite(nozzle)
	_thrust = move_toward(_thrust, _thrust_target, delta / IGNITE_RAMP)
	_place_exhaust(nozzle)
	_set_exhaust_visible(_thrust > 0.002)
	var alt := nozzle.origin.y - AirbaseWorld.height_at(nozzle.origin.x, nozzle.origin.z)
	var diamonds := 1.0 - smoothstep(DIAMOND_FADE_ALT.x, DIAMOND_FADE_ALT.y, alt)
	_plume_mat.set_shader_parameter(&"diamonds", diamonds)
	_sample_trail(delta, nozzle.origin)
	_emit_puffs(nozzle)


func _ignite(nozzle: Transform3D) -> void:
	_ignited = true
	_prev_nozzle = nozzle.origin
	_sample_timer = 0.0
	if is_instance_valid(_director):
		_director.ignition(nozzle.origin, -nozzle.basis.z)
	if _lights_on < MAX_LIGHTS:
		_lights_on += 1
		_has_light = true


func _release_light() -> void:
	if _has_light:
		_has_light = false
		_lights_on = maxi(0, _lights_on - 1)


func _place_exhaust(nozzle: Transform3D) -> void:
	var flick := 0.85 + 0.15 * sin(_clock * 97.0) * sin(_clock * 61.0)
	_plume.global_transform = nozzle
	_plume_mat.set_shader_parameter(&"intensity", _thrust)
	_plume_mat.set_shader_parameter(&"plume_length", PLUME_LEN * (0.35 + 0.65 * _thrust) * (0.95 + 0.05 * flick))
	_glow.global_position = nozzle.origin + nozzle.basis.z * 0.35
	_glow.scale = Vector3.ONE * maxf(_thrust * flick, 0.01)
	_light.global_position = nozzle.origin + nozzle.basis.z * 1.2
	_light.light_energy = LIGHT_ENERGY * _thrust * flick


func _set_exhaust_visible(on: bool) -> void:
	_plume.visible = on
	_glow.visible = on
	_light.visible = on and _has_light


func _sample_trail(delta: float, p: Vector3) -> void:
	_sample_timer -= delta
	if _sample_timer > 0.0:
		return
	_sample_timer = SAMPLE_DT
	_pts.append(p)
	_birth.append(_clock)
	if _pts.size() > TRAIL_MAX:
		_pts.remove_at(0)
		_birth.remove_at(0)


# Puffs along the path since the last frame (sub-frame: the rocket covers several metres per frame).
func _emit_puffs(nozzle: Transform3D) -> void:
	var p := nozzle.origin
	var seg := p - _prev_nozzle
	var seg_len := seg.length()
	if seg_len < 1e-4 or not is_instance_valid(_director):
		_prev_nozzle = p
		return
	var back := nozzle.basis.z
	var from_launch := p.distance_to(_origin)
	var spacing := PUFF_NEAR if from_launch < PUFF_NEAR_DIST else PUFF_FAR
	_puff_acc += seg_len
	while _puff_acc >= spacing and _puffs < PUFF_MAX:
		_puff_acc -= spacing
		var q := p - seg * (_puff_acc / seg_len)
		_director.trail_puff(q, back, from_launch < PUFF_NEAR_DIST)
		_puffs += 1
	_prev_nozzle = p


# Trail points belong to the air: they drift with the wind and rise slowly; old ones are dropped.
func _drift_trail(delta: float) -> void:
	var drift := (FXDirector.WIND + Vector3.UP * TRAIL_RISE) * delta
	for i in _pts.size():
		_pts[i] += drift
	while not _birth.is_empty() and _clock - _birth[0] > TRAIL_LIFE:
		_pts.remove_at(0)
		_birth.remove_at(0)


# Camera-facing ribbon, one pair of vertices per point, widening and fading with age.
func _draw_trail() -> void:
	var pts := _pts.duplicate()
	var ages := PackedFloat32Array()
	for i in _birth.size():
		ages.append(_clock - _birth[i])
	if _ignited and not _detached and is_instance_valid(_rocket):
		pts.append(_nozzle().origin)
		ages.append(0.0)
	_trail_mesh.clear_surfaces()
	_trail.visible = pts.size() >= 2
	if pts.size() < 2:
		return
	var cam := get_viewport().get_camera_3d()
	var has_eye := is_instance_valid(cam)
	var eye := cam.global_position if has_eye else Vector3.ZERO
	var n := pts.size()
	var along := 0.0
	_trail_mesh.surface_begin(Mesh.PRIMITIVE_TRIANGLE_STRIP)
	for i in n:
		if i > 0:
			along += pts[i].distance_to(pts[i - 1])
		var tangent := pts[mini(i + 1, n - 1)] - pts[maxi(i - 1, 0)]
		if tangent.length_squared() < 1e-8:
			tangent = Vector3.UP
		var view := (pts[i] - eye) if has_eye else Vector3.UP
		var side := tangent.normalized().cross(view)
		if side.length_squared() < 1e-8:
			side = tangent.normalized().cross(Vector3.RIGHT)
		side = side.normalized()
		var k := clampf(ages[i] / TRAIL_LIFE, 0.0, 1.0)
		var w := 0.28 + 2.6 * sqrt(k)
		var c := Color(0.96, 0.96, 0.95).lerp(Color(0.86, 0.86, 0.87), k)
		c.a = 0.85 * pow(1.0 - k, 1.3) * smoothstep(0.0, 0.08, ages[i] + 0.02)
		_trail_mesh.surface_set_color(c)
		_trail_mesh.surface_set_uv(Vector2(0.0, along))
		_trail_mesh.surface_add_vertex(pts[i] - side * w)
		_trail_mesh.surface_set_color(c)
		_trail_mesh.surface_set_uv(Vector2(1.0, along))
		_trail_mesh.surface_add_vertex(pts[i] + side * w)
	_trail_mesh.surface_end()


## Ribbon points alive (for tests).
func trail_points() -> int:
	return _pts.size()


# Ring grid along z (UV.y = 0 at nozzle, 1 at tip); the shader does the shaping.
static func _get_cone_mesh() -> ArrayMesh:
	if _cone_mesh:
		return _cone_mesh
	var verts := PackedVector3Array()
	var norms := PackedVector3Array()
	var uvs := PackedVector2Array()
	var idx := PackedInt32Array()
	for j in RING_ROWS + 1:
		var z := float(j) / float(RING_ROWS)
		for i in RING_SEGS + 1:
			var a := TAU * float(i) / float(RING_SEGS)
			var d := Vector3(cos(a), sin(a), 0.0)
			verts.append(Vector3(d.x, d.y, z))
			norms.append(d)
			uvs.append(Vector2(float(i) / float(RING_SEGS), z))
	for j in RING_ROWS:
		for i in RING_SEGS:
			var a0 := j * (RING_SEGS + 1) + i
			var b0 := a0 + RING_SEGS + 1
			idx.append(a0)
			idx.append(b0)
			idx.append(a0 + 1)
			idx.append(a0 + 1)
			idx.append(b0)
			idx.append(b0 + 1)
	var arrays: Array = []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = norms
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_INDEX] = idx
	_cone_mesh = ArrayMesh.new()
	_cone_mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return _cone_mesh


static func _get_plume_shader() -> Shader:
	if _plume_shader == null:
		_plume_shader = Shader.new()
		_plume_shader.code = PLUME_CODE
	return _plume_shader


static func _get_trail_shader() -> Shader:
	if _trail_shader == null:
		_trail_shader = Shader.new()
		_trail_shader.code = TRAIL_CODE
	return _trail_shader


static func _get_glow_mat() -> StandardMaterial3D:
	if _glow_mat == null:
		var grad := Gradient.new()
		grad.colors = PackedColorArray([Color(1.0, 1.0, 1.0, 1.0), Color(1.0, 0.8, 0.5, 0.35), Color(1.0, 0.6, 0.3, 0.0)])
		grad.offsets = PackedFloat32Array([0.0, 0.25, 1.0])
		var tex := GradientTexture2D.new()
		tex.gradient = grad
		tex.fill = GradientTexture2D.FILL_RADIAL
		tex.fill_from = Vector2(0.5, 0.5)
		tex.fill_to = Vector2(1.0, 0.5)
		tex.width = 64
		tex.height = 64
		_glow_mat = StandardMaterial3D.new()
		_glow_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		_glow_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		_glow_mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		_glow_mat.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
		_glow_mat.billboard_keep_scale = true
		_glow_mat.no_depth_test = false
		_glow_mat.albedo_texture = tex
		_glow_mat.albedo_color = Color(1.0, 0.9, 0.72)
		_glow_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	return _glow_mat
