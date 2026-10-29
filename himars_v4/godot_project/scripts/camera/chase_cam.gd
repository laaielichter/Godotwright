class_name ChaseCam
extends Node3D

## Camera rig for the HIMARS. The lens is the child "Cam" (shake is applied to it locally). Modes:
## - follow: spring-arm chase with look-ahead, speed FOV push, terrain clearance along the arm, RMB
##   orbit with smooth return, wheel zoom; eases back and up while the launcher is elevated.
## - cockpit / fcc: V cycles follow -> cockpit (driver's eye) -> fcc (fire-control console) -> follow.
##   RMB looks around within limits.
## - rocket: chases the newest rocket from behind and to the side during the boost, then hands over
##   to the impact view IMPACT_LEAD s before the predicted hit.
## - impact: spectator spot at a safe distance with the explosion, the smoke column and the horizon in
##   frame; short slow motion, shake after distance / 343 s, then a smooth return to the view the player
##   had. Only the last rocket of a salvo triggers it (RocketProjectile.in_flight()).
## C resets the orbit and zoom.

const MODE_FOLLOW: StringName = &"follow"
const MODE_ROCKET: StringName = &"rocket"
const MODE_IMPACT: StringName = &"impact"
const MODE_COCKPIT: StringName = &"cockpit"
const MODE_FCC: StringName = &"fcc"

# Follow
const DIST_DEFAULT := 15.0
const DIST_MIN := 7.0
const DIST_MAX := 60.0
const PITCH_DEFAULT := 0.21     # rad above the look point
const PITCH_MIN := -0.15
const PITCH_MAX := 1.3
const LOOK_HEIGHT := 1.9        # m above the vehicle origin
const MIN_CLEARANCE := 1.8      # m above the terrain, along the whole arm
const ARM_SAMPLES := 10
const HEADING_RATE := 2.6       # 1/s, how fast the arm swings behind a turning truck
const PIVOT_RATE := 9.0
const ZOOM_RATE := 6.0
const LOOK_AHEAD_T := 0.8       # s of travel the look point leads by
const LOOK_AHEAD_MAX := 4.0     # m
const ELEV_BACK := 0.45         # extra distance factor at full launcher elevation
const ELEV_PITCH := 0.14        # rad added at full elevation
const ELEV_LIFT := 1.8          # m the look point rises at full elevation
const ELEV_FULL := PI / 3.0     # rad, the launcher's limit
const ORBIT_SENS := 0.006       # rad per mouse pixel
const ORBIT_DELAY := 1.2        # s after RMB release before the view eases back
const ORBIT_EASE := 1.8         # 1/s
const BASE_FOV := 42.0
const FOV_PUSH := 7.0           # deg added at speed
const FOV_V := Vector2(1.0, 8.5)  # m/s: no push below x, full push at y
const SPEED_CAP := 600.0        # m/s, ignores teleports
# Cockpit: marker empties in the model win (their -Z is the look direction); fallback offsets in the vehicle frame (v3 cab).
const DRIVER_EYE_NODE := "DriverEye"
const FCC_VIEW_NODE := "FccView"
const EYE_DRIVER := Vector3(-0.5, 2.08, -2.45)
const EYE_FCC := Vector3(-0.12, 1.9, -2.62)
const FCC_LOOK := Vector3(0.52, 1.52, -3.38)
const COCKPIT_PITCH := -0.05    # rad, a little down so the bonnet edge and the road show
const COCKPIT_FOV := 66.0
const FCC_FOV := 54.0
const LOOK_YAW_MAX := 1.3       # rad, mouse look limits inside the cab
const LOOK_PITCH_MAX := 0.55
const NEAR_IN := 0.05
const NEAR_OUT := 1.0           # 0.1 gave depth z-fighting on the runway at range
const FAR_IN := 8000.0
const FAR_OUT := 12000.0
# Rocket
const ROCKET_BACK := 15.0       # m behind the rocket
const ROCKET_SIDE := 4.0        # m to its right
const ROCKET_UP := 2.5
const ROCKET_LEAD := 20.0       # m ahead of the rocket the view aims at
const ROCKET_OFF_RATE := 4.0
const ROCKET_DIR_RATE := 6.0
const ROCKET_FOV := 50.0
const ROCKET_LAUNCH_OFF := Vector3(10.0, 6.0, 22.0)  # side, up, back: wide first view of a new launch
const IMPACT_LEAD := 2.2        # s before the predicted hit the impact view takes over
# Impact
const IMPACT_DIST := 105.0      # m, spectator distance
const IMPACT_HEIGHT := 9.0      # m above the ground at the spot
const IMPACT_LOOK_UP := 13.0    # m above the impact the view aims at (the column rises into frame)
const IMPACT_FOV := 40.0
const IMPACT_SCALE := 0.3       # Engine.time_scale during the slow motion
const SLOW_HOLD := 0.9          # real s at IMPACT_SCALE
const SLOW_RAMP := 0.7          # real s back to 1.0
const IMPACT_HOLD := 4.2        # real s on the impact view after the hit
const RETURN_TIME := 1.6        # real s blend back to the player's view
const WAIT_MAX := 6.0           # s the impact view waits past the predicted hit
const EXPLOSION_SHAKE := 0.8    # trauma at IMPACT_DIST
const LAUNCH_SHAKE := 0.35      # trauma at 16 m
const CAB_LAUNCH_SHAKE := 0.5   # structure-borne, in the cab

var target: Node3D
var world: AirbaseWorld
var mode: StringName = MODE_FOLLOW
var cam_yaw := 0.0              # orbit offset from directly behind the vehicle, rad
var cam_pitch := PITCH_DEFAULT  # orbit elevation, rad
var distance := DIST_DEFAULT    # m, follow mode
var camera: Camera3D
var shake := CameraShake.new()
## Impact views started (for tests).
var impact_views := 0

var _home: StringName = MODE_FOLLOW
var _vehicle: Node3D
var _pitch_node: Node3D
var _eye_node: Node3D
var _fcc_node: Node3D
var _pitch_lookup := 0.0
var _vel := Vector3.ZERO
var _prev_pos := Vector3.ZERO
var _has_prev := false
var _snap := true
var _orbiting := false
var _idle := ORBIT_DELAY
var _look_yaw := 0.0
var _look_pitch := 0.0
var _heading := 0.0
var _pivot := Vector3.ZERO
var _zoom := DIST_DEFAULT
var _elev := 0.0
var _lift := 0.0
var _fov := BASE_FOV
var _blend_from := Transform3D.IDENTITY
var _blend_fov := BASE_FOV
var _blend_look := Vector3.ZERO
var _subject_dist := 10.0      # m from the view to what it looks at (set by each view)
var _blend_t := 1.0
var _blend_dur := 0.0
var _rocket: RocketProjectile
var _rocket_dir := Vector3.FORWARD
var _rocket_off := Vector3.ZERO
var _impact_pos := Vector3.ZERO
var _impact_spot := Vector3.ZERO
var _impact_live := false
var _impact_clock := 0.0
var _wait_left := 0.0
var _slowmo := false
var _slow_t := 0.0
var _has_impact := false
var _last_impact_pos := Vector3.ZERO
var _last_impact_normal := Vector3.UP
var _spots := ImpactSpot.new()


func _ready() -> void:
	process_priority = 100
	camera = Camera3D.new()
	camera.name = "Cam"
	add_child(camera)
	camera.fov = BASE_FOV
	camera.near = NEAR_OUT
	camera.far = FAR_OUT
	camera.current = true


func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		Engine.time_scale = 1.0


func _exit_tree() -> void:
	_end_slowmo()
	Engine.time_scale = 1.0


## follow, rocket, impact (replays the last impact), cockpit or fcc.
func set_mode(m: StringName) -> void:
	if m == mode:
		return
	match m:
		MODE_IMPACT:
			var p := target.global_position if is_instance_valid(target) else global_position
			if _has_impact:
				p = _last_impact_pos
			_start_impact(p, _last_impact_normal)
			shake.spectator(_impact_spot.distance_to(p), EXPLOSION_SHAKE, IMPACT_DIST)
		MODE_FOLLOW:
			if mode == MODE_ROCKET or mode == MODE_IMPACT:
				_go_home(0.6)
			else:
				_home = MODE_FOLLOW
				_switch(MODE_FOLLOW, 0.0)
		MODE_ROCKET:
			if not (target is RocketProjectile):
				push_warning("ChaseCam: rocket mode needs a RocketProjectile target")
				return
			_rocket = target as RocketProjectile
			_switch(MODE_ROCKET, 0.4)
		MODE_COCKPIT, MODE_FCC:
			_home = m
			_restore_vehicle_target()
			_switch(m, 0.0)
		_:
			push_warning("ChaseCam: set_mode takes follow, rocket, impact, cockpit or fcc, got %s" % m)


## A rocket hit the ground. Starts the impact view, unless a later rocket of the salvo is still in
## flight: then that one will.
func notify_impact(pos: Vector3, normal: Vector3) -> void:
	if RocketProjectile.in_flight() > 0:
		return
	_start_impact(pos, normal)


## Short name of the current view for the HUD (Dutch, like the rest of it).
func view_name() -> String:
	match mode:
		MODE_COCKPIT:
			return "cabine"
		MODE_FCC:
			return "FCC"
		MODE_ROCKET:
			return "raket"
		MODE_IMPACT:
			return "inslag"
	return "volgen"


func _unhandled_input(event: InputEvent) -> void:
	var mb := event as InputEventMouseButton
	if mb:
		if mb.button_index == MOUSE_BUTTON_RIGHT:
			_orbiting = mb.pressed
			if not mb.pressed:
				_idle = 0.0
		elif mb.pressed and mode == MODE_FOLLOW and mb.button_index == MOUSE_BUTTON_WHEEL_UP:
			distance = clampf(distance * 0.9, DIST_MIN, DIST_MAX)
		elif mb.pressed and mode == MODE_FOLLOW and mb.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			distance = clampf(distance / 0.9, DIST_MIN, DIST_MAX)
		return
	var mm := event as InputEventMouseMotion
	if mm:
		if not _orbiting:
			return
		if _in_cab():
			_look_yaw = clampf(_look_yaw - mm.relative.x * ORBIT_SENS, -LOOK_YAW_MAX, LOOK_YAW_MAX)
			_look_pitch = clampf(_look_pitch - mm.relative.y * ORBIT_SENS, -LOOK_PITCH_MAX, LOOK_PITCH_MAX)
		else:
			cam_yaw = wrapf(cam_yaw - mm.relative.x * ORBIT_SENS, -PI, PI)
			cam_pitch = clampf(cam_pitch - mm.relative.y * ORBIT_SENS, PITCH_MIN, PITCH_MAX)
		return
	var key := event as InputEventKey
	if key == null or not key.pressed or key.echo:
		return
	if key.keycode == KEY_C:
		_reset_orbit()
	elif key.keycode == KEY_V:
		cycle_view()


## V: follow -> cockpit -> fcc -> follow. From the rocket or impact view it continues from the
## player's own view.
func cycle_view() -> void:
	var from := mode if mode != MODE_ROCKET and mode != MODE_IMPACT else _home
	var next := MODE_COCKPIT
	if from == MODE_COCKPIT:
		next = MODE_FCC
	elif from == MODE_FCC:
		next = MODE_FOLLOW
	_end_slowmo()
	_home = next
	_restore_vehicle_target()
	_look_yaw = 0.0
	_look_pitch = 0.0
	# Within the cab the head turns; everything else is a cut.
	_switch(next, 0.35 if from == MODE_COCKPIT and next == MODE_FCC else 0.0)


func _process(delta: float) -> void:
	var rdt := delta / Engine.time_scale if Engine.time_scale > 0.001 else delta
	_track_vehicle(delta)
	_relax_look(rdt)
	_update_state(delta, rdt)
	var want := _want(rdt)
	var out := want
	var fov := _fov
	if _blend_t < 1.0:
		_blend_t = minf(1.0, _blend_t + rdt / maxf(_blend_dur, 0.001))
		var k := smoothstep(0.0, 1.0, _blend_t)
		var arc := clampf(_blend_from.origin.distance_to(want.origin) * 0.12, 0.0, 80.0) * sin(PI * k)
		var pos := _blend_from.origin.lerp(want.origin, k) + Vector3.UP * arc
		# The aim moves to the new subject early, then the view travels: no empty frames on a long return.
		var look := _blend_look.lerp(want.origin - want.basis.z * _subject_dist, smoothstep(0.0, 0.55, _blend_t))
		out = Transform3D(_look_basis(look - pos), pos)
		fov = lerpf(_blend_fov, _fov, k)
	if not _in_cab():
		out.origin.y = maxf(out.origin.y, _ground(out.origin) + MIN_CLEARANCE)
	global_transform = out
	camera.fov = fov
	camera.near = NEAR_IN if _in_cab() else NEAR_OUT
	camera.far = FAR_IN if _in_cab() else FAR_OUT
	shake.rumble = clampf(absf(_vel.length()) / 8.0, 0.0, 1.0) * 0.6 + 0.12 if _in_cab() else 0.0
	camera.transform = shake.step(delta, rdt)
	_update_time_scale(rdt)
	_snap = false


func _in_cab() -> bool:
	return mode == MODE_COCKPIT or mode == MODE_FCC


func _switch(m: StringName, blend: float) -> void:
	if mode == MODE_IMPACT and m != MODE_IMPACT:
		_end_slowmo()
	_start_blend(blend)
	mode = m
	_snap = true


func _start_blend(dur: float) -> void:
	_blend_from = Transform3D(global_transform.basis.orthonormalized(), global_position)
	_blend_fov = camera.fov if camera else BASE_FOV
	_blend_look = _blend_from.origin - _blend_from.basis.z * _subject_dist
	_blend_dur = dur
	_blend_t = 0.0 if dur > 0.0 else 1.0


# Back to the view the player had (follow, cockpit or fcc) after the rocket / impact views.
func _go_home(blend: float) -> void:
	_end_slowmo()
	_restore_vehicle_target()
	_switch(_home, blend if _home == MODE_FOLLOW else 0.0)


func _restore_vehicle_target() -> void:
	if is_instance_valid(_vehicle):
		target = _vehicle


func _update_state(game_dt: float, rdt: float) -> void:
	if mode == MODE_ROCKET:
		# The vehicle points target at each new rocket; a new one is a cut to its launch.
		if target is RocketProjectile and target != _rocket and not (target as RocketProjectile).is_done():
			_rocket = target as RocketProjectile
			_start_blend(0.0)
			_snap = true
		if not is_instance_valid(_rocket) or _rocket.is_done():
			_go_home(0.6)
		elif not _rocket.is_burning() and _rocket.time_to_impact() <= IMPACT_LEAD:
			_begin_approach()
	elif mode == MODE_IMPACT:
		if _impact_live:
			_impact_clock += rdt
			if _impact_clock >= IMPACT_HOLD:
				_go_home(RETURN_TIME)
		else:
			_wait_left -= game_dt
			if _wait_left <= 0.0:
				_go_home(RETURN_TIME)


# The rocket is coasting in: wait for it on the spectator spot, looking at the predicted hit.
func _begin_approach() -> void:
	var p := _rocket.predicted_impact()
	if p == Vector3.INF:
		return
	_impact_pos = p
	_impact_spot = _spots.choose(p, _from_point(p), IMPACT_DIST, IMPACT_HEIGHT, world)
	_impact_live = false
	_wait_left = _rocket.time_to_impact() + WAIT_MAX
	_switch(MODE_IMPACT, 0.0)


func _start_impact(pos: Vector3, normal: Vector3) -> void:
	var same_spot := mode == MODE_IMPACT and not _impact_live and pos.distance_to(_impact_pos) < 120.0
	_impact_pos = pos
	if not same_spot:
		_impact_spot = _spots.choose(pos, _from_point(pos), IMPACT_DIST, IMPACT_HEIGHT, world)
		_switch(MODE_IMPACT, 0.0)
	_impact_live = true
	_impact_clock = 0.0
	impact_views += 1
	_slowmo = true
	_slow_t = 0.0
	Engine.time_scale = IMPACT_SCALE
	_has_impact = true
	_last_impact_pos = pos
	_last_impact_normal = normal


func _update_time_scale(rdt: float) -> void:
	if not _slowmo:
		return
	_slow_t += rdt
	if _slow_t < SLOW_HOLD:
		Engine.time_scale = IMPACT_SCALE
	elif _slow_t < SLOW_HOLD + SLOW_RAMP:
		Engine.time_scale = lerpf(IMPACT_SCALE, 1.0, smoothstep(0.0, 1.0, (_slow_t - SLOW_HOLD) / SLOW_RAMP))
	else:
		_end_slowmo()


func _end_slowmo() -> void:
	if _slowmo:
		_slowmo = false
		Engine.time_scale = 1.0


func _want(dt: float) -> Transform3D:
	match mode:
		MODE_ROCKET:
			if is_instance_valid(_rocket):
				return _rocket_view(dt)
		MODE_IMPACT:
			return _impact_view(dt)
		MODE_COCKPIT, MODE_FCC:
			if is_instance_valid(_vehicle):
				return _cab_view()
	return _follow_view(dt)


func _follow_view(dt: float) -> Transform3D:
	if not is_instance_valid(_vehicle):
		return global_transform
	var vxf := _vehicle.global_transform
	var fwd := -vxf.basis.z
	fwd.y = 0.0
	fwd = fwd.normalized() if fwd.length_squared() > 1e-6 else Vector3.FORWARD
	var heading := atan2(-fwd.x, -fwd.z)
	var v_fwd := _vel.dot(fwd)
	var e := 0.0
	if is_instance_valid(_pitch_node):
		e = clampf(_pitch_node.rotation.x / ELEV_FULL, 0.0, 1.0)
	if _snap:
		_heading = heading
		_elev = e
		_zoom = distance
	else:
		_heading = lerp_angle(_heading, heading, _rate(HEADING_RATE, dt))
		_elev = lerpf(_elev, e, _rate(1.6, dt))
		_zoom = lerpf(_zoom, distance, _rate(ZOOM_RATE, dt))
	var ahead := fwd * clampf(v_fwd * LOOK_AHEAD_T, -2.0, LOOK_AHEAD_MAX)
	var pivot := vxf.origin + Vector3.UP * (LOOK_HEIGHT + ELEV_LIFT * _elev) + ahead
	_pivot = pivot if _snap else _pivot.lerp(pivot, _rate(PIVOT_RATE, dt))
	var pitch := clampf(cam_pitch + ELEV_PITCH * _elev, PITCH_MIN, PITCH_MAX)
	var dist := _zoom * (1.0 + ELEV_BACK * _elev)
	var back := Vector3.BACK.rotated(Vector3.UP, _heading + cam_yaw)
	var pos := _pivot + (back * cos(pitch) + Vector3.UP * sin(pitch)) * dist
	# Spring arm against the terrain: lift the camera so every point of the arm keeps clearance.
	var need := 0.0
	for i in range(1, ARM_SAMPLES + 1):
		var f := float(i) / float(ARM_SAMPLES)
		var q := _pivot.lerp(pos, f)
		var deficit := _ground(q) + MIN_CLEARANCE - q.y
		if deficit > 0.0:
			need = maxf(need, deficit / f)
	_lift = need if (_snap or need > _lift) else lerpf(_lift, need, _rate(1.5, dt))
	pos.y += _lift
	var push := smoothstep(FOV_V.x, FOV_V.y, absf(v_fwd))
	var fov_t := BASE_FOV + FOV_PUSH * push
	_fov = fov_t if _snap else lerpf(_fov, fov_t, _rate(2.5, dt))
	_subject_dist = _pivot.distance_to(pos)
	return Transform3D(_look_basis(_pivot - pos), pos)


func _cab_view() -> Transform3D:
	var vxf := _vehicle.global_transform
	var marker := _eye_node if mode == MODE_COCKPIT else _fcc_node
	var local: Transform3D
	if is_instance_valid(marker):
		# Marker pose in the vehicle frame, scale removed.
		local = vxf.affine_inverse() * marker.global_transform
		local.basis = local.basis.orthonormalized()
	elif mode == MODE_COCKPIT:
		local = Transform3D(Basis.from_euler(Vector3(COCKPIT_PITCH, 0.0, 0.0)), EYE_DRIVER)
	else:
		local = Transform3D(Basis.looking_at(FCC_LOOK - EYE_FCC, Vector3.UP), EYE_FCC)
	_fov = COCKPIT_FOV if mode == MODE_COCKPIT else FCC_FOV
	_subject_dist = 4.0
	local.basis = local.basis * Basis(Vector3.UP, _look_yaw) * Basis(Vector3.RIGHT, _look_pitch)
	return vxf * local


func _rocket_view(dt: float) -> Transform3D:
	var rp := _rocket.global_position
	var v := _rocket.velocity()
	var vdir := v.normalized() if v.length_squared() > 1.0 else -_rocket.global_basis.z
	if _snap:
		_rocket_dir = vdir
	else:
		var d := _rocket_dir.lerp(vdir, _rate(ROCKET_DIR_RATE, dt))
		if d.length_squared() > 1e-8:
			_rocket_dir = d.normalized()
	var side := _rocket_dir.cross(Vector3.UP)
	side = side.normalized() if side.length_squared() > 1e-4 else Vector3.RIGHT
	var off := -_rocket_dir * ROCKET_BACK + side * ROCKET_SIDE + Vector3.UP * ROCKET_UP
	# A new rocket starts wide (clear of the pod), then the view tightens to the chase offset.
	var wide := -_rocket_dir * ROCKET_LAUNCH_OFF.z + side * ROCKET_LAUNCH_OFF.x + Vector3.UP * ROCKET_LAUNCH_OFF.y
	_rocket_off = wide if _snap else _rocket_off.lerp(off, _rate(ROCKET_OFF_RATE, dt))
	var pos := rp + _rocket_off
	pos.y = maxf(pos.y, _ground(pos) + MIN_CLEARANCE)
	_fov = ROCKET_FOV
	_subject_dist = (rp + _rocket_dir * ROCKET_LEAD).distance_to(pos)
	return Transform3D(_look_basis(rp + _rocket_dir * ROCKET_LEAD - pos), pos)


func _impact_view(_dt: float) -> Transform3D:
	var look := _impact_pos + Vector3.UP * IMPACT_LOOK_UP
	_fov = IMPACT_FOV
	if _impact_live and _slowmo:
		_fov = IMPACT_FOV - 4.0 * smoothstep(0.0, SLOW_HOLD + SLOW_RAMP, _slow_t)
	elif _impact_live:
		_fov = IMPACT_FOV - 4.0
	_subject_dist = look.distance_to(_impact_spot)
	return Transform3D(_look_basis(look - _impact_spot), _impact_spot)


func _track_vehicle(dt: float) -> void:
	if is_instance_valid(target) and not (target is RocketProjectile) and target != _vehicle:
		_bind_vehicle(target)
	if not is_instance_valid(_vehicle):
		return
	# Parts can appear later (model loaded or swapped), so missing ones are looked up once a second.
	if not is_instance_valid(_pitch_node) or not is_instance_valid(_eye_node) or not is_instance_valid(_fcc_node):
		_pitch_lookup -= dt
		if _pitch_lookup <= 0.0:
			_pitch_lookup = 1.0
			_find_parts()
	var p := _vehicle.global_position
	if _has_prev and dt > 0.0:
		var inst := (p - _prev_pos) / dt
		if inst.length() < SPEED_CAP:
			_vel = _vel.lerp(inst, _rate(6.0, dt))
	_prev_pos = p
	_has_prev = true


func _bind_vehicle(v: Node3D) -> void:
	_vehicle = v
	_has_prev = false
	_find_parts()
	_pitch_lookup = 1.0
	var hv := v as HimarsVehicle
	if hv != null and not hv.fired.is_connected(_on_vehicle_fired):
		hv.fired.connect(_on_vehicle_fired)
	_snap = true


# Nodes of the vehicle model the camera reads (never writes): launcher pitch and the cab markers.
func _find_parts() -> void:
	_pitch_node = _vehicle.find_child("LauncherPitch", true, false) as Node3D
	_eye_node = _vehicle.find_child(DRIVER_EYE_NODE, true, false) as Node3D
	_fcc_node = _vehicle.find_child(FCC_VIEW_NODE, true, false) as Node3D


func _on_vehicle_fired(rocket: RocketProjectile) -> void:
	if _in_cab():
		shake.add(CAB_LAUNCH_SHAKE)
	else:
		shake.spectator(camera.global_position.distance_to(rocket.global_position), LAUNCH_SHAKE, 16.0)
	rocket.impacted.connect(_on_rocket_impacted)


# Every hit is heard and felt from wherever the camera is, after distance / 343 s.
func _on_rocket_impacted(pos: Vector3, _normal: Vector3, _speed: float) -> void:
	shake.spectator(camera.global_position.distance_to(pos), EXPLOSION_SHAKE, IMPACT_DIST)


func _relax_look(dt: float) -> void:
	if _orbiting:
		return
	_idle = minf(_idle + dt, ORBIT_DELAY)
	if _idle < ORBIT_DELAY:
		return
	var k := _rate(ORBIT_EASE, dt)
	cam_yaw = lerpf(cam_yaw, 0.0, k)
	cam_pitch = lerpf(cam_pitch, PITCH_DEFAULT, k)
	_look_yaw = lerpf(_look_yaw, 0.0, k)
	_look_pitch = lerpf(_look_pitch, 0.0, k)
	if absf(cam_yaw) < 0.001:
		cam_yaw = 0.0
	if absf(cam_pitch - PITCH_DEFAULT) < 0.001:
		cam_pitch = PITCH_DEFAULT


func _reset_orbit() -> void:
	cam_yaw = 0.0
	cam_pitch = PITCH_DEFAULT
	distance = DIST_DEFAULT
	_look_yaw = 0.0
	_look_pitch = 0.0
	_idle = ORBIT_DELAY


# Where the shot came from: the launcher, or a point behind the impact.
func _from_point(p: Vector3) -> Vector3:
	return _vehicle.global_position if is_instance_valid(_vehicle) else p + Vector3.BACK * 100.0


func _ground(p: Vector3) -> float:
	return AirbaseWorld.height_at(p.x, p.z) if world != null else -INF


static func _look_basis(dir: Vector3) -> Basis:  # level horizon: always built with world up
	var d := Vector3.FORWARD
	if dir.length_squared() > 1e-8:
		d = dir.normalized()
	var up := Vector3.UP if absf(d.y) < 0.999 else Vector3.BACK
	return Basis.looking_at(d, up)


static func _rate(k: float, dt: float) -> float:
	return 1.0 - exp(-k * dt)
