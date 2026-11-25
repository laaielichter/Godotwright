import { Command } from "commander";
import { ProtectedPathError } from "../project/protect.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { ScaffoldError } from "../scaffold/error.js";
import { EXPORT_PLATFORMS, exportPreset, formatExportPreset, type PresetArgs, type PresetValue } from "../scaffold/presets.js";
import { formatNewProject, newProject, type ProjectKind, type RenderingMethod } from "../scaffold/project.js";
import { CSHARP_TEMPLATES, SCRIPT_TEMPLATES, SHADER_KINDS, formatNewScript, formatNewShader, newScript, newShader, type ScriptTemplate, type ShaderKind } from "../scaffold/script.js";
import { formatTranslations, translations } from "../scaffold/translations.js";
import { SettingsError } from "../settings/edit.js";
import { collect, writeOut } from "./output.js";

/** Runs one scaffold call and prints its result, or the reason it was refused. */
function run<T>(command: Command, json: boolean | undefined, make: () => T, format: (result: T) => string): void {
  try {
    const result = make();
    writeOut(command, json ? `${JSON.stringify(result, null, 2)}\n` : format(result));
  } catch (error) {
    if (!(error instanceof ScaffoldError) && !(error instanceof SettingsError) && !(error instanceof ProjectNotFoundError) && !(error instanceof ProtectedPathError)) throw error;
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}

/** `key=value` pairs from repeated options; the value keeps every `=` after the first. */
function pairs(items: string[], option: string): Record<string, PresetValue> {
  const out: Record<string, PresetValue> = {};
  for (const item of items) {
    const at = item.indexOf("=");
    if (at <= 0) throw new ScaffoldError(`${option} takes key=value; got "${item}"`);
    out[item.slice(0, at).trim()] = item.slice(at + 1);
  }
  return out;
}

export function newCommand(): Command {
  const cmd = new Command("new").description("make new files without Godot: a project, a script from a typed template, or a shader");

  cmd.addCommand(
    new Command("project")
      .description("a new Godot 4.7 project in an empty or missing folder: project.godot, main.tscn with main.gd, icon.svg, .gitignore and .gitattributes")
      .argument("<dir>", "the folder to make the project in")
      .option("--name <name>", "the project name (default: the folder's name)")
      .option("--kind <kind>", "the main scene's root: 2d (Node2D), 3d (Node3D) or ui (Control)", "2d")
      .option("--renderer <method>", "forward_plus, mobile or gl_compatibility", "forward_plus")
      .option("--merge-driver", "add the merge=godotwright lines to .gitattributes")
      .option("--mcp", "add a .mcp.json that starts the Godotwright MCP server")
      .option("--dotnet", "a C# project: also write <Name>.csproj and <Name>.sln, and set the assembly name")
      .option("--force", "use a folder that is not empty; files that are there are never overwritten")
      .option("--json", "print the result as JSON")
      .action((dir: string, o: { name?: string; kind: string; renderer: string; mergeDriver?: boolean; mcp?: boolean; dotnet?: boolean; force?: boolean; json?: boolean }, command: Command) =>
        run(command, o.json, () => newProject(dir, { name: o.name, kind: o.kind as ProjectKind, renderer: o.renderer as RenderingMethod, mergeDriver: o.mergeDriver, mcp: o.mcp, dotnet: o.dotnet, force: o.force }), formatNewProject),
      ),
  );

  cmd.addCommand(
    new Command("script")
      .description(`a new GDScript from a template (${SCRIPT_TEMPLATES.join(", ")}): typed, and clean in godotwright review (the input actions a template reads are added to project.godot when missing). A file that ends in .cs gets the C# form (${CSHARP_TEMPLATES.join(", ")}): a partial class named after the file`)
      .argument("<file>", "res:// path of the new script, e.g. res://player/player.gd or res://player/Player.cs")
      .argument("[path]", "project directory (or any path inside it)", ".")
      .option("--template <name>", "the template", "node")
      .option("--class-name <name>", "give the script a class_name")
      .option("--base <class>", "for the node template: the class to extend (default Node)")
      .option("--dimension <d>", "for area_trigger: 2d or 3d")
      .option("--no-input-actions", "do not add the input actions the template reads to project.godot (they are added by default when missing)")
      .option("--dry-run", "print the script, write nothing")
      .option("--json", "print the result as JSON")
      .action((file: string, path: string, o: { template: string; className?: string; base?: string; dimension?: string; inputActions: boolean; dryRun?: boolean; json?: boolean }, command: Command) =>
        run(command, o.json, () => newScript(path, file, { template: o.template as ScriptTemplate, className: o.className, base: o.base, dimension: o.dimension as "2d" | "3d" | undefined, inputActions: o.inputActions, write: !o.dryRun }), formatNewScript),
      ),
  );

  cmd.addCommand(
    new Command("shader")
      .description(`a new .gdshader with a minimal working body (${SHADER_KINDS.join(", ")})`)
      .argument("<file>", "res:// path of the new shader, e.g. res://fx/tint.gdshader")
      .argument("[path]", "project directory (or any path inside it)", ".")
      .option("--kind <kind>", `the shader type: ${SHADER_KINDS.join(", ")} (default: spatial when the main scene is 3D, else canvas_item)`)
      .option("--dry-run", "print the shader, write nothing")
      .option("--json", "print the result as JSON")
      .action((file: string, path: string, o: { kind?: string; dryRun?: boolean; json?: boolean }, command: Command) =>
        run(command, o.json, () => newShader(path, file, o.kind as ShaderKind | undefined, { write: !o.dryRun }), formatNewShader),
      ),
  );
  return cmd;
}

interface Common {
  write?: boolean;
  json?: boolean;
}
const common = (c: Command): Command => c.option("--write", "apply the change (default: only show what would change)").option("--json", "print the result as JSON");

export function presetCommand(): Command {
  const cmd = new Command("preset").description("export presets in export_presets.cfg: list, add, change and remove them without the editor; nothing is written without --write");
  const preset = (command: Command, path: string, op: "list" | "add" | "set" | "remove", args: () => PresetArgs, o: Common) =>
    run(command, o.json, () => exportPreset(path, op, args(), { write: o.write }), formatExportPreset);

  cmd.addCommand(
    new Command("list")
      .description("the presets with their platform, filters, path and options")
      .argument("[path]", "project directory (or any path inside it)", ".")
      .option("--json", "print the result as JSON")
      .action((path: string, o: Common, command: Command) => preset(command, path, "list", () => ({}), o)),
  );

  cmd.addCommand(
    common(
      new Command("add")
        .description(`add a preset for a platform (${EXPORT_PLATFORMS.join(", ")}); Godot fills in the options you do not give with its defaults`)
        .argument("<platform>", "the platform, e.g. \"Windows Desktop\" or linux")
        .argument("[path]", "project directory (or any path inside it)", ".")
        .option("--name <name>", "the preset's name (default: the platform)")
        .option("--export-path <file>", "where the export goes, e.g. build/game.exe")
        .option("--runnable", "mark it as the platform's runnable preset")
        .option("--no-runnable", "do not mark it runnable")
        .option("--export-filter <mode>", "all_resources, scenes, resources, exclude or customized")
        .option("--include <filter>", "include_filter, e.g. \"*.json,data/*\"")
        .option("--exclude <filter>", "exclude_filter, e.g. \"tests/*\"")
        .option("--option <key=value>", "a platform option, e.g. binary_format/embed_pck=true (repeatable)", collect, []),
    ).action((platform: string, path: string, o: Common & { name?: string; exportPath?: string; runnable?: boolean; exportFilter?: string; include?: string; exclude?: string; option: string[] }, command: Command) =>
      preset(
        command,
        path,
        "add",
        () => ({ platform, name: o.name, export_path: o.exportPath, runnable: o.runnable, export_filter: o.exportFilter, include_filter: o.include, exclude_filter: o.exclude, options: pairs(o.option, "--option") }),
        o,
      ),
    ),
  );

  cmd.addCommand(
    common(
      new Command("set")
        .description("change keys of a preset (--set export_path=build/game.exe) or its options (--option key=value)")
        .argument("<preset>", "the preset's name or number")
        .argument("[path]", "project directory (or any path inside it)", ".")
        .option("--set <key=value>", "a key of the preset: name, export_path, runnable, export_filter, include_filter, exclude_filter (repeatable)", collect, [])
        .option("--option <key=value>", "a platform option (repeatable)", collect, [])
        .option("--unset <key>", "remove a key; options/<key> for an option (repeatable)", collect, []),
    ).action((name: string, path: string, o: Common & { set: string[]; option: string[]; unset: string[] }, command: Command) =>
      preset(command, path, "set", () => ({ preset: name, set: pairs(o.set, "--set"), options: pairs(o.option, "--option"), unset: o.unset }), o),
    ),
  );

  cmd.addCommand(
    common(
      new Command("remove")
        .description("remove a preset; the presets after it move down one number, as Godot needs them without gaps")
        .argument("<preset>", "the preset's name or number")
        .argument("[path]", "project directory (or any path inside it)", "."),
    ).action((name: string, path: string, o: Common, command: Command) => preset(command, path, "remove", () => ({ preset: name }), o)),
  );
  return cmd;
}

export function translationsCommand(): Command {
  const cmd = new Command("translations").description("translation files: which are registered, add or remove one, and check a CSV against the keys the code and scenes use");
  const tr = (command: Command, path: string, op: "list" | "add" | "remove" | "check", file: string | undefined, o: Common) =>
    run(command, o.json, () => translations(path, op, file === undefined ? {} : { file }, { write: o.write }), formatTranslations);

  cmd.addCommand(
    new Command("list")
      .description("files in internationalization/locale/translations, and CSV and PO files in the project that are not")
      .argument("[path]", "project directory (or any path inside it)", ".")
      .option("--json", "print the result as JSON")
      .action((path: string, o: Common, command: Command) => tr(command, path, "list", undefined, o)),
  );
  cmd.addCommand(
    common(
      new Command("add")
        .description("register a translation file: a CSV adds one .translation per locale, a .po or .translation itself")
        .argument("<file>", "res:// path of the .csv, .po or .translation")
        .argument("[path]", "project directory (or any path inside it)", "."),
    ).action((file: string, path: string, o: Common, command: Command) => tr(command, path, "add", file, o)),
  );
  cmd.addCommand(
    common(
      new Command("remove")
        .description("take a translation file out of the setting (the file itself stays)")
        .argument("<file>", "res:// path of the .csv, .po or .translation")
        .argument("[path]", "project directory (or any path inside it)", "."),
    ).action((file: string, path: string, o: Common, command: Command) => tr(command, path, "remove", file, o)),
  );
  cmd.addCommand(
    new Command("check")
      .description("a CSV against the project: keys used by tr() or scenes that it lacks, keys nothing uses, and empty cells per locale")
      .argument("<file>", "res:// path of the CSV")
      .argument("[path]", "project directory (or any path inside it)", ".")
      .option("--json", "print the result as JSON")
      .action((file: string, path: string, o: Common, command: Command) => {
        tr(command, path, "check", file, o);
      }),
  );
  return cmd;
}
