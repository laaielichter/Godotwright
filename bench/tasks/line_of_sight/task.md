In res://scripts/enemy.gd, add has_line_of_sight(target: Vector2) -> bool.

Cast a physics ray from the enemy's global position to `target` (a global position).
The ray must only hit physics layer 1 (the world) and must ignore the enemy itself.
Return true when nothing blocks the ray.
