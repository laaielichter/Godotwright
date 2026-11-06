import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Tier } from "../src/mcp/server.js";
import { DEMO, FIXTURES, makeProject, tempFolder } from "./helpers.js";

async function connect(tier: Tier, root = DEMO) {
  const server = createServer({ tier, root, godot: "/no/such/godot" });
  const client = new Client({ name: "test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}

type Result = { content: { type: string; text: string }[]; isError?: boolean };
const textOf = (r: unknown) =>
  (r as Result).content.map((c) => c.text).join("\n");

describe("MCP server (cheap profile)", () => {
  let client: Client;
  let close: () => Promise<unknown>;
  beforeAll(async () => ({ client, close } = await connect("cheap")));
  afterAll(() => close());

  it("lists the tools with read-only hints", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "godot_api",
      "godot_api_search",
      "godot_check",
      "godot_checklist",
      "godot_code",
      "godot_deps",
      "godot_doctor",
      "godot_export",
      "godot_export_run",
      "godot_feedback",
      "godot_fix",
      "godot_game",
      "godot_leaks",
      "godot_lesson_add",
      "godot_lessons",
      "godot_migrate",
      "godot_model_brief",
      "godot_model_build",
      "godot_model_identify",
      "godot_model_inspect",
      "godot_model_lint",
      "godot_model_spec",
      "godot_model_view",
      "godot_perf",
      "godot_play",
      "godot_project_edit",
      "godot_rename",
      "godot_resource_edit",
      "godot_review",
      "godot_scan",
      "godot_scenario",
      "godot_scene_edit",
      "godot_screenshot",
      "godot_session",
      "godot_shader",
      "godot_test",
      "godot_undo",
      "godot_usages",
    ]);
    expect(
      tools.find((t) => t.name === "godot_scan")?.annotations?.readOnlyHint,
    ).toBe(true);
    expect(
      tools.find((t) => t.name === "godot_api")?.inputSchema.required,
    ).toEqual(["query"]);
  });

  it("documents setget and @rpc rewrites in the godot_migrate tool description", async () => {
    const { tools } = await client.listTools();
    const migrate = tools.find((t) => t.name === "godot_migrate");
    expect(migrate?.description).toMatch(/network keywords to @rpc\(\.\.\.\)/);
    expect(migrate?.description).toMatch(/setget to property syntax/);
  });

  it("edits import settings through godot_resource_edit, and refuses an unknown option", async () => {
    const root = makeProject({
      "project.godot": "config_version=5\n",
      "beep.wav.import": '[remap]\n\nimporter="wav"\ntype="AudioStreamWAV"\n\n[params]\n\nedit/loop_mode=0\n',
    });
    const server = createServer({ tier: "cheap", root, godot: "/no/such/godot" });
    const local = new Client({ name: "test", version: "1.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), local.connect(b)]);
    const call = (args: Record<string, unknown>) => local.callTool({ name: "godot_resource_edit", arguments: { file: "res://beep.wav", ...args } });
    const dry = (await call({ ops: [{ op: "set", key: "edit/loop_mode", value: "Forward" }] })) as Result;
    expect(dry.isError).toBeFalsy();
    expect(textOf(dry)).toContain("+ edit/loop_mode=2");
    const written = (await call({ ops: [{ op: "set", key: "edit/loop_mode", value: 2 }], write: true })) as Result;
    expect(textOf(written)).toMatch(/reimport skipped: not reimported/);
    const bad = (await call({ ops: [{ op: "set", key: "edit/loop", value: "1" }] })) as Result;
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatch(/no option edit\/loop; did you mean .*edit\/loop_mode/);
    await Promise.all([local.close(), server.close()]);
  });

  it("does not call the tools that write learning read-only", async () => {
    const { tools } = await client.listTools();
    for (const name of ["godot_review", "godot_api"]) {
      const annotations = tools.find((t) => t.name === name)?.annotations;
      expect(annotations?.readOnlyHint, name).toBe(false);
      expect(annotations?.destructiveHint, name).toBe(false);
    }
    // Search records nothing, so it is read-only.
    expect(
      tools.find((t) => t.name === "godot_api_search")?.annotations
        ?.readOnlyHint,
    ).toBe(true);
  });

  it("lists and checks scenarios, and needs Godot to run or save one", async () => {
    const root = makeProject({
      "project.godot": "[application]\n",
      "main.tscn": '[gd_scene format=3]\n\n[node name="Main" type="Node"]\n',
      ".godotwright/scenarios/jump.json": '{"input": "10 tap jump", "frames": 70, "expect": ["Hero.velocity.y == -400 @ 10"]}',
    });
    const call = (args: Record<string, unknown>) => client.callTool({ name: "godot_scenario", arguments: { path: root, ...args } }) as Promise<Result>;
    expect(textOf(await call({ op: "list" }))).toBe('jump: main scene; 70 frames; input "10 tap jump"\n  Hero.velocity.y == -400 @ 10\n');
    const none = await call({ op: "run", name: "swim" });
    expect(none.isError).toBe(true);
    expect(textOf(none)).toContain('no scenarios matching "swim"');
    expect((await call({ op: "save" })).isError).toBe(true);
    const noGodot = await call({ op: "save", name: "jump2", scene: "res://main.tscn", input: "10 tap jump", expect: ["Hero.velocity.y == -400 @ 10"] });
    expect(noGodot.isError).toBe(true);
    expect(textOf(noGodot)).toMatch(/Godot/);
    const exists = await call({ op: "save", name: "jump", expect: ["Hero.velocity.y == -400 @ 10"] });
    expect(textOf(exists)).toContain("exists; pass overwrite");
  });

  it("sends step-by-step instructions", () => {
    expect(client.getInstructions()).toContain("Never guess API names");
  });

  it("scans the project briefly", async () => {
    const out = textOf(
      await client.callTool({ name: "godot_scan", arguments: {} }),
    );
    expect(out).toContain("project: Demo Game (Godot 4.7, Forward Plus)");
    expect(out).not.toContain(":12");
  });

  it("looks up the API and fails clearly on Godot 3 names", async () => {
    const ok = await client.callTool({
      name: "godot_api",
      arguments: { query: "CharacterBody2D.move_and_slide" },
    });
    expect(textOf(ok)).toContain("CharacterBody2D.move_and_slide() -> bool");
    const old = (await client.callTool({
      name: "godot_api",
      arguments: { query: "KinematicBody2D" },
    })) as Result;
    expect(old.isError).toBe(true);
    expect(textOf(old)).toContain("is called CharacterBody2D in Godot 4");
    const search = await client.callTool({
      name: "godot_api_search",
      arguments: { query: "is on floor", limit: 3 },
    });
    expect(textOf(search)).toContain("CharacterBody2D.is_on_floor()");
  });

  it("reviews unsaved code before it is written", async () => {
    const code =
      "extends CharacterBody2D\n\n\nfunc _physics_process(delta: float) -> void:\n\tvelocity = move_and_slide(velocity, Vector2.UP)\n";
    const out = textOf(
      await client.callTool({
        name: "godot_review",
        arguments: { code, file: "res://scripts/new_player.gd" },
      }),
    );
    expect(out).toContain(
      "findings in res://scripts/new_player.gd: 1 (1 errors)",
    );
    expect(out).toContain(
      "res://scripts/new_player.gd:5: error [api/wrong-arguments] move_and_slide() takes 0 arguments, but 2 are given.",
    );
    const fixed =
      "extends CharacterBody2D\n\n\nfunc _physics_process(_delta: float) -> void:\n\tmove_and_slide()\n";
    const clean = textOf(
      await client.callTool({
        name: "godot_review",
        arguments: { code: fixed, file: "scripts/new_player.gd" },
      }),
    );
    expect(clean).toContain("No errors in these files.");
  });

  it("explains how to continue without Godot", async () => {
    const r = (await client.callTool({
      name: "godot_check",
      arguments: {},
    })) as Result;
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("not found or not executable");
  });

  it("exports with destructive hints, and reads a pack read-only without Godot", async () => {
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === "godot_export_run")?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(tools.find((t) => t.name === "godot_export")?.annotations?.readOnlyHint).toBe(true);
    const root = makeProject({
      "project.godot": '[application]\nconfig/name="P"\nrun/main_scene="res://main.tscn"\n',
      "main.tscn": '[gd_scene format=3]\n\n[ext_resource type="Script" path="res://main.gd" id="1"]\n\n[node name="Main" type="Node"]\nscript = ExtResource("1")\n',
      "main.gd": 'extends Node\n\n\nfunc _ready() -> void:\n\tprint(FileAccess.get_file_as_string("res://data/b.json"))\n',
      "data/b.json": "{}",
      "export_presets.cfg": '[preset.0]\n\nname="Linux"\nplatform="Linux"\nexport_filter="all_resources"\n',
    });
    const read = (await client.callTool({ name: "godot_export", arguments: { path: root, pck: `${FIXTURES}/pck/game.pck` } })) as Result;
    expect(read.isError).toBeFalsy();
    expect(textOf(read)).toMatch(/^export pck: .*game\.pck: ok\npack: 11 files/);
    const run = (await client.callTool({ name: "godot_export_run", arguments: { path: root, preset: "Linux" } })) as Result;
    expect(run.isError).toBe(true);
    expect(textOf(run)).toContain("not found or not executable");
    const noPreset = (await client.callTool({ name: "godot_export_run", arguments: { path: root } })) as Result;
    expect(textOf(noPreset)).toBe("pack needs preset (its name or number)");
    // An out outside the project is refused before anything is deleted or written.
    const keep = join(tempFolder("gw-outside-"), "keep.pck");
    writeFileSync(keep, "PRECIOUS");
    const escape = (await client.callTool({ name: "godot_export_run", arguments: { path: root, preset: "Linux", out: keep, frames: 0 } })) as Result;
    expect(escape.isError).toBe(true);
    expect(textOf(escape)).toContain("is outside the project");
    expect(readFileSync(keep, "utf8")).toBe("PRECIOUS");
  });

  it("reviews an upgrade between 4.x releases with from and target", async () => {
    const root = makeProject({
      "project.godot": '[application]\nconfig/name="Old"\nconfig/features=PackedStringArray("4.5")\n',
      "main.tscn": '[gd_scene format=3]\n\n[node name="Main" type="Node3D"]\n\n[node name="Skel" type="Skeleton3D" parent="."]\n\n[node name="Body" type="MeshInstance3D" parent="Skel"]\n',
    });
    const review = textOf(await client.callTool({ name: "godot_review", arguments: { path: root, target: "4.6" } }));
    expect(review).toContain("; upgrade 4.5 -> 4.6");
    expect(review).toContain("[api/upgrade-mesh-skeleton]");
    const later = (await client.callTool({ name: "godot_review", arguments: { path: root, target: "4.8" } })) as Result;
    expect(later.isError).toBe(true);
    expect(textOf(later)).toContain("compare_godot");
  });

  it("asks for a second binary when compare_godot is next and GODOT_NEXT is unset", async () => {
    const saved = process.env["GODOT_NEXT"];
    delete process.env["GODOT_NEXT"];
    try {
      const r = (await client.callTool({ name: "godot_check", arguments: { compare_godot: "next" } })) as Result;
      expect(r.isError).toBe(true);
      expect(textOf(r)).toContain("GODOT_NEXT");
    } finally {
      if (saved !== undefined) process.env["GODOT_NEXT"] = saved;
    }
  });

  it("returns errors as tool errors, not crashes", async () => {
    const r = (await client.callTool({
      name: "godot_scan",
      arguments: { path: "/no/such/project" },
    })) as Result;
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("No project.godot found");
  });
});

describe("MCP server (premium profile)", () => {
  let client: Client;
  let close: () => Promise<unknown>;
  beforeAll(
    async () =>
      ({ client, close } = await connect("premium", `${FIXTURES}/messy`)),
  );
  afterAll(() => close());

  it("gives full detail by default", async () => {
    const scan = textOf(
      await client.callTool({ name: "godot_scan", arguments: {} }),
    );
    expect(scan).toContain("func DoDamage(amount)");
    const review = textOf(
      await client.callTool({
        name: "godot_review",
        arguments: { files: ["res://scripts/enemy.gd"] },
      }),
    );
    expect(review).toContain("fix: ");
    expect(review).toContain("[quality/naming]");
    expect(review).not.toContain("old_player.gd");
    const rules = textOf(
      await client.callTool({ name: "godot_checklist", arguments: {} }),
    );
    expect(rules).toContain("[api/wrong-arguments] (error)");
  });

  it("reads focus paths as the project names its files", async () => {
    const exact = textOf(
      await client.callTool({
        name: "godot_review",
        arguments: { files: ["res://scripts/enemy.gd"] },
      }),
    );
    expect(exact).toContain("res://scripts/enemy.gd:");
    for (const file of [
      "./scripts/enemy.gd",
      "scripts/../scripts/enemy.gd",
      "/scripts/enemy.gd",
    ]) {
      const out = textOf(
        await client.callTool({
          name: "godot_review",
          arguments: { files: [file] },
        }),
      );
      expect(out, file).toBe(exact);
    }
    const code =
      "extends CharacterBody2D\n\n\nfunc _physics_process(delta: float) -> void:\n\tvelocity = move_and_slide(velocity, Vector2.UP)\n";
    const fresh = await client.callTool({
      name: "godot_review",
      arguments: { code, file: "./scripts/new_player.gd" },
    });
    expect(textOf(fresh)).toContain(
      "res://scripts/new_player.gd:5: error [api/wrong-arguments]",
    );
    expect(textOf(fresh)).not.toContain("res://./");
  });

  it("does not report a clean verdict for a file that is not in the project", async () => {
    const missing = (await client.callTool({
      name: "godot_review",
      arguments: { files: ["./scripts/nope.gd"] },
    })) as Result;
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain(
      "no such file in the project: res://scripts/nope.gd",
    );
    expect(textOf(missing)).not.toContain("No errors");
    const escape = (await client.callTool({
      name: "godot_review",
      arguments: { files: ["../scripts/enemy.gd"] },
    })) as Result;
    expect(textOf(escape)).toContain(
      "no such file in the project: res://../scripts/enemy.gd",
    );
  });

  it("keeps the screenshot baseline folder inside the project", async () => {
    for (const baseline_dir of ["../outside", "/tmp/gw-escape-baselines"]) {
      const r = (await client.callTool({ name: "godot_screenshot", arguments: { scene: "res://main.tscn", baseline: "evil", baseline_dir } })) as Result;
      expect(r.isError).toBe(true);
      expect(textOf(r)).toContain("outside the project");
    }
    expect(existsSync(`${FIXTURES}/outside`)).toBe(false);
  });

  it("finds what is wrong, in order, and fixes what is mechanical", async () => {
    const root = makeProject({
      "project.godot": '[application]\nconfig/name="Doc"\nconfig/features=PackedStringArray("4.7")\n',
      "a.gd": 'extends Node\n\n\nfunc f(x: Node) -> void:\n\tif x is Node3D and is_instance_valid(x):\n\t\tprint("CafÃ©")\n\tlook_at_smooth()\n',
    });
    const doc = ((await client.callTool({ name: "godot_doctor", arguments: { path: root, godot: false, symptom: "helicopter slides off moving ship" } })) as { content: { text: string }[] }).content[0]!.text;
    expect(doc).toMatch(/^doctor: Doc: 2 problems to fix, 2 to look at/);
    expect(doc).toMatch(/1\. error \[api\/unknown-function\]/);
    expect(doc).toMatch(/godot_fix can do this/);
    expect(doc).toMatch(/physics\/moving-platform-velocity/);
    expect(doc).toMatch(/Next:\n  1\) apply the 2 mechanical fixes with godot_fix/);
    const fix = ((await client.callTool({ name: "godot_fix", arguments: { path: root, write: true } })) as { content: { text: string }[] }).content[0]!.text;
    expect(fix).toMatch(/^fix: 2 fixes in 1 file \(written, journal #1: godot_undo reverts it\)/);
    expect(fix).toMatch(/after the fixes: 1 error and 0 warnings left/);
  });

  it("describes all tools in its instructions", () => {
    expect(client.getInstructions()).toContain(
      "godot_checklist lists every AAA rule",
    );
    expect(client.getInstructions()).toContain(
      "godot_feedback marks a review finding",
    );
  });

  it("hides a finding after feedback says it is wrong", async () => {
    const files = ["res://scripts/old_player.gd"];
    const before = textOf(
      await client.callTool({ name: "godot_review", arguments: { files } }),
    );
    const line = before
      .split("\n")
      .find((l) => l.includes('Method "empty()"'))!;
    expect(line).toBeTruthy();
    const noted = textOf(
      await client.callTool({
        name: "godot_feedback",
        arguments: { finding: line, verdict: "wrong" },
      }),
    );
    expect(noted).toContain("api/unknown-member");
    const after = textOf(
      await client.callTool({ name: "godot_review", arguments: { files } }),
    );
    expect(after).not.toContain('Method "empty()"');
    expect(after).toContain("1 finding hidden");
    const bad = (await client.callTool({
      name: "godot_feedback",
      arguments: { finding: "nonsense", verdict: "wrong" },
    })) as Result;
    expect(bad.isError).toBe(true);
  });

  it("says so when learning is off instead of noting the feedback", async () => {
    process.env["GODOTWRIGHT_LEARN"] = "0";
    try {
      const line =
        "res://scripts/player.gd:3: warning [quality/unused-variable] x is never used";
      const off = (await client.callTool({
        name: "godot_feedback",
        arguments: { finding: line, verdict: "wrong" },
      })) as Result;
      expect(off.isError).toBe(true);
      expect(textOf(off)).toContain("Learning is off");
    } finally {
      delete process.env["GODOTWRIGHT_LEARN"];
    }
  });
});

describe("MCP lessons", () => {
  let client: Client;
  let close: () => Promise<unknown>;
  beforeAll(async () => ({ client, close } = await connect("premium", `${FIXTURES}/messy`)));
  afterAll(() => close());

  it("finds lessons by words, by a Godot message and by id, and lists gaps", async () => {
    const byWords = textOf(
      await client.callTool({ name: "godot_lessons", arguments: { query: "helicopter slides off a moving ship deck" } }),
    );
    expect(byWords.split("\n")[0]).toContain("physics/moving-platform-velocity");
    const byError = textOf(
      await client.callTool({
        name: "godot_lessons",
        arguments: { error: 'Parse Error: Cannot infer the type of "ox" variable because the value doesn\'t have a set type.' },
      }),
    );
    expect(byError).toContain("gdscript/variant-loop-inference");
    const byId = textOf(await client.callTool({ name: "godot_lessons", arguments: { query: "gameplay/time-scale" } }));
    expect(byId).toContain("symptom:");
    const none = (await client.callTool({ name: "godot_lessons", arguments: { query: "zzzz qqqq" } })) as Result;
    expect(none.isError).toBe(true);
    expect(textOf(await client.callTool({ name: "godot_lessons", arguments: { gaps: true } }))).toMatch(/no gaps yet|did not predict/);
  });

  it("keeps a lesson learned here, scrubbed, and takes feedback on lessons", async () => {
    const kept = textOf(
      await client.callTool({
        name: "godot_lesson_add",
        arguments: {
          title: "Wheels sink when a vehicle spawns before the terrain collider exists",
          fix: "Wait one physics frame after adding the terrain, then place the vehicle.",
          symptom: "The truck in res://levels/farm.tscn sank into the hill.",
          topic: "physics",
          error: 'Node not found: "Wheels/FrontLeft" (relative to "/root/Main/Truck").',
        },
      }),
    );
    expect(kept).toContain("local/wheels-sink-when-a-vehicle-spawns");
    expect(kept).not.toContain("farm.tscn");
    const found = textOf(await client.callTool({ name: "godot_lessons", arguments: { query: "vehicle sinks into terrain at spawn" } }));
    expect(found).toContain("[learned here]");
    const helped = textOf(
      await client.callTool({ name: "godot_feedback", arguments: { lesson: "gameplay/time-scale", verdict: "right" } }),
    );
    expect(helped).toContain("helped");
    const both = (await client.callTool({
      name: "godot_feedback",
      arguments: { lesson: "gameplay/time-scale", finding: "x", verdict: "right" },
    })) as Result;
    expect(both.isError).toBe(true);
    const unknown = (await client.callTool({ name: "godot_feedback", arguments: { lesson: "no/such-lesson", verdict: "wrong" } })) as Result;
    expect(unknown.isError).toBe(true);
    const refused = (await client.callTool({
      name: "godot_lesson_add",
      arguments: { title: "OldPlayer fix", fix: "Set jump_hieght in OldPlayer.apply()" },
    })) as Result;
    expect(refused.isError).toBe(true);
  });

  it("names the lessons behind review findings", async () => {
    const out = textOf(await client.callTool({ name: "godot_review", arguments: {} }));
    expect(out).toMatch(/lessons behind these findings \(godot_lessons <id>\): .*->/);
  });
});

describe("MCP server tier", () => {
  it("names the valid tiers when the tier is neither cheap nor premium", () => {
    for (const tier of ["Premium", "fast", "", "toString"]) {
      expect(
        () => createServer({ tier: tier as Tier, root: DEMO }),
        tier,
      ).toThrow(`tier must be cheap or premium, got "${tier}"`);
    }
  });
});

describe("MCP Registry entry", () => {
  const read = (file: string) =>
    JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
  const pkg = read("package.json") as {
    name: string;
    version: string;
    mcpName: string;
  };
  const server = read("server.json") as {
    name: string;
    description: string;
    version: string;
    packages: {
      registryType: string;
      identifier: string;
      version: string;
      packageArguments: { value?: string }[];
    }[];
  };

  it("matches the npm package, so the registry accepts it", () => {
    expect(server.name).toBe(pkg.mcpName);
    expect(server.version).toBe(pkg.version);
    expect(server.description.length).toBeLessThanOrEqual(100);
    expect(server.packages).toHaveLength(1);
    expect(server.packages[0]).toMatchObject({
      registryType: "npm",
      identifier: pkg.name,
      version: pkg.version,
    });
    expect(server.packages[0]?.packageArguments[0]?.value).toBe("mcp");
  });
});
