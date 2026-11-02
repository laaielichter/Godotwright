import { describe, expect, it } from "vitest";
import { GodotApi } from "../src/api/api.js";
import { formatLookup } from "../src/api/format.js";
import { isWrite, knownRenderMode, parseShader, resolveInclude, shaderIncludes, stripShaderComments } from "../src/godot/shader.js";
import { formatFinding } from "../src/review/format.js";
import { reviewProject } from "../src/review/review.js";
import { DEMO, makeProject } from "./helpers.js";

/**
 * Shader review rules. Every message and every quiet case below was checked against Godot 4.7.2: the code that fires
 * fails to compile there with the error quoted in the comment, the code that stays quiet compiles.
 */

const PROJECT = '[application]\nconfig/name="T"\nconfig/features=PackedStringArray("4.7")\n';

function shaderFindings(files: Record<string, string>, rule?: string, project = PROJECT): string[] {
  const root = makeProject({ "project.godot": project, ".gitignore": ".godot/\n", ...files });
  return reviewProject(root)
    .findings.filter((f) => /shader/.test(f.rule) && (!rule || f.rule === rule))
    .map(formatFinding);
}

const one = (code: string, rule?: string) => shaderFindings({ "s.gdshader": code }, rule);

describe("shader reader", () => {
  it("blanks comments and keeps lines", () => {
    expect(stripShaderComments("a // b\n/* c\nd */ e")).toBe("a     \n    \n     e");
  });

  it("reads type, render modes, uniforms with hints, functions, includes and declared names", () => {
    const p = parseShader(
      [
        "shader_type spatial;",
        "render_mode blend_mix, cull_disabled;",
        '#include "lib.gdshaderinc"',
        "#define TINT vec3(1.0)",
        "uniform vec4 albedo : source_color, hint_default_white = vec4(1.0);",
        "uniform float amount : hint_range(0.0, 1.0, 0.1) = 0.5;",
        "instance uniform vec3 tint_color;",
        "varying vec3 world_pos;",
        "const float K = 2.0, L = 3.0;",
        "struct Ray { vec3 o; vec3 d; };",
        "float f(in float x, Ray r) { float y = x, z[2]; return y; }",
        "void fragment() {",
        "\tfor (int i = 0; i < 4; i++) { ALBEDO += texture(t, UV).rgb; }",
        "}",
      ].join("\n"),
    );
    expect(p.type).toBe("spatial");
    expect(p.renderModes.map((m) => m.name)).toEqual(["blend_mix", "cull_disabled"]);
    expect(p.uniforms.map((u) => `${u.scope ?? ""}${u.type} ${u.name}:${u.hints.map((h) => h.name).join(",")}@${u.line}`)).toEqual([
      "vec4 albedo:source_color,hint_default_white@5",
      "float amount:hint_range@6",
      "instancevec3 tint_color:@7",
    ]);
    expect(p.functions.map((f) => `${f.name} ${f.line}-${f.endLine}`)).toEqual(["f 11-11", "fragment 12-14"]);
    expect(p.includes).toEqual([{ path: "lib.gdshaderinc", line: 3 }]);
    for (const name of ["TINT", "albedo", "amount", "tint_color", "world_pos", "K", "L", "Ray", "f", "x", "r", "y", "z", "fragment", "i"]) {
      expect(p.declared.has(name), name).toBe(true);
    }
    expect(p.declared.has("o")).toBe(false);
    expect(p.loops).toHaveLength(1);
    expect(p.loops[0]!.count).toBe(4);
  });

  it("knows writes", () => {
    const p = parseShader("void fragment() { COLOR = a; COLOR.rgb *= b; X[0] = c; Y++; --Z; v = COLOR; w = COLOR == a; }");
    const writes = p.tokens.map((t, n) => (/^[A-Z]$|^COLOR$/.test(t.t) && isWrite(p.tokens, n) ? t.t : "")).filter(Boolean);
    expect(writes).toEqual(["COLOR", "COLOR", "X", "Y", "Z"]);
  });

  it("resolves includes like Godot, also from a Shader stored in a scene", () => {
    expect(resolveInclude("res://fx/water.gdshader", "lib/noise.gdshaderinc")).toBe("res://fx/lib/noise.gdshaderinc");
    expect(resolveInclude("res://fx/water.gdshader", "../common.gdshaderinc")).toBe("res://common.gdshaderinc");
    expect(resolveInclude("res://levels/a.tscn::Shader_x", "noise.gdshaderinc")).toBe("res://levels/noise.gdshaderinc");
    expect(resolveInclude("res://a.gdshader", "res://x/y.gdshaderinc")).toBe("res://x/y.gdshaderinc");
    expect(resolveInclude("res://a.gdshader", "../../out.gdshaderinc")).toBeUndefined();
    expect(shaderIncludes('// #include "no.gdshaderinc"\n#include "yes.gdshaderinc"\n')).toEqual([{ path: "yes.gdshaderinc", line: 2 }]);
  });

  it("matches render modes the way Godot does", () => {
    const modes = GodotApi.load().shaderType("spatial")!.renderModes;
    for (const ok of ["blend_mix", "depth_draw_always", "depth_test_disabled", "cull_disabled", "unshaded", "depth_prepass_alpha"]) expect(knownRenderMode(ok, modes), ok).toBe(true);
    for (const bad of ["blend_screen", "depth_draw_alpha_prepass", "async_visible", "cull"]) expect(knownRenderMode(bad, modes), bad).toBe(false);
  });
});

describe("godot_api shader answers", () => {
  const api = GodotApi.load();

  it("says where a built-in exists and whether it can be written", () => {
    const out = formatLookup(api, api.lookup("ALBEDO"));
    expect(out).toContain("spatial fragment(): vec3");
    expect(out).toContain("spatial light(): vec3 (read-only)");
  });

  it("lists a shader type's built-ins per function, and translates Godot 3 shader names", () => {
    const out = formatLookup(api, api.lookup("shader:canvas_item.fragment"));
    expect(out).toContain("fragment(): VERTEX (rw)");
    expect(out).toContain("every function: TIME, PI, TAU, E");
    expect(out).toContain("stage functions: texture_sdf");
    expect(formatLookup(api, api.lookup("shader:spatial"))).toContain("render_mode: blend_mix, blend_add");
    expect(formatLookup(api, api.lookup("hint_albedo"))).toContain("the shader name hint_albedo is called source_color in Godot 4");
    expect(formatLookup(api, api.lookup("shader:WORLD_MATRIX"))).toContain("WORLD_MATRIX is called MODEL_MATRIX");
    expect(formatLookup(api, api.lookup("shader:spatal"))).toContain("did you mean: spatial");
  });
});

describe("api/shader-removed-builtin and api/shader-renamed (Godot 3 shader code)", () => {
  it("reports SCREEN_TEXTURE, DEPTH_TEXTURE and NORMAL_ROUGHNESS_TEXTURE once each, with Godot's own fix", () => {
    // Godot 4.7.2: "SCREEN_TEXTURE has been removed in favor of using hint_screen_texture with a uniform."
    const code = "shader_type spatial;\n\nvoid fragment() {\n\tALBEDO = texture(SCREEN_TEXTURE, SCREEN_UV).rgb;\n\tALBEDO += texture(SCREEN_TEXTURE, SCREEN_UV).rgb * texture(DEPTH_TEXTURE, SCREEN_UV).r;\n}\n";
    expect(one(code)).toEqual([
      "res://s.gdshader:4: error [api/shader-removed-builtin] SCREEN_TEXTURE was removed in Godot 4: declare `uniform sampler2D SCREEN_TEXTURE : hint_screen_texture, filter_linear_mipmap;` near the top (godot_fix and godot_migrate add it).",
      "res://s.gdshader:5: error [api/shader-removed-builtin] DEPTH_TEXTURE was removed in Godot 4: declare `uniform sampler2D DEPTH_TEXTURE : hint_depth_texture, filter_linear_mipmap;` near the top (godot_fix and godot_migrate add it).",
    ]);
  });

  it("stays quiet when the uniform of that name is declared (Godot's suggested fix)", () => {
    expect(one("shader_type canvas_item;\nuniform sampler2D SCREEN_TEXTURE : hint_screen_texture, filter_linear_mipmap;\nvoid fragment() {\n\tCOLOR = texture(SCREEN_TEXTURE, SCREEN_UV);\n}\n")).toEqual([]);
  });

  it("reports renamed hints, built-ins and render modes from Godot's rename table", () => {
    // Godot 4.7.2: "Expected valid type hint after ':'.", "Unknown identifier in expression: 'WORLD_MATRIX'.",
    // "Invalid render mode: 'depth_draw_alpha_prepass'."
    const code = [
      "shader_type spatial;",
      "render_mode depth_draw_alpha_prepass;",
      "uniform vec4 tint : hint_color;",
      "uniform sampler2D tex : hint_albedo;",
      "uniform sampler2D dark : hint_black_albedo;",
      "void vertex() {",
      "\tVERTEX = (WORLD_MATRIX * vec4(VERTEX, 1.0)).xyz;",
      "}",
      "void fragment() {",
      "\tNORMALMAP = vec3(0.5);",
      "\tTRANSMISSION = vec3(0.1);",
      "\tALBEDO = CAMERA_MATRIX[0].xyz;",
      "}",
    ].join("\n");
    expect(one(code)).toEqual([
      "res://s.gdshader:2: error [api/shader-renamed] depth_draw_alpha_prepass is the Godot 3 name: use depth_prepass_alpha (godot_migrate rewrites it).",
      "res://s.gdshader:3: error [api/shader-renamed] hint_color is the Godot 3 name: use source_color (godot_migrate rewrites it).",
      "res://s.gdshader:4: error [api/shader-renamed] hint_albedo is the Godot 3 name: use source_color (godot_migrate rewrites it).",
      "res://s.gdshader:5: error [api/shader-renamed] hint_black_albedo is the Godot 3 name: use source_color, hint_default_black (godot_migrate rewrites it).",
      "res://s.gdshader:7: error [api/shader-renamed] WORLD_MATRIX is the Godot 3 name: use MODEL_MATRIX (godot_migrate rewrites it).",
      "res://s.gdshader:10: error [api/shader-renamed] NORMALMAP is the Godot 3 name: use NORMAL_MAP (godot_migrate rewrites it).",
      "res://s.gdshader:11: error [api/shader-renamed] TRANSMISSION is the Godot 3 name: use BACKLIGHT (godot_migrate rewrites it).",
      "res://s.gdshader:12: error [api/shader-renamed] CAMERA_MATRIX is the Godot 3 name: use INV_VIEW_MATRIX (godot_migrate rewrites it).",
    ]);
  });

  it("reports a Godot 3 particle shader's vertex()", () => {
    // Godot 4.7.2: "Unknown identifier in expression: 'VELOCITY'." inside vertex() of a particles shader.
    expect(one("shader_type particles;\nvoid vertex() {\n\tVELOCITY = vec3(1.0);\n}\n", "api/shader-renamed")).toEqual([
      "res://s.gdshader:2: error [api/shader-renamed] Godot 4 particle shaders have no vertex(): Godot calls start() when a particle spawns and process() every frame. Move the code there.",
    ]);
  });

  it("leaves names in comments, user declarations and member access alone", () => {
    const code = "shader_type spatial;\n// SCREEN_TEXTURE hint_color WORLD_MATRIX\nstruct S { vec3 NORMALMAP; };\nvoid fragment() {\n\tS s;\n\tfloat hint_white = 1.0;\n\tALBEDO = s.NORMALMAP * hint_white;\n}\n";
    expect(one(code)).toEqual([]);
  });
});

describe("api/shader-builtin-misplaced and api/shader-read-only-builtin", () => {
  it("reports COLOR written in a spatial fragment() but not in vertex()", () => {
    // Godot 4.7.2: "Constants cannot be modified." for fragment(); vertex() compiles.
    expect(one("shader_type spatial;\nvoid fragment() {\n\tCOLOR = vec4(1.0);\n\tCOLOR.rgb = vec3(0.5);\n}\n")).toEqual([
      'res://s.gdshader:3: error [api/shader-read-only-builtin] COLOR is read-only in spatial fragment() (Godot: "Constants cannot be modified"): write ALBEDO (and ALPHA); COLOR is the vertex colour here, and vertex() may write it.',
    ]);
    expect(one("shader_type spatial;\nvoid vertex() {\n\tCOLOR = vec4(1.0);\n}\nvoid fragment() {\n\tALBEDO = COLOR.rgb;\n}\n")).toEqual([]);
  });

  it("reports VERTEX written in fragment()", () => {
    expect(one("shader_type spatial;\nvoid fragment() {\n\tVERTEX = vec3(0.0);\n}\n")).toEqual([
      'res://s.gdshader:3: error [api/shader-read-only-builtin] VERTEX is read-only in spatial fragment() (Godot: "Constants cannot be modified"): move the vertex in vertex().',
    ]);
  });

  it("reports built-ins of another shader type, another function, or a helper function", () => {
    // Godot 4.7.2: "Unknown identifier in expression: 'ALBEDO'." / 'COLOR' in spatial light() / 'UV' in a helper.
    expect(one("shader_type canvas_item;\nvoid fragment() {\n\tALBEDO = vec3(1.0);\n}\n")).toEqual([
      "res://s.gdshader:3: error [api/shader-builtin-misplaced] ALBEDO does not exist in canvas_item shaders (it is a spatial and fog built-in): write COLOR.",
    ]);
    expect(one("shader_type spatial;\nvoid light() {\n\tDIFFUSE_LIGHT += COLOR.rgb;\n}\n")).toEqual([
      "res://s.gdshader:3: error [api/shader-builtin-misplaced] COLOR does not exist in spatial light(); it does in vertex(), fragment().",
    ]);
    expect(one("shader_type spatial;\nvec2 h() {\n\treturn UV * TIME;\n}\nvoid fragment() {\n\tALBEDO = vec3(h(), 0.0);\n}\n")).toEqual([
      "res://s.gdshader:3: error [api/shader-builtin-misplaced] UV is not available in your function h(): built-ins of vertex(), fragment(), light() exist only there. Pass it in as a parameter.",
    ]);
  });

  it("reports discard in vertex() and stage functions where they do not exist", () => {
    // Godot 4.7.2: "'discard' cannot be used within the 'vertex' processor function."
    expect(one("shader_type spatial;\nvoid vertex() {\n\tdiscard;\n}\n")).toEqual([
      "res://s.gdshader:3: error [api/shader-builtin-misplaced] discard is not allowed in spatial vertex(); only fragment() and light() can discard.",
    ]);
    expect(one("shader_type canvas_item;\nvoid vertex() {\n\tVERTEX.x += texture_sdf(VERTEX);\n}\n")).toEqual([
      "res://s.gdshader:3: error [api/shader-builtin-misplaced] texture_sdf() cannot be called in canvas_item vertex(); Godot offers it in canvas_item fragment(), canvas_item light().",
    ]);
  });

  it("stays quiet on locals, uniforms and defines with built-in names, and on code that compiles", () => {
    const code = [
      "shader_type canvas_item;",
      "uniform vec4 MODULATE_COLOR : source_color;",
      "#define EMISSION vec3(0.0)",
      "void fragment() {",
      "\tvec3 ALBEDO = vec3(1.0);",
      "\tCOLOR = vec4(ALBEDO + EMISSION, 1.0) * MODULATE_COLOR;",
      "\tCOLOR.rgb *= vec3(TIME * PI);",
      "\tif (AT_LIGHT_PASS) { discard; }",
      "}",
    ].join("\n");
    expect(one(code)).toEqual([]);
  });

  it("does not guess when an include is missing (it may declare the names)", () => {
    expect(one('shader_type canvas_item;\n#include "gone.gdshaderinc"\nvoid fragment() {\n\tALBEDO = vec3(1.0);\n}\n')).toEqual([
      'res://s.gdshader:2: error [structure/shader-missing-include] #include "gone.gdshaderinc" (res://gone.gdshaderinc) does not exist: Godot then stops at the # with "Tokenizer: Unknown character #35: \'#\'", which does not name the file.',
    ]);
  });

  it("knows names declared in an include", () => {
    const files = {
      "fx/lib.gdshaderinc": "#define ALBEDO_OF(c) c.rgb\nvec3 EMISSION_FOR(float x) { return vec3(x); }\nvec3 MODEL_MATRIX_FIX = vec3(0.0);\n",
      "fx/s.gdshader": 'shader_type canvas_item;\n#include "lib.gdshaderinc"\nvoid fragment() {\n\tCOLOR.rgb = EMISSION_FOR(1.0);\n}\n',
    };
    expect(shaderFindings(files)).toEqual([]);
  });
});

describe("api/shader-render-mode and api/shader-type", () => {
  it("reports render modes the shader type does not have, with near names", () => {
    // Godot 4.7.2: "Invalid render mode: 'async_visible'."
    expect(one("shader_type spatial;\nrender_mode blend_mix, async_visible, cull_none;\nvoid fragment() {}\n")).toEqual([
      "res://s.gdshader:2: error [api/shader-render-mode] Unknown render mode async_visible for spatial shaders.",
      "res://s.gdshader:2: error [api/shader-render-mode] Unknown render mode cull_none for spatial shaders: did you mean cull_front?",
    ]);
    expect(one("shader_type canvas_item;\nrender_mode unshaded, blend_disabled, light_only;\nvoid fragment() {}\n")).toEqual([]);
  });

  it("reports a missing or misspelled shader_type", () => {
    expect(one("void fragment() {}\n")[0]).toContain("[api/shader-type] No shader_type");
    expect(one("shader_type particle;\nvoid process() {}\n")).toEqual([
      "res://s.gdshader:1: error [api/shader-type] Unknown shader_type particle: did you mean particles? Godot 4.7 has spatial, canvas_item, particles, sky, fog, texture_blit.",
    ]);
    // An include has no shader_type of its own.
    expect(shaderFindings({ "lib.gdshaderinc": "float f(float x) { return x; }\n" })).toEqual([]);
  });
});

describe("quality/shader-color-no-source-color", () => {
  it("reports colour uniforms and albedo textures without source_color in 3D shaders", () => {
    const code = [
      "shader_type spatial;",
      "uniform vec4 albedo_color = vec4(1.0);",
      "uniform vec3 glow;",
      "uniform sampler2D albedo_texture;",
      "uniform vec4 params;",
      "uniform sampler2D noise;",
      "uniform sampler2D normal_tex : hint_normal;",
      "uniform vec4 tint : source_color;",
      "void fragment() {",
      "\tALBEDO = albedo_color.rgb * texture(albedo_texture, UV).rgb * tint.rgb;",
      "\tEMISSION = glow * params.x * texture(noise, UV).r;",
      "\tNORMAL_MAP = texture(normal_tex, UV).rgb;",
      "}",
    ].join("\n");
    expect(one(code, "quality/shader-color-no-source-color")).toEqual([
      "res://s.gdshader:2: warning [quality/shader-color-no-source-color] uniform vec4 albedo_color has no source_color hint: Forward+ and Mobile then treat the sRGB colour you pick as linear, so it looks washed out. Add `: source_color`.",
      "res://s.gdshader:3: warning [quality/shader-color-no-source-color] uniform vec3 glow has no source_color hint: Forward+ and Mobile then treat the sRGB colour you pick as linear, so it looks washed out. Add `: source_color`.",
      "res://s.gdshader:4: warning [quality/shader-color-no-source-color] uniform sampler2D albedo_texture has no source_color hint: Forward+ and Mobile then treat the sRGB texture as linear, so it looks washed out. Add `: source_color`.",
    ]);
  });

  it("stays quiet in 2D shaders and in projects on the Compatibility renderer (no conversion there)", () => {
    expect(one("shader_type canvas_item;\nuniform vec4 color = vec4(1.0);\nvoid fragment() {\n\tCOLOR = color;\n}\n")).toEqual([]);
    const compat = `${PROJECT}\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n`;
    expect(shaderFindings({ "s.gdshader": "shader_type spatial;\nuniform vec4 color;\nvoid fragment() {\n\tALBEDO = color.rgb;\n}\n" }, undefined, compat)).toEqual([]);
  });
});

describe("performance hints", () => {
  it("reports discard in an opaque spatial shader, not in a transparent one", () => {
    expect(one("shader_type spatial;\nvoid fragment() {\n\tif (UV.x > 0.5) { discard; }\n\tALBEDO = vec3(1.0);\n}\n")).toEqual([
      "res://s.gdshader:3: info [performance/shader-discard] discard in an opaque spatial shader: Godot can no longer draw this mesh's depth prepass and shadows with its shared depth-only material, so this whole fragment shader also runs in those passes.",
    ]);
    expect(one("shader_type spatial;\nvoid fragment() {\n\tif (UV.x > 0.5) { discard; }\n\tALBEDO = vec3(1.0);\n\tALPHA = 0.5;\n}\n")).toEqual([]);
  });

  it("reports a spatial shader that reads the screen", () => {
    expect(one("shader_type spatial;\nuniform sampler2D screen : hint_screen_texture;\nvoid fragment() {\n\tALBEDO = texture(screen, SCREEN_UV).rgb;\n}\n")).toEqual([
      "res://s.gdshader:2: info [performance/shader-screen-read] screen uses hint_screen_texture: Godot draws this material in the transparent pass after the opaque objects, without a depth prepass, and it casts no shadow; Godot copies the screen for it every frame it is drawn.",
    ]);
  });

  it("does not claim a missing prepass or shadow with depth_prepass_alpha", () => {
    const out = one("shader_type spatial;\nrender_mode depth_prepass_alpha;\nuniform sampler2D d : hint_depth_texture, filter_nearest;\nvoid fragment() {\n\tALBEDO = vec3(texture(d, SCREEN_UV).r);\n}\n", "performance/shader-screen-read");
    expect(out).toEqual([
      "res://s.gdshader:3: info [performance/shader-screen-read] d uses hint_depth_texture: Godot draws this material in the transparent pass after the opaque objects; Godot copies the depth buffer for it every frame it is drawn.",
    ]);
  });

  it("reports texture reads in long or open-ended loops, not in short fixed ones", () => {
    const loop = (head: string) => `shader_type canvas_item;\nuniform sampler2D t;\nuniform int n = 8;\nvoid fragment() {\n\tvec4 c = vec4(0.0);\n\tfor (${head}) {\n\t\tc += texture(t, UV + float(i) * 0.01);\n\t}\n\tCOLOR = c;\n}\n`;
    expect(one(loop("int i = 0; i < n; i++"))).toEqual([
      "res://s.gdshader:7: info [performance/shader-texture-in-loop] texture() inside a loop: the number of reads per pixel depends on the loop bound. Keep the count small and fixed, use a lower mip level (textureLod), or split a blur into two passes.",
    ]);
    expect(one(loop("int i = 0; i < 64; i++"))[0]).toContain("64 texture reads per pixel");
    expect(one(loop("int i = 0; i < 9; i++"))).toEqual([]);
  });
});

describe("shaders in scenes and unsaved code", () => {
  it("reviews a Shader stored in a scene, with the scene's line numbers", () => {
    const scene = '[gd_scene format=3]\n\n[sub_resource type="Shader" id="Shader_a1"]\ncode = "shader_type canvas_item;\n\nvoid fragment() {\n\tCOLOR = texture(SCREEN_TEXTURE, SCREEN_UV);\n}\n"\n\n[node name="R" type="ColorRect"]\n';
    expect(shaderFindings({ "main.tscn": scene })).toEqual([
      "res://main.tscn::Shader_a1:7: error [api/shader-removed-builtin] SCREEN_TEXTURE was removed in Godot 4: declare `uniform sampler2D SCREEN_TEXTURE : hint_screen_texture, filter_linear_mipmap;` near the top (godot_fix and godot_migrate add it).",
    ]);
  });

  it("reviews unsaved shader code passed as an override", () => {
    const root = makeProject({ "project.godot": PROJECT, "s.gdshader": "shader_type spatial;\nvoid fragment() {}\n" });
    const report = reviewProject(root, { overrides: { "res://s.gdshader": "shader_type spatial;\nuniform vec4 c : hint_color;\nvoid fragment() {}\n" }, focus: ["res://s.gdshader"] });
    expect(report.findings.map(formatFinding)).toEqual([
      "res://s.gdshader:2: error [api/shader-renamed] hint_color is the Godot 3 name: use source_color (godot_migrate rewrites it).",
    ]);
  });

  it("keeps the demo fixture's shader clean", () => {
    expect(reviewProject(DEMO).findings.filter((f) => /shader/.test(f.rule))).toEqual([]);
  });
});
