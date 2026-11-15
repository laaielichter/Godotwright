class_name Menu
extends CanvasLayer

# Prefix shown before the score.
@export var label_text = "Score"

@onready var button = Button.new()
@onready var score_label = Label.new()

var score = 0

func _ready():
	button.text = "Start"
	button.size = Vector2(120, 40)
	button.position = Vector2(180, 115)
	button.pressed.connect(self._on_pressed)
	add_child(button)
	score_label.text = label_text + ": 0"
	score_label.position = Vector2(10, 10)
	add_child(score_label)

func add_points(amount):
	score += amount
	score_label.text = label_text + ": " + str(score)

func _on_pressed():
	button.queue_free()
	print("Game starting with ", score, " points")
