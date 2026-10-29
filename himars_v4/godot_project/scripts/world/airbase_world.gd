class_name AirbaseWorld
extends Node3D
## Mountain-ringed valley: one terrain mesh plus the airbase on its flat plain.
## height_at() is the single source of truth for mesh and physics.

const PLAIN_H := 420.0
const GRID_N := 561                 # vertices per side
const CELL := 10.0                  # m between vertices; mesh covers 5600 m
const HALF := 2800.0
const FLAT_HX := 1600.0             # exactly flat box around the airbase
const FLAT_HZ := 420.0
const DETAIL_AMP := 5.0             # rolling detail beyond the box, m
const RING_IN := 1700.0             # mountains start at this radius, m
const RING_OUT := 2400.0            # and reach full height here
const EDGE_IN := 2450.0             # mountains fade to the plain between these radii, m (smooth, no crease),
const EDGE_OUT := HALF - 10.0       # beyond EDGE_OUT every mesh edge point is plain
const PEAK_MIN := 1100.0
const PEAK_MAX := 1900.0
const SLAB_TOP := 0.05              # pavement top above PLAIN_H (avoids z-fight with terrain)
const SLAB_T := 0.3
const NOISE_SEED := 20260612

const COL_GRASS := Color(0.40, 0.42, 0.24)
const COL_ALPINE := Color(0.34, 0.37, 0.28)
const COL_ROCK := Color(0.42, 0.40, 0.37)
const COL_SNOW := Color(0.87, 0.88, 0.90)

static var _n_detail: FastNoiseLite
static var _n_region: FastNoiseLite
static var _n_relief: FastNoiseLite

var _built: bool = false


static func _ensure_noise() -> void:
	if _n_relief != null:
		return
	var d := FastNoiseLite.new()
	d.seed = NOISE_SEED
	d.frequency = 1.0 / 400.0
	d.fractal_type = FastNoiseLite.FRACTAL_FBM
	d.fractal_octaves = 3
	var g := FastNoiseLite.new()
	g.seed = NOISE_SEED + 1
	g.frequency = 1.0 / 1500.0
	g.fractal_type = FastNoiseLite.FRACTAL_FBM
	g.fractal_octaves = 2
	# Smooth FBM, not ridged: ridged creases need finer cells than the 10 m mesh can follow.
	var rg := FastNoiseLite.new()
	rg.seed = NOISE_SEED + 2
	rg.frequency = 1.0 / 1800.0
	rg.fractal_type = FastNoiseLite.FRACTAL_FBM
	rg.fractal_octaves = 3
	_n_detail = d
	_n_region = g
	_n_relief = rg


static func height_at(x: float, z: float) -> float:
	var bd: float = maxf(absf(x) - FLAT_HX, absf(z) - FLAT_HZ)
	if bd <= 0.0:
		return PLAIN_H
	_ensure_noise()
	var h: float = PLAIN_H + DETAIL_AMP * smoothstep(0.0, 300.0, bd) * _n_detail.get_noise_2d(x, z)
	var r: float = sqrt(x * x + z * z)
	if r > RING_IN:
		var e: float = _smootherstep(RING_IN, RING_OUT, r)
		var top: float = lerpf(PEAK_MIN, PEAK_MAX, clampf(0.5 + 0.5 * _n_region.get_noise_2d(x, z), 0.0, 1.0))
		var ridge: float = smoothstep(-0.35, 0.65, _n_relief.get_noise_2d(x, z))
		var shape: float = 0.15 + 0.85 * ridge
		var edge: float = 1.0 - _smootherstep(EDGE_IN, EDGE_OUT, r)
		h += (top - PLAIN_H) * e * shape * edge
	return h


static func _smootherstep(a: float, b: float, x: float) -> float:
	var t: float = clampf((x - a) / (b - a), 0.0, 1.0)
	return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


static func _terrain_color(h: float, ny: float) -> Color:
	var slope: float = 1.0 - ny
	var c: Color = COL_GRASS.lerp(COL_ALPINE, smoothstep(700.0, 1100.0, h))
	c = c.lerp(COL_ROCK, smoothstep(0.12, 0.34, slope))
	c = c.lerp(COL_SNOW, smoothstep(1300.0, 1600.0, h) * (1.0 - smoothstep(0.22, 0.42, slope)))
	return c


func build() -> void:
	if _built:
		return
	_built = true
	_build_terrain()
	var airbase := Node3D.new()
	airbase.name = "Airbase"
	add_child(airbase)
	_build_airbase(airbase)


func spawn_point() -> Transform3D:
	return Transform3D(Basis.IDENTITY, Vector3(0.0, PLAIN_H, 270.0))


## The drawn map ends at HALF: the march stops there, and a ray that leaves the map gives the
## ground point on its edge.
func aim_point(origin: Vector3, dir: Vector3, max_dist: float = 6000.0) -> Vector3:
	var d: Vector3 = dir.normalized()
	var reach: float = minf(max_dist, _map_exit(origin, d))
	var t0: float = 0.0
	var t1: float = 0.0
	while t1 < reach:
		t1 = minf(t1 + 5.0, reach)
		if _is_below(origin, d, t1):
			var lo: float = t0
			var hi: float = t1
			for _i in 8:
				var mid: float = (lo + hi) * 0.5
				if _is_below(origin, d, mid):
					hi = mid
				else:
					lo = mid
			return origin + d * ((lo + hi) * 0.5)
		t0 = t1
	var edge: Vector3 = origin + d * reach
	edge.y = height_at(edge.x, edge.z)
	return edge


static func _is_below(o: Vector3, d: Vector3, t: float) -> bool:
	var p: Vector3 = o + d * t
	return p.y <= height_at(p.x, p.z)


# Distance along d from o to the edge of the drawn map (INF when d runs parallel to both edges).
static func _map_exit(o: Vector3, d: Vector3) -> float:
	var t: float = INF
	if absf(d.x) > 1e-6:
		t = minf(t, (signf(d.x) * HALF - o.x) / d.x)
	if absf(d.z) > 1e-6:
		t = minf(t, (signf(d.z) * HALF - o.z) / d.z)
	return maxf(t, 0.0)


func spawn_explosion(pos: Vector3, normal: Vector3, size: float) -> void:
	ExplosionFX.spawn(self, pos, normal, size)


func _build_terrain() -> void:
	var n: int = GRID_N
	var last: int = n - 1
	var hs := PackedFloat32Array()
	hs.resize(n * n)
	for iz in n:
		var z: float = -HALF + iz * CELL
		for ix in n:
			hs[iz * n + ix] = height_at(-HALF + ix * CELL, z)

	var verts := PackedVector3Array()
	var norms := PackedVector3Array()
	var cols := PackedColorArray()
	verts.resize(n * n)
	norms.resize(n * n)
	cols.resize(n * n)
	for iz in n:
		var z: float = -HALF + iz * CELL
		var zm: int = maxi(iz - 1, 0)
		var zp: int = mini(iz + 1, last)
		for ix in n:
			var x: float = -HALF + ix * CELL
			var xm: int = maxi(ix - 1, 0)
			var xp: int = mini(ix + 1, last)
			var i: int = iz * n + ix
			var h: float = hs[i]
			var gx: float = (hs[iz * n + xp] - hs[iz * n + xm]) / ((xp - xm) * CELL)
			var gz: float = (hs[zp * n + ix] - hs[zm * n + ix]) / ((zp - zm) * CELL)
			var nrm: Vector3 = Vector3(-gx, 1.0, -gz).normalized()
			verts[i] = Vector3(x, h, z)
			norms[i] = nrm
			cols[i] = _terrain_color(h, nrm.y)

	# Front faces are clockwise seen from above, so (a, b, c) and (b, d, c) face up.
	var idx := PackedInt32Array()
	idx.resize(last * last * 6)
	var k: int = 0
	for iz in last:
		for ix in last:
			var a: int = iz * n + ix
			var b: int = a + 1
			var c: int = a + n
			var d: int = c + 1
			idx[k] = a
			idx[k + 1] = b
			idx[k + 2] = c
			idx[k + 3] = b
			idx[k + 4] = d
			idx[k + 5] = c
			k += 6

	var arrays: Array = []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = norms
	arrays[Mesh.ARRAY_COLOR] = cols
	arrays[Mesh.ARRAY_INDEX] = idx
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var mat := StandardMaterial3D.new()
	mat.vertex_color_use_as_albedo = true
	mat.roughness = 1.0
	mesh.surface_set_material(0, mat)
	var mi := MeshInstance3D.new()
	mi.name = "Terrain"
	mi.mesh = mesh
	add_child(mi)


func _build_airbase(root: Node3D) -> void:
	var asphalt: StandardMaterial3D = _mat(Color(0.13, 0.13, 0.14), 0.92)
	var taxi: StandardMaterial3D = _mat(Color(0.19, 0.19, 0.20), 0.92)
	var concrete: StandardMaterial3D = _mat(Color(0.30, 0.30, 0.29), 0.85)
	var paint: StandardMaterial3D = _mat(Color(0.93, 0.93, 0.90), 0.7)
	var wall: StandardMaterial3D = _mat(Color(0.70, 0.70, 0.66), 0.8)
	var roof: StandardMaterial3D = _mat(Color(0.42, 0.46, 0.50), 0.6, 0.2)
	var dark: StandardMaterial3D = _mat(Color(0.22, 0.24, 0.27), 0.7)
	var glass: StandardMaterial3D = _mat(Color(0.10, 0.16, 0.22), 0.2, 0.3)
	var steel: StandardMaterial3D = _mat(Color(0.74, 0.76, 0.78), 0.45, 0.4)

	_slab(root, "Runway", Vector3(3000.0, SLAB_T, 45.0), Vector2(0.0, 0.0), asphalt)
	_slab(root, "Taxiway", Vector3(23.0, SLAB_T, 207.5), Vector2(0.0, 126.25), taxi)
	_slab(root, "Apron", Vector3(600.0, SLAB_T, 60.0), Vector2(0.0, 260.0), concrete)
	_slab(root, "FuelPad", Vector3(80.0, SLAB_T, 60.0), Vector2(370.0, 245.0), concrete)

	# Runway markings: centreline dashes and threshold bars, just above the asphalt.
	var mark_y: float = PLAIN_H + SLAB_TOP + 0.03
	var dash_mesh: BoxMesh = _box_mesh(Vector3(36.0, 0.1, 0.9), paint)
	for i in 47:
		_add_mesh(root, "RwyDash", dash_mesh, Vector3(-1380.0 + i * 60.0, mark_y, 0.0))
	var thr_mesh: BoxMesh = _box_mesh(Vector3(30.0, 0.1, 3.0), paint)
	for sx in [-1.0, 1.0]:
		for k in 7:
			_add_mesh(root, "Threshold", thr_mesh, Vector3(sx * 1440.0, mark_y, -18.0 + k * 6.0))

	_hangar(root, Vector2(-190.0, 350.0), wall, roof, dark)
	_hangar(root, Vector2(190.0, 350.0), wall, roof, dark)

	# Control tower at the west edge of the apron.
	var tx: float = -345.0
	var tz: float = 200.0
	_add_mesh(root, "TowerBase", _box_mesh(Vector3(14.0, 9.0, 14.0), wall), Vector3(tx, PLAIN_H + 4.5, tz))
	_add_mesh(root, "TowerShaft", _cyl_mesh(2.4, 2.4, 38.0, 24, paint), Vector3(tx, PLAIN_H + 28.0, tz))
	_add_mesh(root, "TowerCab", _cyl_mesh(5.5, 5.0, 5.0, 32, glass), Vector3(tx, PLAIN_H + 49.5, tz))
	_add_mesh(root, "TowerRoof", _cyl_mesh(6.2, 6.2, 1.0, 32, dark), Vector3(tx, PLAIN_H + 52.5, tz))

	# Fuel tank group: four tanks with domes on the fuel pad.
	var tanks := Node3D.new()
	tanks.name = "FuelTanks"
	root.add_child(tanks)
	for p in [Vector2(350.0, 230.0), Vector2(390.0, 230.0), Vector2(350.0, 262.0), Vector2(390.0, 262.0)]:
		_add_mesh(tanks, "Tank", _cyl_mesh(7.0, 7.0, 13.0, 32, steel), Vector3(p.x, PLAIN_H + 6.5, p.y))
		var dome := SphereMesh.new()
		dome.radius = 7.0
		dome.height = 14.0
		dome.radial_segments = 32
		dome.rings = 12
		dome.material = steel
		_add_mesh(tanks, "TankDome", dome, Vector3(p.x, PLAIN_H + 13.0, p.y))


func _hangar(root: Node3D, c: Vector2, wall: Material, roof: Material, door: Material) -> void:
	var len_x: float = 70.0
	var depth: float = 45.0
	var eave: float = 16.0
	_add_mesh(root, "HangarBody", _box_mesh(Vector3(len_x, eave, depth), wall), Vector3(c.x, PLAIN_H + eave * 0.5, c.y))
	# Half-cylinder roof: a cylinder along X, squashed to an arch; its lower half sits inside the walls.
	var arch: Basis = Basis(Vector3.BACK, PI * 0.5) * Basis.from_scale(Vector3(0.6, 1.0, 1.0))
	_add_mesh(root, "HangarRoof", _cyl_mesh(depth * 0.5, depth * 0.5, len_x - 0.4, 48, roof), Vector3(c.x, PLAIN_H + eave, c.y), arch)
	# Door panel on the apron-facing (-Z) side.
	_add_mesh(root, "HangarDoor", _box_mesh(Vector3(50.0, 12.0, 0.3), door), Vector3(c.x, PLAIN_H + 6.0, c.y - depth * 0.5 - 0.1))


func _slab(root: Node3D, nm: String, size: Vector3, c: Vector2, mat: Material) -> void:
	_add_mesh(root, nm, _box_mesh(size, mat), Vector3(c.x, PLAIN_H + SLAB_TOP - SLAB_T * 0.5, c.y))


static func _mat(c: Color, rough: float, metal: float = 0.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	m.metallic = metal
	return m


static func _box_mesh(size: Vector3, mat: Material) -> BoxMesh:
	var m := BoxMesh.new()
	m.size = size
	m.material = mat
	return m


static func _cyl_mesh(top_r: float, bot_r: float, h: float, segs: int, mat: Material) -> CylinderMesh:
	var m := CylinderMesh.new()
	m.top_radius = top_r
	m.bottom_radius = bot_r
	m.height = h
	m.radial_segments = segs
	m.rings = 1
	m.material = mat
	return m


static func _add_mesh(parent: Node3D, nm: String, m: Mesh, pos: Vector3, rot: Basis = Basis.IDENTITY) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.name = nm
	mi.mesh = m
	mi.transform = Transform3D(rot, pos)
	parent.add_child(mi)
	return mi
