---
name: port
description: Port Godot 3 GDScript in this project to Godot 4.7 with Godotwright, then check it with a review and with Godot.
disable-model-invocation: true
argument-hint: "[folder or .gd file, optional]"
---

# Port Godot 3 code to Godot 4

Port the project (or only $ARGUMENTS, when given) from Godot 3 to Godot 4.7.

1. Call `godot_review` and count the `api/godot3-syntax`, `api/unknown-type`, `api/unknown-function`
   and `api/unknown-member` findings. This is the "before" picture; show it to the user.
2. Call `godot_migrate` without `write` and show the user what it will change and what it leaves to do
   by hand. Then call it again with `write: true`.
3. Do the listed TO DOs by hand, one at a time. Look up every replacement with `godot_api` (it knows
   the Godot 3 names). Typical ones: `move_and_slide()` takes no arguments and uses the `velocity`
   property; signals connect with `signal_name.connect(callable)`; `yield` becomes `await`.
4. Call `godot_review` with `only_new: true` after each file until no Godot 3 findings are left.
5. When Godot is installed, run `godot_check`. Scenes and project settings are not migrated by
   `godot_migrate`; if `godot_check` reports them, tell the user that Godot's own `--convert-3to4`
   handles those.
6. End with the counts before and after and the list of hand-made changes.
