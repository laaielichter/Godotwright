# Privacy

Godotwright learns from use to make its reviews and lookups better.
This page says exactly what it keeps and what it can send.

## On your machine (always, unless you turn it off)

The learning file (`godotwright learn` shows where it is) holds:

- per review rule: how often it fired, how often real Godot confirmed or
  contradicted it, and how often someone marked a finding of it as wrong or
  right (a verdict of right is never counted as a Godot confirmation);
- failed API lookups, and the real name looked up right after. Only a Godot
  class and a member a few letters from a real one are kept (`Node2D.lookat`):
  a bare name, or a class Godot does not have, is not;
- Godot error messages as templates, with quoted text, paths and numbers
  replaced (`Identifier "<s>" not declared in the current scope.`). Every other
  word that is not Godot or engine wording becomes `<id>`, and a message that
  still holds a path or a name is not kept;
- hashes of findings marked as wrong (so they stay hidden), and of findings marked as right or confirmed by Godot
  after they were marked wrong (so `godotwright dream` can find verdicts that contradict each other), local only;
- per lesson id: how often the lesson was shown, and how often it was marked as helpful or wrong;
- lessons you keep with `godot_lesson_add` or `godotwright lessons add`, local only. Before one is stored, names of
  the project (its title, classes, nodes, files, groups and input actions), paths, links, e-mail addresses, dates,
  codes, keys, long numbers, source code and other capitalised names are replaced by placeholders such as `<name>`;
  a lesson that is mostly placeholders is refused. The tool shows what was stored. Remove one with
  `godotwright lessons remove <id>`. Each lesson keeps a hash of the project folder it was learned in (not the path),
  so `godotwright dream` only shows a project's own lessons to agents in that project.

The hooks of the Claude Code plugin (`godotwright hook`) keep a small state file per agent session: the paths of the
Godot files changed in that session that still had review errors, so the agent is reminded of them once before it
stops. It lives in the plugin's data folder (or the system temp folder), is never sent, and is deleted after two days.

`godotwright dream` (and `godot_dream`) reads the learning file and the project's journal on this machine; it calls no
model and sends nothing. Only with `--transcripts` (`transcripts: true`) does it also read this project's Claude Code and
Codex session transcripts, from your home folder. From those it keeps nothing but counts of Godotwright tool calls,
Godot error messages as templates (as above), and failed Godot API lookups (as above); their text, code, names and
paths are never copied into its output, a lesson or a report. Next to the learning file, `dreams.json` counts sessions
per project (by a hash of the project folder and of each session id) to know when a dream is due. An applied dream (only
when you apply it) writes lessons into the learning file (scrubbed as above), and hints, a report and a short note of
lessons for agents into `.godot/godotwright/dreams/` (untracked by git; when git would track `.godot/`, into
Godotwright's state folder instead). It never writes into a file of your repository and adds nothing to the shared
report; `godotwright undo` takes it back. The session-start hook may apply dreams by itself only when
`godotwright.json` says `"dream": {"auto": "apply"}` and you allowed it once on this machine
(`godotwright dream --auto-apply yes`).

## The rules

- **Never game code.** No code, file contents, paths, or project, file or node names in lessons, hints, reports or
  anything else Godotwright keeps or sends. Text is scrubbed, and what still looks like code or a name is dropped.
- **Private data only on this machine, and only with your permission.** Session transcripts are read only when you ask
  for that run; dreams are applied only when you ask, or after your one-time consent for automatic applies.
- **Never into your repository, never online.** Learned data stays in untracked or private folders on this machine.
- **Learning across machines only anonymously,** through the opt-in sharing below, which is unchanged.

The learning file is built not to hold code, paths or project names. A method of your own on
a Godot class can still look like a Godot name, so keep the file local.
Turn learning off with `godotwright learn off` or `GODOTWRIGHT_LEARN=0`. Delete
the file with `godotwright learn reset`; a reset keeps learning off if it was off.

## Sharing (off until you say yes)

`godotwright learn share on` sends anonymous counts at most once a day.
`godotwright learn preview` prints the exact report that would go out next.

A report holds only:

- Godotwright and Godot versions, and the OS family (linux, macos, windows);
- a random install id that is replaced every 30 days, so the collector can
  count distinct installs; it is not tied to you or your project;
- counts per review rule (built-in rule ids only);
- mistyped Godot API names: a `Class.member` a few letters from a real Godot
  member, sent only with the real name it was looked up as next, and only when
  it is a typo of that name. Bare names and your own names are never sent;
- Godot error templates, after a second pass that replaces every word that is
  not a Godot class name or engine wording with `<id>`. A template that still
  holds a path is never sent;
- for lessons that ship with Godotwright only: the lesson id with how often it was shown, helped and was marked
  wrong. The text of a lesson is never sent, and lessons you kept yourself are never sent at all; to propose one for
  everyone, `godotwright lessons export` prints them for you to review and send yourself.

Each report holds only what is new since the last one. Nothing is sent when
sharing is off, when `GODOTWRIGHT_LEARN=0` or `DO_NOT_TRACK` is set, or when no
collector is configured. Reports go over https only, or over http to a collector
on this machine (localhost, 127.0.0.1 or [::1]; for tests and local collectors). A
failed send is retried a day later; it never slows a command down by more than a
few seconds.

Turn it off at any time with `godotwright learn share off`; that also forgets
the install id.

The collector does not store IP addresses or request headers. It keeps each
report as it was received, with its install id, until its operator deletes it.
It publishes only results that at least 3 installs reported.
