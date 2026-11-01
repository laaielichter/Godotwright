---
name: debug
description: Use when Godot prints an error or warning (SCRIPT ERROR, Parse Error, "Invalid access", "Cannot infer the type", a crash or a black screen), or when a Godot game behaves wrong (falls through a floor, jitters, slides off a moving platform, a node is null, a signal never fires). Finds the cause with Godotwright's lessons from real projects, the 4.7 API and the project map, fixes it, and proves the fix with Godot.
argument-hint: "[error message, log file or symptom, optional]"
---

# Debug a Godot problem

Find the cause of the problem ($ARGUMENTS, or what the user described), fix it and prove the fix. Do not guess: every
step below answers from the project or from Godot.

1. **Get the exact message.** If there is none yet, reproduce it: `godot_check` (loads every script and scene), or
   `godot_play` on the scene with an input timeline and the values you suspect in `watch`. Keep the message as printed.
2. **Ask the lessons first.** Call `godot_lessons` with the message as `error`. If nothing matches, call it with a few
   words of the symptom ("helicopter bounces on moving deck", "textures shimmer far away", "stutter when streaming").
   A lesson gives symptom, cause, fix and how to test; read the full one with its id.
3. **Read the code that runs.** `godot_scan` for the scene tree, autoloads and input map; `godot_usages` for everything
   that touches the name in the message. Check every engine call on the path with `godot_api`: Godot 3 names, wrong
   argument counts and properties that moved are the usual cause.
4. **Name the cause in one sentence** before you change anything, in Godot terms (which node, which property, which
   frame or physics tick). If two causes fit, design a check that tells them apart (`godot_play` with `watch`).
5. **Fix the cause, not the symptom.** No `if x == null: return` around a null that should never be null, no lowered
   physics settings to hide a contact bug. Keep the change small and typed. `godot_review` the file (the hook does this
   after every edit when the plugin hooks are on).
6. **Prove it.** Run the same reproduction again (`godot_check`, `godot_play`, `godot_test`) and show before and after.
   A fix that cannot be shown failing first is not proven.
7. **Teach it back.** If the fix took more than one try, keep it with `godot_lesson_add` (general words, the Godot
   message as `error`, no names or code). Rate every lesson you used with `godot_feedback` (`lesson`, verdict `right`
   or `wrong`).

End with: the message, the cause in one sentence, the fix per file, and the proof.
