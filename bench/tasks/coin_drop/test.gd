extends "res://.godot/bench/harness.gd"


func run() -> void:
	var world: Node2D = Node2D.new()
	root.add_child(world)
	var player: Node = (load("res://scenes/player.tscn") as PackedScene).instantiate()
	world.add_child(player)
	player.set("position", Vector2(0, 0))
	player.set_physics_process(false)
	var enemy: Node = (load("res://scenes/enemy.tscn") as PackedScene).instantiate()
	world.add_child(enemy)
	enemy.set("position", Vector2(0, -60))
	await frames(30)
	var coins: Array[Node] = get_nodes_in_group("coins")
	check("the enemy touched the player", not is_instance_valid(enemy))
	if not check("one coin was dropped", coins.size() == 1, str(coins.size())):
		return
	var coin: Area2D = coins[0] as Area2D
	check("the coin is a child of the enemy's parent", coin.get_parent() == world)
	check("the coin is where the enemy was", coin.position.y < 0.0 and coin.position.y > -60.0, str(coin.position))
	check("the coin is in the physics world", coin.monitoring and PhysicsServer2D.area_get_space(coin.get_rid()) == world.get_world_2d().space)
	player.set("position", Vector2(400, 400))
	await frames(3)
	player.set("position", coin.position)
	var seen: Array[bool] = [false]
	coin.body_entered.connect(func(_body: Node2D) -> void: seen[0] = true)
	await frames(5)
	check("the coin notices the player", seen[0])
