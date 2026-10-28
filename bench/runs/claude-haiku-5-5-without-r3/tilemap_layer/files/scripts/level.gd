extends Node2D

@onready var ground: TileMapLayer = $Ground


func fill_rect(area: Rect2i) -> void:
	for x in range(area.position.x, area.end.x):
		for y in range(area.position.y, area.end.y):
			ground.set_cell(Vector2i(x, y), 0, Vector2i(0, 0))


func is_solid_at(world_position: Vector2) -> bool:
	var local_position := ground.to_local(world_position)
	var cell := ground.local_to_map(local_position)
	return ground.get_cell_source_id(cell) != -1
