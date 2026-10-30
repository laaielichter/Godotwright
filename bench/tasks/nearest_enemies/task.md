Find the enemies near a point.

Add `enemies_near(point: Vector2, radius: float) -> Array[Area2D]` to the GameState autoload (res://autoload/game_state.gd). It returns the enemies (the nodes in the "enemies" group) whose global position is within `radius` of `point`, nearest first. Keep the return type exactly as written.
