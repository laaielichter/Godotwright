class_name CameraShake
extends RefCounted

## Additive camera shake for the lens: trauma 0..1 (impulses add, decays DECAY per second, amplitude
## grows with trauma squared) on smooth noise, plus a continuous low rumble layer the owner sets each
## frame (road, idle). Rotation stays within MAX_ROT_DEG so it reads as rattle, not as a turn.
## A spectator impulse (spectator()) arrives after distance / SOUND_SPEED seconds of game time and
## falls off with distance; the flash of the same event is seen at once.

const MAX_ROT_DEG := 1.2
const MAX_OFFSET := 0.16         # m at full trauma
const DECAY := 1.3               # trauma per real second
const FREQ := 14.0               # noise speed of the trauma layer
const RUMBLE_FREQ := 6.0
const RUMBLE_DEG := 0.15
const SOUND_SPEED := 343.0       # m/s

var trauma := 0.0
## Continuous layer 0..1, set by the owner every frame.
var rumble := 0.0

var _noise := FastNoiseLite.new()
var _t := 0.0
var _delays := PackedFloat32Array()
var _amounts := PackedFloat32Array()


func _init() -> void:
	_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	_noise.frequency = 1.0
	_noise.seed = 1337


func add(amount: float) -> void:
	trauma = clampf(trauma + amount, 0.0, 1.0)


## Adds amount after delay seconds of game time.
func add_delayed(delay: float, amount: float) -> void:
	if delay <= 0.0:
		add(amount)
		return
	_delays.append(delay)
	_amounts.append(amount)


## An event dist m away: strength at ref_dist, falling off as 1/dist, arriving after dist / 343 s.
func spectator(dist: float, strength: float, ref_dist: float) -> void:
	var amount := clampf(strength * ref_dist / maxf(dist, ref_dist * 0.25), 0.0, 1.0)
	add_delayed(dist / SOUND_SPEED, amount)


## Impulses still travelling toward the listener.
func pending() -> int:
	return _delays.size()


func clear() -> void:
	trauma = 0.0
	_delays.clear()
	_amounts.clear()


## game_dt drives the sound delay, real_dt the oscillation and the decay. Returns the lens offset.
func step(game_dt: float, real_dt: float) -> Transform3D:
	var i := 0
	while i < _delays.size():
		_delays[i] -= game_dt
		if _delays[i] <= 0.0:
			add(_amounts[i])
			_delays.remove_at(i)
			_amounts.remove_at(i)
		else:
			i += 1
	trauma = maxf(0.0, trauma - DECAY * real_dt)
	_t += real_dt
	var a := trauma * trauma
	var r := deg_to_rad(MAX_ROT_DEG)
	var t := _t * FREQ
	var pitch := _noise.get_noise_2d(t, 0.0) * a * r
	var yaw := _noise.get_noise_2d(t, 50.0) * a * r * 0.8
	var roll := _noise.get_noise_2d(t, 100.0) * a * r * 0.35
	var off := Vector3(_noise.get_noise_2d(t, 150.0), _noise.get_noise_2d(t, 200.0), 0.0) * a * MAX_OFFSET
	if rumble > 0.0:
		var tr := _t * RUMBLE_FREQ
		var rb := clampf(rumble, 0.0, 1.0) * deg_to_rad(RUMBLE_DEG)
		pitch += _noise.get_noise_2d(tr, 300.0) * rb
		yaw += _noise.get_noise_2d(tr, 350.0) * rb * 0.5
		off.y += _noise.get_noise_2d(tr, 400.0) * rumble * 0.01
	pitch = clampf(pitch, -r, r)
	yaw = clampf(yaw, -r, r)
	roll = clampf(roll, -r, r)
	return Transform3D(Basis.from_euler(Vector3(pitch, yaw, roll)), off)
