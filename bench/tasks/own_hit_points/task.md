Enemies need hit points of their own.

Add `hit(amount: int)` to the enemy (res://scripts/enemy.gd): the enemy loses that many hit points and is removed with `queue_free()` when it has none left. Every enemy starts with the hit points from its `stats`.
