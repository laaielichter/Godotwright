import type { GodotApi } from "../api/api.js";

/**
 * Makes free text safe to keep as a lesson: no names, paths, links, e-mail addresses, codes, keys or source code.
 * What is left is Godot's own vocabulary and plain words. The same rules hold for the lessons that ship with
 * Godotwright (a test runs every bundled lesson through this and expects it unchanged), so a lesson learned on
 * one machine can be shared later without anything that points back to a person or a project.
 */

export interface Scrubbed {
  text: string;
  /** What was replaced, by kind (name, path, file, url, email, code, number, date). */
  replaced: Record<string, number>;
}

export interface ScrubContext {
  api: GodotApi;
  /** Names of the project (class names, nodes, autoloads, files, its own name): replaced wherever they appear. */
  projectNames?: Iterable<string>;
}

/** Words written with a capital that are not names: tools, platforms, formats and Godot terms. */
const TECH_WORDS = new Set(
  `godot godotwright gdscript gdextension gdshader glsl hlsl vulkan direct3d opengl metal webgl webgpu jolt godotphysics
  forward+ forward mobile compatibility windows linux macos android ios web steam steamdeck blender gltf glb fbx obj collada
  python javascript typescript node.js nodejs npm numpy pillow c# c++ mono dotnet .net git github gitlab ci json xml yaml toml
  csv png jpeg jpg webp exr hdr ktx dds wav ogg mp3 mp4 webm theora mcp claude codex gemini cursor ai npc npcs hud ui ux
  fps vram ram cpu gpu ssd hdd lod lods pbr ao ssao ssil sdfgi voxelgi taa fxaa msaa smaa fsr fsr2 dlss xess hdr srgb
  rgb rgba bc bptc etc2 astc s3tc vrs rid aabb ik fov dpi utc utf8 unicode ascii api apis sdk cli id ids url urls ok
  hz khz mhz ghz mb gb kb tb english dutch latin godotphysics2d godotphysics3d`.split(/\s+/).filter(Boolean),
);

/** GDScript keywords and Godot shader words: the language, not anyone's code. */
const LANGUAGE_WORDS = new Set(
  `class_name extends func var const signal enum static await preload onready export super self null true false match
  pass return breakpoint is_instance_valid shader_type render_mode spatial canvas_item particles sky fog
  depth_draw_always depth_draw_opaque depth_draw_never depth_prepass_alpha depth_test_disabled unshaded cull_disabled
  cull_back cull_front blend_mix blend_add blend_mul blend_premul_alpha ambient_light_disabled shadows_disabled
  world_vertex_coords skip_vertex_transform at_cubemap_pass at_half_res_pass at_quarter_res_pass half_res_color
  quarter_res_color use_half_res_pass use_quarter_res_pass hint_depth_texture hint_screen_texture hint_normal_roughness_texture
  model_matrix view_matrix inv_view_matrix projection_matrix camera_position_world eyedir`.split(/\s+/).filter(Boolean),
);

/** Dutch words that can start a sentence; English sentence starts are checked against Godot's own docs. */
const DUTCH_STARTS = new Set(
  `de het een als bij gebruik zet nooit altijd wanneer dit dat deze die na voor met zonder in op elke iedere maak lees
  controleer test meet bouw laad houd geef kies leg doe geen niet waar wat hoe waarom ook alleen eerst daarna dan zo
  wie welk welke er hier daar omdat want maar en of tot tussen door uit om onder boven achter naast sinds tijdens
  vraag stel schrijf draai start stop sla bewaar kijk vergelijk reken schaal verplaats draai`.split(/\s+/).filter(Boolean),
);

/** Files that every Godot project has: not a name of anyone's project. */
const COMMON_FILES = new Set(["project.godot", "export_presets.cfg", "override.cfg", "godotwright.json", "model.contract.json"]);

const FILE_EXT =
  "gd|tscn|scn|tres|res|glb|gltf|blend|fbx|obj|dae|png|jpe?g|webp|exr|hdr|ktx2?|dds|svg|wav|ogg|mp3|py|js|mjs|cjs|ts|json|cfg|ini|godot|import|uid|pck|zip|exe|dll|so|dylib|cmd|bat|ps1|sh|md|txt|csv|log|gdshader|gdshaderinc|shader|cs|cpp|h|yml|yaml|toml|xml|html";

/** Units after a number (`30kn`, `16ms`, `4k`, `1080p`): a measurement, not a code. */
const UNIT = /^\d+(?:[.,]\d+)?(?:k|m|km|cm|mm|kg|g|t|s|ms|us|µs|ns|h|min|hz|khz|mhz|ghz|fps|px|kn|kt|kts|mph|kph|kmh|mb|gb|kb|tb|mib|gib|kib|x|d|deg|v|w|kw|mw|p|bit|bits|st|nd|rd|th|e|de|ste)$/i;

/** Tokens with digits that are words of the trade. */
const TECH_CODES = /^(?:[1-4]d|float(?:16|32|64)|u?int(?:8|16|32|64)|utf-?(?:8|16)|x86(?:_64)?|arm64|d3d1[12]|gles[23]|lod\d|sha(?:1|256|512)|md5|mp[34]|h26[45]|vp[89]|av1|etc2|bc[1-7]|rgba?(?:8|16|32)f?|r(?:8|16|32)f?|rg(?:8|16|32)f?|ipv[46]|http2|wasm32|win(?:32|64)|vector[234]i?|transform[23]d|rect2i?|aabb|godot[34]|godotphysics[23]d|latin-?1|iso-?8859(?:-?1)?)$/i;

let vocabulary: Set<string> | undefined;
let apiNames: Set<string> | undefined;

/** Every lowercase word in Godot's class reference: an English word that starts a sentence is no name. */
function englishWords(api: GodotApi): Set<string> {
  if (vocabulary) return vocabulary;
  const words = new Set<string>();
  const add = (text?: string) => {
    if (text) for (const w of text.match(/\b[a-z][a-z']{1,}\b/g) ?? []) words.add(w);
  };
  for (const cls of api.classes.values()) {
    add(cls.brief);
    add(cls.description);
    for (const list of [cls.methods, cls.members, cls.signals, cls.constants]) for (const entry of list ?? []) add(entry.description);
  }
  vocabulary = words;
  return words;
}

/** Godot class, member, constant and setting names: these are no names of a project. */
function godotNames(api: GodotApi): Set<string> {
  if (apiNames) return apiNames;
  const names = new Set<string>();
  for (const cls of api.classes.values()) {
    names.add(cls.name);
    for (const list of [cls.methods, cls.members, cls.signals, cls.constants, cls.constructors, cls.annotations]) {
      for (const entry of list ?? []) {
        names.add(entry.name);
        // Project settings are members named like paths: rendering/textures/default_filters/anisotropic_filtering_level.
        for (const part of entry.name.split("/")) names.add(part);
        const e = (entry as { enum?: string }).enum;
        if (e) for (const part of e.split(".")) names.add(part);
      }
    }
  }
  apiNames = names;
  return names;
}

export function isGodotName(name: string, api: GodotApi): boolean {
  const bare = name.replace(/\(\)$/, "");
  const names = godotNames(api);
  if (names.has(bare) || api.classes.has(bare) || names.has(bare.replace(/^@/, ""))) return true;
  const dotted = /^(@?[A-Za-z_]\w*)\.([A-Za-z_]\w*)$/.exec(bare);
  return Boolean(dotted && api.classes.has(dotted[1]!) && names.has(dotted[2]!));
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replaces everything that could name a person, a project or a machine.
 * Replacements are `<name>`, `<path>`, `<file>`, `<url>`, `<email>`, `<code>`, `<n>` and `<date>`.
 */
export function scrubText(input: string, context: ScrubContext): Scrubbed {
  const { api } = context;
  const replaced: Record<string, number> = {};
  const mark = (kind: string) => {
    replaced[kind] = (replaced[kind] ?? 0) + 1;
    return `<${kind}>`;
  };
  let text = input.replace(/\r\n?/g, "\n");

  // Source code: fenced blocks, and inline code that is not a Godot name.
  text = text.replace(/```[\s\S]*?(?:```|$)/g, () => mark("code"));
  text = text.replace(/`([^`\n]{1,200})`/g, (all, inner: string) => (isGodotName(inner.trim(), api) ? all : mark("code")));
  text = text.replace(/\b(?:static\s+)?func\s+[A-Za-z_]\w*\s*\([^)\n]*\)[^\n.]*/g, () => mark("code"));
  text = text.replace(/\b(?:var|const)\s+[A-Za-z_]\w*\s*(?::\s*[\w[\]]+)?\s*:?=\s*[^\n,;]+/g, () => mark("code"));
  text = text.replace(/[^\n.;]*(?::=|->|\{|\})[^\n.;]*/g, (all) => (all.trim() ? ` ${mark("code")}` : all));

  // Links, e-mail addresses and paths.
  text = text.replace(/\b(?:https?|ftp|file|ssh|git):\/\/\S+|\bwww\.[\w-]+\.\S+/gi, () => mark("url"));
  text = text.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, () => mark("email"));
  text = text.replace(/\b(?:res|user|uid):\/\/[^\s"'`,;)]*/g, () => mark("path"));
  text = text.replace(/(?:\b[A-Za-z]:|\\\\[\w.-]+)[\\/][^\s"'`,;)]*/g, () => mark("path"));
  text = text.replace(/(^|[\s("'=])(?:~|\.{1,2})?\/(?:[\w.@-]+\/)+[\w.@-]*/g, (_all, lead: string) => `${lead}${mark("path")}`);
  text = text.replace(/(^|[\s("'=])~(?=[\s,.;)]|$)/g, (_all, lead: string) => `${lead}${mark("path")}`);
  text = text.replace(new RegExp(`\\b[\\w.-]+(?:[\\\\/][\\w.-]+)+\\.(?:${FILE_EXT})\\b`, "gi"), () => mark("path"));
  text = text.replace(new RegExp(`(?<![\\w<])\\.?[\\w-]+(?:\\.[\\w-]+)*\\.(?:${FILE_EXT})\\b`, "gi"), (file) => (COMMON_FILES.has(file.toLowerCase()) ? file : mark("file")));

  // Codes, keys, ids and dates.
  text = text.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, () => mark("code"));
  text = text.replace(/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{1,2}:\d{2}(?::\d{2})?Z?)?\b|\b20\d{6}(?:T\d{4,6}Z?)?\b/g, () => mark("date"));
  text = text.replace(/\b(?=[A-Za-z0-9_+/=-]*\d)(?=[A-Za-z0-9_+/=-]*[A-Za-z])[A-Za-z0-9_+/=-]{20,}\b/g, () => mark("code"));
  text = text.replace(/\b[0-9a-f]{12,}\b/gi, (hex) => (/\d/.test(hex) ? mark("code") : hex));
  text = text.replace(/\b\d{6,}\b/g, () => mark("n"));
  text = text.replace(/\b[A-Za-z]{1,5}-\d+[A-Za-z]?\b/g, (token) => (TECH_CODES.test(token) || TECH_CODES.test(token.replace("-", "")) ? token : mark("code")));
  text = text.replace(/\b(?=\w*\d)(?=\w*[A-Za-z])\w+\b/g, (token) => {
    if (UNIT.test(token) || TECH_CODES.test(token) || isGodotName(token, api) || token.startsWith("_")) return token;
    return mark("code");
  });

  // Names of the project, as written there.
  const own = [...new Set(context.projectNames ?? [])]
    .map((n) => n.trim())
    .filter((n) => n.length >= 3 && !isGodotName(n, api) && !TECH_WORDS.has(n.toLowerCase()))
    .sort((a, b) => b.length - a.length);
  for (const name of own) {
    // A lowercase word ("player") is an ordinary word too; a plain word with a capital ("Deck") is replaced only as
    // written; a phrase or a coined name everywhere.
    if (/^[a-z]+$/.test(name)) continue;
    const plain = /^[A-Z][a-z]+$/.test(name);
    const pattern = new RegExp(`(?<![\\w<])${escape(name)}(?![\\w>])`, plain ? "g" : "gi");
    text = text.replace(pattern, () => mark("name"));
  }

  // Identifiers that are not Godot's: snake_case, camelCase and coined PascalCase compounds.
  text = text.replace(/(?<![\w<@.])(?:[A-Za-z_][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+|[a-z]+[A-Z]\w*|[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+)(?![\w>])/g, (id) =>
    isGodotName(id, api) || TECH_WORDS.has(id.toLowerCase()) || LANGUAGE_WORDS.has(id.toLowerCase()) ? id : mark("name"),
  );
  // The member after a Godot class (`Engine.time_scale`) is checked with its class.
  text = text.replace(/\b([A-Z]\w*)\.([a-z_]\w*)\b/g, (all, cls: string, member: string) => (api.classes.has(cls) && !godotNames(api).has(member) ? `${cls}.${mark("name")}` : all));

  // Words with a capital: a name, unless it is Godot's, a tool or format, an acronym, or an ordinary word starting a sentence.
  const words = englishWords(api);
  text = text.replace(/(^|[^\p{L}\p{N}_<])([A-Z][\p{L}\p{N}_'’]*[\p{L}\p{N}_])/gu, (all, before: string, word: string, offset: number) => {
    // Tokens with digits or underscores were judged above.
    if (/[\p{N}_]/u.test(word)) return all;
    const bare = word.replace(/['’]s$/, "");
    const lower = bare.toLowerCase();
    if (api.classes.has(bare) || TECH_WORDS.has(lower) || LANGUAGE_WORDS.has(lower) || godotNames(api).has(bare)) return all;
    if (/^[A-Z]{2,5}$/.test(bare)) return all;
    const head = text.slice(0, offset + before.length).replace(/[\s"'(*_-]+$/, "");
    const startsSentence = head === "" || /[.!?:;\n]$/.test(head) || /(?:^|\n)\s*(?:[-*•]|\d+[.)])$/.test(head);
    if (startsSentence && !/^[A-Z]{2,}$/.test(bare) && (words.has(lower) || DUTCH_STARTS.has(lower))) return all;
    return `${before}${mark("name")}${word.slice(bare.length)}`;
  });

  text = text
    .replace(/(<(\w+)>)(?:[ \t/&+-]*<\2>)+/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, replaced };
}

/** Share of the words that were replaced: a lesson that is mostly placeholders says nothing. */
export function placeholderShare(text: string): number {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (!tokens.length) return 1;
  return tokens.filter((t) => /<\w+>/.test(t)).length / tokens.length;
}
