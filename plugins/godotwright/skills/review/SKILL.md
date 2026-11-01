---
name: review
description: Review this Godot project with Godotwright and fix what it finds, errors first, re-reviewing after each fix.
disable-model-invocation: true
argument-hint: "[files or folder, optional]"
---

# Review and fix

Review the Godot project (or only $ARGUMENTS, when given) and fix what the review finds.

1. Call `godot_scan` once, so you know the scenes, scripts and input actions.
2. Call `godot_review` (pass the files from $ARGUMENTS when given). Show the user the overall score,
   the score per category and the number of errors, warnings and infos.
3. If there are Godot 3 findings, run `godot_migrate` as a report first, then with `write: true`.
4. Fix the remaining errors, then the warnings, one file at a time. Look up every API you change with
   `godot_api`. After each file, call `godot_review` with that file and `only_new: true`.
5. Leave infos the user did not ask about; list them at the end instead.
6. When Godot is installed, finish with `godot_check` (and `godot_test` if the project has tests).
7. End with the score before and after, what you changed per file, and anything left that needs a
   decision from the user. Report verified false alarms with `godot_feedback`.

Do not change gameplay or behaviour to make a finding go away. If a fix would change what the game
does, ask first.
