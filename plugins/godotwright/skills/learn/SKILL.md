---
name: learn
description: Teach Godotwright what this session learned about the Godot project, anonymously, so the next session (and every later review and check on this machine) starts smarter.
disable-model-invocation: true
argument-hint: "[what to focus on, optional]"
---

# Teach Godotwright what you learned

Godotwright learns on this machine: which rules Godot confirms, which findings were false alarms, and the lessons you
keep. Nothing here is sent anywhere. Use the lesson tools when this server has them (`godot_lessons`,
`godot_lesson_add`); older servers only have `godot_feedback` for findings.

1. **Look at the gaps.** Call `godot_lessons` with `gaps: true`. It lists the Godot errors seen here that no review rule
   predicted and no lesson explains yet, most frequent first.
2. **Go over this session** (or only $ARGUMENTS, when given). For every problem that took more than one try, or that a
   gap lists, ask: is there a general lesson in it that another Godot project could use?
3. **Keep each lesson with `godot_lesson_add`.** Write it in general words:
   - `title`: the lesson in one line ("A body placed on a moving deck must start at the deck's speed").
   - `symptom`, `cause` (in Godot terms) and `fix`; `test` when you know how to check it.
   - `error`: the Godot message exactly as printed, so `godot_check` shows the fix the next time it appears.
   - No names of the project, no file names, no code: Godotwright replaces them anyway and refuses a lesson that is
     mostly names. Show the user what was stored.
4. **Rate what helped.** For every lesson from `godot_lessons` you used this session, call `godot_feedback` with
   `lesson` and `verdict` right (it helped) or wrong (it did not fit). For review findings you verified as false
   alarms, call `godot_feedback` with `finding` and verdict wrong.
5. **End with a short list:** the lessons kept (their ids), the feedback given, and the gaps that are left. Tell the user
   that `godotwright lessons export` prints the kept lessons as entries they can propose for everyone, and that
   nothing leaves the machine unless they share it themselves.

Do not keep a lesson for something a review rule already reports, and do not keep secrets, personal data or code.
