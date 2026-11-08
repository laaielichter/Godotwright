extends SceneTree
# Used by library-godot.test.ts. Loads every library asset as Godot imported it and checks it: it instantiates, has
# meshes with surfaces, normals and materials, UVs and tangents where a material is textured, a sane size, and it stands
# on y = 0 (vessels reach below it). Writes one line per asset to res://check_all.txt.
var failures := 0
var lines: PackedStringArray = []

func _walk(n: Node, out: Array) -> void:
	if n is MeshInstance3D:
		out.append(n)
	for c in n.get_children():
		_walk(c, out)

func _world(n: Node3D, root: Node) -> Transform3D:
	var t := n.transform
	var p := n.get_parent()
	while p != null and p != root.get_parent():
		if p is Node3D: t = (p as Node3D).transform * t
		p = p.get_parent()
	return t

func _check(path: String) -> void:
	var problems: PackedStringArray = []
	var res = load(path)
	if res == null or not (res is PackedScene):
		failures += 1
		lines.append("FAIL %s: does not load as a PackedScene" % path)
		return
	var root: Node = res.instantiate()
	if root == null:
		failures += 1
		lines.append("FAIL %s: does not instantiate" % path)
		return
	var meshes: Array = []
	_walk(root, meshes)
	if meshes.is_empty():
		problems.append("no MeshInstance3D")
	var aabb := AABB()
	var first := true
	var surfaces := 0
	var textured := 0
	var tris := 0
	var miny := INF
	for mi: MeshInstance3D in meshes:
		var mesh: Mesh = mi.mesh
		if mesh == null:
			problems.append("%s has no mesh" % mi.name)
			continue
		var box: AABB = _world(mi, root) * mesh.get_aabb()
		aabb = box if first else aabb.merge(box)
		first = false
		for s in mesh.get_surface_count():
			surfaces += 1
			var arr := mesh.surface_get_arrays(s)
			var xf := _world(mi, root)
			for v: Vector3 in arr[Mesh.ARRAY_VERTEX]:
				miny = minf(miny, (xf * v).y)
			var idx = arr[Mesh.ARRAY_INDEX]
			tris += (idx.size() if idx != null else arr[Mesh.ARRAY_VERTEX].size()) / 3
			if arr[Mesh.ARRAY_NORMAL] == null: problems.append("%s surface %d has no normals" % [mi.name, s])
			var mat: Material = mi.get_active_material(s)
			if mat == null:
				problems.append("%s surface %d has no material" % [mi.name, s])
			elif mat is BaseMaterial3D and mat.albedo_texture != null:
				textured += 1
				if arr[Mesh.ARRAY_TEX_UV] == null: problems.append("%s surface %d is textured but has no UVs" % [mi.name, s])
				if mat.normal_enabled and arr[Mesh.ARRAY_TANGENT] == null: problems.append("%s surface %d has a normal map but no tangents" % [mi.name, s])
	var vessel := path.contains("/vehicles/boat") or path.contains("/vehicles/rowing-boat")
	if not first:
		if not vessel and absf(miny) > 0.06: problems.append("lowest vertex y = %.3f" % miny)
		if vessel and miny > -0.05: problems.append("vessel does not reach below the waterline")
		if aabb.size.length() < 0.05 or aabb.size.length() > 500: problems.append("odd size %s" % aabb.size)
	root.queue_free()
	if problems.is_empty():
		lines.append("ok %s  meshes %d surfaces %d textured %d tris %d size %.2f x %.2f x %.2f" % [path, meshes.size(), surfaces, textured, tris, aabb.size.x, aabb.size.y, aabb.size.z])
	else:
		failures += 1
		lines.append("FAIL %s: %s" % [path, "; ".join(problems)])

func _init() -> void:
	var files: PackedStringArray = []
	for cat in DirAccess.get_directories_at("res://assets"):
		for f in DirAccess.get_files_at("res://assets/" + cat):
			if f.ends_with(".glb"): files.append("res://assets/%s/%s" % [cat, f])
	for f in files:
		_check(f)
	var out := FileAccess.open("res://check_all.txt", FileAccess.WRITE)
	out.store_string("\n".join(lines) + "\n")
	print("checked %d assets, %d failed" % [files.size(), failures])
	quit(1 if failures else 0)
