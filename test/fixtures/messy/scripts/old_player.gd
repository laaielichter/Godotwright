extends KinematicBody2D

export var speed = 200
onready var sprite = $Sprite

var velocity_old = Vector2()


func _ready():
	connect("body_entered", self, "_on_body_entered")
	yield(get_tree().create_timer(1.0), "timeout")


func _physics_process(delta):
	if Input.is_action_pressed("jump"):
		velocity_old.y -= speed
	velocity_old = move_and_slide(velocity_old, Vector2.UP)
	rotation = deg2rad(90)
	var t = OS.get_ticks_msec()
	if t > 1000:
		get_tree().change_scene("res://scenes/Main.tscn")
	var items = []
	if items.empty():
		pass
