Add a bullet.

Make a scene res://scenes/bullet.tscn: an Area2D root with a small collision shape and the script res://scripts/bullet.gd. A bullet flies up the screen at 600 pixels per second. It hits enemies (the "enemies" physics layer) but passes through the player (the "player" layer). When it touches an enemy, it calls `hit(1)` on that enemy and removes itself.
