---
name: dream
description: Let Godotwright look back at past sessions in this Godot project and propose lessons, project hints, merges and fixes for contradictions, each with its evidence; apply only what you approve.
disable-model-invocation: true
argument-hint: "[transcripts, optional]"
---

# Dream: learn from past sessions

Godotwright keeps counts on this machine: Godot errors the review did not predict, API names that were looked up and
did not exist, lessons that helped or misled, findings marked as false alarms, and writes that were undone. A dream
reads them back and proposes what to keep. No model and no network: nothing leaves the machine, and nothing changes
until a proposal is applied.

1. **Dream.** Call `godot_dream` with detail full. Read session transcripts only when $ARGUMENTS says `transcripts`, or
   when the user says yes when you ask: then call it with `transcripts: true`. Only anonymous facts are kept from them.
2. **Finish the drafts.** A draft lesson has the symptom and the Godot message, not the cause or fix. For each one you
   can work out, use `godot_lessons` and `godot_api`, and `godot_check` when Godot is installed to prove the fix. For a
   longer look, hand the dream to the `godot-dreamer` subagent.
3. **Show, then ask.** List every proposal with its number, the evidence and the reason, plus the lessons you wrote for
   the drafts. Ask the user which to apply.
4. **Apply what was approved:** `godot_dream` with `apply` (numbers or ids), then `godot_lesson_add` with the exact
   title of each finished draft so it replaces the draft.
5. **End with a short list:** what was applied, what was left, and that `godot_undo` takes the apply back.

Nothing is written into a file of the repository: hints, the report and the lessons for agents stay in the project's
untracked `.godot/godotwright/dreams/` (or Godotwright's state folder), and the session start shows them to the agent.
No lesson may hold code, paths, or project, file or node names.

Settings live in `godotwright.json`: `"dream": {"auto": "suggest", "minHours": 24, "minSessions": 5}`. With
`"suggest"` (the default) the session start says when proposals are waiting; `"apply"` applies lesson and hint changes
by itself (never a removal), but only after the user allowed it once with `godotwright dream --auto-apply yes`; never
give that consent for them. `"off"` stays quiet.
