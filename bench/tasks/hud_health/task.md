Show the player's health in the HUD.

Add a Label to res://scenes/ui/hud.tscn that shows the health as "HP: <health>/<max_health>",
for example "HP: 3/3", and keep it up to date whenever the player's health changes.
The player already emits health_changed(new_health, max_health).
