Work in res://scripts/level.gd (attached to res://scenes/level.tscn, whose Ground node is a TileMapLayer).

Add two functions:
- fill_rect(area: Rect2i) fills every cell in `area` on Ground with the tile at atlas
  coordinates (0, 0) of source 0.
- is_solid_at(world_position: Vector2) -> bool returns true when the Ground cell under that
  global position is filled. The level and Ground may be moved, so convert positions properly.
