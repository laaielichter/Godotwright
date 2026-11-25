# Godot 3 Platformer Example

A tiny Godot 3.5 project written from scratch to try `godotwright migrate`
and `godotwright review` on. Clone the repo, build, and run the four commands
below: the numbers and lines you see are copied from a real run, not typed.

There is no art, no sound and no scene (`.tscn`): `migrate` does not convert
scenes or project settings (Godot's own `--convert-3to4` does those), so the
example is pure text, and every node the scripts use is built from code in
`_ready()`.

## What is in it

| File | Shows |
| --- | --- |
| `scripts/player.gd` | `KinematicBody2D`, `export var`, `onready var`, `yield(get_tree().create_timer(1.0), "timeout")`, `emit_signal`, `setget`, `OS.get_ticks_msec()`, and the `move_and_slide()` call that is left for a hand fix |
| `scripts/coin.gd` | `connect("body_entered", self, "_on_body_entered")`, `rand_range`, `OS.get_ticks_msec()` |
| `scripts/menu.gd` | `connect("pressed", self, "_on_pressed")`, `export var`, `onready var` |
| `scripts/game.gd` | `.instance()`, `export(PackedScene)`, signal connections |
| `scripts/level_editor.gd` | `tool`, `export var`, `OS.get_ticks_msec()` |

All of it is original work (MIT); nothing is copied from a tutorial.

## Run it

From the repository root, build once, then run every command from inside this
folder (`node ../../dist/cli.js` is the built CLI; `npx -y godotwright` is
the same once installed from npm):

```sh
npm ci && npm run build
cd examples/godot3-platformer
```

## 1. Review before

```sh
node ../../dist/cli.js review .
```

```text
AAA review: Godot 3 Platformer Example (Godot 4.7.2-stable, 5 scripts, 0 scenes)
overall: 56/100
  api            0  36 errors
  performance  100  no findings
  quality       56  11 infos
  structure     87  1 errors, 1 infos
  static typing: 0% (0/29 declarations)

findings (49):
  res://scripts/coin.gd:5: error [api/godot3-syntax] Godot 3 syntax: `export var` is `@export var` in Godot 4.
  res://scripts/coin.gd:7: error [api/godot3-syntax] Godot 3 syntax: `onready var` is `@onready var` in Godot 4.
  res://scripts/coin.gd:8: error [api/godot3-syntax] Godot 3 syntax: `onready var` is `@onready var` in Godot 4.
  res://scripts/coin.gd:8: error [api/unknown-function] Function "rand_range()" does not exist in "Coin", its parents or the global scope. In Godot 4 it is `randf_range` (Godot 3 name).
  res://scripts/coin.gd:16: error [api/godot3-syntax] Godot 3 syntax: `connect("signal", target, "method")` is `signal_name.connect(target.method)` in Godot 4.
  res://scripts/coin.gd:21: error [api/unknown-member] Method "get_ticks_msec()" does not exist on OS in Godot 4.7. In Godot 4 use Time.get_ticks_msec().
  res://scripts/game.gd:4: error [api/godot3-syntax] Godot 3 syntax: `export var` is `@export var` in Godot 4.
  res://scripts/game.gd:7: error [api/godot3-syntax] Godot 3 syntax: `export var` is `@export var` in Godot 4.
  res://scripts/game.gd:7: error [api/unknown-function] Function "export()" does not exist in this script (Node), its parents or the global scope. Did you mean: exp?
  res://scripts/game.gd:9: error [api/godot3-syntax] Godot 3 syntax: `onready var` is `@onready var` in Godot 4.
  res://scripts/game.gd:10: error [api/godot3-syntax] Godot 3 syntax: `onready var` is `@onready var` in Godot 4.
  res://scripts/game.gd:18: error [api/godot3-syntax] Godot 3 syntax: `connect("signal", target, "method")` is `signal_name.connect(target.method)` in Godot 4.
  res://scripts/game.gd:19: error [api/godot3-syntax] Godot 3 syntax: `connect("signal", target, "method")` is `signal_name.connect(target.method)` in Godot 4.
  res://scripts/game.gd:21: error [api/godot3-syntax] Godot 3 syntax: `PackedScene.instance()` is `instantiate()` in Godot 4.
  res://scripts/level_editor.gd:1: error [api/godot3-syntax] Godot 3 syntax: `tool` is `@tool` in Godot 4.
  res://scripts/level_editor.gd:5: error [api/godot3-syntax] Godot 3 syntax: `export var` is `@export var` in Godot 4.
  res://scripts/level_editor.gd:7: error [api/godot3-syntax] Godot 3 syntax: `export var` is `@export var` in Godot 4.
  res://scripts/level_editor.gd:8: error [api/godot3-syntax] Godot 3 syntax: `export var` is `@export var` in Godot 4.
  res://scripts/level_editor.gd:11: error [api/unknown-member] Method "get_ticks_msec()" does not exist on OS in Godot 4.7. In Godot 4 use Time.get_ticks_msec().
  res://scripts/level_editor.gd:14: error [api/unknown-member] Method "get_ticks_msec()" does not exist on OS in Godot 4.7. In Godot 4 use Time.get_ticks_msec().
  res://scripts/menu.gd:5: error [api/godot3-syntax] Godot 3 syntax: `export var` is `@export var` in Godot 4.
  res://scripts/menu.gd:7: error [api/godot3-syntax] Godot 3 syntax: `onready var` is `@onready var` in Godot 4.
  res://scripts/menu.gd:8: error [api/godot3-syntax] Godot 3 syntax: `onready var` is `@onready var` in Godot 4.
  res://scripts/menu.gd:16: error [api/godot3-syntax] Godot 3 syntax: `connect("signal", target, "method")` is `signal_name.connect(target.method)` in Godot 4.
  res://scripts/player.gd:2: error [api/unknown-type] Cannot extend "KinematicBody2D": it does not exist in Godot 4.7 or this project. In Godot 4 it is `CharacterBody2D` (Godot 3 name).
  +24 more (infos and the rest: use --detail full)

Exit code: 1
```

## 2. Migrate (dry run)

```sh
node ../../dist/cli.js migrate .
```

```text
migrate: 5 scripts with 35 changes, 1 thing to do by hand (dry run: add --write to apply)
res://scripts/coin.gd (6 changes)
     5: export var  ->  @export var
     7: onready var  ->  @onready var
     8: onready var  ->  @onready var
     8: rand_range  ->  randf_range
    16: connect("body_entered", self, "_on_body_entered")  ->  body_entered.connect(self._on_body_entered)
    21: OS.get_ticks_msec()  ->  Time.get_ticks_msec()
res://scripts/game.gd (7 changes)
     4: export var  ->  @export var
     7: export(PackedScene) var coin_scene  ->  @export var coin_scene: PackedScene
     9: onready var  ->  @onready var
    10: onready var  ->  @onready var
    18: player.connect("jumped", self, "_on_player_jumped")  ->  player.jumped.connect(self._on_player_jumped)
    19: player.connect("died", self, "_on_player_died")  ->  player.died.connect(self._on_player_died)
    21: .instance()  ->  .instantiate()
res://scripts/level_editor.gd (6 changes)
     1: tool  ->  @tool
     5: export var  ->  @export var
     7: export var  ->  @export var
     8: export var  ->  @export var
    11: OS.get_ticks_msec()  ->  Time.get_ticks_msec()
    14: OS.get_ticks_msec()  ->  Time.get_ticks_msec()
res://scripts/menu.gd (4 changes)
     5: export var  ->  @export var
     7: onready var  ->  @onready var
     8: onready var  ->  @onready var
    16: button.connect("pressed", self, "_on_pressed")  ->  button.pressed.connect(self._on_pressed)
res://scripts/player.gd (12 changes)
     2: KinematicBody2D  ->  CharacterBody2D
     5: export var  ->  @export var
     7: export var  ->  @export var
    10: onready var  ->  @onready var
    10: Sprite  ->  Sprite2D
    12: onready var  ->  @onready var
    12: OS.get_ticks_msec()  ->  Time.get_ticks_msec()
    17: setget set_lives  ->  : set = set_lives
    25: yield(get_tree().create_timer(1.0), "timeout")  ->  await get_tree().create_timer(1.0).timeout
    34: emit_signal("jumped")  ->  jumped.emit()
    36: OS.get_ticks_msec()  ->  Time.get_ticks_msec()
    42: emit_signal("died")  ->  died.emit()
    35: TO DO: move_and_slide() takes no arguments in Godot 4: set `velocity` first, call move_and_slide(), and read `velocity` back
  note: setters in Godot 4 run on assignment inside the script (in Godot 3 they required self.)

Next: run `godotwright review` for what is still wrong, then `godotwright check` with Godot 4. Scenes and project settings are not migrated here; Godot's own `--convert-3to4` does those.
```

The dry run writes nothing. The one `TO DO` is the `move_and_slide(velocity, Vector2.UP)` call: `migrate` deliberately does not guess how to port it, because in Godot 4 `move_and_slide()` reads and writes the `velocity` property instead of taking arguments.

## 3. Apply the migration

```sh
node ../../dist/cli.js migrate . --write
```

The output is the same as the dry run except the header:

```text
migrate: 5 scripts with 35 changes, 1 thing to do by hand (written, journal #1: godot_undo reverts it)
```

The scripts are now Godot 4. For example, `player.gd` became (the `move_and_slide()` line and the local `velocity` are still to fix by hand):

```gdscript
class_name Player
extends CharacterBody2D

# Horizontal speed in pixels per second.
@export var speed = 160
# Upward velocity applied when jumping.
@export var jump_impulse = 300

# The node that draws the player; added in _ready().
@onready var sprite = Sprite2D.new()
# Game time at start, used by the speed-up effect below.
@onready var started_at = Time.get_ticks_msec()

# Current velocity, in pixels per second.
var velocity = Vector2()
# Remaining lives; read by the game script.
var lives = 3: set = set_lives

signal jumped
signal died

func _ready():
	add_child(sprite)
	sprite.position.y = -10
	await get_tree().create_timer(1.0).timeout
	velocity.y = -60

func _physics_process(delta):
	var direction = Input.get_axis("ui_left", "ui_right")
	velocity.x = direction * speed
	velocity.y += 900.0 * delta
	if Input.is_action_just_pressed("ui_up") and is_on_floor():
		velocity.y = -jump_impulse
		jumped.emit()
	move_and_slide(velocity, Vector2.UP)
	if Time.get_ticks_msec() - started_at > 3000:
		speed = 320

func set_lives(value):
	lives = value
	if lives <= 0:
		died.emit()
```

## 4. Review after

```sh
node ../../dist/cli.js review .
```

```text
AAA review: Godot 3 Platformer Example (Godot 4.7.2-stable, 5 scripts, 0 scenes)
overall: 80/100
  api           76  2 errors
  performance  100  no findings
  quality       61  5 infos
  structure     87  1 errors, 1 infos
  static typing: 2% (1/46 declarations)

findings (9):
  res://scripts/player.gd:15: error [api/redefines-native-member] Member "velocity" redefined (original in native class 'CharacterBody2D'): remove it to use the inherited property, or rename it.
  res://scripts/player.gd:35: error [api/wrong-arguments] move_and_slide() takes 0 arguments, but 2 are given. In Godot 4 set `velocity` and call move_and_slide() without arguments.
  res://project.godot: error [structure/broken-reference] no main scene set (application/run/main_scene)
  +6 more (infos and the rest: use --detail full)

Exit code: 1
```

## 5. What is left, and the hand fix

Two of the errors are the `move_and_slide()` hand fix `migrate` announced, in
`scripts/player.gd`:

1. `res://scripts/player.gd:15` — `CharacterBody2D` already has a `velocity`
   property, so the local `var velocity = Vector2()` shadows it. Remove it and
   use the inherited property.
2. `res://scripts/player.gd:35` — `move_and_slide()` takes no arguments in
   Godot 4. Set `velocity` (as the script already does above the call) and call
   `move_and_slide()` bare.

The third error, `no main scene set (application/run/main_scene)`, is on
purpose: this example has no scenes, so there is nothing to make the main
scene. In a real port, Godot's own `--convert-3to4` converts your scenes and
project settings, and the main scene comes back with them. The remaining
findings are `quality/untyped` infos (add static types) and one
`structure/unused-script` info for `game.gd` (in a real project it is attached
to the main scene node).

Fix `player.gd` by hand:

```gdscript
# before (line 15): remove the local velocity, use the inherited one
var velocity = Vector2()

# before (line 35): take no arguments in Godot 4
move_and_slide(velocity, Vector2.UP)
```

```gdscript
# after: use the inherited CharacterBody2D.velocity property, and call move_and_slide() bare
move_and_slide()
```

## 6. Review after the hand fix

```sh
node ../../dist/cli.js review . --detail full
```

```text
AAA review: Godot 3 Platformer Example (Godot 4.7.2-stable, 5 scripts, 0 scenes)
overall: 88/100
  api          100  no findings
  performance  100  no findings
  quality       61  5 infos
  structure     87  1 errors, 1 infos
  static typing: 2% (1/45 declarations)

findings (7):
  res://project.godot: error [structure/broken-reference] no main scene set (application/run/main_scene)
    fix: Fix the path or uid, or restore the missing file.
  res://scripts/coin.gd:5: info [quality/untyped] 9 of 9 declarations have no static type, e.g. var value (line 5), var shape (line 7), var bob_offset (line 8).
    fix: Add types to variables, parameters and return values (or use :=).
  res://scripts/game.gd:4: info [quality/untyped] 10 of 11 declarations have no static type, e.g. var coin_count (line 4), var player (line 9), var hud (line 10).
    fix: Add types to variables, parameters and return values (or use :=).
  res://scripts/level_editor.gd:5: info [quality/untyped] 6 of 6 declarations have no static type, e.g. var tile_size (line 5), var columns (line 7), var rows (line 8).
    fix: Add types to variables, parameters and return values (or use :=).
  res://scripts/menu.gd:5: info [quality/untyped] 8 of 8 declarations have no static type, e.g. var label_text (line 5), var button (line 7), var score_label (line 8).
    fix: Add types to variables, parameters and return values (or use :=).
  res://scripts/player.gd:5: info [quality/untyped] 11 of 11 declarations have no static type, e.g. var speed (line 5), var jump_impulse (line 7), var sprite (line 10).
    fix: Add types to variables, parameters and return values (or use :=).
  res://scripts/game.gd: info [structure/unused-script] No scene, resource, autoload or script refers to this script.
    fix: Attach, reference or remove the script.

Exit code: 1
```

The api score is now 100. The only remaining error is the intentional
`no main scene` one; the rest are style infos.

## Staying true: the drift test

`test/examples.test.ts` runs `migrateScript()` over every script here and
checks the result against the expected Godot 4 text (inline in the test). If a
future `migrate` change alters any rewrite, the test fails, so this README
cannot quietly drift from what the tool actually prints. The test needs no
Godot install.
