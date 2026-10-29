class_name FXDirector
extends Node3D

## Shared, pooled FX for launches, rocket trails and explosions: one per world, made on first use
## (FXDirector.for_world). Puffs live in two MultiMesh channels (alpha smoke/dust/debris and additive
## fire/flash/sparks) that are simulated here, so nothing is instanced per shot, per puff or per frame.
## Smoke and dust are world-space and relax toward WIND (they belong to the air); debris and sparks are
## ballistic. Flash lights, shock rings and scorch marks are fixed pools that are recycled.
## (GPUParticles3D.emit_particle does not work on the Compatibility renderer, hence the own channels.)

const NODE_NAME := "FXDirector"
const WIND := Vector3(2.4, 0.0, 1.1)   # m/s, light breeze that every smoke and dust puff drifts with
const SMOKE_CAP := 900
const GLOW_CAP := 320
const STRIDE := 12                     # floats per puff: age life s0 s1 rot spin drag buoy ramp alpha seed flags
const BUF_STRIDE := 20                 # MultiMesh floats per instance: 12 transform + 4 colour + 4 custom
const FLAG_GROUND := 1                 # puff rests on the terrain instead of sinking into it
const LIGHTS := 4
const RINGS := 3
const SCORCHES := 10
const SCORCH_LIFE := 120.0             # s until a scorch mark is fully faded
const GLOW_ENERGY := 2.2
const MOUTH := 2.05                    # m from the rocket centre in the tube to the tube mouth / rear

enum Ramp { TRAIL, EJECT, DUST, DARK, DEBRIS, FIRE, FLASH, SPARK }
enum Job { COLUMN, GROUND_DUST }

static var _noise_tex: ImageTexture = null


## A pool of camera-facing puffs drawn by one MultiMesh.
class Channel:
	var cap: int
	var n := 0
	var pos := PackedVector3Array()
	var vel := PackedVector3Array()
	var f := PackedFloat32Array()
	var buf := PackedFloat32Array()
	var mm: MultiMesh

	func _init(capacity: int) -> void:
		cap = capacity
		pos.resize(cap)
		vel.resize(cap)
		f.resize(cap * FXDirector.STRIDE)
		buf.resize(cap * FXDirector.BUF_STRIDE)
		var quad := QuadMesh.new()
		quad.size = Vector2.ONE
		mm = MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_colors = true
		mm.use_custom_data = true
		mm.mesh = quad
		mm.instance_count = cap
		mm.visible_instance_count = 0

	func remove(i: int) -> void:
		n -= 1
		if i == n:
			return
		pos[i] = pos[n]
		vel[i] = vel[n]
		var a := i * FXDirector.STRIDE
		var b := n * FXDirector.STRIDE
		for k in FXDirector.STRIDE:
			f[a + k] = f[b + k]


## A short-lived emitter that adds puffs over time (smoke column, ground dust).
class EmitJob:
	var kind: int
	var pos: Vector3
	var normal: Vector3
	var t := 0.0
	var dur: float
	var acc := 0.0
	var size: float


var _smoke: Channel
var _glow: Channel
var _smoke_mat: ShaderMaterial
var _jobs: Array[EmitJob] = []
var _lights: Array[OmniLight3D] = []
var _light_t := PackedFloat32Array()
var _light_dur := PackedFloat32Array()
var _light_e := PackedFloat32Array()
var _rings: Array[MeshInstance3D] = []
var _ring_t := PackedFloat32Array()
var _ring_dur := PackedFloat32Array()
var _ring_r := PackedFloat32Array()
var _scorches: Array[MeshInstance3D] = []
var _scorch_age := PackedFloat32Array()
var _scorch_next := 0
var _sun_found := false
var _rng := RandomNumberGenerator.new()


## The director under host (normally the AirbaseWorld); made the first time it is asked for.
static func for_world(host: Node) -> FXDirector:
	if not is_instance_valid(host):
		return null
	var d := host.get_node_or_null(NodePath(NODE_NAME)) as FXDirector
	if d == null:
		d = FXDirector.new()
		d.name = NODE_NAME
		host.add_child(d)
	return d


static func noise_texture() -> Texture2D:
	if _noise_tex == null:
		var fn := FastNoiseLite.new()
		fn.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
		fn.fractal_type = FastNoiseLite.FRACTAL_FBM
		fn.fractal_octaves = 4
		fn.frequency = 0.035
		fn.seed = 7
		var img := fn.get_seamless_image(128, 128)
		img.convert(Image.FORMAT_L8)
		img.generate_mipmaps()
		_noise_tex = ImageTexture.create_from_image(img)
	return _noise_tex


func _init() -> void:
	_rng.seed = 4711
	_smoke = Channel.new(SMOKE_CAP)
	_glow = Channel.new(GLOW_CAP)


func _ready() -> void:
	top_level = true
	global_transform = Transform3D.IDENTITY
	var noise := noise_texture()
	_smoke_mat = _shader_mat(FXShaders.SMOKE_CODE, noise)
	_add_channel_node("Smoke", _smoke, _smoke_mat, 0)
	var glow_mat := _shader_mat(FXShaders.GLOW_CODE, noise)
	glow_mat.set_shader_parameter(&"energy", GLOW_ENERGY)
	_add_channel_node("Glow", _glow, glow_mat, 1)
	for i in LIGHTS:
		var l := OmniLight3D.new()
		l.name = "Flash%d" % i
		l.shadow_enabled = false
		l.visible = false
		add_child(l)
		_lights.append(l)
		_light_t.append(1.0)
		_light_dur.append(1.0)
		_light_e.append(0.0)
	for i in RINGS:
		_rings.append(_flat_quad("Ring%d" % i, _shader_mat(FXShaders.RING_CODE, noise)))
		_ring_t.append(1.0)
		_ring_dur.append(1.0)
		_ring_r.append(1.0)
	for i in SCORCHES:
		_scorches.append(_flat_quad("Scorch%d" % i, _shader_mat(FXShaders.SCORCH_CODE, noise)))
		_scorch_age.append(SCORCH_LIFE)


func _add_channel_node(nm: String, ch: Channel, mat: ShaderMaterial, prio: int) -> void:
	mat.render_priority = prio
	var mmi := MultiMeshInstance3D.new()
	mmi.name = nm
	mmi.multimesh = ch.mm
	mmi.material_override = mat
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mmi.custom_aabb = AABB(Vector3(-6000.0, -1000.0, -6000.0), Vector3(12000.0, 6000.0, 12000.0))
	add_child(mmi)


func _flat_quad(nm: String, mat: ShaderMaterial) -> MeshInstance3D:
	var q := QuadMesh.new()
	q.size = Vector2(2.0, 2.0)
	q.orientation = PlaneMesh.FACE_Y
	var mi := MeshInstance3D.new()
	mi.name = nm
	mi.mesh = q
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.visible = false
	add_child(mi)
	return mi


static func _shader_mat(code: String, noise: Texture2D) -> ShaderMaterial:
	var sh := Shader.new()
	sh.code = code
	var m := ShaderMaterial.new()
	m.shader = sh
	m.set_shader_parameter(&"noise_tex", noise)
	return m


## Launch of one tube. start is the rocket's transform in the tube (centre of the rocket), dir its
## launch direction. Muzzle flash and light at the tube mouth, an ejection puff that stays in the air
## at the mouth, back-blast out of the rear of the pod and a dust cloud on the ground around it.
func launch_burst(start: Transform3D, dir: Vector3) -> void:
	var d := dir.normalized()
	var mouth := start.origin + d * MOUTH
	var rear := start.origin - d * MOUTH
	# Flash: one compact hot sprite plus a few smaller ones along the exit line (not a screen filler).
	emit_glow(mouth + d * 0.5, d * 6.0, 0.09, 2.4, 3.0, Ramp.FLASH)
	for i in 3:
		emit_glow(mouth + d * (0.4 + 0.5 * i), d * 12.0 + _rand_vec(2.0), 0.14, 0.9, 1.8, Ramp.FIRE)
	flash_light(mouth + d * 0.6, Color(1.0, 0.82, 0.55), 9.0, 22.0, 0.22)
	# Ejection smoke at the mouth: leaves slowly, then hangs and drifts.
	for i in 6:
		var v := d * _rng.randf_range(2.0, 7.0) + _rand_vec(1.2)
		emit_smoke(mouth + _rand_vec(0.3), v, _rng.randf_range(2.5, 4.0), 0.7, _rng.randf_range(2.8, 4.2), Ramp.EJECT, 0.85, 1.4, 0.25, 0)
	# Back-blast: the exhaust of the first metres leaves the rear of the pod and hits the ground.
	for i in 10:
		var v := -d * _rng.randf_range(10.0, 24.0) + Vector3.DOWN * _rng.randf_range(2.0, 6.0) + _rand_vec(3.0)
		emit_smoke(rear + _rand_vec(0.3), v, _rng.randf_range(3.0, 5.0), 1.0, _rng.randf_range(4.5, 6.5), Ramp.TRAIL, 0.75, 1.7, 0.35, FLAG_GROUND)
	var g := rear
	g.y = AirbaseWorld.height_at(g.x, g.z)
	_add_job(Job.GROUND_DUST, g, Vector3.UP, 0.5, 1.0)


## Motor ignition a few metres in front of the tube: a white-hot pop and a short light spike.
func ignition(p: Vector3, dir: Vector3) -> void:
	var d := dir.normalized()
	emit_glow(p, d * 20.0, 0.1, 3.2, 4.2, Ramp.FLASH)
	for i in 4:
		emit_glow(p - d * (0.6 * i), -d * 10.0 + _rand_vec(3.0), 0.15, 0.6, 1.5, Ramp.FIRE)
	flash_light(p, Color(1.0, 0.86, 0.62), 12.0, 30.0, 0.3)


## One puff of solid-motor smoke left in the air along the flight path.
func trail_puff(p: Vector3, back: Vector3, near_launch: bool) -> void:
	var v := back * _rng.randf_range(3.0, 9.0) + _rand_vec(1.2)
	var s1 := _rng.randf_range(3.2, 5.0) if near_launch else _rng.randf_range(4.0, 6.5)
	emit_smoke(p, v, _rng.randf_range(6.0, 9.0), 0.8, s1, Ramp.TRAIL, 0.8, 1.5, 0.25, 0)


## Ground burst of a warhead of the given size (m): flash, fireball, sparks, debris, shock ring, dust
## ring, a smoke column that rises and drifts with the wind, and a scorch mark.
func explosion(p: Vector3, normal: Vector3, size: float) -> void:
	var n := normal.normalized() if normal.length_squared() > 1e-6 else Vector3.UP
	var k := clampf(size / 0.6, 0.3, 3.0)
	var core := p + n * 2.5 * k
	emit_glow(core, Vector3.ZERO, 0.15, 10.0 * k, 15.0 * k, Ramp.FLASH)
	emit_glow(core, Vector3.ZERO, 0.08, 5.0 * k, 7.0 * k, Ramp.FLASH)
	flash_light(core + n * 2.0, Color(1.0, 0.7, 0.4), 18.0, 80.0 * k, 0.7)
	for i in 24:
		var dirv := (n * 1.1 + _rand_unit()).normalized()
		var v := dirv * _rng.randf_range(4.0, 14.0) * k
		emit_glow(core + _rand_vec(2.5 * k), v, _rng.randf_range(0.8, 1.6), 3.5 * k, _rng.randf_range(8.0, 12.0) * k, Ramp.FIRE)
	for i in 40:
		var dirv := (n * 1.4 + _rand_unit()).normalized()
		_emit(_glow, core, dirv * _rng.randf_range(18.0, 45.0), _rng.randf_range(0.6, 1.5), 0.35, 0.2, Ramp.SPARK, 1.0, 0.25, -9.8, FLAG_GROUND)
	for i in 22:
		var dirv := (n * 1.2 + _rand_unit()).normalized()
		var s := _rng.randf_range(0.25, 0.7)
		emit_smoke(p + n * 0.5, dirv * _rng.randf_range(10.0, 30.0) * sqrt(k), _rng.randf_range(2.5, 4.0), s, s, Ramp.DEBRIS, 1.0, 0.08, -9.8, FLAG_GROUND)
	_ring(p + n * 0.25, n, 48.0 * k, 0.55)
	for i in 28:
		var a := TAU * float(i) / 28.0 + _rng.randf_range(-0.1, 0.1)
		var out := (Vector3(cos(a), 0.0, sin(a)) - n * n.dot(Vector3(cos(a), 0.0, sin(a)))).normalized()
		emit_smoke(p + out * 2.0 * k + n * 1.2, out * _rng.randf_range(16.0, 28.0) * k, _rng.randf_range(4.0, 6.5), 2.0 * k, _rng.randf_range(7.0, 11.0) * k, Ramp.DUST, 0.8, 1.6, 0.35, FLAG_GROUND)
	for i in 10:
		var v := (n * 1.5 + _rand_unit()).normalized() * _rng.randf_range(5.0, 12.0) * k
		emit_smoke(core + _rand_vec(2.0 * k), v, _rng.randf_range(8.0, 11.0), 3.0 * k, _rng.randf_range(10.0, 14.0) * k, Ramp.DARK, 0.9, 0.5, 1.0, 0)
	_add_job(Job.COLUMN, p, n, 3.2, k)
	_scorch(p, n, 5.0 * k)


func emit_smoke(p: Vector3, v: Vector3, life: float, s0: float, s1: float, ramp: int, alpha: float, drag: float, buoy: float, flags: int) -> void:
	_emit(_smoke, p, v, life, s0, s1, ramp, alpha, drag, buoy, flags)


func emit_glow(p: Vector3, v: Vector3, life: float, s0: float, s1: float, ramp: int) -> void:
	_emit(_glow, p, v, life, s0, s1, ramp, 1.0, 2.0, 1.5, 0)


func _emit(ch: Channel, p: Vector3, v: Vector3, life: float, s0: float, s1: float, ramp: int, alpha: float, drag: float, buoy: float, flags: int) -> void:
	if ch.n >= ch.cap:
		return
	var i := ch.n
	ch.n += 1
	ch.pos[i] = p
	ch.vel[i] = v
	var b := i * STRIDE
	ch.f[b] = 0.0
	ch.f[b + 1] = maxf(life, 0.02)
	ch.f[b + 2] = s0
	ch.f[b + 3] = s1
	ch.f[b + 4] = _rng.randf_range(0.0, TAU)
	ch.f[b + 5] = _rng.randf_range(-0.5, 0.5) if ramp != Ramp.DEBRIS else _rng.randf_range(-8.0, 8.0)
	ch.f[b + 6] = drag
	ch.f[b + 7] = buoy
	ch.f[b + 8] = float(ramp)
	ch.f[b + 9] = alpha
	ch.f[b + 10] = _rng.randf()
	ch.f[b + 11] = float(flags)


func flash_light(p: Vector3, col: Color, energy: float, light_range: float, dur: float) -> void:
	var best := 0
	var best_left := INF
	for i in LIGHTS:
		var left := _light_dur[i] - _light_t[i]
		if left < best_left:
			best_left = left
			best = i
	var l := _lights[best]
	l.global_position = p
	l.light_color = col
	l.omni_range = light_range
	l.light_energy = energy
	l.visible = true
	_light_t[best] = 0.0
	_light_dur[best] = dur
	_light_e[best] = energy


func _ring(p: Vector3, n: Vector3, r_max: float, dur: float) -> void:
	var best := 0
	for i in RINGS:
		if _ring_t[i] >= _ring_dur[i]:
			best = i
			break
	var mi := _rings[best]
	mi.global_transform = Transform3D(_basis_up(n), p)
	mi.visible = true
	_ring_t[best] = 0.0
	_ring_dur[best] = dur
	_ring_r[best] = r_max


func _scorch(p: Vector3, n: Vector3, radius: float) -> void:
	var i := _scorch_next
	_scorch_next = (_scorch_next + 1) % SCORCHES
	var mi := _scorches[i]
	mi.global_transform = Transform3D(_basis_up(n).rotated(n, _rng.randf_range(0.0, TAU)) * Basis.from_scale(Vector3.ONE * radius), p + n * 0.12)
	mi.visible = true
	(mi.material_override as ShaderMaterial).set_shader_parameter(&"seed", Vector2(_rng.randf(), _rng.randf()))
	_scorch_age[i] = 0.0


func _add_job(kind: int, p: Vector3, n: Vector3, dur: float, size: float) -> void:
	var j := EmitJob.new()
	j.kind = kind
	j.pos = p
	j.normal = n
	j.dur = dur
	j.size = size
	_jobs.append(j)


## Live puffs in both channels plus active jobs, lights and rings; 0 when every transient effect has
## ended (scorch marks are permanent pool items and do not count).
func busy_count() -> int:
	var c := _smoke.n + _glow.n + _jobs.size()
	for i in LIGHTS:
		if _lights[i].visible:
			c += 1
	for i in RINGS:
		if _rings[i].visible:
			c += 1
	return c


func live_puffs() -> int:
	return _smoke.n + _glow.n


func _process(delta: float) -> void:
	if not _sun_found:
		_find_sun()
	var dt := minf(delta, 0.1)
	_step_jobs(dt)
	_step_channel(_smoke, dt)
	_step_channel(_glow, dt)
	_step_lights(dt)
	_step_rings(dt)
	_step_scorches(dt)


func _find_sun() -> void:
	_sun_found = true
	var suns := get_tree().root.find_children("*", "DirectionalLight3D", true, false)
	if suns.is_empty():
		return
	var sun := suns[0] as DirectionalLight3D
	_smoke_mat.set_shader_parameter(&"sun_dir", -sun.global_basis.z)


func _step_jobs(dt: float) -> void:
	var i := 0
	while i < _jobs.size():
		var j := _jobs[i]
		j.t += dt
		match j.kind:
			Job.COLUMN:
				_job_column(j, dt)
			Job.GROUND_DUST:
				_job_dust(j, dt)
		if j.t >= j.dur:
			_jobs.remove_at(i)
		else:
			i += 1


# Smoke column: a strong updraft that weakens over the job; puffs grow large, rise on buoyancy and
# are carried off by the wind (drag relaxes them toward WIND), so the column leans and drifts.
func _job_column(j: EmitJob, dt: float) -> void:
	var u := clampf(j.t / j.dur, 0.0, 1.0)
	j.acc += dt * lerpf(16.0, 5.0, u)
	while j.acc >= 1.0:
		j.acc -= 1.0
		var k := j.size
		var p := j.pos + j.normal * (1.5 + 3.0 * u) * k + _rand_vec(2.0 * k)
		var up := lerpf(15.0, 6.0, u) * k
		var v := Vector3.UP * up + _rand_vec(2.0)
		var life := _rng.randf_range(10.0, 14.0)
		emit_smoke(p, v, life, 3.5 * k, _rng.randf_range(13.0, 18.0) * k, Ramp.DARK, 0.88, 0.32, 1.3, 0)
		if u < 0.3:
			emit_glow(p, v * 0.6, _rng.randf_range(0.5, 0.9), 2.0 * k, 5.0 * k, Ramp.FIRE)


func _job_dust(j: EmitJob, dt: float) -> void:
	j.acc += dt * 40.0 * j.size
	while j.acc >= 1.0:
		j.acc -= 1.0
		var a := _rng.randf_range(0.0, TAU)
		var out := Vector3(cos(a), 0.0, sin(a))
		var p := j.pos + out * _rng.randf_range(1.0, 4.0)
		p.y = AirbaseWorld.height_at(p.x, p.z) + 0.8
		emit_smoke(p, out * _rng.randf_range(5.0, 11.0) + Vector3.UP * 0.8, _rng.randf_range(4.0, 6.0), 1.6, _rng.randf_range(5.0, 7.5), Ramp.DUST, 0.7, 1.1, 0.3, FLAG_GROUND)


func _step_channel(ch: Channel, dt: float) -> void:
	var i := 0
	while i < ch.n:
		var b := i * STRIDE
		var age := ch.f[b] + dt
		var life := ch.f[b + 1]
		if age >= life:
			ch.remove(i)
			continue
		ch.f[b] = age
		var v := ch.vel[i]
		var drag := ch.f[b + 6]
		if drag > 0.0:
			v += (WIND - v) * (1.0 - exp(-drag * dt))
		v.y += ch.f[b + 7] * dt
		var p := ch.pos[i] + v * dt
		var t := age / life
		var s := lerpf(ch.f[b + 2], ch.f[b + 3], 1.0 - pow(1.0 - t, 2.4))
		if int(ch.f[b + 11]) & FLAG_GROUND:
			var gy := AirbaseWorld.height_at(p.x, p.z) + s * 0.3
			if p.y < gy:
				p.y = gy
				if v.y < 0.0:
					v.y *= -0.2
				v.x *= 0.7
				v.z *= 0.7
		ch.vel[i] = v
		ch.pos[i] = p
		ch.f[b + 4] += ch.f[b + 5] * dt
		var c := _ramp(int(ch.f[b + 8]), t)
		c.a *= ch.f[b + 9]
		var o := i * BUF_STRIDE
		ch.buf[o] = s
		ch.buf[o + 1] = 0.0
		ch.buf[o + 2] = 0.0
		ch.buf[o + 3] = p.x
		ch.buf[o + 4] = 0.0
		ch.buf[o + 5] = s
		ch.buf[o + 6] = 0.0
		ch.buf[o + 7] = p.y
		ch.buf[o + 8] = 0.0
		ch.buf[o + 9] = 0.0
		ch.buf[o + 10] = s
		ch.buf[o + 11] = p.z
		ch.buf[o + 12] = c.r
		ch.buf[o + 13] = c.g
		ch.buf[o + 14] = c.b
		ch.buf[o + 15] = c.a
		ch.buf[o + 16] = ch.f[b + 4]
		ch.buf[o + 17] = t
		ch.buf[o + 18] = ch.f[b + 10]
		ch.buf[o + 19] = 0.0
		i += 1
	ch.mm.visible_instance_count = 0
	if ch.n > 0:
		ch.mm.buffer = ch.buf
		ch.mm.visible_instance_count = ch.n


func _step_lights(dt: float) -> void:
	for i in LIGHTS:
		var l := _lights[i]
		if not l.visible:
			continue
		_light_t[i] += dt
		var u := _light_t[i] / _light_dur[i]
		if u >= 1.0:
			l.visible = false
			l.light_energy = 0.0
			continue
		l.light_energy = _light_e[i] * pow(1.0 - u, 2.0) * _rng.randf_range(0.85, 1.0)


func _step_rings(dt: float) -> void:
	for i in RINGS:
		var mi := _rings[i]
		if not mi.visible:
			continue
		_ring_t[i] += dt
		var u := _ring_t[i] / _ring_dur[i]
		if u >= 1.0:
			mi.visible = false
			continue
		var r := maxf(_ring_r[i] * (1.0 - pow(1.0 - u, 2.5)), 0.5)
		var xf := mi.global_transform
		mi.global_transform = Transform3D(xf.basis.orthonormalized() * Basis.from_scale(Vector3.ONE * r), xf.origin)
		var mat := mi.material_override as ShaderMaterial
		mat.set_shader_parameter(&"alpha", 0.75 * (1.0 - u) * smoothstep(0.0, 0.08, u))
		mat.set_shader_parameter(&"width", lerpf(0.5, 0.18, u))


func _step_scorches(dt: float) -> void:
	for i in SCORCHES:
		var mi := _scorches[i]
		if not mi.visible:
			continue
		_scorch_age[i] += dt
		var age := _scorch_age[i]
		if age >= SCORCH_LIFE:
			mi.visible = false
			continue
		var a := smoothstep(0.0, 0.25, age) * (1.0 - smoothstep(SCORCH_LIFE * 0.6, SCORCH_LIFE, age))
		(mi.material_override as ShaderMaterial).set_shader_parameter(&"alpha", a)


static func _ramp(ramp: int, t: float) -> Color:
	match ramp:
		Ramp.TRAIL:
			var c := Color(0.97, 0.97, 0.96).lerp(Color(0.86, 0.86, 0.87), t)
			c.a = smoothstep(0.0, 0.03, t) * pow(1.0 - t, 1.4)
			return c
		Ramp.EJECT:
			var c := Color(0.82, 0.81, 0.79).lerp(Color(0.74, 0.74, 0.75), t)
			c.a = smoothstep(0.0, 0.05, t) * pow(1.0 - t, 1.6)
			return c
		Ramp.DUST:
			var c := Color(0.72, 0.65, 0.53).lerp(Color(0.78, 0.74, 0.68), t)
			c.a = smoothstep(0.0, 0.08, t) * pow(1.0 - t, 1.3) * 0.85
			return c
		Ramp.DARK:
			var c := Color(0.36, 0.32, 0.28).lerp(Color(0.66, 0.64, 0.62), smoothstep(0.0, 0.4, t))
			c.a = smoothstep(0.0, 0.05, t) * pow(1.0 - t, 1.15)
			return c
		Ramp.DEBRIS:
			var c := Color(0.11, 0.09, 0.07)
			c.a = 1.0 - smoothstep(0.85, 1.0, t)
			return c
		Ramp.FIRE:
			var c: Color
			if t < 0.25:
				c = Color(1.0, 0.95, 0.78).lerp(Color(1.0, 0.62, 0.22), t / 0.25)
			else:
				c = Color(1.0, 0.62, 0.22).lerp(Color(0.45, 0.10, 0.02), (t - 0.25) / 0.75)
			c.a = pow(1.0 - t, 1.5)
			return c
		Ramp.FLASH:
			var c := Color(1.0, 0.96, 0.88)
			c.a = pow(1.0 - t, 2.0)
			return c
		Ramp.SPARK:
			var c := Color(1.0, 0.78, 0.38).lerp(Color(1.0, 0.4, 0.1), t)
			c.a = 1.0 - t
			return c
	return Color(1.0, 1.0, 1.0, 1.0 - t)


func _rand_unit() -> Vector3:
	var v := Vector3(_rng.randf_range(-1.0, 1.0), _rng.randf_range(-1.0, 1.0), _rng.randf_range(-1.0, 1.0))
	return v.normalized() if v.length_squared() > 1e-4 else Vector3.UP


func _rand_vec(r: float) -> Vector3:
	return Vector3(_rng.randf_range(-r, r), _rng.randf_range(-r, r), _rng.randf_range(-r, r))


static func _basis_up(up: Vector3) -> Basis:
	var ref := Vector3.RIGHT if absf(up.dot(Vector3.RIGHT)) < 0.9 else Vector3.BACK
	var x := ref.cross(up).normalized()
	return Basis(x, up, x.cross(up))
