res://scripts/turret.gd and res://scripts/bullet.gd were written for Godot 3 and do not work
in Godot 4.7. Port them to Godot 4.7 so res://scenes/turret.tscn works as it did:
the turret turns toward its target, fires a bullet every fire_interval seconds, and emits
fired(bullet) for each shot. Bullets fly forward in the direction they were fired.
