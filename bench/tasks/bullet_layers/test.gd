extends "res://.godot/bench/harness.gd"


func run() -> void:
	if not check("bullet scene exists", ResourceLoader.exists("res://scenes/bullet.tscn")):
		return
	var player: Node = load_scene("res://scenes/player.tscn")
	player.set("position", Vector2(0, 0))
	player.set_physics_process(false)
	var through: Node = load_scene("res://scenes/bullet.tscn")
	if not check("bullet root is an Area2D", through is Area2D):
		return
	through.set("position", Vector2(0, 0))
	var health: int = int(player.get("health"))
	await frames(3)
	check("the bullet passes through the player", is_instance_valid(through) and not through.is_queued_for_deletion() and int(player.get("health")) == health)
	var bullet: Area2D = through as Area2D
	check("it does not collide with the player layer", is_instance_valid(bullet) and not bullet.get_collision_mask_value(2))
	check("it collides with the enemies layer", is_instance_valid(bullet) and bullet.get_collision_mask_value(3))
	var start_y: float = float(bullet.get("position").y) if is_instance_valid(bullet) else 0.0
	await frames(30)
	if is_instance_valid(bullet):
		var flown: float = start_y - float(bullet.get("position").y)
		check("it flies up at about 600 px/s", flown > 250.0 and flown < 350.0, str(flown))
	var enemy: Node = load_scene("res://scenes/enemy.tscn")
	enemy.set("position", Vector2(2000, -100))
	enemy.set_process(false)
	var shot: Node = load_scene("res://scenes/bullet.tscn")
	shot.set("position", Vector2(2000, -60))
	await frames(10)
	check("it hits the enemy", int(enemy.get("hit_points")) == 1 if is_instance_valid(enemy) else false, str(enemy.get("hit_points") if is_instance_valid(enemy) else "freed"))
	check("it removes itself after the hit", not is_instance_valid(shot) or shot.is_queued_for_deletion())
