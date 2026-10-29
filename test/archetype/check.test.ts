import { describe, expect, it } from "vitest";
import { checkArchetype, chooseArchetype } from "../../src/archetype/check.js";
import { loadLibrary, validateArchetypes } from "../../src/archetype/library.js";
import { buildSpec } from "../../src/build/spec.js";
import { EXAMPLE_SPEC } from "../../src/build/spec-help.js";
import { buildKind } from "../../src/build/generators/index.js";
import { inspectModel } from "../../src/model/inspect.js";
import { lintModelFile } from "../../src/model/lint.js";
import { runCli } from "../helpers.js";
import { writeScene } from "../build/helpers.js";

const library = loadLibrary();
type Node = Record<string, unknown>;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The example car with a change applied to its node tree. */
function car(change: (nodes: Node[]) => void): string {
  const spec = clone(EXAMPLE_SPEC) as unknown as { nodes: Node[] };
  change(spec.nodes);
  return writeScene(buildSpec(spec));
}
const wheels = (nodes: Node[]) => ((nodes[0]!["children"] as Node[]).find((c) => c["name"] === "Wheels")!["children"] as Node[]);
const check = (path: string, what: string) => checkArchetype(inspectModel(path), chooseArchetype(what, library).archetype);
const rules = (path: string, what: string) => check(path, what).map((f) => f.rule);

describe("a good model passes", () => {
  it("the example car and the house have nothing above info", () => {
    expect(check(writeScene(buildSpec(EXAMPLE_SPEC)), "car").filter((f) => f.severity !== "info")).toEqual([]);
    expect(check(writeScene(buildKind("house")), "building.house").filter((f) => f.severity !== "info")).toEqual([]);
    expect(check(writeScene(buildKind("house", { roof: "hip", floors: 3, chimney: false })), "huis").filter((f) => f.severity !== "info")).toEqual([]);
  });

  it("lists the usual parts that are not there, once", () => {
    const f = check(writeScene(buildSpec(EXAMPLE_SPEC)), "car").filter((x) => x.rule === "archetype/optional-part");
    expect(f).toHaveLength(1);
    expect(f[0]!.message).toContain("Door");
    expect(f[0]!.message).toContain("Headlight");
  });
});

describe("missing and miscounted parts", () => {
  it("reports a car with no wheels as an error", () => {
    const path = car((n) => { const c = n[0]!["children"] as Node[]; n[0]!["children"] = c.filter((x) => x["name"] !== "Wheels"); });
    const f = check(path, "car").filter((x) => x.rule === "archetype/missing-part");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("error");
    expect(f[0]!.message).toContain('"Wheel"');
  });

  it("reports a car with only two wheels", () => {
    const path = car((n) => { wheels(n).splice(1, 1); });
    const f = check(path, "car").filter((x) => x.rule === "archetype/part-count");
    expect(f.map((x) => x.message).join(" ")).toMatch(/has 4 "Wheel", this model has 2/);
  });

  it("does not count a group like 'Wheels' as another wheel", () => {
    expect(rules(writeScene(buildSpec(EXAMPLE_SPEC)), "car")).not.toContain("archetype/part-count");
  });

  it("recognises parts by their Dutch and English names, and by the most specific one", () => {
    const spec = { version: 1, nodes: [{ name: "Tractor", material: "paint", children: [
      { name: "Motorkap", shape: "box", size: [1, 1, 2], at: [0, 1.5, 0] },
      { name: "Cabine", shape: "box", size: [1.5, 1.4, 1.5], at: [0, 2.6, -1] },
      { name: "Achterwiel_L", shape: "cylinder", axis: "x", radius: 0.8, height: 0.5, at: [0.9, 0.8, -1.2], mirror: "Achterwiel_R" },
      { name: "Voorwiel_L", shape: "cylinder", axis: "x", radius: 0.5, height: 0.3, at: [0.8, 0.5, 1.4], mirror: "Voorwiel_R" },
    ] }] };
    const f = check(writeScene(buildSpec(spec)), "tractor").filter((x) => x.severity !== "info");
    expect(f).toEqual([]);
  });

  it("treats a part a more specific part replaces as not required (frame, rear wheel)", () => {
    const tractor = library.resolve("vehicle.wheeled.tractor");
    expect(tractor.parts.map((p) => p.name)).not.toContain("Wheel");
    expect(tractor.parts.map((p) => p.name)).toEqual(expect.arrayContaining(["WheelRear", "WheelFront"]));
    expect(library.resolve("vehicle.wheeled.truck").parts.map((p) => p.name)).not.toContain("Body");
    expect(library.resolve("vehicle.wheeled.bicycle").parts.map((p) => p.name)).not.toContain("Wheel");
  });
});

describe("pivots and wheel axes", () => {
  it("accepts wheels with the pivot at the hub and flags one with the pivot at its edge", () => {
    const bad = car((n) => {
      const w = wheels(n)[0]!;
      w["at"] = ["-$x - 0.33", "$wheelRadius", "-$z"];
      w["shape"] = "cylinder";
      delete w["mirror"];
      // Same wheel, but the mesh is shifted so the node origin is off the hub.
      const kids = { name: "Rubber", shape: "cylinder", material: "rubber", axis: "x", radius: "$wheelRadius", height: 0.22, at: [0, 0.4, 0] };
      delete w["shape"]; delete w["radius"]; delete w["height"]; delete w["axis"]; delete w["material"];
      w["children"] = [kids];
    });
    const f = check(bad, "car").filter((x) => x.rule === "archetype/pivot");
    expect(f).toHaveLength(1);
    expect(f[0]!.node).toBe("Car/Wheels/Wheel_FL");
    expect(f[0]!.message).toMatch(/from its centre/);
  });

  it("flags a wheel that lies the wrong way", () => {
    const path = car((n) => { for (const w of wheels(n)) w["axis"] = "z"; });
    const f = check(path, "car").filter((x) => x.rule === "archetype/wheel-axis");
    expect(f.length).toBeGreaterThanOrEqual(1);
    expect(f[0]!.message).toMatch(/short side should lie along x/);
  });

  it("checks a hinged part: a door hinged in its middle is wrong, on its edge is right", () => {
    const door = (at: number[]) => ({ version: 1, nodes: [{ name: "Car", material: "paint", children: [
      { name: "Body", shape: "box", size: [1.8, 0.8, 4.4], at: [0, 0.7, 0] },
      { name: "Door", at: [0.9, 0.7, 0.5], children: [{ name: "Panel", shape: "box", size: [0.05, 0.7, 1.0], at }] },
    ] }] });
    const bad = check(writeScene(buildSpec(door([0, 0, 0]))), "car").filter((x) => x.rule === "archetype/pivot");
    const good = check(writeScene(buildSpec(door([0, 0, 0.5]))), "car").filter((x) => x.rule === "archetype/pivot");
    expect(bad).toHaveLength(1);
    expect(bad[0]!.message).toMatch(/not on an edge of the part/);
    expect(good).toEqual([]);
  });
});

describe("size and direction", () => {
  const scaled = (factor: number) => car((n) => { n[0]!["at"] = [0, 0, 0]; (n[0] as Node)["children"] = (n[0]!["children"] as Node[]); const root = n[0]!; root["name"] = "Scaled"; root["children"] = [{ name: "Car", children: root["children"] }]; });

  it("flags a car that is ten times too big or too small, with the likely factor", () => {
    const big = buildSpec({ version: 1, nodes: [{ name: "Car", material: "paint", children: [{ name: "Body", shape: "box", size: [18, 6, 44], at: [0, 3, 0] }, { name: "Wheel_A", shape: "cylinder", axis: "x", radius: 3, height: 2, at: [9, 3, 12] }] }] });
    const f = check(writeScene(big), "car").filter((x) => x.rule === "archetype/size");
    expect(f).toHaveLength(1);
    expect(f[0]!.message).toMatch(/about 10 times too big, likely a unit mistake/);
    const small = buildSpec({ version: 1, nodes: [{ name: "Car", material: "paint", children: [{ name: "Body", shape: "box", size: [0.18, 0.14, 0.44], at: [0, 0.07, 0] }] }] });
    expect(check(writeScene(small), "car").find((x) => x.rule === "archetype/size")!.message).toMatch(/times too small/);
    expect(scaled(1)).toBeTruthy();
  });

  it("does not flag a size inside the range, or a helicopter whose rotor is wider than its body", () => {
    expect(rules(writeScene(buildSpec(EXAMPLE_SPEC)), "car")).not.toContain("archetype/size");
    const heli = { version: 1, nodes: [{ name: "Helicopter", material: "metal", children: [
      { name: "Fuselage", shape: "ellipsoid", radii: [1.2, 1.4, 7], at: [0, 2.2, 0] },
      { name: "MainRotor", shape: "cylinder", radius: 8.2, height: 0.05, at: [0, 4.3, 0] },
    ] }] };
    expect(rules(writeScene(buildSpec(heli)), "helicopter")).not.toContain("archetype/size");
  });

  it("flags a car that points sideways, but not a ship or a house", () => {
    const sideways = (name: string) => ({ version: 1, nodes: [{ name, material: "paint", children: [{ name: "Body", shape: "box", size: [4.4, 1.4, 1.8], at: [0, 0.7, 0] }, { name: "Wheel_A", shape: "cylinder", axis: "z", radius: 0.33, height: 0.2, at: [1.5, 0.33, 0] }] }] });
    expect(rules(writeScene(buildSpec(sideways("Car"))), "car")).toContain("archetype/orientation");
    expect(rules(writeScene(buildSpec(sideways("Ship"))), "ship")).not.toContain("archetype/orientation");
    expect(rules(writeScene(buildKind("house", { width: 14, depth: 6 })), "house")).not.toContain("archetype/orientation");
  });
});

describe("lint with an archetype", () => {
  it("adds the archetype category and shares the score; without one nothing changes", () => {
    const path = writeScene(buildSpec(EXAMPLE_SPEC));
    const plain = lintModelFile(path);
    expect(plain.categories.map((c) => c.category)).toEqual(["geometry", "materials", "performance", "rig"]);
    expect(plain.archetype).toBeUndefined();
    const withArch = lintModelFile(path, { archetype: library.resolve("vehicle.wheeled.car") });
    expect(withArch.categories.map((c) => c.category)).toEqual(["geometry", "materials", "performance", "rig", "archetype"]);
    expect(withArch.archetype).toBe("vehicle.wheeled.car");
    const broken = lintModelFile(car((n) => { const c = n[0]!["children"] as Node[]; n[0]!["children"] = c.filter((x) => x["name"] !== "Wheels"); }), { archetype: library.resolve("vehicle.wheeled.car") });
    expect(broken.categories.find((c) => c.category === "archetype")!.errors).toBe(1);
    expect(broken.overall).toBeLessThan(withArch.overall);
  });

  it("ignores the root 'thing' and an archetype nobody names exactly still gives a family", () => {
    const path = writeScene(buildSpec(EXAMPLE_SPEC));
    expect(lintModelFile(path, { archetype: library.resolve("thing") }).categories).toHaveLength(4);
    const guess = chooseArchetype("something with wheels and an engine", library);
    expect(guess.generic).toBe(true);
    expect(guess.archetype.id).toBe("vehicle.wheeled");
    expect(chooseArchetype("vehicle.wheeled.truck", library).archetype.id).toBe("vehicle.wheeled.truck");
  });
});

describe("the CLI", () => {
  it("lint --archetype prints what it checked as, and exits 1 on a missing part", async () => {
    const good = writeScene(buildSpec(EXAMPLE_SPEC));
    const ok = await runCli(["model", "lint", good, "--archetype", "auto"]);
    expect(ok.exitCode).toBe(0);
    expect(ok.output).toContain("checked as: car (vehicle.wheeled.car)");
    expect(ok.output).toContain("archetype");
    const bad = car((n) => { const c = n[0]!["children"] as Node[]; n[0]!["children"] = c.filter((x) => x["name"] !== "Wheels"); });
    const run = await runCli(["model", "lint", bad, "--archetype", "car"]);
    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("archetype/missing-part");
    const json = JSON.parse((await runCli(["model", "lint", good, "--archetype", "car", "--json"])).output);
    expect(json.archetype).toBe("vehicle.wheeled.car");
  });

  it("build checks the result against the spec's archetype", async () => {
    const dir = writeScene(buildSpec(EXAMPLE_SPEC)).replace("model.glb", "");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(`${dir}car.json`, JSON.stringify(EXAMPLE_SPEC));
    const run = await runCli(["model", "build", "--spec", `${dir}car.json`, "-o", `${dir}car.glb`]);
    expect(run.output).toContain("(checked as vehicle.wheeled.car)");
    writeFileSync(`${dir}bad.json`, JSON.stringify({ ...EXAMPLE_SPEC, archetype: "vehicle.nope" }));
    expect((await runCli(["model", "build", "--spec", `${dir}bad.json`, "-o", `${dir}bad.glb`])).exitCode).toBe(1);
    const house = await runCli(["model", "build", "house", "-o", `${dir}h.glb`]);
    expect(house.output).toContain("(checked as building.house)");
  });
});

describe("the data", () => {
  it("rejects a replaces that no ancestor can satisfy", () => {
    const list = library.archetypes.map((a) => (a.id === "vehicle.wheeled.car" ? { ...a, parts: [...(a.parts ?? []), { name: "Extra", role: "x", required: false, replaces: ["Nope"] }] } : a));
    expect(validateArchetypes(list).join("\n")).toMatch(/replaces "Nope", which no ancestor has/);
  });
});
