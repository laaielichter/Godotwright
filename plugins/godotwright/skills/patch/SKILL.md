---
name: patch
description: Use when changing a Godot game that is already shipped or installed — a mod or overlay over a game, a patch to a .pck, an installer or update script, a hotfix to live files — or when a Godot project is laid over a base project. Makes the change safe with Godotwright: review against the shipped game, preflight checks, exact anchors, idempotent installs, receipts and byte-identical rollback.
argument-hint: "[what to change, optional]"
---

# Change a shipped Godot game safely

A change to a game people already have must never leave it half-changed. Work on $ARGUMENTS (or what the user named).

1. **Review against the real game.** Put the game's source folder in `godotwright.json` as `base`, and the list of
   files the shipped game holds (a .pck manifest, one path per line or JSON) as `baseFiles`. Then `godot_review` and
   `godot_usages` know every class, scene and path the game has, and do not report what only the shipped game holds.
2. **Work on a copy, never in the original.** Keep the installed game and its source byte-identical; build the change
   as an overlay or a candidate folder next to them.
3. **Patch by anchors that match exactly once.** When a patch inserts code into a file of the game, find the anchor
   text, require exactly one match, and stop with a clear message (changing nothing) when it is missing or appears
   twice. Check that the symbols the patch uses exist. `godot_lessons` with words "patch tools" has the details.
4. **Preflight, then write, then verify.** Before writing: the game's version and file hashes are the ones the patch was
   made for. While writing: a backup of every file it touches, and a restore of all of them on any error, including an
   interrupted run. After writing: a receipt (which files, hashes before and after) and a check with Godot
   (`godot_check` or a headless scenario) on the result.
5. **Make it idempotent and reversible.** Running the installer twice changes nothing the second time. Rollback gives
   the original bytes back; test that with a byte comparison, not by eye.
6. **Give every change a switch** (a setting or a flag) so it can be turned off without a reinstall.
7. **Test on a synthetic copy** of the shipped files when the real ones are out of reach, and say plainly what was not
   tested on the real game.

End with: what changes, the preflight, the install and rollback steps, and what was tested where.
