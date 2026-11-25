extends Node

# How many coins to spawn.
@export var coin_count = 3
# The scene each coin starts from; assign it in the editor. It stays null here
# because this example has no scenes: the line exists to show the rewrite.
@export var coin_scene: PackedScene

@onready var player = Player.new()
@onready var hud = Menu.new()

var coins = []

func _ready():
	add_child(player)
	player.position = Vector2(240, 200)
	add_child(hud)
	player.jumped.connect(self._on_player_jumped)
	player.died.connect(self._on_player_died)
	for i in range(coin_count):
		var c = coin_scene.instantiate()
		c.position = Vector2(60 + i * 180, 140)
		add_child(c)
		coins.append(c)

func _physics_process(delta):
	for c in coins:
		if c.collected:
			c.queue_free()
	coins = coins.filter(func(c): return not c.collected)

func _on_player_jumped():
	hud.add_points(10)

func _on_player_died():
	get_tree().reload_current_scene()
