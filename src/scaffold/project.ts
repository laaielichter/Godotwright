import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { assertWritable } from "../project/protect.js";
import { generateUid, isUidText } from "../scene/uid.js";
import { GODOT_TARGET } from "../version.js";
import { ScaffoldError } from "./error.js";

/**
 * A new Godot 4.7 project as files: project.godot in the shape the project manager writes, a main scene with a typed
 * root and its script, an icon, and the git files. Nothing here needs Godot; Godot fills in `.godot/` and the
 * `.import` and `.uid` files it wants on its first import.
 */

export type ProjectKind = "2d" | "3d" | "ui";
export type RenderingMethod = "forward_plus" | "mobile" | "gl_compatibility";

export interface NewProjectOptions {
  /** application/config/name; default the folder's name. */
  name?: string;
  /** The root of the main scene: 2d is a Node2D, 3d a Node3D, ui a full-rect Control. Default 2d. */
  kind?: ProjectKind;
  /** Default forward_plus. */
  renderer?: RenderingMethod;
  /** Also write the three `merge=godotwright` lines to .gitattributes (see `godotwright merge --install`). */
  mergeDriver?: boolean;
  /** Also write a .mcp.json that starts the Godotwright MCP server. */
  mcp?: boolean;
  /**
   * A C# (.NET) project: also writes `<Name>.csproj` and `<Name>.sln` in the shape Godot generates, adds the "C#"
   * feature and sets `[dotnet] project/assembly_name`. It needs the .NET build of Godot and the .NET SDK.
   */
  dotnet?: boolean;
  /** Use a folder that already holds files. A file that is there is never overwritten; it is listed as skipped. */
  force?: boolean;
}

export interface NewProjectResult {
  /** The project folder, absolute. */
  project: string;
  name: string;
  kind: ProjectKind;
  renderer: RenderingMethod;
  mainScene: string;
  /** Files written, relative to the project. */
  created: string[];
  /** Files that were there already and were left as they were. */
  skipped: string[];
  notes: string[];
}

export const PROJECT_KINDS: Record<ProjectKind, string> = { "2d": "Node2D", "3d": "Node3D", ui: "Control" };

/** The feature name Godot's project manager writes in application/config/features for each rendering method. */
export const RENDERER_FEATURES: Record<RenderingMethod, string> = { forward_plus: "Forward Plus", mobile: "Mobile", gl_compatibility: "GL Compatibility" };

const HEADER = [
  "; Engine configuration file.",
  "; It's best edited using the editor UI and not directly,",
  "; since the parameters that go here are not all obvious.",
  ";",
  "; Format:",
  ";   [section] ; section goes between []",
  ";   param=value ; assign values to parameters",
];

/** A neutral placeholder icon (a rounded tile with a play mark); the project's own art replaces it. */
export const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect x="4" y="4" width="120" height="120" rx="22" fill="#2f3b52"/><path d="M50 38v52l42-26z" fill="#f2c14e"/><circle cx="34" cy="94" r="7" fill="#7bd389"/></svg>\n';

const GITIGNORE = [
  "# Godot 4+ specific ignores",
  ".godot/",
  "/android/",
  "",
  "# Translations Godot makes from CSV files on import",
  "*.translation",
  "",
  "# Export artefacts",
  "/build/",
  "/export/",
  "*.pck",
  "*.exe",
  "*.x86_64",
  "*.arm64",
  "*.apk",
  "*.aab",
  "*.ipa",
  "*.dmg",
  "",
];

const MERGE_ATTRIBUTES = ["*.tscn merge=godotwright", "*.tres merge=godotwright", "project.godot merge=godotwright"];

/** The text of project.godot for a new project. `mainScene` is a uid:// or res:// path. */
export function projectGodotText(name: string, renderer: RenderingMethod, mainScene: string, assemblyName?: string): string {
  const out = [
    ...HEADER,
    "",
    "config_version=5",
    "",
    "[application]",
    "",
    `config/name=${JSON.stringify(name)}`,
    `run/main_scene=${JSON.stringify(mainScene)}`,
    // The .NET editor adds the "C#" feature after the version.
    `config/features=PackedStringArray(${[GODOT_TARGET, ...(assemblyName ? ["C#"] : []), RENDERER_FEATURES[renderer]].map((f) => JSON.stringify(f)).join(", ")})`,
    'config/icon="res://icon.svg"',
  ];
  // Forward+ is Godot's default, so the project manager writes no [rendering] section for it. For Compatibility it
  // also sets the override for mobile devices, whose default would otherwise be the Mobile renderer.
  // Sections in the order Godot saves them: [dotnet] before [rendering].
  if (assemblyName) out.push("", "[dotnet]", "", `project/assembly_name=${JSON.stringify(assemblyName)}`);
  if (renderer !== "forward_plus") {
    out.push("", "[rendering]", "", `renderer/rendering_method=${JSON.stringify(renderer)}`);
    if (renderer === "gl_compatibility") out.push('renderer/rendering_method.mobile="gl_compatibility"');
  }
  return `${out.join("\n")}\n`;
}

/** The Godot engine version whose Godot.NET.Sdk a new C# project names (Godot writes its own full version). */
export const GODOT_ENGINE_VERSION = "4.7.2";
/** The .NET SDK the C# project file names: Godot's own NuGet SDK at the targeted Godot version. */
export const GODOT_NET_SDK = `Godot.NET.Sdk/${GODOT_ENGINE_VERSION}`;
/** The target framework Godot 4.7 writes for a new C# project. */
export const DOTNET_TARGET_FRAMEWORK = "net8.0";
/** The target framework Godot 4.7 writes for Android builds (the export template's jar libraries need .NET 9). */
export const DOTNET_ANDROID_TARGET_FRAMEWORK = "net9.0";

const CS_KEYWORDS = new Set(
  "as do if in is for int new out ref try base bool byte case char else enum goto lock long null this true uint void break catch class const event false fixed float sbyte short throw ulong using where while yield double extern object params public return sealed sizeof static string struct switch typeof unsafe ushort checked decimal default finally foreach partial private virtual abstract continue delegate explicit implicit internal operator override readonly volatile interface namespace protected unchecked stackalloc".split(" "),
);

/** One part of a namespace, as GodotTools.ProjectEditor/IdentifierUtils.cs SanitizeIdentifier does it (allowEmpty). */
function sanitizeIdentifier(identifier: string): string {
  if (identifier === "") return "Empty";
  const source = identifier.slice(0, 511);
  let out = "";
  let start = 0;
  if (source[0] === "@") {
    out = "@";
    start = 1;
  }
  // C# walks UTF-16 code units; so does this (a lone surrogate is no letter, and is skipped as Godot skips it).
  for (let i = start; i < source.length; i++) {
    const ch = source[i]!;
    if (/[\p{Lu}\p{Ll}\p{Lt}\p{Lm}\p{Lo}\p{Nl}]/u.test(ch)) out += ch;
    // Marks, connectors and digits only after the first character; an underscore may start an identifier.
    else if (/[\p{Mn}\p{Mc}\p{Pc}\p{Nd}]/u.test(ch) && (out.length > start || ch === "_")) out += ch;
  }
  if (out.length === start) out += "Empty";
  const isKeyword = (v: string) => (v.length > 2 && v[0] === "_" && v[1] === "_" && v[2] !== "_") || CS_KEYWORDS.has(v);
  return out[0] !== "@" && isKeyword(out) ? `@${out}` : out;
}

/**
 * A C# namespace from a project name, exactly as Godot's IdentifierUtils.SanitizeQualifiedIdentifier does it: each
 * dot-separated part keeps its letters (and digits, marks and `_` after the first character), an empty part becomes
 * `Empty`, and a keyword gets `@` in front. "Space Game" becomes `SpaceGame`, "3D Demo: C#" `DDemoC`.
 */
export function sanitizeNamespace(name: string): string {
  return name.split(".").map(sanitizeIdentifier).join(".");
}

/**
 * The .csproj of a new Godot C# project, byte for byte what Godot 4.7.2's editor writes
 * (GodotTools.ProjectEditor ProjectGenerator.GenAndSaveGameProject, run from the 4.7.2 .NET build to compare): the
 * Godot.NET.Sdk at Godot's own version, net8.0 with net9.0 for Android, EnableDynamicLoading, and a RootNamespace only
 * when the project name is not a valid namespace. Godot saves it without a BOM and without a final newline.
 */
export function csprojText(name: string): string {
  const namespace = sanitizeNamespace(name);
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return [
    `<Project Sdk="${GODOT_NET_SDK}">`,
    "  <PropertyGroup>",
    `    <TargetFramework>${DOTNET_TARGET_FRAMEWORK}</TargetFramework>`,
    `    <TargetFramework Condition=" '$(GodotTargetPlatform)' == 'android' ">${DOTNET_ANDROID_TARGET_FRAMEWORK}</TargetFramework>`,
    "    <EnableDynamicLoading>true</EnableDynamicLoading>",
    ...(namespace !== name ? [`    <RootNamespace>${escape(namespace)}</RootNamespace>`] : []),
    "  </PropertyGroup>",
    "</Project>",
  ].join("\n");
}

/**
 * The .sln of a new Godot C# project, from the template in
 * modules/mono/editor/GodotTools/GodotTools.ProjectEditor/DotNetSolution.cs (godotengine/godot): one C# project with
 * the Debug, ExportDebug and ExportRelease configurations. Godot saves it as UTF-8 with a BOM; so does this.
 */
export function slnText(name: string, csproj: string, guid: string): string {
  const configs = ["Debug", "ExportDebug", "ExportRelease"];
  return [
    "\uFEFFMicrosoft Visual Studio Solution File, Format Version 12.00",
    "# Visual Studio 2012",
    `Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "${name}", "${csproj.replace(/\//g, "\\")}", "{${guid}}"`,
    "EndProject",
    "Global",
    "\tGlobalSection(SolutionConfigurationPlatforms) = preSolution",
    ...configs.map((c) => `\t${c}|Any CPU = ${c}|Any CPU`),
    "\tEndGlobalSection",
    "\tGlobalSection(ProjectConfigurationPlatforms) = postSolution",
    ...configs.flatMap((c) => [`\t\t{${guid}}.${c}|Any CPU.ActiveCfg = ${c}|Any CPU`, `\t\t{${guid}}.${c}|Any CPU.Build.0 = ${c}|Any CPU`]),
    "\tEndGlobalSection",
    "EndGlobal",
    "",
  ].join("\n");
}

function mainSceneText(kind: ProjectKind, sceneUid: string, scriptUid: string): string {
  const out = [
    `[gd_scene load_steps=2 format=3 uid="${sceneUid}"]`,
    "",
    `[ext_resource type="Script" uid="${scriptUid}" path="res://main.gd" id="1_main"]`,
    "",
    `[node name="Main" type="${PROJECT_KINDS[kind]}"]`,
  ];
  // A UI root fills the window: the values the editor writes for the Full Rect preset.
  if (kind === "ui") out.push("layout_mode = 3", "anchors_preset = 15", "anchor_right = 1.0", "anchor_bottom = 1.0", "grow_horizontal = 2", "grow_vertical = 2");
  out.push('script = ExtResource("1_main")');
  return `${out.join("\n")}\n`;
}

export function newProject(dir: string, options: NewProjectOptions = {}): NewProjectResult {
  const root = resolve(dir);
  const kind = options.kind ?? "2d";
  const renderer = options.renderer ?? "forward_plus";
  if (!(kind in PROJECT_KINDS)) throw new ScaffoldError(`"${kind}" is not a project kind; use 2d, 3d or ui`);
  if (!(renderer in RENDERER_FEATURES)) throw new ScaffoldError(`"${renderer}" is not a rendering method; use forward_plus, mobile or gl_compatibility`);
  const name = (options.name ?? basename(root)).trim();
  if (!name) throw new ScaffoldError("the project needs a name");
  if (/[\r\n]/.test(name)) throw new ScaffoldError("the project name must be one line");

  if (existsSync(root)) {
    if (!statSync(root).isDirectory()) throw new ScaffoldError(`${root} is a file, not a folder`);
    if (existsSync(join(root, "project.godot"))) throw new ScaffoldError(`${root} already has a project.godot; a new project is never written over an existing one`);
    const there = readdirSync(root);
    if (there.length && !options.force) {
      throw new ScaffoldError(`${root} is not empty (${there.slice(0, 4).join(", ")}${there.length > 4 ? ", ..." : ""}); use an empty folder, or force to add the project files next to what is there (existing files are never overwritten)`);
    }
  }

  const sceneUid = generateUid();
  // With force, a main.gd.uid that is already there keeps its uid, and the new scene names it.
  const uidFile = join(root, "main.gd.uid");
  const kept = existsSync(uidFile) ? readFileSync(uidFile, "utf8").trim() : "";
  const scriptUid = isUidText(kept) ? kept : generateUid(new Set([sceneUid]));
  const files: [string, string][] = [
    // With main.tscn already there (force), the scene keeps its own uid, so the setting names it by path.
    ["project.godot", projectGodotText(name, renderer, existsSync(join(root, "main.tscn")) ? "res://main.tscn" : sceneUid, options.dotnet ? name : undefined)],
    ["main.tscn", mainSceneText(kind, sceneUid, scriptUid)],
    ["main.gd", `extends ${PROJECT_KINDS[kind]}\n\n\nfunc _ready() -> void:\n\tpass\n`],
    ["main.gd.uid", `${scriptUid}\n`],
    ["icon.svg", ICON_SVG],
    [".gitignore", GITIGNORE.join("\n")],
    [
      ".gitattributes",
      ["# Normalize EOL for all files that Git considers text files.", "* text=auto eol=lf", ...(options.mergeDriver ? ["", "# Scenes, resources and project.godot merged by meaning (godotwright merge --install sets up the driver in each clone).", ...MERGE_ATTRIBUTES] : []), ""].join("\n"),
    ],
  ];
  if (options.mcp) files.push([".mcp.json", `${JSON.stringify({ mcpServers: { godotwright: { command: "npx", args: ["-y", "godotwright", "mcp", "--tier", "premium"] } } }, null, 2)}\n`]);

  if (options.dotnet) {
    // The assembly has the project's name, and the two files are named after it (Godot does the same).
    if (/[<>:"/\\|?*\x00-\x1f]/.test(name)) throw new ScaffoldError(`a C# project names its .csproj and .sln after the project, and "${name}" has characters a file name cannot hold; give a name without < > : " / \\ | ? *`);
    files.push([`${name}.csproj`, csprojText(name)], [`${name}.sln`, slnText(name, `${name}.csproj`, randomUUID().toUpperCase())]);
  }

  for (const [rel] of files) assertWritable(join(root, rel));
  mkdirSync(root, { recursive: true });
  const created: string[] = [];
  const skipped: string[] = [];
  for (const [rel, text] of files) {
    const full = join(root, rel);
    // "wx" fails on a file that is there, so nothing is ever overwritten, also not one that appeared just now.
    try {
      writeFileSync(full, text, { flag: "wx" });
      created.push(rel);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      skipped.push(rel);
    }
  }

  const notes: string[] = [];
  if (skipped.some((f) => f.startsWith("main."))) notes.push("a main.* file was already there and was kept: check that main.tscn, main.gd and main.gd.uid still belong together");
  if (options.mergeDriver && created.includes(".gitattributes")) notes.push("the merge driver itself lives in each clone's git config: run `godotwright merge --install` once per clone");
  if (options.mergeDriver && skipped.includes(".gitattributes")) notes.push(".gitattributes was already there: run `godotwright merge --install` to add the merge lines to it");
  if (options.dotnet) notes.push(`C#: open the project with the .NET build of Godot ${GODOT_TARGET} (it needs the .NET SDK 8 or later); main.gd is GDScript, add C# scripts with godot_new op script and a .cs file. The .csproj names ${GODOT_NET_SDK}, as Godot ${GODOT_ENGINE_VERSION} writes it; another Godot version offers to update it`);
  notes.push("Godot makes .godot/, icon.svg.import and missing .uid files on its first import (open the project, or run godot --headless --import)");
  return { project: root, name, kind, renderer, mainScene: "res://main.tscn", created, skipped, notes };
}

export function formatNewProject(r: NewProjectResult): string {
  const out = [`new project "${r.name}" at ${r.project}: Godot ${GODOT_TARGET}, ${RENDERER_FEATURES[r.renderer]}, main scene ${r.mainScene} (${PROJECT_KINDS[r.kind]})`];
  out.push(`created ${r.created.length}: ${r.created.join(", ") || "nothing"}`);
  if (r.skipped.length) out.push(`skipped ${r.skipped.length} (already there, not overwritten): ${r.skipped.join(", ")}`);
  for (const n of r.notes) out.push(`note: ${n}`);
  out.push("Next: godot_review the project; add input actions with godot_project_edit (input_add); new scripts with godotwright new script.");
  return `${out.join("\n")}\n`;
}
