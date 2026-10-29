class_name RocketProjectile
extends Node3D

## Ballistic GMLRS-type rocket: motor burn, drag, ground impact.
## Local space: nose -Z, nozzle at +Z (RocketFX.NOZZLE_Z), origin at the centre.
## launch() also plays the pooled launch FX of the tube (FXDirector.launch_burst). The class keeps a
## count of rockets in flight (in_flight()) and each rocket predicts its impact point and time, so the
## camera can hand over to the impact view before the hit and react only to the last rocket of a salvo.

signal impacted(pos: Vector3, normal: Vector3, speed: float)
signal burnout()

const GRAVITY := 9.81
const RHO_0 := 1.225
const RHO_SCALE_H := 8500.0
const DRAG_CD := 0.3
const BODY_RADIUS := 0.114
const DRAG_AREA := PI * BODY_RADIUS * BODY_RADIUS
const SUB_DT := 1.0 / 120.0
const MAX_FRAME_DT := 1.0 / 30.0
const FREE_DELAY := RocketFX.FADE_TIME  # s after impact before the node is freed (the trail lives on in RocketFX)
const MAX_FLIGHT := 60.0                # s, a shot that has not landed by then is not solved
const SLOPE_STEP := 1.0
const GLB_PATH := "res://models/gmlrs_rocket.glb"

@export var burn_time := 3.4         # s
@export var thrust := 24000.0        # N during the burn
@export var mass := 306.0            # kg, constant: propellant mass loss is not modelled
## Passed as the size argument of world.spawn_explosion (m). GMLRS-type warhead.
@export var warhead_size := 0.6
## Used as the visual when the GLB is missing: its meshes are duplicated and its
## own transform is reset, so its meshes must be authored nose -Z.
var visual_template: Node3D = null

var _world: AirbaseWorld = null
var _launched := false
var _done := false
var _burnt := false
var _fx_made := false
var _age := 0.0
var _free_left := 0.0
var _pos := Vector3.ZERO
var _pos_prev := Vector3.ZERO
var _vel := Vector3.ZERO
var _launch_dir := Vector3.FORWARD
var _visual: Node3D = null
var _fx: RocketFX = null
var _launch_origin := Vector3.ZERO
var _counted := false
var _pred_hit := Vector3.INF
var _pred_at := INF                  # flight age (s) at which the predicted impact happens

static var _in_flight := 0


## Rockets launched and not yet impacted (or freed).
static func in_flight() -> int:
	return _in_flight

## Call after the rocket is in the scene tree. start is a global transform.
func launch(start: Transform3D, dir: Vector3, v0: float, world: AirbaseWorld) -> void:
	if _launched:
		return
	_launched = true
	_world = world
	var d := dir.normalized()
	_launch_dir = d if d.length_squared() > 0.5 else -start.basis.z
	_pos = start.origin
	_pos_prev = _pos
	_vel = _launch_dir * v0
	_launch_origin = _pos
	_counted = true
	_in_flight += 1
	_visual = _make_visual()
	add_child(_visual)
	_set_pose(Transform3D(_look_basis(), _pos))
	_update_prediction()
	var director := FXDirector.for_world(world if is_instance_valid(world) else get_parent())
	if director != null:
		director.launch_burst(start, _launch_dir)


func is_burning() -> bool:
	return _launched and not _done and not _burnt


func is_done() -> bool:
	return _done


func velocity() -> Vector3:
	return _vel


func flight_age() -> float:
	return _age


func launch_origin() -> Vector3:
	return _launch_origin


## Predicted ground impact (Vector3.INF when it does not come down within MAX_FLIGHT).
func predicted_impact() -> Vector3:
	return _pred_hit


## Seconds of flight left until the predicted impact (INF when unknown).
func time_to_impact() -> float:
	return maxf(_pred_at - _age, 0.0) if _pred_at < INF else INF


func _physics_process(delta: float) -> void:
	if not _launched:
		return
	if _done:
		_free_left -= delta
		if _free_left <= 0.0:
			set_physics_process(false)
			queue_free()
		return
	_pos_prev = _pos
	var dt := clampf(delta, 0.0, MAX_FRAME_DT)
	var steps := maxi(1, ceili(dt / SUB_DT - 1e-6))
	var h := dt / float(steps)
	for _i in steps:
		if _substep(h):
			return


func _process(_delta: float) -> void:
	if not _launched or _done:
		return
	if not _fx_made:
		_make_fx()
	var f := clampf(Engine.get_physics_interpolation_fraction(), 0.0, 1.0)
	_set_pose(Transform3D(_look_basis(), _pos_prev.lerp(_pos, f)))


func _exit_tree() -> void:
	_uncount()
	if is_instance_valid(_fx):
		_fx.detach_and_fade()


func _uncount() -> void:
	if _counted:
		_counted = false
		_in_flight = maxi(0, _in_flight - 1)


# Semi-implicit Euler step. Returns true when the rocket hit the ground.
func _substep(h: float) -> bool:
	var prev := _pos
	_vel += _accel(_pos, _vel, _age, _launch_dir) * h
	_pos += _vel * h
	_age += h
	if not _burnt and _age >= burn_time:
		_end_burn()
	return _check_ground(prev)


# Acceleration (m/s^2) at pos and vel, age s after launch: gravity, drag, and thrust while burning.
func _accel(pos: Vector3, vel: Vector3, age: float, launch_dir: Vector3) -> Vector3:
	var rho := RHO_0 * exp(-pos.y / RHO_SCALE_H)
	var m := maxf(mass, 0.001)
	var force := Vector3(0.0, -GRAVITY * m, 0.0) - vel * (0.5 * rho * DRAG_CD * DRAG_AREA * vel.length())
	if age < burn_time:
		var td: Vector3 = vel.normalized() if vel.length_squared() > 1e-4 else launch_dir
		force += td * thrust
	return force / m


func _check_ground(prev: Vector3) -> bool:
	if _off_map(_pos):
		_impact(_edge_point(_pos), _vel.length())
		return true
	if _pos.y > AirbaseWorld.height_at(_pos.x, _pos.z):
		return false
	_impact(_ground_hit(prev, _pos), _vel.length())
	return true


# Where the flight segment prev -> now meets the ground, on the ground.
static func _ground_hit(prev: Vector3, now: Vector3) -> Vector3:
	var prev_clear := prev.y - AirbaseWorld.height_at(prev.x, prev.z)
	var denom := prev_clear - (now.y - AirbaseWorld.height_at(now.x, now.z))
	var f := 0.0 if denom <= 1e-9 else clampf(prev_clear / denom, 0.0, 1.0)
	var hit := prev.lerp(now, f)
	hit.y = AirbaseWorld.height_at(hit.x, hit.z)
	return hit


# The drawn map ends at HALF. A rocket that leaves it detonates on the edge, not over unseen ground.
static func _off_map(p: Vector3) -> bool:
	return absf(p.x) > AirbaseWorld.HALF or absf(p.z) > AirbaseWorld.HALF


static func _edge_point(p: Vector3) -> Vector3:
	var e := Vector3(clampf(p.x, -AirbaseWorld.HALF, AirbaseWorld.HALF), 0.0, clampf(p.z, -AirbaseWorld.HALF, AirbaseWorld.HALF))
	e.y = AirbaseWorld.height_at(e.x, e.z)
	return e


## Ground point where a rocket launched from start along dir at speed v0 comes down. Same integration
## and map rule as the flight, with no side effects: call it on a scratch instance outside the tree.
## Vector3.INF when it does not come down within MAX_FLIGHT.
func predict_landing(start: Vector3, dir: Vector3, v0: float) -> Vector3:
	var d := dir.normalized()
	var hit := _simulate(start, d * v0, 0.0, d)
	return Vector3(hit.x, hit.y, hit.z) if hit.w < INF else Vector3.INF


# Integrates from a flight state to the ground. xyz = impact point, w = flight age at impact (INF if none).
func _simulate(start: Vector3, vel0: Vector3, age0: float, d: Vector3) -> Vector4:
	var pos := start
	var vel := vel0
	var age := age0
	for _i in int(maxf(MAX_FLIGHT - age0, 0.0) / SUB_DT):
		var prev := pos
		vel += _accel(pos, vel, age, d) * SUB_DT
		pos += vel * SUB_DT
		age += SUB_DT
		var hit := Vector3.INF
		if _off_map(pos):
			hit = _edge_point(pos)
		elif pos.y <= AirbaseWorld.height_at(pos.x, pos.z):
			hit = _ground_hit(prev, pos)
		if hit != Vector3.INF:
			return Vector4(hit.x, hit.y, hit.z, age)
	return Vector4(0.0, 0.0, 0.0, INF)


func _update_prediction() -> void:
	var hit := _simulate(_pos, _vel, _age, _launch_dir)
	_pred_at = hit.w
	_pred_hit = Vector3(hit.x, hit.y, hit.z) if hit.w < INF else Vector3.INF


func _end_burn() -> void:
	_burnt = true
	if is_instance_valid(_fx):
		_fx.detach_and_fade()
	_update_prediction()
	burnout.emit()


func _impact(hit: Vector3, speed: float) -> void:
	_done = true
	_pos = hit
	_free_left = FREE_DELAY
	var normal := _ground_normal(hit.x, hit.z)
	if is_instance_valid(_visual):
		_visual.visible = false
	if is_instance_valid(_fx):
		_fx.detach_and_fade()
	_pred_hit = hit
	_pred_at = _age
	# Counted out before the signal, so listeners see whether other rockets are still flying.
	_uncount()
	impacted.emit(hit, normal, speed)
	if is_instance_valid(_world):
		_world.spawn_explosion(hit, normal, warhead_size)
	else:
		ExplosionFX.spawn(get_parent(), hit, normal, warhead_size)


static func _ground_normal(x: float, z: float) -> Vector3:
	var s := SLOPE_STEP
	var dx := (AirbaseWorld.height_at(x + s, z) - AirbaseWorld.height_at(x - s, z)) / (2.0 * s)
	var dz := (AirbaseWorld.height_at(x, z + s) - AirbaseWorld.height_at(x, z - s)) / (2.0 * s)
	return Vector3(-dx, 1.0, -dz).normalized()


func _thrust_dir() -> Vector3:
	return _vel.normalized() if _vel.length_squared() > 1e-4 else _launch_dir


func _look_basis() -> Basis:
	var fwd := _thrust_dir()
	var up := Vector3.UP if absf(fwd.y) < 0.99 else Vector3.BACK
	return Basis.looking_at(fwd, up)


func _set_pose(xf: Transform3D) -> void:
	if is_inside_tree():
		global_transform = xf
	else:
		transform = xf


# The FX is a sibling, not a child, so its trail can fade after this rocket is freed.
func _make_fx() -> void:
	var host := get_parent()
	if host == null:
		return
	_fx_made = true
	_fx = RocketFX.new()
	_fx.name = "RocketFX"
	host.add_child(_fx)
	_fx.attach(self, _world, _launch_origin)
	_fx.set_thrust(1.0)


func _make_visual() -> Node3D:
	if ResourceLoader.exists(GLB_PATH):
		var packed := load(GLB_PATH) as PackedScene
		if packed:
			var inst := packed.instantiate() as Node3D
			if inst:
				return inst
	if is_instance_valid(visual_template):
		var copy := visual_template.duplicate() as Node3D
		if copy:
			copy.transform = Transform3D.IDENTITY
			copy.visible = true
			return copy
	return _make_fallback_visual()


# Placeholder GMLRS-like rocket, 3.94 m long, body radius BODY_RADIUS.
func _make_fallback_visual() -> Node3D:
	var root_node := Node3D.new()
	var body := _mat(Color(0.36, 0.39, 0.30), 0.55)
	var fin := _mat(Color(0.26, 0.29, 0.22), 0.6)
	var dark := _mat(Color(0.08, 0.08, 0.08), 0.8)
	var r := BODY_RADIUS
	var x_rot := Vector3(PI * 0.5, 0.0, 0.0)
	# Nose ogive (tip at -Z), warhead, motor, boat tail with nozzle at +Z.
	_add_part(root_node, _cyl(0.0, r, 0.8), Vector3(0.0, 0.0, -1.57), Vector3(-PI * 0.5, 0.0, 0.0), body)
	_add_part(root_node, _cyl(r, r, 1.4), Vector3(0.0, 0.0, -0.47), x_rot, body)
	_add_part(root_node, _cyl(r, r, 1.52), Vector3(0.0, 0.0, 0.99), x_rot, body)
	_add_part(root_node, _cyl(0.07, r, 0.2), Vector3(0.0, 0.0, 1.85), x_rot, dark)
	var span := 0.34
	var chord := 0.42
	for sgn: float in [-1.0, 1.0]:
		_add_part(root_node, _box(Vector3(span, 0.012, chord)), Vector3(sgn * (r + span * 0.5), 0.0, 1.2), Vector3.ZERO, fin)
		_add_part(root_node, _box(Vector3(0.012, span, chord)), Vector3(0.0, sgn * (r + span * 0.5), 1.2), Vector3.ZERO, fin)
		_add_part(root_node, _box(Vector3(0.26, 0.008, 0.18)), Vector3(sgn * (r + 0.1), 0.0, -1.05), Vector3.ZERO, fin)
		_add_part(root_node, _box(Vector3(0.008, 0.26, 0.18)), Vector3(0.0, sgn * (r + 0.1), -1.05), Vector3.ZERO, fin)
	return root_node


static func _add_part(parent: Node3D, mesh: Mesh, pos: Vector3, rot: Vector3, mat: Material) -> void:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = pos
	mi.rotation = rot
	parent.add_child(mi)


static func _cyl(top_r: float, bottom_r: float, h: float) -> CylinderMesh:
	var c := CylinderMesh.new()
	c.top_radius = top_r
	c.bottom_radius = bottom_r
	c.height = h
	c.radial_segments = 16
	c.rings = 1
	return c


static func _box(sz: Vector3) -> BoxMesh:
	var b := BoxMesh.new()
	b.size = sz
	return b


static func _mat(col: Color, rough: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = col
	m.roughness = rough
	m.metallic = 0.15
	return m
