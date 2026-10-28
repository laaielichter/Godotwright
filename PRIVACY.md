# Privacy

Godotwright learns from use to make its reviews and lookups better.
This page says exactly what it keeps and what it can send.

## On your machine (always, unless you turn it off)

The learning file (`godotwright learn` shows where it is) holds:

- per review rule: how often it fired, and how often real Godot confirmed or
  contradicted it, or someone marked it as wrong;
- API lookups that found nothing, and what was looked up right after;
- Godot error messages as templates, with names, paths and numbers replaced
  (`Identifier "<s>" not declared in the current scope.`);
- hashes of findings marked as wrong (so they stay hidden), local only.

It never holds code or project names. Turn it off with `godotwright learn off`
or `GODOTWRIGHT_LEARN=0`; delete it with `godotwright learn reset`.

## Sharing (off until you say yes)

`godotwright learn share on` sends anonymous counts at most once a day.
`godotwright learn preview` prints the exact report that would go out next.

A report holds only:

- Godotwright and Godot versions, and the OS family (linux, macos, windows);
- a random install id that is replaced every 30 days, so the collector can
  count distinct installs; it is not tied to you or your project;
- counts per review rule (built-in rule ids only);
- mistyped Godot API names (only names a few letters away from a real Godot
  class or member, so your own class and function names are left out) and the
  real Godot name that was looked up next;
- Godot error templates, after a second pass that replaces any word that looks
  like an identifier with `<id>` (Godot class names stay).

Each report holds only what is new since the last one. Nothing is sent when
sharing is off, when `GODOTWRIGHT_LEARN=0` or `DO_NOT_TRACK` is set, or when no
collector is configured. Reports go over https only. A failed send is retried a
day later; it never slows a command down by more than a few seconds.

Turn it off at any time with `godotwright learn share off`; that also forgets
the install id. The collector does not store IP addresses and keeps only
results that at least 3 installs reported.
