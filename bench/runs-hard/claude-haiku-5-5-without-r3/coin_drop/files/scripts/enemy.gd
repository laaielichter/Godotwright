extends Area2D

const COIN_SCENE: PackedScene = preload("res://scenes/coin.tscn")

@export var stats: EnemyStats


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
		_drop_coin()
		queue_free()


func _drop_coin() -> void:
	var coin: Area2D = COIN_SCENE.instantiate()
	coin.position = position
	# Physics callbacks are flushing, so the coin must be added deferred.
	get_parent().call_deferred("add_child", coin)
