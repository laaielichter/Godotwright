extends "res://.godot/bench/harness.gd"


func run() -> void:
	var level: Node2D = load_scene("res://scenes/level.tscn") as Node2D
	if not check("level scene loads", level != null):
		return
	level.position = Vector2(100, 50)
	await frames(2)
	var ground: TileMapLayer = level.get_node_or_null("Ground") as TileMapLayer
	if not check("Ground is a TileMapLayer", ground != null):
		return
	if not check("has fill_rect and is_solid_at", level.has_method("fill_rect") and level.has_method("is_solid_at")):
		return
	level.call("fill_rect", Rect2i(2, 1, 4, 3))
	await frames(1)
	check("fills 12 cells", ground.get_used_cells().size() == 12, str(ground.get_used_cells().size()))
	check("uses source 0", ground.get_cell_source_id(Vector2i(5, 3)) == 0, str(ground.get_cell_source_id(Vector2i(5, 3))))
	check("uses atlas tile (0, 0)", ground.get_cell_atlas_coords(Vector2i(2, 1)) == Vector2i(0, 0), str(ground.get_cell_atlas_coords(Vector2i(2, 1))))
	check("stays inside the rect", ground.get_cell_source_id(Vector2i(6, 1)) == -1 and ground.get_cell_source_id(Vector2i(1, 1)) == -1)
	var inside: Vector2 = ground.to_global(ground.map_to_local(Vector2i(3, 2)))
	var outside: Vector2 = ground.to_global(ground.map_to_local(Vector2i(0, 0)))
	check("solid on a filled cell", level.call("is_solid_at", inside) == true, str(inside))
	check("not solid on an empty cell", level.call("is_solid_at", outside) == false, str(outside))
	check("not solid far away", level.call("is_solid_at", Vector2(-2000, -2000)) == false)
	var edge: Vector2 = ground.to_global(ground.map_to_local(Vector2i(6, 2)))
	check("not solid just right of the rect", level.call("is_solid_at", edge) == false, str(edge))
