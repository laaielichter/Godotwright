@tool
extends EditorScript

# Size of the grid cells, in pixels.
@export var tile_size = 16
# Level size in cells.
@export var columns = 30
@export var rows = 17

func _run():
	var started_at = Time.get_ticks_msec()
	var cells = columns * rows
	print("Placing ", cells, " tiles of ", tile_size, "px")
	print("Took ", Time.get_ticks_msec() - started_at, " msec")
