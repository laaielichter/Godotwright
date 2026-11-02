/**
 * Godot 3 shader code that Godot 4.7 refuses, and what to write instead. Every entry was compiled in Godot 4.7.2: the
 * Godot 3 form fails with the message matched here, and the replacement compiles.
 */

/** Built-ins renamed or removed in Godot 4 (spatial and canvas_item). */
const BUILTINS: Record<string, string> = {
  WORLD_MATRIX: "MODEL_MATRIX",
  EXTRA_MATRIX: "MODEL_MATRIX, which holds the extra transform in Godot 4",
  CAMERA_MATRIX: "INV_VIEW_MATRIX",
  INV_CAMERA_MATRIX: "VIEW_MATRIX",
  TRANSMISSION: "BACKLIGHT",
  ALPHA_SCISSOR: "ALPHA_SCISSOR_THRESHOLD",
  NORMALMAP: "NORMAL_MAP",
  NORMALMAP_DEPTH: "NORMAL_MAP_DEPTH",
  CLEARCOAT_GLOSS: "CLEARCOAT_ROUGHNESS = 1.0 - gloss",
};

/** Built-ins only canvas_item shaders renamed (spatial shaders still have PROJECTION_MATRIX). */
const CANVAS_BUILTINS: Record<string, string> = {
  PROJECTION_MATRIX: "SCREEN_MATRIX, or CANVAS_MATRIX for the canvas transform",
};

const HINTS: Record<string, string> = {
  hint_color: "source_color",
  hint_albedo: "source_color",
  hint_black_albedo: "source_color, hint_default_black",
  hint_black: "hint_default_black",
  hint_white: "hint_default_white",
  hint_aniso: "hint_anisotropy",
};

const RENDER_MODES: Record<string, string> = {
  depth_draw_alpha_prepass: "use depth_prepass_alpha",
  async_visible: "remove it: Godot 4 has no asynchronous shader compilation mode",
  async_hidden: "remove it: Godot 4 has no asynchronous shader compilation mode",
};

const SCREEN_READS: Record<string, string> = {
  SCREEN_TEXTURE: "hint_screen_texture",
  DEPTH_TEXTURE: "hint_depth_texture",
  NORMAL_ROUGHNESS_TEXTURE: "hint_normal_roughness_texture",
};

/** Particle built-ins a Godot 3 particles shader writes in vertex(). */
const PARTICLE_BUILTINS = /^(VELOCITY|TRANSFORM|COLOR|CUSTOM|ACTIVE|RESTART|LIFETIME|DELTA|INDEX|NUMBER|EMISSION_TRANSFORM)$/;

export interface HintContext {
  /** The source line Godot points to, when it could be read. */
  line?: string;
  /** Shader.Mode of the shader: 1 canvas_item, 2 particles. */
  mode?: number;
  /** The whole shader source, when it could be read. */
  source?: string;
}

/** How to fix a Godot 3 leftover that Godot 4 reports, or undefined when the message is not one. */
export function godot3Hint(message: string, ctx: HintContext = {}): string | undefined {
  const removed = /^(\w+) has been removed in favor of using (hint_\w+) with a uniform/.exec(message);
  if (removed && SCREEN_READS[removed[1]!]) {
    return `Godot 3; use a uniform with ${removed[2]}: uniform sampler2D ${removed[1]} : ${removed[2]}, filter_linear_mipmap;`;
  }
  const unknown = /^Unknown identifier in expression: '(\w+)'/.exec(message);
  if (unknown) {
    const name = unknown[1]!;
    if (ctx.mode === 2 && PARTICLE_BUILTINS.test(name) && ctx.source && /\bvoid\s+vertex\s*\(/.test(ctx.source)) {
      return "Godot 3 particles shader; Godot 4 runs particle code in start() and process(), not vertex()";
    }
    const renamed = (ctx.mode === 1 ? CANVAS_BUILTINS[name] : undefined) ?? BUILTINS[name];
    if (renamed) return `Godot 3 name; use ${renamed}`;
    if (SCREEN_READS[name]) return `Godot 3; use a uniform with ${SCREEN_READS[name]}`;
    return undefined;
  }
  if (/^Expected valid type hint after ':'/.test(message) && ctx.line) {
    const after = ctx.line.slice(ctx.line.indexOf(":") + 1);
    for (const old of after.match(/\bhint_\w+/g) ?? []) {
      const now = HINTS[old];
      if (now) return `Godot 3 hint ${old}; use ${now}`;
    }
    return undefined;
  }
  const mode = /^Invalid render mode: '(\w+)'/.exec(message);
  if (mode && RENDER_MODES[mode[1]!]) return `Godot 3 render mode; ${RENDER_MODES[mode[1]!]}`;
  return undefined;
}
