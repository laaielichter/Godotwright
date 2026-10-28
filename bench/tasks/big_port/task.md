res://scripts/hero.gd (used by res://scenes/hero.tscn) was written for Godot 3 and does not
work in Godot 4.7. Port it to Godot 4.7 so the hero behaves exactly as before:

- runs left and right with the move_left/move_right actions and jumps from the floor with jump,
- plays the "run" animation while moving and "idle" otherwise,
- `speed` stays an exported value limited to 100..600 in the Inspector,
- collect(amount) adds to `coins`, emits coins_changed(total), and flashes the sprite yellow
  for 0.15 seconds,
- the script still works as a tool script without moving the hero in the editor.
