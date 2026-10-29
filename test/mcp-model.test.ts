import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
    expect(text).toContain("godot_model_view");
    expect(text).toContain("+Z");
  });

  it("marks the read-only tools, and the build tool as a writer", async () => {
    const { tools } = await client.listTools();
    for (const name of ["godot_model_identify", "godot_model_spec", "godot_model_lint", "godot_model_inspect", "godot_model_view"]) expect(tools.find((t) => t.name === name)?.annotations?.readOnlyHint, name).toBe(true);
    expect(tools.find((t) => t.name === "godot_model_build")?.annotations?.readOnlyHint).toBe(false);
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

  it("shows a model as text, with views, parts and what does not touch", async () => {
    const out = textOf(await call("godot_model_view", { file: "models/ok.glb", width: 40 }));
    expect(out).toContain("FRONT");
    expect(out).toContain("PARTS");
    expect(textOf(await call("godot_model_view", { file: "models/ok.glb", only: "top" }))).not.toContain("FRONT");
    expect(failed(await call("godot_model_view", { file: "../../etc/hostname" }))).toBe(true);
    expect(failed(await call("godot_model_view", { file: "models/nope.glb" }))).toBe(true);
  });

  it("inspects a model", async () => {
    const out = textOf(await call("godot_model_inspect", { file: "models/ok.glb" }));
    expect(out).toContain("8 nodes");
    expect(out).toContain("Wheel_FL");
    expect(failed(await call("godot_model_inspect", { file: "models/nope.glb" }))).toBe(true);
  });
});
