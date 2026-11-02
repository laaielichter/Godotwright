import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanup } from "../src/check/check.js";
import { doctorProject, formatDoctor } from "../src/doctor/doctor.js";
import { CHECKER_SCRIPT } from "../src/check/checker-script.js";
import { formatDiagnostic, parseGodotLog } from "../src/check/log.js";
import { fixProject } from "../src/fix/fix.js";
import { createServer } from "../src/mcp/server.js";
import { migrateProject } from "../src/migrate/migrate.js";
import { migrateShader } from "../src/migrate/shader.js";
import { formatShaderReport, shaderReport } from "../src/shader/shader.js";
import { makeProject, runCli } from "./helpers.js";

const PROJECT = '[application]\nconfig/name="Shaders"\nconfig/features=PackedStringArray("4.7")\n';

const GODOT3 = [
  "shader_type spatial;",
  "render_mode depth_draw_alpha_prepass, cull_disabled;",
  "// hint_color and SCREEN_TEXTURE stay in comments",
  "uniform vec4 tint : hint_color = vec4(1.0);",
  "uniform sampler2D tex : hint_albedo;",
  "#define WORLD_POS (WORLD_MATRIX * vec4(VERTEX, 1.0)).xyz",
  "void vertex() {",
  "\tVERTEX = (inverse(WORLD_MATRIX) * vec4(WORLD_POS, 1.0)).xyz;",
  "}",
  "void fragment() {",
  "\tALBEDO = tint.rgb * texture(tex, UV).rgb + texture(SCREEN_TEXTURE, SCREEN_UV).rgb;",
  "\tNORMALMAP = vec3(0.5);",
  "\tCLEARCOAT_GLOSS = 0.5;",
  "}",
  "",
].join("\n");

describe("Godot's shader errors (verbatim 4.7.2 output)", () => {
  // From `godot --headless --script` compiling shaders with get_rid(); see test/integration/shader-godot.test.ts.
  const log = [
    "GODOTWRIGHT_SHADER res://a_screen.gdshader",
    "--Main Shader--",
    "    2 | ",
    "    3 | void fragment() {",
    "E   4->  COLOR = texture(SCREEN_TEXTURE, SCREEN_UV);",
    "    5 | }",
    "SHADER ERROR: SCREEN_TEXTURE has been removed in favor of using hint_screen_texture with a uniform.",
    "To continue with minimal code changes add 'uniform sampler2D SCREEN_TEXTURE : hint_screen_texture, filter_linear_mipmap;' near the top of your shader.",
    "          at: (null) (:4)",
    "          GDScript backtrace (most recent call first):",
    "              [0] _initialize (res://.godot/godotwright/check.gd:6)",
    "ERROR: Shader compilation failed.",
    "   at: shader_set_code (servers/rendering/dummy/storage/material_storage.cpp:192)",
    "   GDScript backtrace (most recent call first):",
    "       [0] _initialize (res://.godot/godotwright/check.gd:6)",
    "GODOTWRIGHT_END res://a_screen.gdshader",
    "GODOTWRIGHT_SHADER res://c.gdshader",
    "--Main Shader--",
    "    1 | shader_type spatial;",
    'E   2-> #include "res://sub/lib.gdshaderinc"',
    "--res://sub/lib.gdshaderinc--",
    "    2 | float f(float x) {",
    "E   3->  return x * undefined_thing;",
    "SHADER ERROR: Unknown identifier in expression: 'undefined_thing'.",
    "          at: (null) (res://sub/lib.gdshaderinc:3)",
    "ERROR: Shader compilation failed.",
    "   at: shader_set_code (servers/rendering/dummy/storage/material_storage.cpp:192)",
    "GODOTWRIGHT_END res://c.gdshader",
    "GODOTWRIGHT_SHADER res://notype.gdshader",
    "ERROR: Shader type  not supported in Dummy renderer.",
    "   at: shader_set_code (servers/rendering/dummy/storage/material_storage.cpp:183)",
    "GODOTWRIGHT_END res://notype.gdshader",
    "GODOTWRIGHT_BEGIN res://level.tscn",
    "--Main Shader--",
    "E   3->  ALBEDO = vec3(1.0, 0.0);",
    'SHADER ERROR: Invalid arguments for the built-in function: "vec3(float,float)".',
    "          at: (null) (:3)",
    "ERROR: Shader compilation failed.",
    "   at: shader_set_code (servers/rendering/dummy/storage/material_storage.cpp:192)",
    "GODOTWRIGHT_END res://level.tscn",
    "GODOTWRIGHT_DONE 0 1 3",
  ].join("\n");

  it("gives each shader error its file:line and drops the echo and the follow-up", () => {
    expect(cleanup(parseGodotLog(log, "check")).map(formatDiagnostic)).toEqual([
      "res://a_screen.gdshader:4: error: SCREEN_TEXTURE has been removed in favor of using hint_screen_texture with a uniform. To continue with minimal code changes add 'uniform sampler2D SCREEN_TEXTURE : hint_screen_texture, filter_linear_mipmap;' near the top of your shader.",
      "res://sub/lib.gdshaderinc:3: error: Unknown identifier in expression: 'undefined_thing'.",
      "res://notype.gdshader: error: No shader_type: start the shader with shader_type spatial, canvas_item, particles, sky, fog or texture_blit.",
      // A Shader stored in a scene: the line is the shader's own, so it stays in the message.
      'res://level.tscn: error: Invalid arguments for the built-in function: "vec3(float,float)". (shader line 3)',
    ]);
  });

  it("reports a shader a scene uses once, with its own file:line", () => {
    const error = [
      "SHADER ERROR: SCREEN_TEXTURE has been removed in favor of using hint_screen_texture with a uniform.",
      "To continue with minimal code changes add 'uniform sampler2D SCREEN_TEXTURE : hint_screen_texture, filter_linear_mipmap;' near the top of your shader.",
      "          at: (null) (:4)",
      "ERROR: Shader compilation failed.",
      "   at: shader_set_code (servers/rendering/dummy/storage/material_storage.cpp:192)",
    ];
    const importLog = error.join("\n");
    const checkLog = ["GODOTWRIGHT_BEGIN res://main.tscn", ...error, "GODOTWRIGHT_END res://main.tscn", "GODOTWRIGHT_SHADER res://broken.gdshader", ...error, "GODOTWRIGHT_END res://broken.gdshader"].join("\n");
    const all = cleanup([...parseGodotLog(importLog, "import"), ...parseGodotLog(checkLog, "check")]);
    expect(all.map((d) => `${d.file}:${d.line}`)).toEqual(["res://broken.gdshader:4"]);
  });

  it("names the usual cause of the preprocessor's '#' error", () => {
    const missing = "GODOTWRIGHT_SHADER res://b.gdshader\nSHADER ERROR: Tokenizer: Unknown character #35: '#'\n          at: (null) (:2)\nGODOTWRIGHT_END res://b.gdshader\n";
    expect(cleanup(parseGodotLog(missing, "check")).map(formatDiagnostic)).toEqual([
      "res://b.gdshader:2: error: Tokenizer: Unknown character #35: '#' (the shader preprocessor failed, most often on an #include of a file that does not exist; godot_review names it)",
    ]);
  });

  it("the checker compiles every .gdshader after loading the scenes", () => {
    expect(CHECKER_SCRIPT).toContain('elif ext == "gdshader":');
    expect(CHECKER_SCRIPT).toContain("shader.get_rid()");
    expect(CHECKER_SCRIPT).toContain('MARKER + "_SHADER "');
  });
});

describe("migrate shaders", () => {
  it("rewrites Godot's shader renames, adds the removed textures' uniforms and lists the rest", () => {
    const m = migrateShader(GODOT3);
    expect(m.code.split("\n")).toEqual([
      "shader_type spatial;",
      "render_mode depth_prepass_alpha, cull_disabled;",
      "uniform sampler2D SCREEN_TEXTURE : hint_screen_texture, filter_linear_mipmap;",
      "// hint_color and SCREEN_TEXTURE stay in comments",
      "uniform vec4 tint : source_color = vec4(1.0);",
      "uniform sampler2D tex : source_color;",
      "#define WORLD_POS (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz",
      "void vertex() {",
      "\tVERTEX = (inverse(MODEL_MATRIX) * vec4(WORLD_POS, 1.0)).xyz;",
      "}",
      "void fragment() {",
      "\tALBEDO = tint.rgb * texture(tex, UV).rgb + texture(SCREEN_TEXTURE, SCREEN_UV).rgb;",
      "\tNORMAL_MAP = vec3(0.5);",
      "\tCLEARCOAT_GLOSS = 0.5;",
      "}",
      "",
    ]);
    expect(m.changes.map((c) => `${c.line} ${c.rule}`)).toEqual([
      "2 api/shader-renamed",
      "3 api/shader-removed-builtin",
      "5 api/shader-renamed",
      "6 api/shader-renamed",
      "7 api/shader-renamed",
      "9 api/shader-renamed",
      "13 api/shader-renamed",
    ]);
    expect(m.left).toEqual([{ line: 14, message: "CLEARCOAT_GLOSS: Godot 4 has CLEARCOAT_ROUGHNESS instead, which is 1.0 - gloss" }]);
    expect(migrateShader(m.code).changes).toEqual([]);
  });

  it("adds the texture uniform after a render_mode that shares the shader_type line and spans lines, keeping CRLF", () => {
    const code = "shader_type spatial; render_mode unshaded,\r\n\tcull_disabled;\r\nvoid fragment() { ALBEDO = texture(SCREEN_TEXTURE, SCREEN_UV).rgb + vec3(texture(DEPTH_TEXTURE, SCREEN_UV).r); }\r\n";
    const m = migrateShader(code);
    expect(m.code).toBe(
      "shader_type spatial; render_mode unshaded,\r\n\tcull_disabled;\r\n" +
        "uniform sampler2D SCREEN_TEXTURE : hint_screen_texture, filter_linear_mipmap;\r\n" +
        "uniform sampler2D DEPTH_TEXTURE : hint_depth_texture, filter_linear_mipmap;\r\n" +
        "void fragment() { ALBEDO = texture(SCREEN_TEXTURE, SCREEN_UV).rgb + vec3(texture(DEPTH_TEXTURE, SCREEN_UV).r); }\r\n",
    );
    expect(m.changes.map((c) => `${c.line} ${c.rule} ${c.to}`)).toEqual([
      "3 api/shader-removed-builtin uniform sampler2D SCREEN_TEXTURE : hint_screen_texture, filter_linear_mipmap;",
      "4 api/shader-removed-builtin uniform sampler2D DEPTH_TEXTURE : hint_depth_texture, filter_linear_mipmap;",
    ]);
    expect(migrateShader(m.code).changes).toEqual([]);
  });

  it("lists particle vertex() and COLOR written in a spatial fragment() as work by hand", () => {
    expect(migrateShader("shader_type particles;\nvoid vertex() {\n\tVELOCITY = vec3(1.0);\n}\n").left[0]?.message).toMatch(/move its code to start\(\)/);
    expect(migrateShader("shader_type spatial;\nvoid fragment() {\n\tCOLOR = vec4(1.0);\n}\n").left).toEqual([{ line: 3, message: "COLOR is read-only in a spatial fragment() in Godot 4: write ALBEDO (and ALPHA)" }]);
    expect(migrateShader("shader_type spatial;\nvoid vertex() {\n\tCOLOR = vec4(1.0);\n}\n").left).toEqual([]);
  });

  it("migrates .gdshader and .gdshaderinc files of a project together with scripts", () => {
    const root = makeProject({ "project.godot": PROJECT, "fx/water.gdshader": GODOT3, "fx/lib.gdshaderinc": "vec3 w(vec3 v) { return (WORLD_MATRIX * vec4(v, 1.0)).xyz; }\n" });
    const dry = migrateProject(root);
    expect(dry.files.map((f) => `${f.file} ${f.changes.length}`)).toEqual(["res://fx/lib.gdshaderinc 1", "res://fx/water.gdshader 7"]);
    const written = migrateProject(root, { write: true });
    expect(written.written).toBe(true);
    expect(readFileSync(join(root, "fx", "lib.gdshaderinc"), "utf8")).toBe("vec3 w(vec3 v) { return (MODEL_MATRIX * vec4(v, 1.0)).xyz; }\n");
    expect(migrateProject(root).changes).toBe(0);
  });
});

describe("fix shaders", () => {
  it("renames Godot 3 names and adds every missing texture uniform once", () => {
    const code = "shader_type spatial;\nuniform vec4 tint : hint_color;\nvoid fragment() {\n\tALBEDO = tint.rgb * texture(SCREEN_TEXTURE, SCREEN_UV).rgb * texture(DEPTH_TEXTURE, SCREEN_UV).r;\n\tNORMALMAP = vec3(0.5);\n}\n";
    const root = makeProject({ "project.godot": PROJECT, "s.gdshader": code });
    const result = fixProject(root, { write: true });
    expect(result.skipped).toEqual([]);
    expect(readFileSync(join(root, "s.gdshader"), "utf8")).toBe(
      "shader_type spatial;\nuniform sampler2D SCREEN_TEXTURE : hint_screen_texture, filter_linear_mipmap;\nuniform sampler2D DEPTH_TEXTURE : hint_depth_texture, filter_linear_mipmap;\nuniform vec4 tint : source_color;\nvoid fragment() {\n\tALBEDO = tint.rgb * texture(SCREEN_TEXTURE, SCREEN_UV).rgb * texture(DEPTH_TEXTURE, SCREEN_UV).r;\n\tNORMAL_MAP = vec3(0.5);\n}\n",
    );
    expect(result.remaining?.filter((f) => f.severity === "error")).toEqual([]);
  });

  it("adds the texture uniform after a render_mode that shares the shader_type line and spans lines", () => {
    const code = "shader_type spatial; render_mode unshaded,\n\tcull_disabled;\nvoid fragment() { ALBEDO = texture(SCREEN_TEXTURE, SCREEN_UV).rgb; }\n";
    const root = makeProject({ "project.godot": PROJECT, "r.gdshader": code });
    const result = fixProject(root, { write: true });
    expect(readFileSync(join(root, "r.gdshader"), "utf8")).toBe(
      "shader_type spatial; render_mode unshaded,\n\tcull_disabled;\nuniform sampler2D SCREEN_TEXTURE : hint_screen_texture, filter_linear_mipmap;\nvoid fragment() { ALBEDO = texture(SCREEN_TEXTURE, SCREEN_UV).rgb; }\n",
    );
    expect(result.remaining?.filter((f) => f.severity === "error")).toEqual([]);
  });

  it("leaves names without a one-to-one rename, and Shaders stored in scenes, alone", () => {
    const scene = '[gd_scene format=3]\n\n[sub_resource type="Shader" id="S1"]\ncode = "shader_type spatial;\nuniform vec4 c : hint_color;\nvoid fragment() {}\n"\n\n[node name="N" type="Node3D"]\n';
    const root = makeProject({ "project.godot": PROJECT, "s.gdshader": "shader_type spatial;\nvoid fragment() {\n\tCLEARCOAT_GLOSS = 1.0;\n}\n", "n.tscn": scene });
    const result = fixProject(root);
    expect(result.changes).toEqual([]);
    expect(result.skipped.map((s) => `${s.file}:${s.line} ${s.reason}`)).toEqual(["res://s.gdshader:3 no one-to-one Godot 4 name: change it by hand as the message says"]);
  });
});

describe("godot_shader without Godot", () => {
  const files = {
    "project.godot": PROJECT,
    "fx/water.gdshader": GODOT3,
    "fx/ok.gdshader": "shader_type canvas_item;\nvoid fragment() {\n\tCOLOR = vec4(1.0);\n}\n",
    "fx/lib.gdshaderinc": "float f(float x) { return x; }\n",
    "main.tscn": '[gd_scene format=3]\n\n[sub_resource type="Shader" id="Shader_1"]\ncode = "shader_type spatial;\nvoid fragment() {\n\tCOLOR = vec4(1.0);\n}\n"\n\n[node name="M" type="Node3D"]\n',
    "addons/x/third.gdshader": "shader_type spatial;\nuniform vec4 c : hint_color;\nvoid fragment() {}\n",
  };

  it("reviews every shader, include and Shader in a scene, and says when it did not compile", async () => {
    const root = makeProject(files);
    const report = await shaderReport(root, { godot: "/no/such/godot" });
    expect(report.compileSkipped).toBe("Godot binary not found or not executable: /no/such/godot; only the static review ran");
    expect(report.shaders.map((s) => s.path)).toEqual(["res://fx/lib.gdshaderinc", "res://fx/ok.gdshader", "res://fx/water.gdshader", "res://main.tscn::Shader_1"]);
    const text = formatShaderReport(report);
    expect(text.split("\n").slice(0, 2)).toEqual([
      "shaders: 4 (include 1, canvas_item 1, spatial 2; 1 stored in scenes or resources)",
      "not compiled: Godot binary not found or not executable: /no/such/godot; only the static review ran",
    ]);
    expect(text).toContain("res://main.tscn::Shader_1:6: error [api/shader-read-only-builtin] COLOR is read-only in spatial fragment()");
    expect(text).toContain("res://fx/water.gdshader:2: error [api/shader-renamed] depth_draw_alpha_prepass is the Godot 3 name");
    expect(text).not.toContain("addons");
    expect(report.errors).toBe(9);
  });

  it("filters by file (a scene selects its Shaders) and fails when compile is required without Godot", async () => {
    const root = makeProject(files);
    const scene = await shaderReport(root, { files: ["res://main.tscn"], compile: false });
    expect(scene.shaders.map((s) => s.path)).toEqual(["res://main.tscn::Shader_1"]);
    expect(scene.findings.map((f) => f.rule)).toEqual(["api/shader-read-only-builtin"]);
    expect(scene.compileSkipped).toBeUndefined();
    await expect(shaderReport(root, { compile: true, godot: "/no/such/godot" })).rejects.toThrow(/Godot binary not found/);
  });

  it("reports a requested file that is no shader in the project as an error", async () => {
    const root = makeProject(files);
    const report = await shaderReport(root, { files: ["res://nope.gdshader", "res://fx/ok.gdshader"], compile: false });
    expect(report.unknownFiles).toEqual(["res://nope.gdshader"]);
    expect(report.errors).toBe(1);
    expect(formatShaderReport(report)).toContain("res://nope.gdshader: error no shader, shader include or scene holding a shader at this path in the project");
    const cli = await runCli(["shader", root, "--file", "res://../outside.gdshader", "--no-compile"]);
    expect(cli.exitCode).toBe(1);
    expect(cli.output).toContain("res://../outside.gdshader: error no shader");
  });

  it("runs from the CLI with exit code 1 on errors, and as JSON", async () => {
    const root = makeProject(files);
    const ok = await runCli(["shader", root, "--file", "fx/ok.gdshader", "--no-compile"]);
    expect(ok.exitCode).toBe(0);
    expect(ok.output).toBe("shaders: 1 (canvas_item 1)\n0 errors, 0 warnings\n");
    const bad = await runCli(["shader", root, "--no-compile", "--json"]);
    expect(bad.exitCode).toBe(1);
    expect(JSON.parse(bad.output).findings.length).toBeGreaterThan(5);
  });

  it("checks unsaved shader code over MCP", async () => {
    const root = makeProject(files);
    const server = createServer({ tier: "cheap", root, godot: "/no/such/godot" });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      const result = (await client.callTool({
        name: "godot_shader",
        arguments: { file: "res://fx/new.gdshader", code: "shader_type canvas_item;\nvoid fragment() {\n\tALBEDO = vec3(1.0);\n}\n" },
      })) as { content: { text: string }[]; isError?: boolean };
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toBe(
        [
          "shaders: 1 (canvas_item 1)",
          "not compiled: Godot binary not found or not executable: /no/such/godot; only the static review ran",
          "res://fx/new.gdshader:3: error [api/shader-builtin-misplaced] ALBEDO does not exist in canvas_item shaders (it is a spatial and fog built-in): write COLOR.",
          "1 error, 0 warnings",
          "",
        ].join("\n"),
      );
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === "godot_shader")!;
      expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });
});

describe("godot_doctor on Godot 3 shaders", () => {
  it("points to godot_migrate and godot_shader", async () => {
    const root = makeProject({ "project.godot": PROJECT, "fx/water.gdshader": GODOT3 });
    const text = formatDoctor(await doctorProject(root, { godot: false }));
    expect(text).toContain("[api/shader-renamed]");
    expect(text).toContain("godot_migrate rewrites Godot 3 code like this for the whole project");
    expect(text).toContain("run godot_shader: it compiles every shader with Godot headless");
  });
});
