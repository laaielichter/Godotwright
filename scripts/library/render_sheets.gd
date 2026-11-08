extends SceneTree
# Used by scripts/render-library.mjs. Renders every .glb under res://assets/<group>/ in Godot (Compatibility renderer)
# with calibrated light (AgX tone mapping, sun 0.9, ambient 0.28: an 18 % grey card in sun reads about sRGB 130-150) and
# writes one contact sheet per group: res://sheets/<group>.png (or .jpg), cells in file-name order.
# Args after --: cell-width cols [png|jpg] [cell-height] (the height defaults to the width).
var COLS := 6
var cell := 320
var cell_h := 320
var vp: SubViewport
var cam: Camera3D
var holder: Node3D

func _setup() -> void:
	vp = SubViewport.new()
	vp.size = Vector2i(cell, cell_h)
	vp.msaa_3d = Viewport.MSAA_4X
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	vp.own_world_3d = true
	get_root().add_child(vp)
	var env := Environment.new()
	var sky := Sky.new()
	var mat := ProceduralSkyMaterial.new()
	mat.sky_top_color = Color(0.36, 0.52, 0.75)
	mat.sky_horizon_color = Color(0.72, 0.77, 0.82)
	mat.ground_horizon_color = Color(0.6, 0.6, 0.58)
	mat.ground_bottom_color = Color(0.3, 0.3, 0.28)
	sky.sky_material = mat
	env.sky = sky
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.58, 0.63, 0.68)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.78, 0.8, 0.84)
	env.ambient_light_energy = 0.28
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	env.tonemap_exposure = 0.95
	var we := WorldEnvironment.new()
	we.environment = env
	vp.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50, 35, 0)
	sun.light_energy = 0.9
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 200
	vp.add_child(sun)
	cam = Camera3D.new()
	cam.fov = 30
	vp.add_child(cam)
	holder = Node3D.new()
	vp.add_child(holder)

func _bounds(n: Node, xf: Transform3D, box: Array) -> void:
	var t := xf
	if n is Node3D: t = xf * (n as Node3D).transform
	if n is MeshInstance3D and (n as MeshInstance3D).mesh:
		for s in (n as MeshInstance3D).mesh.get_surface_count():
			for v: Vector3 in (n as MeshInstance3D).mesh.surface_get_arrays(s)[Mesh.ARRAY_VERTEX]:
				var w := t * v
				box[0] = box[0].min(w)
				box[1] = box[1].max(w)
	for c in n.get_children(): _bounds(c, t, box)

func _render(path: String) -> Image:
	for c in holder.get_children(): c.queue_free()
	var inst: Node3D = (load(path) as PackedScene).instantiate()
	var box := [Vector3(INF, INF, INF), Vector3(-INF, -INF, -INF)]
	_bounds(inst, Transform3D(), box)
	holder.add_child(inst)
	var ground := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	var size: Vector3 = box[1] - box[0]
	var radius := size.length() * 0.5
	plane.size = Vector2(radius * 8, radius * 8)
	ground.mesh = plane
	var gm := StandardMaterial3D.new()
	gm.albedo_color = Color(0.42, 0.45, 0.42)
	gm.roughness = 1.0
	gm.metallic_specular = 0.0
	ground.material_override = gm
	ground.position = Vector3((box[0].x + box[1].x) / 2, minf(box[0].y, 0.0) - 0.002, (box[0].z + box[1].z) / 2)
	if path.get_file().contains("boat"):
		# A vessel floats: the ground is water at y = 0.
		gm.albedo_color = Color(0.08, 0.2, 0.26)
		ground.position.y = 0.0
	holder.add_child(ground)
	var center: Vector3 = (box[0] + box[1]) / 2
	var dir := Vector3(1.0, 0.75, 1.35).normalized()
	cam.near = radius / 100.0
	cam.far = radius * 40.0
	cam.position = center + dir * (radius / sin(deg_to_rad(15)) * 1.02)
	cam.look_at(center, Vector3.UP)
	var sun: DirectionalLight3D = vp.get_child(1)
	sun.directional_shadow_max_distance = radius * 12
	await process_frame
	await process_frame
	await RenderingServer.frame_post_draw
	return vp.get_texture().get_image()

func _init() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0: cell = int(args[0])
	if args.size() > 1: COLS = int(args[1])
	var jpg := args.size() > 2 and args[2] == "jpg"
	cell_h = int(args[3]) if args.size() > 3 else cell
	_setup()
	DirAccess.make_dir_recursive_absolute("res://sheets")
	await process_frame
	var total := 0
	for group in DirAccess.get_directories_at("res://assets"):
		var list: Array = []
		for f in DirAccess.get_files_at("res://assets/" + group):
			if f.ends_with(".glb"): list.append(f)
		list.sort()
		var rows := ceili(list.size() / float(COLS))
		var sheet := Image.create(COLS * cell, rows * cell_h, false, Image.FORMAT_RGBA8)
		sheet.fill(Color(0.16, 0.17, 0.19))
		for i in list.size():
			var img := await _render("res://assets/%s/%s" % [group, list[i]])
			img.convert(Image.FORMAT_RGBA8)
			sheet.blit_rect(img, Rect2i(Vector2i.ZERO, img.get_size()), Vector2i((i % COLS) * cell, (i / COLS) * cell_h))
			total += 1
		if jpg:
			sheet.convert(Image.FORMAT_RGB8)
			sheet.save_jpg("res://sheets/%s.jpg" % group, 0.8)
		else:
			sheet.save_png("res://sheets/%s.png" % group)
		print("sheet %s: %d" % [group, list.size()])
	print("rendered %d assets" % total)
	quit()
