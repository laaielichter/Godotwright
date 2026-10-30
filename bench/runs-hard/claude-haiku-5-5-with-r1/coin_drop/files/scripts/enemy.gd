extends Area2D

@export var stats: EnemyStats

const COIN_SCENE: PackedScene = preload("res://scenes/coin.tscn")


func _ready() -> void:
	body_entered.connect(_on_body_entered)


func _process(delta: float) -> void:
	var speed: float = stats.speed if stats else 100.0
	position.y += speed * delta


func _on_body_entered(body: Node2D) -> void:
	if body is Player:
		var damage: int = stats.damage if stats else 1
		(body as Player).take_damage(damage)
		GameState.add_points(1)
		_spawn_coin.call_deferred(get_parent(), global_position)
		queue_free()


func _spawn_coin(parent: Node, spawn_position: Vector2) -> void:
	var coin: Area2D = COIN_SCENE.instantiate()
	parent.add_child(coin)
	coin.global_position = spawn_position
