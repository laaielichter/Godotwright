import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { GodotApi } from "../../src/api/api.js";
import { checkProject } from "../../src/check/check.js";
import { formatDiagnostic } from "../../src/check/log.js";
import { compileShaders, type ShaderToCompile } from "../../src/check/shader-compile.js";
import { migrateShader } from "../../src/migrate/shader.js";
import { formatFinding } from "../../src/review/format.js";
import { reviewProject } from "../../src/review/review.js";
import { formatShaderReport, shaderReport } from "../../src/shader/shader.js";
import { FIXTURES } from "../helpers.js";

/**
 * The shader tables, rules, migration and compile pass checked against a real Godot 4.7 binary in $GODOT (and the
 * official demo projects in $GODOT_DEMOS). Every claim the static review makes about Godot is compiled here.
 */
const GODOT = process.env["GODOT"];
const DEMOS = process.env["GODOT_DEMOS"];
const PROJECT = 'config_version=5\n\n[application]\nconfig/name="shaders"\nconfig/features=PackedStringArray("4.7")\n';

function project(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "godotwright-shader-"));
  for (const [path, content] of Object.entries({ "project.godot": PROJECT, ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

/** Compiles code snippets in one Godot run; the result per snippet is "ok" or Godot's first error. */
async function compileAll(codes: string[]): Promise<string[]> {
  const root = project();
  const items: ShaderToCompile[] = codes.map((code, i) => ({ path: `res://case_${i}.gdshader`, code }));
  const result = await compileShaders(root, items, { godot: GODOT, timeoutMs: 600_000 });
  expect(result.compiled).toBe(codes.length);
  return codes.map((_c, i) => result.diagnostics.find((d) => d.file === `res://case_${i}.gdshader` && d.severity === "error")?.message ?? "ok");
}

/** A statement that reads a built-in of a GLSL type, so the compiler must know the name. */
function readOf(name: string, type: string): string {
  const t = type.replace(/^const /, "");
  if (t === "sampler2D") return `vec4 _r = texture(${name}, vec2(0.0));`;
  if (t === "samplerCube") return `vec4 _r = texture(${name}, vec3(0.0));`;
  return `${t} _r = ${name};`;
}

const api = GodotApi.load();
const types = api.shaderTypes();
/** Scopes Godot calls: per type its processor functions; "global"/"constants" are checked inside the first of them. */
const mainsOf = (t: string) => Object.entries(api.shaderType(t)!.functions).filter(([, f]) => f.main).map(([f]) => f);
const signature = (t: string, fn: string) => `void ${fn}() {`;

describe.skipIf(!GODOT)("shader tables against Godot 4.7", () => {
  it("every built-in compiles where the table puts it, and is unknown in a processor function that lacks it", { timeout: 600_000 }, async () => {
    const cases: { label: string; code: string; ok: boolean }[] = [];
    for (const t of types) {
      const mains = mainsOf(t);
      const fns = api.shaderType(t)!.functions;
      for (const [scope, info] of Object.entries(fns)) {
        const at = info.main ? [scope] : mains;
        for (const [name, type] of Object.entries(info.builtins)) {
          for (const fn of at) cases.push({ label: `${t} ${fn} reads ${name}`, code: `shader_type ${t};\n${signature(t, fn)}\n\t${readOf(name, type)}\n}\n`, ok: true });
          if (info.main) {
            for (const other of mains.filter((m) => m !== scope && fns[m]!.builtins[name] === undefined)) {
              cases.push({ label: `${t} ${other} lacks ${name}`, code: `shader_type ${t};\n${signature(t, other)}\n\t${readOf(name, type)}\n}\n`, ok: false });
            }
          }
        }
      }
    }
    const results = await compileAll(cases.map((c) => c.code));
    const wrong = cases.map((c, i) => ({ ...c, got: results[i]! })).filter((c) => (c.got === "ok") !== c.ok).map((c) => `${c.label}: ${c.got}`);
    console.log(`${cases.length} built-in cases compiled`);
    expect(wrong).toEqual([]);
  });

  it("built-ins marked read-only cannot be written, the others can", { timeout: 600_000 }, async () => {
    const cases: { label: string; code: string; ok: boolean }[] = [];
    for (const t of types) {
      for (const [fn, info] of Object.entries(api.shaderType(t)!.functions)) {
        if (!info.main) continue;
        for (const [name, type] of Object.entries(info.builtins)) {
          if (/sampler/.test(type)) continue;
          const plain = type.replace(/^const /, "");
          cases.push({ label: `${t} ${fn} writes ${name}`, code: `shader_type ${t};\nvoid ${fn}() {\n\t${plain} _v = ${name};\n\t${name} = _v;\n}\n`, ok: !type.startsWith("const ") });
        }
      }
    }
    const results = await compileAll(cases.map((c) => c.code));
    const wrong = cases.map((c, i) => ({ ...c, got: results[i]! })).filter((c) => (c.got === "ok") !== c.ok).map((c) => `${c.label}: ${c.got}`);
    for (const [i, c] of cases.entries()) if (!c.ok) expect(results[i], c.label).toMatch(/Constants cannot be modified/);
    expect(wrong).toEqual([]);
  });

  it("every render and stencil mode in the table compiles; Godot 3 and unknown ones do not", { timeout: 300_000 }, async () => {
    const cases: { label: string; code: string; ok: boolean }[] = [];
    for (const t of types) {
      const fn = mainsOf(t)[0]!;
      for (const [mode, options] of Object.entries(api.shaderType(t)!.renderModes)) {
        for (const name of options.length ? options.map((o) => `${mode}_${o}`) : [mode]) {
          cases.push({ label: `${t} ${name}`, code: `shader_type ${t};\nrender_mode ${name};\nvoid ${fn}() {}\n`, ok: true });
        }
      }
    }
    for (const t of types) {
      const fn = mainsOf(t)[0]!;
      for (const [mode, options] of Object.entries(api.shaderType(t)!.stencilModes)) {
        for (const name of options.length ? options.map((o) => `${mode}_${o}`) : [mode]) {
          cases.push({ label: `${t} stencil ${name}`, code: `shader_type ${t};\nstencil_mode ${name}, 1;\nvoid ${fn}() {}\n`, ok: true });
        }
      }
    }
    cases.push({ label: "spatial stencil compare_none", code: "shader_type spatial;\nstencil_mode read, compare_none, 1;\nvoid fragment() {}\n", ok: false });
    for (const bad of ["depth_draw_alpha_prepass", "async_visible", "cull_none", "blend_screen"]) {
      cases.push({ label: `spatial ${bad}`, code: `shader_type spatial;\nrender_mode ${bad};\nvoid fragment() {}\n`, ok: false });
    }
    const results = await compileAll(cases.map((c) => c.code));
    const wrong = cases.map((c, i) => ({ ...c, got: results[i]! })).filter((c) => (c.got === "ok") !== c.ok).map((c) => `${c.label}: ${c.got}`);
    expect(wrong).toEqual([]);
  });

  it("every Godot 3 name in the rename table fails, and its Godot 4 name compiles", { timeout: 300_000 }, async () => {
    const shaderOf = (name: string): string | undefined => {
      if (name.startsWith("hint_") || name === "source_color") return `shader_type spatial;\nuniform sampler2D t : ${name};\nvoid fragment() { ALBEDO = texture(t, UV).rgb; }\n`;
      if (name === "depth_draw_alpha_prepass" || name === "depth_prepass_alpha") return `shader_type spatial;\nrender_mode ${name};\nvoid fragment() {}\n`;
      if (/MATRIX/.test(name)) return `shader_type spatial;\nvoid vertex() { mat4 m = ${name}; }\n`;
      if (/^(NORMALMAP|NORMAL_MAP|TRANSMISSION|BACKLIGHT)$/.test(name)) return `shader_type spatial;\nvoid fragment() { ${name} = vec3(0.5); }\n`;
      if (/^(NORMALMAP_DEPTH|NORMAL_MAP_DEPTH|ALPHA_SCISSOR|ALPHA_SCISSOR_THRESHOLD)$/.test(name)) return `shader_type spatial;\nvoid fragment() { ${name} = 0.5; }\n`;
      return undefined;
    };
    const cases: { label: string; code: string; ok: boolean }[] = [];
    for (const [from, to] of Object.entries(api.data.renames.shaders ?? {})) {
      const old = shaderOf(from);
      const replaced = shaderOf(to.split(",")[0]!.trim());
      expect(old, `no test shader for ${from}`).toBeDefined();
      expect(replaced, `no test shader for ${to}`).toBeDefined();
      cases.push({ label: from, code: old!, ok: false }, { label: to, code: replaced!, ok: true });
    }
    // Names Godot 4 removed without a one-to-one rename, and the hint the review uses for hint_black_albedo.
    cases.push(
      { label: "CLEARCOAT_GLOSS", code: "shader_type spatial;\nvoid fragment() { CLEARCOAT_GLOSS = 1.0; }\n", ok: false },
      { label: "CLEARCOAT_ROUGHNESS", code: "shader_type spatial;\nvoid fragment() { CLEARCOAT_ROUGHNESS = 0.0; }\n", ok: true },
      { label: "EXTRA_MATRIX", code: "shader_type canvas_item;\nvoid vertex() { mat4 m = EXTRA_MATRIX; }\n", ok: false },
      { label: "source_color, hint_default_black", code: "shader_type spatial;\nuniform sampler2D t : source_color, hint_default_black;\nvoid fragment() { ALBEDO = texture(t, UV).rgb; }\n", ok: true },
      { label: "SCREEN_TEXTURE", code: "shader_type canvas_item;\nvoid fragment() { COLOR = texture(SCREEN_TEXTURE, SCREEN_UV); }\n", ok: false },
      { label: "DEPTH_TEXTURE", code: "shader_type spatial;\nvoid fragment() { ALBEDO = vec3(texture(DEPTH_TEXTURE, SCREEN_UV).r); }\n", ok: false },
      { label: "NORMAL_ROUGHNESS_TEXTURE", code: "shader_type spatial;\nvoid fragment() { ALBEDO = texture(NORMAL_ROUGHNESS_TEXTURE, SCREEN_UV).rgb; }\n", ok: false },
      { label: "particles vertex()", code: "shader_type particles;\nvoid vertex() { VELOCITY = vec3(1.0); }\n", ok: false },
    );
    const results = await compileAll(cases.map((c) => c.code));
    const wrong = cases.map((c, i) => ({ ...c, got: results[i]! })).filter((c) => (c.got === "ok") !== c.ok).map((c) => `${c.label}: ${c.got}`);
    expect(wrong).toEqual([]);
  });
});

describe.skipIf(!GODOT)("shader review findings against Godot 4.7", () => {
  /** Each case: shader code, the rules the review reports, and whether Godot compiles it. Errors must match. */
  const CASES: { code: string; rules: string[] }[] = [
    { code: "shader_type spatial;\nvoid fragment() {\n\tCOLOR = vec4(1.0);\n}\n", rules: ["api/shader-read-only-builtin"] },
    { code: "shader_type spatial;\nvoid vertex() {\n\tCOLOR = vec4(1.0);\n}\n", rules: [] },
    { code: "shader_type spatial;\nvoid fragment() {\n\tVERTEX = vec3(0.0);\n}\n", rules: ["api/shader-read-only-builtin"] },
    { code: "shader_type canvas_item;\nvoid fragment() {\n\tALBEDO = vec3(1.0);\n}\n", rules: ["api/shader-builtin-misplaced"] },
    { code: "shader_type spatial;\nvoid light() {\n\tDIFFUSE_LIGHT += COLOR.rgb;\n}\n", rules: ["api/shader-builtin-misplaced"] },
    { code: "shader_type spatial;\nvec2 h() {\n\treturn UV * TIME;\n}\nvoid fragment() {\n\tALBEDO = vec3(h(), 0.0);\n}\n", rules: ["api/shader-builtin-misplaced"] },
    { code: "shader_type spatial;\nfloat h() {\n\treturn TIME * PI;\n}\nvoid fragment() {\n\tALBEDO = vec3(h());\n}\n", rules: [] },
    { code: "shader_type spatial;\nvoid vertex() {\n\tdiscard;\n}\n", rules: ["api/shader-builtin-misplaced"] },
    { code: "shader_type canvas_item;\nvoid vertex() {\n\tVERTEX.x += texture_sdf(VERTEX);\n}\n", rules: ["api/shader-builtin-misplaced"] },
    { code: "shader_type canvas_item;\nvoid fragment() {\n\tCOLOR.a = texture_sdf(screen_uv_to_sdf(SCREEN_UV));\n}\n", rules: [] },
    { code: "shader_type spatial;\nrender_mode blend_mix, async_visible;\nvoid fragment() {}\n", rules: ["api/shader-render-mode"] },
    { code: "shader_type particle;\nvoid process() {}\n", rules: ["api/shader-type"] },
    { code: "void fragment() {}\n", rules: ["api/shader-type"] },
    {
      code: "shader_type canvas_item;\nuniform vec4 MODULATE_COLOR : source_color;\n#define EMISSION vec3(0.0)\nvoid fragment() {\n\tvec3 ALBEDO = vec3(1.0);\n\tCOLOR = vec4(ALBEDO + EMISSION, 1.0) * MODULATE_COLOR;\n\tCOLOR.rgb *= vec3(TIME * PI);\n\tif (AT_LIGHT_PASS) { discard; }\n}\n",
      rules: [],
    },
    { code: "shader_type spatial;\nstruct S { vec3 NORMALMAP; };\nvoid fragment() {\n\tS s;\n\tfloat hint_white = 1.0;\n\tALBEDO = s.NORMALMAP * hint_white;\n}\n", rules: [] },
    { code: "shader_type spatial;\nuniform vec4 tint : hint_color;\nvoid fragment() {\n\tALBEDO = tint.rgb;\n}\n", rules: ["api/shader-renamed"] },
    { code: "shader_type spatial;\nvoid fragment() {\n\tALBEDO = texture(SCREEN_TEXTURE, SCREEN_UV).rgb;\n}\n", rules: ["api/shader-removed-builtin"] },
    // Warnings and hints are about code that compiles.
    { code: "shader_type spatial;\nuniform vec4 albedo_color = vec4(1.0);\nvoid fragment() {\n\tALBEDO = albedo_color.rgb;\n}\n", rules: ["quality/shader-color-no-source-color"] },
    { code: "shader_type spatial;\nvoid fragment() {\n\tif (UV.x > 0.5) { discard; }\n\tALBEDO = vec3(1.0);\n}\n", rules: ["performance/shader-discard"] },
  ];

  it("reports an error exactly when Godot does not compile the shader", { timeout: 300_000 }, async () => {
    const results = await compileAll(CASES.map((c) => c.code));
    const mismatches: string[] = [];
    for (const [i, c] of CASES.entries()) {
      const root = project({ "s.gdshader": c.code });
      const findings = reviewProject(root).findings.filter((f) => /shader/.test(f.rule));
      expect(findings.map((f) => f.rule).sort(), c.code).toEqual([...c.rules].sort());
      const errors = findings.filter((f) => f.severity === "error");
      if ((errors.length > 0) !== (results[i] !== "ok")) mismatches.push(`${c.code.split("\n").join(" | ")} -> review ${errors.map(formatFinding).join("; ") || "clean"}, Godot ${results[i]}`);
    }
    expect(mismatches).toEqual([]);
  });

  it("migrated Godot 3 shaders compile", { timeout: 300_000 }, async () => {
    const godot3 = [
      "shader_type spatial;\nrender_mode depth_draw_alpha_prepass, cull_disabled;\nuniform vec4 tint : hint_color = vec4(1.0);\nuniform sampler2D tex : hint_albedo;\nuniform sampler2D dark : hint_black_albedo;\nuniform sampler2D aniso : hint_aniso;\n#define WORLD_POS (WORLD_MATRIX * vec4(VERTEX, 1.0)).xyz\nvoid vertex() {\n\tvec3 p = WORLD_POS;\n\tVERTEX = (inverse(WORLD_MATRIX) * vec4(p, 1.0)).xyz;\n}\nvoid fragment() {\n\tALBEDO = tint.rgb * texture(tex, UV).rgb + texture(SCREEN_TEXTURE, SCREEN_UV).rgb * texture(DEPTH_TEXTURE, SCREEN_UV).r + texture(dark, UV).rgb;\n\tNORMALMAP = vec3(0.5);\n\tNORMALMAP_DEPTH = 1.0;\n\tTRANSMISSION = vec3(0.1);\n\tALPHA_SCISSOR = 0.5;\n\tALBEDO += (CAMERA_MATRIX * INV_CAMERA_MATRIX)[0].xyz;\n}\n",
      "shader_type canvas_item;\nvoid fragment() {\n\tCOLOR = texture(SCREEN_TEXTURE, SCREEN_UV);\n}\n",
      "shader_type spatial; render_mode unshaded,\r\n\tcull_disabled;\r\nvoid fragment() { ALBEDO = texture(SCREEN_TEXTURE, SCREEN_UV).rgb; }\r\n",
    ];
    const before = await compileAll(godot3);
    expect(before.every((r) => r !== "ok")).toBe(true);
    const migrated = godot3.map((s) => migrateShader(s));
    for (const m of migrated) expect(m.left).toEqual([]);
    expect(await compileAll(migrated.map((m) => m.code))).toEqual(migrated.map(() => "ok"));
    // Running it again changes nothing.
    for (const m of migrated) expect(migrateShader(m.code).changes).toEqual([]);
  });
});

describe.skipIf(!GODOT)("godot_shader and godot_check compile with real Godot", () => {
  const files = {
    "fx/lib.gdshaderinc": "// helpers\nfloat f(float x) {\n\treturn x * 2.0;\n}\n",
    "fx/broken_lib.gdshaderinc": "float g(float x) {\n\treturn x * undefined_thing;\n}\n",
    "fx/ok.gdshader": 'shader_type canvas_item;\n#include "lib.gdshaderinc"\nvoid fragment() {\n\tCOLOR = vec4(f(0.25));\n}\n',
    "fx/uses_broken.gdshader": 'shader_type canvas_item;\n#include "broken_lib.gdshaderinc"\nvoid fragment() {\n\tCOLOR = vec4(g(1.0));\n}\n',
    "fx/args.gdshader": "shader_type spatial;\n\nvoid fragment() {\n\tALBEDO = vec3(1.0, 0.0);\n}\n",
    "fx/notype.gdshader": "void fragment() {\n}\n",
    "level.tscn":
      '[gd_scene format=3]\n\n[sub_resource type="Shader" id="Shader_a1"]\ncode = "shader_type canvas_item;\n#include \\"fx/lib.gdshaderinc\\"\nvoid fragment() {\n\tCOLOR = vec4(f(1.0), 0.0);\n}\n"\n\n[sub_resource type="ShaderMaterial" id="M"]\nshader = SubResource("Shader_a1")\n\n[node name="R" type="ColorRect"]\nmaterial = SubResource("M")\n',
  };

  it("reports Godot's errors with file:line: shader files, includes, Shaders in scenes and a missing shader_type", { timeout: 300_000 }, async () => {
    const root = project(files);
    const report = await shaderReport(root, { godot: GODOT, compile: true });
    const text = formatShaderReport(report, "full");
    console.log(text);
    expect(report.compile?.compiled).toBe(5);
    const godot = report.compile!.diagnostics.map(formatDiagnostic);
    expect(godot).toContain("res://fx/args.gdshader:4: error: Invalid arguments for the built-in function: \"vec3(float,float)\".");
    expect(godot).toContain("res://fx/broken_lib.gdshaderinc:2: error: Unknown identifier in expression: 'undefined_thing'.");
    // Line 4 of the scene's Shader code is line 7 of level.tscn.
    expect(godot).toContain('res://level.tscn::Shader_a1:7: error: Invalid arguments for the built-in function: "vec4(float,float)".');
    expect(godot).toContain("res://fx/notype.gdshader: error: No shader_type: start the shader with shader_type spatial, canvas_item, particles, sky, fog or texture_blit.");
    expect(godot.some((l) => l.includes("Shader compilation failed"))).toBe(false);
    expect(godot.some((l) => l.startsWith("res://fx/ok.gdshader"))).toBe(false);
    // The static review names the missing shader_type once; Godot's line for it adds nothing.
    expect(text).toContain("[api/shader-type]");
    expect(report.errors).toBe(4);
  });

  it("compiles unsaved code with relative includes, and the shaders that use a selected include", { timeout: 300_000 }, async () => {
    const root = project(files);
    const unsaved = await shaderReport(root, { godot: GODOT, compile: true, files: ["res://fx/ok.gdshader"], overrides: { "res://fx/ok.gdshader": 'shader_type canvas_item;\n#include "lib.gdshaderinc"\nvoid fragment() {\n\tCOLOR = f(1.0);\n}\n' } });
    expect(unsaved.compile!.diagnostics.map(formatDiagnostic)).toEqual(["res://fx/ok.gdshader:4: error: Invalid arguments to operator '=': 'vec4, float'."]);
    const viaInclude = await shaderReport(root, { godot: GODOT, compile: true, files: ["res://fx/broken_lib.gdshaderinc"] });
    expect(viaInclude.compile?.compiled).toBe(1);
    expect(viaInclude.compile!.diagnostics.map(formatDiagnostic)).toEqual(["res://fx/broken_lib.gdshaderinc:2: error: Unknown identifier in expression: 'undefined_thing'."]);
  });

  it("godot_check compiles shaders no scene uses, with file:line", { timeout: 300_000 }, async () => {
    const root = project({ "scr.gdshader": "shader_type canvas_item;\n\nvoid fragment() {\n\tCOLOR = texture(SCREEN_TEXTURE, SCREEN_UV);\n}\n" });
    const result = await checkProject(root, { godot: GODOT });
    expect(result.shaderFiles).toBe(1);
    const errors = result.diagnostics.filter((d) => d.severity === "error").map(formatDiagnostic);
    expect(errors).toEqual([
      "res://scr.gdshader:4: error: SCREEN_TEXTURE has been removed in favor of using hint_screen_texture with a uniform. To continue with minimal code changes add 'uniform sampler2D SCREEN_TEXTURE : hint_screen_texture, filter_linear_mipmap;' near the top of your shader.",
    ]);
  });

  it("keeps the demo fixture clean", { timeout: 300_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "godotwright-shader-demo-"));
    cpSync(join(FIXTURES, "demo"), root, { recursive: true });
    const report = await shaderReport(root, { godot: GODOT, compile: true });
    expect(report.compile?.compiled).toBe(1);
    expect(report.errors + report.warnings).toBe(0);
  });
});

/** Every project folder under the demos checkout. */
function demoProjects(dir: string, depth = 0): string[] {
  if (existsSync(join(dir, "project.godot"))) return [dir];
  if (depth > 3) return [];
  return readdirSync(dir)
    .filter((n) => !n.startsWith(".") && statSync(join(dir, n)).isDirectory())
    .flatMap((n) => demoProjects(join(dir, n), depth + 1));
}

describe.skipIf(!GODOT || !DEMOS)("godot_shader on every official demo project", () => {
  it("compiles every demo shader without an error, and the review reports no shader error", { timeout: 1_800_000 }, async () => {
    // CI checks out only some demo folders (a sparse checkout), so the count follows the folders that are there: every
    // shader of every project that has one must compile, not a fixed total.
    let compiled = 0;
    const problems: string[] = [];
    const counts: string[] = [];
    for (const dir of demoProjects(DEMOS!)) {
      const report = await shaderReport(dir, { godot: GODOT, compile: undefined, includeAddons: false });
      if (report.shaders.length === 0) continue;
      const rel = dir.slice(DEMOS!.length + 1);
      const expected = report.shaders.filter((s) => !s.include).length;
      const got = report.compile?.compiled ?? 0;
      compiled += got;
      counts.push(`${rel} ${got}/${expected}`);
      if (got !== expected) problems.push(`${rel}: Godot compiled ${got} of ${expected} shaders${report.compileSkipped ? ` (${report.compileSkipped})` : ""}`);
      for (const d of report.compile?.diagnostics ?? []) if (d.severity === "error") problems.push(`${rel}: godot ${formatDiagnostic(d)}`);
      for (const f of report.findings) if (f.severity === "error") problems.push(`${rel}: review ${formatFinding(f)}`);
    }
    console.log(`${compiled} demo shaders compiled: ${counts.join(", ")}`);
    expect(counts.length).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

});

/** A display, or xvfb-run, for the GPU pass. */
const SCREEN = process.platform !== "linux" || Boolean(process.env["DISPLAY"]) || spawnSync("which", ["xvfb-run"]).status === 0;

describe.skipIf(!GODOT || !SCREEN)("godot_shader gpu: the headless compile and the GPU pass together", () => {
  it("finds the language errors headless, and the GPU pass adds only what the driver rejects", { timeout: 600_000 }, async () => {
    const root = project({
      "fx/spatial_bad.gdshader": "shader_type spatial;\nvoid fragment() {\n\tfloat x = vec3(1.0);\n\tALBEDO = vec3(x);\n}\n",
      "fx/sky_bad.gdshader": "shader_type sky;\nvoid sky() {\n\tCOLOR = vec2(1.0);\n}\n",
      "fx/big.gdshader": "shader_type spatial;\nuniform float big[200000];\nvoid fragment() {\n\tALBEDO = vec3(big[int(UV.x * 10.0)]);\n}\n",
      "fx/samplers.gdshader": "shader_type canvas_item;\nuniform sampler2D t[64];\nvoid fragment() {\n\tvec4 c = vec4(0.0);\n\tfor (int i = 0; i < 64; i++) { c += texture(t[i], UV); }\n\tCOLOR = c;\n}\n",
    });
    const headless = await shaderReport(root, { godot: GODOT });
    const lines = (r: typeof headless) => formatShaderReport(r).split("\n").filter((l) => / error \[/.test(l));
    expect(lines(headless)).toEqual([
      "res://fx/sky_bad.gdshader:3: error [godot] Invalid arguments to operator '=': 'vec3, vec2'.",
      "res://fx/spatial_bad.gdshader:3: error [godot] Invalid assignment of 'vec3' to 'float'.",
    ]);
    const gpu = await shaderReport(root, { godot: GODOT, gpu: true });
    console.log(formatShaderReport(gpu));
    const found = lines(gpu);
    // The language errors once (the GPU pass finds them again at the same line), and the two only a driver rejects.
    expect(found.filter((l) => l.includes("[godot]"))).toEqual(lines(headless));
    expect(found.filter((l) => l.includes("[gpu]")).map((l) => l.slice(0, l.indexOf(" error")))).toEqual(["res://fx/big.gdshader:", "res://fx/samplers.gdshader:"]);
    expect(gpu.errors).toBe(4);
    expect(formatShaderReport(gpu)).toMatch(/drew \d+ on the GPU \(opengl3 gl_compatibility/);
  });
  it("puts each language error at its line once, per shader type, in an include and in a scene, with the GPU pass on", { timeout: 600_000 }, async () => {
    const root = project({
      "fx/spatial.gdshader": "shader_type spatial;\nvoid fragment() {\n\tfloat a = vec3(1.0).x + vec2(1.0);\n\tALBEDO = vec3(a);\n}\n",
      "fx/canvas.gdshader": "shader_type canvas_item;\n\nvoid fragment() {\n\tCOLOR = vec3(1.0);\n}\n",
      "fx/particles.gdshader": "shader_type particles;\nvoid process() {\n\tVELOCITY = vec2(1.0);\n}\n",
      "fx/sky.gdshader": "shader_type sky;\n\n\nvoid sky() {\n\tCOLOR = vec2(1.0);\n}\n",
      "fx/fog.gdshader": "shader_type fog;\nvoid fog() {\n\tDENSITY = vec2(1.0);\n}\n",
      "inc/lib.gdshaderinc": "float ok_fn() {\n\treturn 1.0;\n}\nfloat bad_fn() {\n\treturn vec3(1.0);\n}\n",
      "fx/uses_inc.gdshader": 'shader_type spatial;\n#include "res://inc/lib.gdshaderinc"\nvoid fragment() {\n\tALBEDO = vec3(ok_fn());\n}\n',
      "level.tscn":
        '[gd_scene format=3]\n\n[sub_resource type="Shader" id="Shader_e1"]\ncode = "shader_type canvas_item;\n\nvoid fragment() {\n\tCOLOR = vec2(0.0);\n}\n"\n\n[sub_resource type="ShaderMaterial" id="M"]\nshader = SubResource("Shader_e1")\n\n[node name="R" type="ColorRect"]\nmaterial = SubResource("M")\n',
    });
    const errorsOf = (text: string) => text.split("\n").filter((l) => / error \[/.test(l)).map((l) => l.slice(0, l.indexOf(" error")));
    const gpu = await shaderReport(root, { godot: GODOT, gpu: true });
    const text = formatShaderReport(gpu);
    console.log(text);
    // Line 4 of the scene's Shader code is line 7 of level.tscn; the include's error is named at the include.
    const expected = [
      "res://fx/canvas.gdshader:4:",
      "res://fx/fog.gdshader:3:",
      "res://fx/particles.gdshader:3:",
      "res://fx/sky.gdshader:5:",
      "res://fx/spatial.gdshader:3:",
      "res://inc/lib.gdshaderinc:5:",
      "res://level.tscn::Shader_e1:7:",
    ];
    expect(errorsOf(text)).toEqual(expected);
    expect(text).not.toContain("error [gpu]");
    expect(gpu.errors).toBe(7);
    expect(text).toMatch(/drew \d+ on the GPU/);
    // godot_check with shaders: the headless compile and the GPU pass, each error once.
    const check = await checkProject(root, { godot: GODOT, shaders: true });
    const at = check.diagnostics.filter((d) => d.source === "shader" && d.severity === "error").map((d) => `${d.file}:${d.line}:`).sort();
    // godot_check names the scene file itself, at the same line.
    expect(at).toEqual(expected.map((e) => e.replace("::Shader_e1", "")));
  });
});
