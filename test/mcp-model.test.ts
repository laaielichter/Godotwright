import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { existsSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXAMPLE_SPEC } from "../src/build/spec-help.js";
import { createServer, type Tier } from "../src/mcp/server.js";
import { makeProject } from "./helpers.js";

type Result = { content: { type: string; text: string }[]; isError?: boolean };
const textOf = (r: unknown) => (r as Result).content.map((c) => c.text).join("\n");
const failed = (r: unknown) => (r as Result).isError === true;

async function connect(tier: Tier, root: string) {
  const server = createServer({ tier, root, godot: "/no/such/godot" });
  const client = new Client({ name: "test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}

describe.each<Tier>(["cheap", "premium"])("model tools (%s profile)", (tier) => {
  const root = makeProject({ "project.godot": 'config_version=5\n[application]\nconfig/name="M"\n' });
  let client: Client;
  let close: () => Promise<unknown>;
  beforeAll(async () => ({ client, close } = await connect(tier, root)));
  afterAll(() => close());
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });

  it("tells agents the workflow in its instructions", () => {
    const text = client.getInstructions() ?? "";
    expect(text).toContain("godot_model_identify");
    expect(text).toContain("godot_model_build");
    expect(text).toContain("godot_model_lint");
    expect(text).toContain("+Z");
  });

  it("marks the read-only tools, and the build tool as a writer", async () => {
    const { tools } = await client.listTools();
    for (const name of ["godot_model_identify", "godot_model_spec", "godot_model_lint", "godot_model_inspect"]) expect(tools.find((t) => t.name === name)?.annotations?.readOnlyHint, name).toBe(true);
    expect(tools.find((t) => t.name === "godot_model_build")?.annotations?.readOnlyHint).toBe(false);
    expect(tools.find((t) => t.name === "godot_model_build")?.annotations?.destructiveHint, "build overwrites out").toBe(true);
    expect(tools.find((t) => t.name === "godot_model_build")?.inputSchema.required).toEqual(["out"]);
  });

  it("identifies a thing, in Dutch, with its parts and what to anticipate", async () => {
    const out = textOf(await call("godot_model_identify", { text: "een tractor" }));
    expect(out).toContain("tractor (vehicle.wheeled.tractor)");
    expect(out).toContain("WheelRear");
    expect(out).toContain("anticipate:");
    const unknown = textOf(await call("godot_model_identify", { text: "asdfgh" }));
    expect(unknown).toContain("generic");
  });

  it("explains the spec format and lists the kinds", async () => {
    const out = textOf(await call("godot_model_spec"));
    expect(out).toContain("A model spec is JSON");
    expect(out).toContain('"name": "Wheel_FL"');
    expect(out).toContain("house:");
  });

  it("builds a spec into a file in the project, checked as its archetype, with a contract", async () => {
    const res = await call("godot_model_build", { out: "models/car.glb", spec: EXAMPLE_SPEC, contract_out: "models/car.contract.json" });
    expect(failed(res)).toBe(false);
    expect(textOf(res)).toContain("(checked as vehicle.wheeled.car)");
    expect(existsSync(`${root}/models/car.glb`)).toBe(true);
    expect(JSON.parse(readFileSync(`${root}/models/car.contract.json`, "utf8")).nodes).toContain("Car/Wheels/Wheel_FL");
  });

  it("builds a ready-made kind with parameters, and a spec from a file", async () => {
    const house = await call("godot_model_build", { out: "models/house.glb", kind: "house", params: { floors: 3, roof: "hip", chimney: false } });
    expect(failed(house)).toBe(false);
    expect(textOf(house)).toContain("(checked as building.house)");
    writeFileSync(`${root}/car.json`, JSON.stringify(EXAMPLE_SPEC));
    const viaFile = await call("godot_model_build", { out: "models/car2.glb", spec_file: "car.json", params: { width: 2 } });
    expect(failed(viaFile)).toBe(false);
    expect(textOf(viaFile)).toContain("2.00 x");
  });

  it("explains what went wrong with a bad spec, a bad parameter or no input", async () => {
    const bad = await call("godot_model_build", { out: "models/bad.glb", spec: { version: 1, nodes: [{ name: "A", shape: "cube" }] } });
    expect(failed(bad)).toBe(true);
    expect(textOf(bad)).toContain('unknown shape "cube"');
    const param = await call("godot_model_build", { out: "models/bad.glb", kind: "house", params: { floors: 0 } });
    expect(failed(param)).toBe(true);
    expect(textOf(param)).toContain("at least 1");
    expect(failed(await call("godot_model_build", { out: "models/none.glb" }))).toBe(true);
    expect(existsSync(`${root}/models/bad.glb`)).toBe(false);
  });

  it("refuses to write or read outside the project, or to write the wrong file type", async () => {
    const outside = await call("godot_model_build", { out: "../escape.glb", kind: "house" });
    expect(failed(outside)).toBe(true);
    expect(textOf(outside)).toContain("outside the project");
    expect(failed(await call("godot_model_build", { out: "/tmp/escape.glb", kind: "house" }))).toBe(true);
    expect(textOf(await call("godot_model_build", { out: "models/x.txt", kind: "house" }))).toContain("must end in .glb");
    expect(textOf(await call("godot_model_build", { out: "models/x.glb", kind: "house", contract_out: "x.txt" }))).toContain("must end in .json");
    expect(failed(await call("godot_model_build", { out: "models/x.glb", spec_file: "../../etc/passwd" }))).toBe(true);
    expect(failed(await call("godot_model_inspect", { file: "../../etc/hostname" }))).toBe(true);
    expect(failed(await call("godot_model_lint", { file: "/etc/hostname" }))).toBe(true);
  });

  it("lints a model, and with an archetype catches a car without wheels", async () => {
    await call("godot_model_build", { out: "models/ok.glb", spec: EXAMPLE_SPEC });
    const plain = textOf(await call("godot_model_lint", { file: "models/ok.glb" }));
    expect(plain).toContain("overall:");
    expect(plain).not.toContain("archetype");
    const good = await call("godot_model_lint", { file: "models/ok.glb", archetype: "auto" });
    expect(failed(good)).toBe(false);
    expect(textOf(good)).toContain("checked as: car (vehicle.wheeled.car)");
    const noWheels = JSON.parse(JSON.stringify(EXAMPLE_SPEC)) as { nodes: { children: { name: string }[] }[] };
    noWheels.nodes[0]!.children = noWheels.nodes[0]!.children.filter((c) => c.name !== "Wheels");
    await call("godot_model_build", { out: "models/nowheels.glb", spec: noWheels });
    const bad = await call("godot_model_lint", { file: "models/nowheels.glb", archetype: "car" });
    expect(failed(bad)).toBe(true);
    expect(textOf(bad)).toContain("archetype/missing-part");
    const budget = textOf(await call("godot_model_lint", { file: "models/ok.glb", max_triangles: 10 }));
    expect(budget).toContain("model/triangle-budget");
  });

  it("lints against a contract", async () => {
    const res = await call("godot_model_lint", { file: "models/ok.glb", contract: "models/car.contract.json" });
    expect(failed(res)).toBe(false);
    expect(textOf(await call("godot_model_lint", { file: "models/ok.glb", contract: "models/missing.json" }))).toContain("not found");
  });

  it("inspects a model", async () => {
    const out = textOf(await call("godot_model_inspect", { file: "models/ok.glb" }));
    expect(out).toContain("8 nodes");
    expect(out).toContain("Wheel_FL");
    expect(failed(await call("godot_model_inspect", { file: "models/nope.glb" }))).toBe(true);
  });
});

describe("model tools and symbolic links", () => {
  const root = makeProject({ "project.godot": 'config_version=5\n[application]\nconfig/name="M"\n' });
  const outside = makeProject({ "target.glb": "keep me", "target.json": "keep me", "dir/keep.txt": "keep me" });
  let client: Client;
  let close: () => Promise<unknown>;
  beforeAll(async () => {
    ({ client, close } = await connect("cheap", root));
    const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
    // A real model that lives outside the project, reached through a link.
    await call("godot_model_build", { out: "src/house.glb", kind: "house" });
    renameSync(join(root, "src", "house.glb"), join(outside, "house.glb"));
    symlinkSync(join(outside, "house.glb"), join(root, "peek.glb"));
    symlinkSync(join(outside, "target.glb"), join(root, "evil.glb"));
    symlinkSync(join(outside, "target.json"), join(root, "evil.json"));
    symlinkSync(join(outside, "dir"), join(root, "linkdir"));
    symlinkSync(join(outside, "new.glb"), join(root, "dangling.glb"));
    symlinkSync(join(root, "src"), join(root, "alias"));
    writeFileSync(join(outside, "secret.json"), '{"note": "TOPSECRET-VALUE" ');
    symlinkSync(join(outside, "secret.json"), join(root, "spec-link.json"));
  });
  afterAll(() => close());
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });

  it("will not write over a file that links outside the project", async () => {
    const res = await call("godot_model_build", { out: "evil.glb", kind: "house" });
    expect(failed(res)).toBe(true);
    expect(textOf(res)).toContain("outside the project");
    expect(readFileSync(join(outside, "target.glb"), "utf8")).toBe("keep me");
  });

  it("will not write into a folder that links outside the project", async () => {
    const res = await call("godot_model_build", { out: "linkdir/new.glb", kind: "house" });
    expect(failed(res)).toBe(true);
    expect(existsSync(join(outside, "dir", "new.glb"))).toBe(false);
  });

  it("will not create a file through a link to a missing file outside the project", async () => {
    expect(failed(await call("godot_model_build", { out: "dangling.glb", kind: "house" }))).toBe(true);
    expect(existsSync(join(outside, "new.glb"))).toBe(false);
  });

  it("will not write a contract through a link, and writes nothing when refused", async () => {
    const res = await call("godot_model_build", { out: "models/linked-contract.glb", kind: "house", contract_out: "evil.json" });
    expect(failed(res)).toBe(true);
    expect(readFileSync(join(outside, "target.json"), "utf8")).toBe("keep me");
    expect(existsSync(join(root, "models", "linked-contract.glb"))).toBe(false);
  });

  it("will not read a model through a link to a file outside the project", async () => {
    for (const name of ["godot_model_inspect", "godot_model_lint"]) {
      const res = await call(name, { file: "peek.glb" });
      expect(failed(res), name).toBe(true);
      expect(textOf(res), name).toContain("outside the project");
    }
  });

  it("will not read a spec through a link, and does not quote its bytes", async () => {
    const res = await call("godot_model_build", { out: "models/from-link.glb", spec_file: "spec-link.json" });
    expect(failed(res)).toBe(true);
    expect(textOf(res)).toContain("outside the project");
    expect(textOf(res)).not.toContain("TOPSECRET");
  });

  it("still works through links that stay inside the project", async () => {
    const res = await call("godot_model_build", { out: "alias/alias.glb", kind: "house" });
    expect(failed(res)).toBe(false);
    expect(existsSync(join(root, "src", "alias.glb"))).toBe(true);
    expect(failed(await call("godot_model_inspect", { file: "alias/alias.glb" }))).toBe(false);
  });

  it("works when the project folder itself is reached through a link", async () => {
    const via = join(makeProject({}), "project-link");
    symlinkSync(root, via);
    const linked = await connect("cheap", via);
    try {
      const res = await linked.client.callTool({ name: "godot_model_build", arguments: { out: "models/via-link.glb", kind: "house" } });
      expect(failed(res)).toBe(false);
      expect(existsSync(join(root, "models", "via-link.glb"))).toBe(true);
    } finally {
      await linked.close();
    }
  });
});
