import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { godot3Hint } from "../src/shaders/hints.js";
import { parseShaderLog } from "../src/shaders/log.js";
import { shaderRunnerSource } from "../src/shaders/runner.js";
import {
  asCheckDiagnostic,
  checkShaders,
  codeStartLine,
  drawnShaders,
  findShaderFiles,
  formatShaderCheck,
  includedFiles,
  mergeDiagnostics,
  parsedFogShaders,
  shaderDiagnostics,
  ShaderCheckError,
  shaderSummary,
  type ShaderCheckResult,
} from "../src/shaders/shaders.js";
import { FIXTURES, makeProject, runCli } from "./helpers.js";

/** Real Godot 4.7.2 output, captured from the shader runner (xvfb-run merges stderr into stdout). */
const fixture = (name: string) => readFileSync(join(FIXTURES, "shaders", name), "utf8");

/** The project the fixtures were captured from. */
const PROJECT: Record<string, string> = {
  "project.godot": 'config_version=5\n\n[application]\n\nconfig/name="Exp"\n',
  "fx/bad_canvas.gdshader": "shader_type canvas_item;\n\nuniform float strength = 1.0;\n\nvoid fragment() {\n\tvec4 c = texture(SCREEN_TEXTURE, SCREEN_UV);\n\tCOLOR = c * strength;\n}\n",
  "fx/good_canvas.gdshader": "shader_type canvas_item;\n\nuniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap;\n\nvoid fragment() {\n\tCOLOR = texture(screen_tex, SCREEN_UV);\n}\n",
  "fx/bad_spatial.gdshader": "shader_type spatial;\n\nuniform vec3 tint = vec3(1.0);\n\nvoid fragment() {\n\tfloat x = tint;\n\tALBEDO = vec3(x);\n}\n",
  "fx/bad_undef.gdshader": "shader_type spatial;\n\nvoid vertex() {\n\tVERTEX += NORMAL * wobble;\n}\n",
  "fx/uses_bad_inc.gdshader": 'shader_type spatial;\n\n#include "res://inc/common.gdshaderinc"\n\nvoid fragment() {\n\tALBEDO = vec3(wave(TIME));\n}\n',
  "fx/after_inc.gdshader": 'shader_type spatial;\n\n#include "res://inc/good.gdshaderinc"\n\nuniform float speed = 1.0;\n\nvoid fragment() {\n\tALBEDO = vec3(wave2(TIME * speed));\n\tROUGHNESS = undefined_rough;\n}\n',
  "fx/bad_particles.gdshader": "shader_type particles;\n\nvoid start() {\n\tTRANSFORM[3].xyz = vec3(0.0);\n}\n\nvoid process() {\n\tVELOCITY += GRAVITY * DELTA;\n\tCOLOR = vec3(1.0);\n}\n",
  "fx/bad_sky.gdshader": "shader_type sky;\n\nvoid sky() {\n\tCOLOR = EYEDIR;\n\tALPHA = 2;\n}\n",
  "fx/bad_fog.gdshader": "shader_type fog;\n\nvoid fog() {\n\tDENSITY = vec2(1.0);\n}\n",
  "fx/big_array.gdshader": "shader_type spatial;\n\nuniform vec4 big[20000];\n\nvoid fragment() {\n\tALBEDO = big[int(UV.x * 100.0)].rgb;\n}\n",
  "inc/common.gdshaderinc": "// shared helpers\nfloat wave(float t) {\n\treturn sin(t) * 0.5 + 0.5;\n}\n\nvec3 tintit(vec3 c) {\n\treturn c * missing_tint;\n}\n",
  "inc/good.gdshaderinc": "// good helpers\nfloat wave2(float t) {\n\treturn sin(t) * 0.5 + 0.5;\n}\n",
  "mat.tres": '[gd_resource type="ShaderMaterial" format=3]\n\n[sub_resource type="Shader" id="Shader_abc12"]\ncode = "shader_type spatial;\n\nvoid fragment() {\n\tALBEDO = vec3(1.0);\n\tEMISSION = foo;\n}\n"\n\n[resource]\nshader = SubResource("Shader_abc12")\n',
  "vs_bad.tres": '[gd_resource type="VisualShader" format=3]\n\n[sub_resource type="VisualShaderNodeExpression" id="VisualShaderNodeExpression_qllkm"]\nexpression = "col = vec3(bad_vs_thing);"\n\n[resource]\nnodes/fragment/2/node = SubResource("VisualShaderNodeExpression_qllkm")\nnodes/fragment/connections = PackedInt32Array(2, 0, 0, 0)\n',
  "vs_good.tres": '[gd_resource type="VisualShader" format=3]\n\n[resource]\nmode = 1\n',
  "notes.tres": '[gd_resource type="Resource" format=3]\n\n[resource]\n',
};

const INCLUDES_PROJECT: Record<string, string> = {
  "project.godot": 'config_version=5\n\n[application]\n\nconfig/name="Exp2"\n',
  "inc/one.gdshaderinc": "float one() {\n\treturn 1.0;\n}\n",
  "inc/long.gdshaderinc": "// a\n// b\n// c\n// d\n// e\nfloat lng() {\n\treturn 1.0;\n}\n\n\n",
  "inc/nested.gdshaderinc": '#include "res://inc/one.gdshaderinc"\nfloat nest() {\n\treturn one();\n}\n',
  "a_one.gdshader": 'shader_type spatial;\n#include "res://inc/one.gdshaderinc"\nvoid fragment() {\n\tALBEDO = vec3(one());\n\tROUGHNESS = bad_a;\n}\n',
  "d_two.gdshader": 'shader_type spatial;\n#include "res://inc/one.gdshaderinc"\n#include "res://inc/long.gdshaderinc"\nvoid fragment() {\n\tROUGHNESS = bad_d;\n}\n',
  "e_nested.gdshader": 'shader_type spatial;\n#include "res://inc/nested.gdshaderinc"\nvoid fragment() {\n\tROUGHNESS = bad_e;\n}\n',
  "f_next.gdshader": 'shader_type spatial;\n#include "res://inc/one.gdshaderinc"\nfloat bad_f_fn() { return bad_f; }\nvoid fragment() {}\n',
  "l_missing_inc.gdshader": 'shader_type spatial;\n#include "res://inc/nope.gdshaderinc"\nvoid fragment() {}\n',
  "m_syntax.gdshader": "shader_type spatial;\nvoid fragment() {\n\tALBEDO = vec3(1.0)\n}\n",
  "n_badtype.gdshader": "shader_type spetial;\nvoid fragment() {}\n",
  "plain.gdshader": "shader_type spatial;\nvoid fragment() {}\n",
};

const lines = (ds: { file?: string; line?: number; message: string; hint?: string }[]) =>
  ds.map((d) => `${d.file}${d.line ? `:${d.line}` : ""}: ${d.message}${d.hint ? ` (${d.hint})` : ""}`);

describe("shader log", () => {
  it("reads the runner's markers, the shaders it found and the renderer", () => {
    const log = parseShaderLog(fixture("render-xvfb.log"));
    expect(log.done).toEqual({ count: 12, driver: "opengl3", method: "gl_compatibility", adapter: "llvmpipe (LLVM 20.1.2, 256 bits)" });
    expect(log.shaders).toHaveLength(13);
    expect(log.shaders.find((s) => s.path === "res://fx/bad_fog.gdshader")).toMatchObject({ mode: 4, kind: "Shader" });
    expect(log.shaders.find((s) => s.path === "res://vs_bad.tres")).toMatchObject({ mode: 0, kind: "VisualShader" });
    expect(log.shaders.find((s) => s.path === "res://mat.tres::Shader_abc12")).toMatchObject({ file: "res://mat.tres" });
    expect(log.firstDrawMs.get("res://fx/good_canvas.gdshader")).toBeGreaterThan(0);
  });

  it("takes the line from at:, not from Godot's excerpt, and keeps Godot's advice", () => {
    const log = parseShaderLog(fixture("render-xvfb.log"));
    const screen = log.entries.find((e) => e.message.startsWith("SCREEN_TEXTURE"));
    expect(screen).toMatchObject({ kind: "language", file: "res://fx/bad_canvas.gdshader", line: 6, phase: "parse" });
    expect(screen?.more[0]).toMatch(/^To continue with minimal code changes add 'uniform sampler2D SCREEN_TEXTURE/);
    const inc = log.entries.find((e) => e.message.includes("missing_tint"));
    expect(inc).toMatchObject({ file: "res://inc/common.gdshaderinc", line: 7, shader: "res://fx/uses_bad_inc.gdshader" });
    expect(inc?.context.map((c) => c.file)).toEqual(["res://fx/uses_bad_inc.gdshader", "res://inc/common.gdshaderinc"]);
    const twoIncludes = parseShaderLog(fixture("includes-xvfb.log")).entries.find((e) => e.message.includes("bad_d"));
    // Godot's excerpt marks the blank line after the expanded includes; at: has the real line.
    expect(twoIncludes).toMatchObject({ file: "res://d_two.gdshader", line: 5 });
    expect(twoIncludes?.context[0]?.code).toBe("");
  });

  it("puts a link error, which names no file, on the shader being drawn, once per message", () => {
    const log = parseShaderLog(fixture("render-xvfb.log"));
    const driver = log.entries.filter((e) => e.kind === "driver");
    expect(driver.length).toBeGreaterThan(1);
    expect(driver[0]).toMatchObject({ message: "SceneShaderGLES3: Program linking failed", shader: "res://fx/big_array.gdshader", phase: "draw" });
    expect(driver[0]?.more).toEqual(["error: Uniform block MaterialUniforms too big (320000/65536)"]);
  });

  it("reads the line of a file whose name holds parentheses, as Godot names a duplicate", () => {
    // As Godot 4.7.2 printed it for "glow (copy).gdshader".
    const log = parseShaderLog(
      [
        "--res://fx/glow (copy).gdshader--",
        "    2 | void fragment() {",
        "E   3->\tfloat x = vec3(1.0);",
        "SHADER ERROR: Invalid assignment of 'vec3' to 'float'.",
        "          at: (null) (res://fx/glow (copy).gdshader:3)",
        "ERROR: Shader compilation failed.",
      ].join("\n"),
    );
    expect(log.entries).toEqual([expect.objectContaining({ file: "res://fx/glow (copy).gdshader", line: 3, more: [] })]);
    const root = makeProject({ "project.godot": "config_version=5\n", "fx/glow (copy).gdshader": "shader_type canvas_item;\nvoid fragment() {\n\tfloat x = vec3(1.0);\n}\n" });
    expect(shaderDiagnostics(root, log)).toEqual([
      expect.objectContaining({ file: "res://fx/glow (copy).gdshader", line: 3, code: "float x = vec3(1.0);", message: "Invalid assignment of 'vec3' to 'float'." }),
    ]);
  });

  it("reads a headless run, where the path is missing and the excerpt went to stdout", () => {
    const log = parseShaderLog(`${fixture("fog-headless.stderr.log")}\n${fixture("fog-headless.stdout.log")}`);
    expect(log.entries).toEqual([
      expect.objectContaining({ kind: "language", message: "Invalid arguments to operator '=': 'float, vec2'.", line: 4, shader: "res://fx/bad_fog.gdshader" }),
    ]);
    expect(log.entries[0]?.file).toBeUndefined();
  });
});

describe("shader diagnostics", () => {
  it("place every error in the user's file: includes, embedded shaders, visual shaders, link errors, fog", () => {
    const root = makeProject(PROJECT);
    const render = parseShaderLog(fixture("render-xvfb.log"));
    const fog = parseShaderLog(`${fixture("fog-headless.stderr.log")}\n${fixture("fog-headless.stdout.log")}`);
    const ds = [...shaderDiagnostics(root, render), ...shaderDiagnostics(root, fog)];
    expect(lines(ds)).toEqual([
      "res://fx/after_inc.gdshader:9: Unknown identifier in expression: 'undefined_rough'.",
      "res://fx/bad_canvas.gdshader:6: SCREEN_TEXTURE has been removed in favor of using hint_screen_texture with a uniform. (Godot 3; use a uniform with hint_screen_texture: uniform sampler2D SCREEN_TEXTURE : hint_screen_texture, filter_linear_mipmap;)",
      "res://fx/bad_particles.gdshader:8: Unknown identifier in expression: 'GRAVITY'.",
      "res://fx/bad_sky.gdshader:5: Invalid arguments to operator '=': 'float, int'.",
      "res://fx/bad_spatial.gdshader:6: Invalid assignment of 'vec3' to 'float'.",
      "res://fx/bad_undef.gdshader:4: Unknown identifier in expression: 'wobble'.",
      "res://inc/common.gdshaderinc:7: Unknown identifier in expression: 'missing_tint'.",
      "res://mat.tres:8: Unknown identifier in expression: 'foo'.",
      "res://vs_bad.tres: Unknown identifier in expression: 'bad_vs_thing'. (generated code line 12: n_out2p0 = vec3(bad_vs_thing);)",
      "res://fx/big_array.gdshader: SceneShaderGLES3: Program linking failed: error: Uniform block MaterialUniforms too big (320000/65536) (the uniforms take more memory than the GPU's uniform block allows; use smaller arrays or put the data in a texture)",
      "res://fx/bad_fog.gdshader:4: Invalid arguments to operator '=': 'float, vec2'.",
    ]);
    expect(ds.find((d) => d.file === "res://inc/common.gdshaderinc")?.includedFrom).toEqual(["res://fx/uses_bad_inc.gdshader:3"]);
    expect(ds.find((d) => d.file === "res://mat.tres")?.code).toBe("EMISSION = foo;");
    expect(asCheckDiagnostic(ds.find((d) => d.file === "res://inc/common.gdshaderinc")!)).toEqual({
      severity: "error",
      file: "res://inc/common.gdshaderinc",
      line: 7,
      message: "Unknown identifier in expression: 'missing_tint'. (included from res://fx/uses_bad_inc.gdshader:3)",
      source: "shader",
    });
  });

  it("name every shader that includes a broken file, also the fog shader of the headless run", () => {
    const root = makeProject({
      "project.godot": "config_version=5\n",
      "inc/common.gdshaderinc": "// common\nfloat helper(float x) {\n\treturn x * 2.0;\n}\nfloat broken() { return vec3(1.0); }\n",
      "fx/uses.gdshader": 'shader_type canvas_item;\n#include "res://inc/common.gdshaderinc"\nvoid fragment() {\n\tCOLOR = vec4(helper(0.2));\n}\n',
      "fx/uses2.gdshader": 'shader_type spatial;\n\n#include "res://inc/common.gdshaderinc"\nvoid fragment() {\n\tALBEDO = vec3(helper(0.2));\n}\n',
      "fx/fogbad.gdshader": 'shader_type fog;\n#include "res://inc/common.gdshaderinc"\nvoid fog() {\n\tDENSITY = helper(0.2);\n}\n',
    });
    const render = shaderDiagnostics(root, parseShaderLog(fixture("shared-include-xvfb.log")));
    expect(render).toEqual([
      expect.objectContaining({ file: "res://inc/common.gdshaderinc", line: 5, includedFrom: ["res://fx/uses.gdshader:2", "res://fx/uses2.gdshader:3"] }),
    ]);
    const fog = shaderDiagnostics(root, parseShaderLog(fixture("shared-include-fog.stderr.log")));
    const all = mergeDiagnostics([...render, ...fog]);
    expect(all).toHaveLength(1);
    expect(all[0]?.includedFrom).toEqual(["res://fx/uses.gdshader:2", "res://fx/uses2.gdshader:3", "res://fx/fogbad.gdshader:2"]);
    expect(asCheckDiagnostic(all[0]!).message).toBe(
      "Expected return with an expression of type 'float'. (included from res://fx/uses.gdshader:2, res://fx/uses2.gdshader:3, res://fx/fogbad.gdshader:2)",
    );
    // Merging does not change the lists it was given.
    expect(render[0]?.includedFrom).toHaveLength(2);
  });

  it("explain Godot's vague messages: a missing include, a missing ';', an unknown shader_type", () => {
    const root = makeProject(INCLUDES_PROJECT);
    expect(lines(shaderDiagnostics(root, parseShaderLog(fixture("includes-xvfb.log"))))).toEqual([
      "res://n_badtype.gdshader:1: Unknown shader_type 'spetial'. (use spatial, canvas_item, particles, sky, fog)",
      "res://l_missing_inc.gdshader:2: Tokenizer: Unknown character #35: '#' (the included file res://inc/nope.gdshaderinc does not exist)",
      "res://m_syntax.gdshader:4: Expected a ';'. (the ';' is probably missing at the end of line 3)",
      "res://a_one.gdshader:5: Unknown identifier in expression: 'bad_a'.",
      "res://d_two.gdshader:5: Unknown identifier in expression: 'bad_d'.",
      "res://e_nested.gdshader:4: Unknown identifier in expression: 'bad_e'.",
      "res://f_next.gdshader:3: Unknown identifier in expression: 'bad_f'.",
    ]);
  });
});

describe("shader results", () => {
  it("count a shader as compiled only once it was drawn when the run timed out", () => {
    // Real output of a run stopped by its timeout while it drew 20 shaders for 60 frames each.
    const log = parseShaderLog(fixture("timeout-xvfb.log"));
    expect(log.done).toBeUndefined();
    expect(log.parsed).toBe(20);
    const shaders = drawnShaders(log);
    const drawn = shaders.filter((s) => s.compiled === "gpu");
    expect(shaders).toHaveLength(20);
    expect(drawn.length).toBe(log.firstDrawMs.size);
    expect(drawn.every((s) => s.ok && s.firstDrawMs !== undefined)).toBe(true);
    expect(shaders.filter((s) => s.compiled === "none").map((s) => `${s.path} ${s.ok}`)).toEqual([
      "res://s5.gdshader false",
      "res://s6.gdshader false",
      "res://s7.gdshader false",
      "res://s8.gdshader false",
      "res://s9.gdshader false",
    ]);
    // A finished run counts every shader it found.
    expect(drawnShaders(parseShaderLog(fixture("render-xvfb.log"))).every((s) => s.compiled === "gpu")).toBe(true);
  });

  it("keep the fog shaders the render run found when the headless run did not finish", () => {
    const found = parseShaderLog(fixture("shared-include-xvfb.log")).shaders.filter((s) => s.mode === 4);
    expect(found.map((s) => s.path)).toEqual(["res://fx/fogbad.gdshader"]);
    const finished = parseShaderLog(fixture("shared-include-fog.stderr.log"));
    expect(parsedFogShaders(found, finished)).toEqual([{ path: "res://fx/fogbad.gdshader", type: "fog", visual: false, compiled: "parsed", ok: true }]);
    // Cut off before the runner's last line, as after a timeout.
    const cut = parseShaderLog(fixture("shared-include-fog.stderr.log").replace(/GODOTWRIGHT_SHADERS_DONE.*/, ""));
    expect(parsedFogShaders(found, cut)).toEqual([{ path: "res://fx/fogbad.gdshader", type: "fog", visual: false, compiled: "none", ok: false }]);
    expect(parsedFogShaders(found, parseShaderLog(""))[0]?.compiled).toBe("none");
  });
});

describe("Godot 3 shader hints", () => {
  it("name the Godot 4 replacement, checked in Godot 4.7.2", () => {
    expect(godot3Hint("Unknown identifier in expression: 'WORLD_MATRIX'.")).toBe("Godot 3 name; use MODEL_MATRIX");
    expect(godot3Hint("Unknown identifier in expression: 'CAMERA_MATRIX'.")).toBe("Godot 3 name; use INV_VIEW_MATRIX");
    expect(godot3Hint("Unknown identifier in expression: 'PROJECTION_MATRIX'.", { mode: 1 })).toMatch(/SCREEN_MATRIX/);
    expect(godot3Hint("Unknown identifier in expression: 'PROJECTION_MATRIX'.", { mode: 0 })).toBeUndefined();
    expect(godot3Hint("Expected valid type hint after ':'.", { line: "uniform vec4 tint : hint_color = vec4(1.0);" })).toBe("Godot 3 hint hint_color; use source_color");
    expect(godot3Hint("Expected valid type hint after ':'.", { line: "uniform sampler2D t : filter_linear, hint_black_albedo;" })).toBe("Godot 3 hint hint_black_albedo; use source_color, hint_default_black");
    expect(godot3Hint("Invalid render mode: 'depth_draw_alpha_prepass'.")).toBe("Godot 3 render mode; use depth_prepass_alpha");
    expect(godot3Hint("Unknown identifier in expression: 'VELOCITY'.", { mode: 2, source: "shader_type particles;\nvoid vertex() {\n\tVELOCITY = vec3(0.0);\n}\n" })).toMatch(/start\(\) and process\(\)/);
    expect(godot3Hint("DEPTH_TEXTURE has been removed in favor of using hint_depth_texture with a uniform.")).toMatch(/hint_depth_texture, filter_linear_mipmap;$/);
    expect(godot3Hint("Unknown identifier in expression: 'wobble'.")).toBeUndefined();
  });
});

describe("shader files", () => {
  it("finds .gdshader files and the .tres/.tscn files that hold a shader, outside addons", () => {
    const root = makeProject({ ...PROJECT, "addons/x/fx.gdshader": "shader_type spatial;\n", "level.tscn": '[gd_scene format=3]\n\n[sub_resource type="Shader" id="Shader_1"]\ncode = "shader_type spatial;\n"\n' });
    const found = findShaderFiles(root, ["addons"]);
    expect(found.sources).toContain("res://level.tscn");
    expect(found.sources).toContain("res://mat.tres");
    expect(found.sources).toContain("res://vs_bad.tres");
    expect(found.sources).not.toContain("res://notes.tres");
    expect(found.sources).not.toContain("res://addons/x/fx.gdshader");
    expect(found.includes).toEqual(["res://inc/common.gdshaderinc", "res://inc/good.gdshaderinc"]);
  });

  it("follows #include through other includes, also relative ones", () => {
    const root = makeProject({ ...INCLUDES_PROJECT, "fx/rel.gdshader": 'shader_type spatial;\n#include "../inc/nested.gdshaderinc"\n' });
    expect([...includedFiles(root, "res://e_nested.gdshader")]).toEqual(["res://inc/nested.gdshaderinc", "res://inc/one.gdshaderinc"]);
    expect([...includedFiles(root, "res://fx/rel.gdshader")]).toEqual(["res://inc/nested.gdshaderinc", "res://inc/one.gdshaderinc"]);
  });

  it("finds where an embedded shader's code starts, not fooled by '[' in code", () => {
    const text = '[gd_scene format=3]\n\n[sub_resource type="Shader" id="Shader_a"]\ncode = "shader_type spatial;\nuniform float k[2];\n[nope]\n"\n\n[sub_resource type="Shader" id="Shader_b"]\ncode = "shader_type canvas_item;\n"\n';
    expect(codeStartLine(text, "Shader_a")).toBe(4);
    expect(codeStartLine(text, "Shader_b")).toBe(10);
    expect(codeStartLine('[gd_resource type="Shader" format=3]\n\n[resource]\ncode = "shader_type sky;\n"\n')).toBe(4);
  });

  it("refuses files that are not shaders, and an include no shader uses, before Godot runs", async () => {
    const root = makeProject({ ...INCLUDES_PROJECT, "lonely.gdshaderinc": "float x() { return 1.0; }\n", "main.gd": "extends Node\n" });
    await expect(checkShaders(root, { files: ["main.gd"] })).rejects.toThrow(ShaderCheckError);
    await expect(checkShaders(root, { files: ["lonely.gdshaderinc"] })).rejects.toThrow(/no shader includes res:\/\/lonely\.gdshaderinc/);
    await expect(checkShaders(root, { files: ["missing.gdshader"] })).rejects.toThrow(/res:\/\/missing\.gdshader does not exist/);
    const cli = await runCli(["shaders", root, "--file", "missing.gdshader"]);
    expect(cli.exitCode).toBe(2);
  });
});

describe("shader runner", () => {
  it("fills in its settings", () => {
    const source = shaderRunnerSource({ files: ["res://a$1.gdshader"], exclude: ["res://addons"], allow: ["res://addons/x/a.gdshader"], render: false, fog: true, frames: 3 });
    expect(source).toContain('const FILES: Array[String] = ["res://a$1.gdshader"]');
    expect(source).toContain('const EXCLUDE: Array[String] = ["res://addons"]');
    expect(source).toContain('const ALLOW: Array[String] = ["res://addons/x/a.gdshader"]');
    expect(source).toContain("const RENDER: bool = false");
    expect(source).toContain("const FOG: bool = true");
    expect(source).toContain("const FRAMES: int = 3");
  });
});

describe("shader check output", () => {
  const result: ShaderCheckResult = {
    godot: "/bin/godot",
    godotVersion: "4.7.2.stable.official",
    renderer: "opengl3 gl_compatibility, llvmpipe (LLVM 20.1.2, 256 bits)",
    shaders: [
      { path: "res://fx/downwash.gdshader", type: "spatial", visual: false, compiled: "gpu", ok: false, firstDrawMs: 80 },
      { path: "res://fx/rotor.gdshader", type: "spatial", visual: false, compiled: "gpu", ok: true, firstDrawMs: 120 },
      { path: "res://fog.gdshader", type: "fog", visual: false, compiled: "parsed", ok: true },
    ],
    includes: ["res://inc/noise.gdshaderinc"],
    diagnostics: [
      { severity: "error", file: "res://fx/downwash.gdshader", line: 41, message: "SCREEN_TEXTURE has been removed in favor of using hint_screen_texture with a uniform.", hint: "Godot 3; use a uniform with hint_screen_texture", code: "vec4 c = texture(SCREEN_TEXTURE, SCREEN_UV);", source: "shader" },
    ],
    errors: 1,
    warnings: 0,
    notes: ["1 fog shader only parsed: fog shaders need Forward+ (Vulkan or Direct3D 12), which this check does not use"],
    complete: true,
    runs: [],
  };

  it("is one line per error with its code, a summary and a Next line", () => {
    expect(formatShaderCheck(result)).toBe(
      [
        "res://fx/downwash.gdshader:41: error: SCREEN_TEXTURE has been removed in favor of using hint_screen_texture with a uniform. (Godot 3; use a uniform with hint_screen_texture)",
        "    | vec4 c = texture(SCREEN_TEXTURE, SCREEN_UV);",
        "2 shaders compiled, 1 parsed only, 1 error, 1 include; renderer opengl3 gl_compatibility, llvmpipe (LLVM 20.1.2, 256 bits); Godot 4.7.2.stable.official",
        "1 fog shader only parsed: fog shaders need Forward+ (Vulkan or Direct3D 12), which this check does not use",
        "Next: fix each error at the line given (godot_api has the Godot 4 built-ins), then run this again; a shader with an error draws nothing in the game.",
        "",
      ].join("\n"),
    );
  });

  it("says the check stopped early, and how many shaders it did not reach", () => {
    const stopped: ShaderCheckResult = {
      ...result,
      renderer: "",
      shaders: [
        { path: "res://a.gdshader", type: "spatial", visual: false, compiled: "gpu", ok: true, firstDrawMs: 80 },
        { path: "res://b.gdshader", type: "spatial", visual: false, compiled: "none", ok: false },
        { path: "res://fog.gdshader", type: "fog", visual: false, compiled: "none", ok: false },
      ],
      includes: [],
      diagnostics: [{ severity: "error", message: "the shader check timed out after 1.5s", source: "shader" }],
      notes: [],
      complete: false,
    };
    const text = formatShaderCheck(stopped).split("\n");
    expect(text.slice(0, 3)).toEqual([
      "error: the shader check timed out after 1.5s",
      "1 shader compiled, 2 not reached, 1 error; renderer unknown; Godot 4.7.2.stable.official",
      "Next: the check stopped before it compiled every shader; run it again with a longer --timeout, or on fewer shaders with --file.",
    ]);
    expect(shaderSummary({ compiled: 1, parsed: 0, notReached: 2, errors: 1, renderer: "" })).toBe("shaders: 1 compiled, 2 not reached (the check stopped early), 1 error (renderer unknown)");
  });

  it("points at --include-addons when there was nothing to compile", () => {
    const empty: ShaderCheckResult = { ...result, shaders: [], includes: [], diagnostics: [], errors: 0, notes: [] };
    expect(formatShaderCheck(empty)).toMatch(/^Next: nothing to compile; shaders in res:\/\/addons are compiled only with --include-addons/m);
    const given: ShaderCheckResult = { ...empty, diagnostics: [{ severity: "warning", file: "res://empty.tscn", message: "no shader to compile in this file (shaders it uses from a skipped folder are left out)", source: "shader" }], warnings: 1 };
    expect(formatShaderCheck(given)).toMatch(/^Next: nothing to compile; pass a \.gdshader, a \.gdshaderinc, or a \.tres\/\.tscn that holds a Shader\.$/m);
  });
});
