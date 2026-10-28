extends Node2D

const SOURCE_ID: int = 0
const TILE_ATLAS_COORDS: Vector2i = Vector2i(0, 0)

@onready var ground: TileMapLayer = $Ground


func fill_rect(area: Rect2i) -> void:
	for x in range(area.position.x, area.end.x):
		for y in range(area.position.y, area.end.y):
			ground.set_cell(Vector2i(x, y), SOURCE_ID, TILE_ATLAS_COORDS)


func is_solid_at(world_position: Vector2) -> bool:
	var local_position: Vector2 = ground.to_local(world_position)
	var cell: Vector2i = ground.local_to_map(local_position)
	return ground.get_cell_source_id(cell) != -1
