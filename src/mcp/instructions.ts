import { GODOT_TARGET } from "../version.js";

/**
 * The server instructions per profile, filtered by the tools that are enabled, so an agent is never told to call
 * a tool that is not there. A line is split into parts by "|": a part that names a tool that is not enabled is
 * left out, and a line whose first part is left out is dropped. Lines that start with "#." are numbered steps.
 */
const CHEAP: string[] = [
  `Godotwright gives you checked Godot ${GODOT_TARGET} knowledge for this project. Follow these steps:`,
  "#. In a project you do not know yet, or when something is broken and you do not know where to start, call godot_doctor: what is wrong, in which order to fix it, and why.",
  "#. Call godot_scan once to learn the scenes, scripts, signals and input actions.",
  "#. Before you use an engine class, method, property or signal you are not sure about, call godot_api. Never guess API names; Godot 3 names do not work in Godot 4.",
  "#. Before you save new GDScript, pass it to godot_review (code + file) and fix every error.",
  "#. After every edit, call godot_review with the changed files. Fix all errors before the next step.",
  "#. If Godot is installed, call godot_check before you finish.| When godot_play with expect proved a fix, keep it: godot_scenario op save with the same arguments.",
  "Before you rename, move or delete a function, signal, node or file, call godot_usages to see everything that uses it|; for a file also godot_deps op why (it follows paths the code builds too)|.",
  "If the review reports Godot 3 code, call godot_migrate (report first, then write: true) instead of fixing the renames by hand.",
  "After you write or change a shader (.gdshader, or a Shader in a scene), call godot_shader and fix every error.",
  "For findings godot_fix can do (freed checks, get_meta defaults, lone ternaries, garbled text, emit_signal, MultiMesh and Timer order, uids, unused resources, Godot 4.7 packed-array writes and upgrade defaults), call godot_fix (report, then write: true) instead of editing them by hand.",
  "#. If you verified that a review finding is a false alarm, pass its line to godot_feedback with verdict wrong.",
  "#. When Godot shows an error you do not understand, call godot_lessons with the message as `error`: lessons from real projects say what it usually means.| When you fixed something that took more than one try, keep the lesson with godot_lesson_add (general words, no names or code).",
  "If a Godotwright write made things worse, call godot_undo: it puts back the files of the last write (steps for more).",
  "To change a .tres or an asset's import settings (loop, compression, per-animation or per-mesh options), call godot_resource_edit (dry run, then write: true) instead of editing the file by hand.",
  "Keep each change small. Use static types (var x: int, func f() -> void).",
  'To make or check a 3D model (.glb):| godot_model_brief gives one page with everything to start (use it first if you are a small model).| godot_model_identify says what the thing is: its parts, size, pivots and what to anticipate.| godot_model_spec shows the spec format.| godot_model_build builds it (put "archetype" in the spec).| godot_model_view shows it as text (front, side, top views and what does not touch) so you can check the shape.| godot_model_lint with archetype checks it. Fix every error.| Models face +Z, +Y is up, units are metres.'
];

const PREMIUM: string[] = [
  `Godotwright gives you checked Godot ${GODOT_TARGET} knowledge for this project.`,
  "- godot_scan maps the project (scenes and node trees, scripts with signatures, autoloads, input map, key settings).",
  "- godot_api and godot_api_search answer from the official Godot 4.7 class reference, offline. Use them instead of memory for exact signatures, and to translate Godot 3 names.",
  "- godot_review is a static AAA review with scores (api, performance, quality, structure). It needs no Godot. Pass code + file to review code before you write it, or files to focus on what you changed.",
  "- godot_check runs Godot headless (import, load every script and scene, optionally run the main scene) and reports errors as file:line.",
  "- godot_doctor answers \"what is wrong here, and in which order do I fix it\": the review and Godot grouped by cause, most urgent first, each with the lesson that explains it| and whether godot_fix or godot_migrate can do it|, then numbered next steps. Start here in a project you do not know or when something is broken.",
  "- godot_fix applies the mechanical fixes for review findings (each labelled safe or check), shows them first, writes with write: true and reviews the changed files again.",
  "- godot_checklist lists every AAA rule with its fix.",
  "- godot_usages finds every place a name or res:// path is used (code, scenes, connections, groups, settings). Call it before you rename, move or delete anything.",
  "- godot_rename renames a name or moves a res:// file everywhere at once (dry run first, then write: true), keeping scene connections, node paths and .uid files right. Use it instead of editing references by hand.",
  "- godot_project_edit changes project.godot (settings, input actions, autoloads) with checks, touching only that entry. Use it instead of editing project.godot by hand.",
  "- godot_screenshot renders a scene, or a .glb model from several sides, to a PNG and says how much is drawn and whether it is blank. Use it to look at what you built. With `baseline` it compares with the stored picture of that name (pixels changed, boxes, moves) so you can prove a visual change, or that nothing else changed.",
  "- godot_session starts a game that stays up between calls (headless, paused at frame 0)|; godot_game then shows the live tree, reads and sets values, calls methods, evaluates expressions and steps frames with frame-exact input until a condition holds, and reloads the scripts you edited with every node's values kept, with new runtime errors after every answer. Use it when a world takes long to load or a state is hard to reach; stop it when done.",
  "- godot_deps follows what loads what from where the game starts: unused files with their size, why a file is used (before deleting or moving it), what a scene loads with it, and scene loops Godot cannot load.",
  "- godot_undo undoes the last Godotwright writes (scene and project edits, renames, migrations, fixes, model builds), newest first; a file changed by hand since is left alone. Use it when a write made things worse.",
  "- godot_export compares the export presets with what the game loads: excluded files that are preloaded, plain data files missing from include_filter, and paths built under excluded folders. Run it before an export; with `pck` it reads an exported pack instead.",
  "- godot_export_run exports for real, headless: a pack, release or debug build, or a patch with only what changed against base packs or the base game's file list. It checks the file, compares the pack with what the game loads, and runs the exported game for some frames with errors and call chains. Run it before you call a build done.",
  "- godot_perf measures a scene's frame times headless (p50/p95/p99 against a budget, the slowest frames and their cause, the change since the last run). Measure before and after every performance change.",
  "- godot_leaks loads, runs and frees a scene in cycles headless and reports what grows per cycle (orphan nodes by class, script and scene with where they were made and removed, nodes left behind, objects that are not nodes). Use it when memory or the orphan count grows, and again after the fix to prove 0 per cycle.",
  "- godot_play runs a scene with an input timeline (press jump on frame 10, hold right for 20 frames) and returns the values you watch per frame. Use it to see the game do something without a screen.",
  "- godot_test runs the project's GUT or GdUnit4 tests headless and returns only what failed, with file:line.",
  "- godot_scenario keeps a passing godot_play run (same arguments, op save) as a regression test in the project that ci runs, and runs the kept ones (op run). Save one after every fix you proved with expect.",
  "- godot_scene_edit changes a .tscn (add or remove nodes, set properties, connect signals, attach scripts) with checks against Godot 4.7, touching only those lines. Use it instead of editing .tscn files by hand.",
  "- godot_shader checks shaders statically against Godot 4.7's shader tables and compiles them with Godot headless, with file:line for both.",
  "- godot_resource_edit changes .tres resources (properties, sub_resources, uids kept) and import settings (audio loop, texture compression, glTF per-animation loop, per-mesh shadows, external materials, importer switch), then reimports headless and checks Godot kept the value. Use it instead of editing .tres or .import files by hand.",
  "- godot_migrate rewrites Godot 3 GDScript and shaders to Godot 4 where that is mechanical (report first, then write: true) and lists what still needs a hand. Use it before fixing Godot 3 findings one by one.",
  "- godot_feedback marks a review finding as wrong (a verified false alarm) or right, or says whether a lesson helped; Godotwright learns from it on this machine.",
  "- godot_lessons answers from lessons learned in real Godot projects (symptom, cause, fix, how to test): by words, by a Godot error message, by a rule, or `gaps: true` for the errors Godotwright cannot predict yet. Use it when Godot shows an error you do not understand and before you build moving platforms, vehicles, large worlds, runtime-loaded models or shaders.",
  "- godot_lesson_add keeps a lesson you learned here (title, symptom, cause, fix, the Godot message), scrubbed of names, paths and code, on this machine only.| The next godot_check or godot_lessons shows it when the same problem comes back.| Add one whenever a fix took more than one try.",
  "- godot_model_brief is one page before you build: what the thing is, the nearest ready-made kind, parts, size, rules, mistakes, the order of tools and a spec cheat sheet. Start here.",
  "- godot_model_identify says what a thing is (English or Dutch, typos and descriptions work): the family, the parts that must exist and how they move, a typical size with its source, variants, Godot conventions (models face +Z, +Y is up, units are metres), what to anticipate and the usual mistakes. Call it before you build or check any 3D model.",
  "- godot_model_spec explains the model spec (a JSON tree of named parts: box, cylinder, ellipsoid, lathe, loft, extrude, roof, tube, with expressions, mirror, repeat, bevels and textured materials) and lists the ready-made kinds.",
  "- godot_model_build makes a clean .glb from a kind or a spec (UVs, tangents, a node per part, deterministic) and lints it.",
  "- godot_model_view draws a .glb as text: front, side and top views made of letters (one letter per part), a table of the parts with sizes, and the parts that do not touch the rest (a ladder away from its tree, a wheel without an axle). You cannot see a picture, so use it after every build to check shape, proportions and that everything is attached.",
  "- godot_model_lint scores a .glb (geometry, materials, performance, rig), and with `archetype` also checks it is what it should be: parts, pivots, wheel axes, size, direction.| godot_model_inspect shows what is in a .glb.",
  "Work in reviewed steps: plan, look up the API, write, review, then check with Godot before you finish. For models: identify, spec, build, view, lint with the archetype, fix, repeat.| When a fix was hard, keep the lesson (godot_lesson_add) so the next session starts smarter."
];

const TOOL = /\bgodot_[a-z_]+/g;

/** Renders the instructions for the enabled tools; `readOnly` adds what that mode means. */
export function renderInstructions(tier: "cheap" | "premium", enabled: ReadonlySet<string>, readOnly = false): string {
  const out: string[] = [];
  let step = 0;
  for (const line of tier === "cheap" ? CHEAP : PREMIUM) {
    const parts = line.split("|");
    const kept = parts.map((part) => [...part.matchAll(TOOL)].every((m) => enabled.has(m[0])));
    if (!kept[0]) continue;
    let text = parts.filter((_, i) => kept[i]).join("");
    if (text.startsWith("#. ")) text = `${++step}. ${text.slice(3)}`;
    out.push(text);
    if (out.length === 1 && readOnly)
  out.push("This session is read-only: tools that change project files only show their dry run, and write options are refused.");
  }
  return out.join("\n");
}
