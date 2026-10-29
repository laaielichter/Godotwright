class_name HimarsVehicle
extends Node3D
## M142 HIMARS on the airbase: drives over the terrain, aims the launcher at the
## camera centre and fires GMLRS-type rockets. No physics bodies.

signal fired(rocket: RocketProjectile)

const MODEL_PATH := "res://models/himars_v4.glb"
const POD_NAMES := ["6x GMLRS-type pod", "Single canister proxy", "Dual canister proxy"]
const POD_NODES := ["PodSix", "PodSingle", "PodDual"]
const WHEEL_NAMES := ["FrontL", "FrontR", "MiddleL", "MiddleR", "RearL", "RearR"]
const TUBES := 6
const WHEEL_R := 0.59  # 395/85R20, OD 1.18 m
const WHEELBASE := 4.53          # m, front to rear axle in the GLB
const MAX_FWD := 8.0             # m/s
const MAX_REV := 3.0
const ACCEL := 1.2               # 1/s, speed relaxes exponentially toward the throttle target
const STEER_MAX := 0.5           # rad
const STEER_RATE := 8.0          # 1/s
const AIM_OMEGA := 6.0           # rad/s, launcher second-order filter
const MAX_PITCH := PI / 3.0      # 60 deg
const AIM_TOL := 0.1             # deg, turret error below which the tube fires (short shots move ~30 m per deg)
const AIM_WAIT := 1.5            # s, otherwise the tube fires after this
const SALVO_GAP := 1.0           # s between shots
const RELOAD_TIME := 6.0         # s
const TRACK_TIME := 6.0          # s, the rocket cam gives up after this if the rocket has not hit
const MUZZLE_SPEED := 25.0       # m/s
const AIM_DIST := 1000.0         # m, the launcher aims at a point this far along the solved launch line
const SOLVE_STEPS := 12          # bisection steps for the launch elevation
const SOLVE_MAX := 0.87          # rad (50 deg), the range still grows with elevation up to here
const EXT_DIST := 0.9            # m, exploded view of the dummy rockets
const EXT_OMEGA := 5.0           # rad/s
const DOOR_ANGLE := PI * 70.0 / 180.0
const DOOR_OMEGA := 4.0
const SPRING_STEP := 0.004       # s, sub-step of the second-order filter

var _world: AirbaseWorld
var _cam: ChaseCam
var _cam_node: Node3D
var _model: Node3D
var _yaw_node: Node3D
var _pitch_node: Node3D
var _wheels: Array[Node3D] = []
var _wheel_rest: Array[Basis] = []
var _contact: Array[Vector2] = []  # FrontL, FrontR, RearL, RearR: x, z in the vehicle frame
var _tubes: Array[Node3D] = []
var _tube_rest: Array[Transform3D] = []
var _doors: Array[Node3D] = []
var _pods: Array[Node3D] = []
var _loaded: Array[bool] = [true, true, true, true, true, true]
var _pod_index := 0
var _heading := 0.0
var _xz := Vector2.ZERO
var _speed := 0.0
var _steer := 0.0
var _roll := 0.0
var _yaw_s := Vector2.ZERO       # launcher yaw: x = angle, y = rate
var _pitch_s := Vector2.ZERO
var _yaw_goal := 0.0
var _pitch_goal := 0.0
var _has_aim := false
var _aim_point := Vector3.ZERO
var _pending := 0                # shots asked for and not yet fired
var _aim_wait := 0.0
var _salvo_cd := 0.0
var _reload_left := 0.0
var _ext_s := Vector2.ZERO
var _ext_target := 0.0
var _door_s := Vector2.ZERO
var _doors_open := false
var _tracked: RocketProjectile = null
var _track_t := 0.0


func _ready() -> void:
	var packed := load(MODEL_PATH) as PackedScene
	if packed == null:
		push_warning("HimarsVehicle: cannot load %s" % MODEL_PATH)
		return
	_model = packed.instantiate() as Node3D
	if _model == null:
		push_warning("HimarsVehicle: model root is not a Node3D")
		return
	_model.name = "Vehicle"
	add_child(_model)
	# Visual only: binds the texture sets to the GLB materials by name (vehicle_materials.gd).
	VehicleMaterials.apply(_model)
	# Cab interior light so the seats, dashboard and fire-control console read through the glass.
	var cab_light := OmniLight3D.new()
	cab_light.name = "CabLight"
	cab_light.position = Vector3(0.0, 2.1, -2.8)
	cab_light.omni_range = 3.2
	cab_light.light_energy = 1.4
	cab_light.light_color = Color(1.0, 0.92, 0.80)
	_model.add_child(cab_light)
	_bind_nodes()


## Call after the world and the cam are in the tree. Places the vehicle on the spawn point
## and makes the cam follow it.
func setup(world: AirbaseWorld, cam: ChaseCam) -> void:
	_world = world
	_cam = cam
	_cam_node = cam.find_child("Cam", false, false) as Node3D
	if _cam_node == null:
		_cam_node = cam
	var sp := world.spawn_point()
	var fwd := -sp.basis.z
	_heading = atan2(-fwd.x, -fwd.z)
	_xz = Vector2(sp.origin.x, sp.origin.z)
	_cam.target = self
	_place()


## Fire button. Aims at the centre of the camera view, with the elevation that lands the rocket
## there; the next tube fires once the launcher is on it, or after AIM_WAIT. Does nothing with a
## non-six pod or without rockets.
func fire() -> void:
	if _world == null or _model == null or _cam_node == null:
		return
	var k := _next_loaded()
	if k < 0:
		return
	var xf := _cam_node.global_transform
	_aim_point = _launch_aim(_tubes[k].global_position, _world.aim_point(xf.origin, -xf.basis.z))
	_has_aim = true
	if _pending == 0:
		_aim_wait = 0.0
	_pending = mini(_pending + 1, _loaded_count())


func rockets_left() -> int:
	return _loaded_count()


func reload_left() -> float:
	return _reload_left


func pod_name() -> String:
	return POD_NAMES[_pod_index]


func _process(delta: float) -> void:
	if _model == null or _world == null:
		return
	_drive(delta)
	_place()
	_update_turret(delta)
	_update_fire(delta)
	_update_cam(delta)
	_update_parts(delta)


func _unhandled_input(event: InputEvent) -> void:
	var mb := event as InputEventMouseButton
	if mb != null:
		if mb.pressed and mb.button_index == MOUSE_BUTTON_LEFT:
			fire()
		return
	var key := event as InputEventKey
	if key == null or not key.pressed or key.echo:
		return
	match key.keycode:
		KEY_3:
			_ext_target = 1.0
		KEY_4:
			_ext_target = 0.0
		KEY_6:
			_doors_open = not _doors_open
		KEY_7:
			_set_pod((_pod_index + 1) % POD_NAMES.size())
		KEY_R:
			if _reload_left <= 0.0 and _loaded_count() < TUBES:
				_reload_left = RELOAD_TIME


func _bind_nodes() -> void:
	_yaw_node = _node("LauncherYaw")
	_pitch_node = _node("LauncherPitch")
	for nm: String in WHEEL_NAMES:
		var w := _node(nm)
		_wheels.append(w)
		_wheel_rest.append(w.transform.basis)
	for i: int in [0, 1, 4, 5]:
		var p := to_local(_wheels[i].global_position)
		_contact.append(Vector2(p.x, p.z))
	for k in TUBES:
		var t := _node("Rocket%d" % (k + 1))
		_tubes.append(t)
		_tube_rest.append(t.transform)
	_doors.append(_node("DoorL"))
	_doors.append(_node("DoorR"))
	for nm: String in POD_NODES:
		_pods.append(_node(nm))
	_apply_pods()
	_apply_tubes()


# A missing node gets an empty placeholder, so the rest of the logic keeps working.
func _node(nm: String) -> Node3D:
	var n := _model.find_child(nm, true, false) as Node3D
	if n == null:
		push_warning("HimarsVehicle: node %s missing in model" % nm)
		n = Node3D.new()
		n.name = nm
		_model.add_child(n)
	return n


func _drive(delta: float) -> void:
	var throttle := (1.0 if Input.is_key_pressed(KEY_W) else 0.0) - (1.0 if Input.is_key_pressed(KEY_S) else 0.0)
	var turn := (1.0 if Input.is_key_pressed(KEY_A) else 0.0) - (1.0 if Input.is_key_pressed(KEY_D) else 0.0)
	var v_target := throttle * (MAX_FWD if throttle > 0.0 else MAX_REV)
	_speed = lerpf(_speed, v_target, 1.0 - exp(-ACCEL * delta))
	_steer = lerpf(_steer, turn * STEER_MAX, 1.0 - exp(-STEER_RATE * delta))
	# Bicycle model. Positive steer (A, left) turns the nose toward -X.
	_heading = wrapf(_heading + _speed * tan(_steer) / WHEELBASE * delta, -PI, PI)
	var fwd := Vector2(-sin(_heading), -cos(_heading))
	_xz += fwd * _speed * delta
	var lim := AirbaseWorld.HALF - 30.0  # the drawn terrain ends at HALF
	if absf(_xz.x) > lim or absf(_xz.y) > lim:
		_xz = _xz.clamp(Vector2(-lim, -lim), Vector2(lim, lim))
		_speed = 0.0
	_roll -= _speed * delta / WHEEL_R
	for i in _wheels.size():
		var st := _steer if i < 2 else 0.0
		_wheels[i].basis = Basis(Vector3.UP, st) * _wheel_rest[i] * Basis(Vector3.RIGHT, _roll)


# Sits the chassis on the terrain: height is the mean of the four wheel contact points, and the
# attitude follows their average normal. Forward is the vehicle's -Z projected on that plane.
func _place() -> void:
	if _contact.size() < 4:
		return
	var flat := Basis(Vector3.UP, _heading)
	var fl := _corner(_contact[0], flat)
	var fr := _corner(_contact[1], flat)
	var bl := _corner(_contact[2], flat)
	var br := _corner(_contact[3], flat)
	var n := (_up_normal(fl, fr, br) + _up_normal(fl, br, bl)).normalized()
	var fwd := -flat.z
	var f := (fwd - n * fwd.dot(n)).normalized()
	var y := (fl.y + fr.y + bl.y + br.y) * 0.25
	var xf := Transform3D(Basis.looking_at(f, n), Vector3(_xz.x, y, _xz.y))
	if is_inside_tree():
		global_transform = xf
	else:
		transform = xf


func _corner(local: Vector2, flat: Basis) -> Vector3:
	var p := Vector3(_xz.x, 0.0, _xz.y) + flat * Vector3(local.x, 0.0, local.y)
	p.y = AirbaseWorld.height_at(p.x, p.z)
	return p


static func _up_normal(a: Vector3, b: Vector3, c: Vector3) -> Vector3:
	var n := (b - a).cross(c - a).normalized()
	return -n if n.y < 0.0 else n


# Turns both launcher axes toward the aim point. The axes turn in the frame of the launcher's
# parent, which is the tilted chassis, so the angles are the local ones. Pitch is the elevation
# of the aim in that frame, clamped 0..60 deg.
func _update_turret(delta: float) -> void:
	if not _has_aim:
		return
	var frame := _yaw_node.get_parent_node_3d().global_transform.basis.inverse()
	var rel := frame * (_aim_point - _yaw_node.global_position)
	var yaw_t := atan2(-rel.x, -rel.z)
	_yaw_goal = _yaw_s.x + angle_difference(_yaw_s.x, yaw_t)
	_yaw_s = _spring(_yaw_s, _yaw_goal, AIM_OMEGA, delta)
	_yaw_node.rotation.y = _yaw_s.x
	var rel_p := frame * (_aim_point - _pitch_node.global_position)
	_pitch_goal = clampf(atan2(rel_p.y, Vector2(rel_p.x, rel_p.z).length()), 0.0, MAX_PITCH)
	_pitch_s = _spring(_pitch_s, _pitch_goal, AIM_OMEGA, delta)
	_pitch_node.rotation.x = _pitch_s.x


# Point on the launch line that lands a rocket from origin on target. A ground target below the
# launcher cannot be aimed at directly (the barrel stops at 0 deg), so the elevation is bisected on
# the predicted landing range, in the vertical plane through target, with the rocket's own flight model.
# The search covers the barrel's own range on the chassis (0..60 deg relative to it), so a tilted
# chassis can fire below the horizon.
func _launch_aim(origin: Vector3, target: Vector3) -> Vector3:
	var flat := Vector3(target.x - origin.x, 0.0, target.z - origin.z)
	var want := flat.length()
	var h: Vector3 = flat / want if want > 0.01 else Vector3(-sin(_heading), 0.0, -cos(_heading))
	var frame := _yaw_node.get_parent_node_3d().global_transform.basis
	var hc := frame.inverse() * h
	hc.y = 0.0
	hc = hc.normalized()
	var probe := RocketProjectile.new()
	var lo := _chassis_elev(frame, hc, 0.0)
	var hi := minf(_chassis_elev(frame, hc, MAX_PITCH), SOLVE_MAX)
	for _i in SOLVE_STEPS:
		var mid := 0.5 * (lo + hi)
		var land := probe.predict_landing(origin, _elev_dir(h, mid), MUZZLE_SPEED)
		if (land - origin).dot(h) < want:
			lo = mid
		else:
			hi = mid
	probe.free()
	return origin + _elev_dir(h, 0.5 * (lo + hi)) * AIM_DIST


static func _elev_dir(h: Vector3, elev: float) -> Vector3:
	return Vector3(h.x * cos(elev), sin(elev), h.z * cos(elev))


# World elevation of the barrel at chassis elevation elev, on the chassis azimuth hc (chassis-frame, horizontal).
static func _chassis_elev(frame: Basis, hc: Vector3, elev: float) -> float:
	var d := frame * Vector3(hc.x * cos(elev), sin(elev), hc.z * cos(elev))
	return atan2(d.y, Vector2(d.x, d.z).length())


func _update_fire(delta: float) -> void:
	_salvo_cd = maxf(0.0, _salvo_cd - delta)
	if _pending <= 0:
		return
	var k := _next_loaded()
	if k < 0:
		_pending = 0
		return
	if _salvo_cd > 0.0:
		return
	_aim_wait += delta
	if _aim_error() <= AIM_TOL or _aim_wait >= AIM_WAIT:
		_fire_tube(k)
		_pending -= 1
		_salvo_cd = SALVO_GAP
		_aim_wait = 0.0


# Remaining turret error in degrees: how far the launcher still has to turn.
func _aim_error() -> float:
	return rad_to_deg(maxf(absf(_yaw_s.x - _yaw_goal), absf(_pitch_s.x - _pitch_goal)))


func _fire_tube(k: int) -> void:
	var tube := _tubes[k]
	var rocket := RocketProjectile.new()
	_world.add_child(rocket)
	rocket.launch(tube.global_transform, -_pitch_node.global_transform.basis.z, MUZZLE_SPEED, _world)
	tube.visible = false
	_loaded[k] = false
	# The rocket spawns its own explosion through the world on impact; this only drives the cam.
	rocket.impacted.connect(_on_impacted.bind(rocket))
	_track(rocket)
	fired.emit(rocket)


func _track(rocket: RocketProjectile) -> void:
	_tracked = rocket
	_track_t = 0.0
	_cam.target = rocket
	_cam.set_mode(ChaseCam.MODE_ROCKET)


func _on_impacted(pos: Vector3, normal: Vector3, _speed_at_impact: float, rocket: RocketProjectile) -> void:
	# A newer rocket still in flight keeps the camera; only the tracked rocket's impact counts.
	if is_instance_valid(_tracked) and rocket != _tracked:
		return
	_cam.notify_impact(pos, normal)  # the impact cam returns to follow mode by itself
	if rocket == _tracked:
		_tracked = null
		_cam.target = self


func _update_cam(delta: float) -> void:
	if not is_instance_valid(_tracked):
		return
	_track_t += delta
	if _track_t < TRACK_TIME:
		return
	_tracked = null
	# An impact cam is left alone; it returns to follow by itself.
	if _cam.mode == ChaseCam.MODE_ROCKET:
		_cam.set_mode(ChaseCam.MODE_FOLLOW)
	_cam.target = self


func _update_parts(delta: float) -> void:
	_ext_s = _spring(_ext_s, _ext_target, EXT_OMEGA, delta)
	for k in TUBES:
		var rest := _tube_rest[k]
		_tubes[k].transform = Transform3D(rest.basis, rest.origin - rest.basis.z * (EXT_DIST * _ext_s.x))
	_door_s = _spring(_door_s, 1.0 if _doors_open else 0.0, DOOR_OMEGA, delta)
	_doors[0].rotation.y = -DOOR_ANGLE * _door_s.x
	_doors[1].rotation.y = DOOR_ANGLE * _door_s.x
	if _reload_left > 0.0:
		_reload_left = maxf(0.0, _reload_left - delta)
		if _reload_left <= 0.0:
			for k in TUBES:
				_loaded[k] = true
			_apply_tubes()


func _set_pod(i: int) -> void:
	_pod_index = i
	_apply_pods()
	_apply_tubes()


func _apply_pods() -> void:
	for i in _pods.size():
		_pods[i].visible = i == _pod_index


# Rockets only show on the six-tube pod.
func _apply_tubes() -> void:
	for k in _tubes.size():
		_tubes[k].visible = _loaded[k] and _pod_index == 0


func _loaded_count() -> int:
	return _loaded.count(true)


func _next_loaded() -> int:
	if _pod_index != 0:
		return -1
	for k in TUBES:
		if _loaded[k]:
			return k
	return -1


## Critically damped second-order filter. s.x is the value, s.y its rate.
static func _spring(s: Vector2, target: float, omega: float, dt: float) -> Vector2:
	var t := minf(dt, 0.1)
	var n := maxi(1, ceili(t / SPRING_STEP))
	var h := t / float(n)
	var x := s.x
	var v := s.y
	var k := omega * omega
	var c := 2.0 * omega
	for _i in n:
		v += (k * (target - x) - c * v) * h
		x += v * h
	return Vector2(x, v)
