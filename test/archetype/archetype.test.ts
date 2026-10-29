import { describe, expect, it } from "vitest";
import { identify, stem, tokens } from "../../src/archetype/identify.js";
import { ArchetypeLibrary, loadLibrary, validateArchetypes } from "../../src/archetype/library.js";
import type { Archetype } from "../../src/archetype/types.js";
import { runCli } from "../helpers.js";

const library = loadLibrary();
const best = (text: string) => identify(text, library).best.id;

const root: Archetype = { id: "thing", name: "thing", description: "d", aliases: ["thing"], conventions: ["c"] };
const child = (extra: Partial<Archetype> = {}): Archetype => ({ id: "thing.widget", extends: "thing", name: "widget", description: "d", aliases: ["widget"], ...extra });

describe("the library data", () => {
  it("loads and has no problems", () => {
    expect(library.archetypes.length).toBeGreaterThanOrEqual(50);
    expect(validateArchetypes(library.archetypes)).toEqual([]);
  });

  it("covers every family of things people build", () => {
    for (const id of ["vehicle.wheeled.car", "vehicle.wheeled.truck", "vehicle.wheeled.tractor", "vehicle.tracked.tank", "vehicle.rail.train", "aircraft.fixed-wing.airliner", "aircraft.rotorcraft.helicopter", "aircraft.rotorcraft.drone", "vessel.ship", "vessel.sailboat", "machine.piston-engine", "machine.wind-turbine", "building.house", "building.windmill", "infrastructure.road", "infrastructure.bridge", "plant.tree.conifer", "plant.grass", "prop.shipping-container", "prop.barrel", "world.terrain", "world.terrain.island", "world.coast", "world.water.sea", "world.water.river", "world.biome", "world.settlement"]) {
      expect(library.get(id), id).toBeDefined();
    }
  });

  it("gives every size a source and a class, and marks only real standards as class A", () => {
    const classA = library.archetypes.filter((a) => a.scale?.confidence === "A").map((a) => a.id);
    expect(classA).toEqual(["prop.shipping-container"]);
    for (const a of library.archetypes) if (a.scale) expect(a.scale.source.length, a.id).toBeGreaterThan(10);
  });

  it("makes every alias find its own archetype (or the one it shares it with)", () => {
    for (const a of library.archetypes) {
      if (a.id === "thing") continue;
      for (const alias of a.aliases) {
        const r = identify(alias, library);
        const hit = r.matches.find((m) => m.id === a.id);
        expect(hit && hit.score >= 0.6, `${a.id}: "${alias}" -> ${r.matches[0]?.id} (${r.matches[0]?.score})`).toBe(true);
      }
    }
  });
});

describe("validation", () => {
  it("accepts a small good library", () => {
    expect(validateArchetypes([root, child()])).toEqual([]);
  });

  it("finds each kind of mistake", () => {
    const problems = (list: Archetype[]) => validateArchetypes(list).join("\n");
    expect(problems([root, root])).toMatch(/id used twice/);
    expect(problems([root, child({ extends: "thing.nope" })])).toMatch(/does not exist/);
    expect(problems([root, child({ extends: undefined })])).toMatch(/only "thing" may have no parent/);
    expect(problems([root, child({ aliases: ["Widget"] })])).toMatch(/lowercase/);
    expect(problems([root, child({ aliases: [] })])).toMatch(/at least one alias/);
    expect(problems([root, child({ aliases: ["thing"] })])).toMatch(/also used by thing/);
    expect(problems([root, child({ parts: [{ name: "wheel", role: "w", required: true }] })])).toMatch(/PascalCase/);
    expect(problems([root, child({ parts: [{ name: "A", role: "w", required: true }, { name: "A", role: "w", required: false }] })])).toMatch(/name used twice/);
    expect(problems([root, child({ parts: [{ name: "Wheel", role: "w", required: true, moves: [{ kind: "spin", axis: "x" }] }] })])).toMatch(/needs a pivot rule/);
    expect(problems([root, child({ parts: [{ name: "Wheel", role: "w", required: true, count: [4, 2] }] })])).toMatch(/count range/);
    expect(problems([root, child({ scale: { length: [5, 1], source: "x", confidence: "C" } })])).toMatch(/min <= max/);
    expect(problems([root, child({ scale: { length: [1, 5], source: "", confidence: "C" } })])).toMatch(/needs a source/);
    expect(problems([root, child({ scale: { length: [1, 5], source: "x", confidence: "Z" as "C" } })])).toMatch(/confidence/);
  });

  it("finds an extends cycle", () => {
    const a: Archetype = { id: "thing.a", extends: "thing.b", name: "a", description: "d", aliases: ["aa"] };
    const b: Archetype = { id: "thing.b", extends: "thing.a", name: "b", description: "d", aliases: ["bb"] };
    expect(validateArchetypes([root, a, b]).join("\n")).toMatch(/cycle/);
  });
});

describe("resolving inheritance", () => {
  it("merges parts by name, with the child winning, and keeps the chain", () => {
    const car = library.resolve("vehicle.wheeled.car");
    expect(car.chain).toEqual(["thing", "vehicle", "vehicle.wheeled", "vehicle.wheeled.car"]);
    const wheel = car.parts.find((p) => p.name === "Wheel")!;
    expect(wheel.count).toBe(4);
    expect(wheel.pivot).toBe("hub");
    expect(car.parts.filter((p) => p.name === "Wheel")).toHaveLength(1);
    expect(car.parts.some((p) => p.name === "Door")).toBe(true);
  });

  it("collects conventions, anticipation and pitfalls from every ancestor without repeats", () => {
    const heli = library.resolve("aircraft.rotorcraft.helicopter");
    expect(heli.conventions.join(" ")).toContain("MODEL_FRONT");
    expect(heli.anticipate.join(" ")).toContain("cockpit");
    expect(heli.anticipate.join(" ")).toContain("collision");
    expect(new Set(heli.pitfalls).size).toBe(heli.pitfalls.length);
  });

  it("uses the nearest size, and a child overrides a parent", () => {
    expect(library.resolve("aircraft.fixed-wing.airliner").scale?.length).toEqual([28, 76]);
    expect(library.resolve("aircraft.fixed-wing.airplane").scale?.length).toEqual([6, 76]);
    expect(library.resolve("vehicle").scale).toBeUndefined();
    const small = new ArchetypeLibrary([root, child({ scale: { length: [1, 2], source: "s", confidence: "C" } })]);
    expect(small.resolve("thing.widget").scale?.length).toEqual([1, 2]);
  });

  it("rejects an unknown id", () => {
    expect(() => library.resolve("nope")).toThrow(/unknown archetype/);
  });
});

describe("identify", () => {
  it("names the five required cases", () => {
    expect(best("tractor")).toBe("vehicle.wheeled.tractor");
    expect(best("helikopter")).toBe("aircraft.rotorcraft.helicopter");
    expect(best("windmill")).toBe("building.windmill");
    expect(best("boot")).toBe("vessel.boat");
    const nonsense = identify("asdfgh", library);
    expect(nonsense.generic).toBe(true);
    expect(nonsense.best.id).toBe("thing");
    expect(nonsense.notes.join(" ")).toMatch(/Nothing matches/);
  });

  it("understands English and Dutch, plurals, filler words and accents", () => {
    expect(best("cars")).toBe("vehicle.wheeled.car");
    expect(best("Een auto, graag!")).toBe("vehicle.wheeled.car");
    expect(best("I want to build a helicopter model please")).toBe("aircraft.rotorcraft.helicopter");
    expect(best("bomen")).toBe("plant.tree");
    expect(best("WINDTURBINES")).toBe("machine.wind-turbine");
    expect(best("café")).not.toBe("vehicle.wheeled.car");
    expect(best("de zeecontainer")).toBe("prop.shipping-container");
  });

  it("knows the pieces an open world is made of, and keeps the things that share a word apart", () => {
    expect(best("eiland")).toBe("world.terrain.island");
    expect(best("a volcano")).toBe("world.terrain.mountain");
    expect(best("noordzee")).toBe("world.water.sea");
    expect(best("rivier")).toBe("world.water.river");
    expect(best("meer")).toBe("world.water.lake");
    expect(best("strand")).toBe("world.coast");
    expect(best("woestijn")).toBe("world.biome");
    expect(best("een dorp")).toBe("world.settlement");
    expect(best("heightmap")).toBe("world.terrain");
    expect(best("sea container")).toBe("prop.shipping-container");
    expect(best("ground vehicle")).toBe("vehicle");
  });

  it("gives the world family its own rules: tiles, sea level, shared borders and instanced scatter", () => {
    const world = library.resolve("world.terrain.island");
    expect(world.chain).toEqual(["thing", "world", "world.terrain", "world.terrain.island"]);
    const text = [...world.conventions, ...world.anticipate].join(" ");
    expect(text).toMatch(/y = 0 is sea level/);
    expect(text).toMatch(/HeightMapShape3D/);
    expect(text).toMatch(/MultiMesh/);
    expect(world.parts.map((p) => p.name)).toEqual(expect.arrayContaining(["Land", "SeaFloor", "Collision"]));
  });

  it("prefers the longer, more specific name", () => {
    expect(best("fighter jet")).toBe("aircraft.fixed-wing.fighter");
    expect(best("a jet engine")).toBe("machine.jet-engine");
    expect(best("sailing boat")).toBe("vessel.sailboat");
    expect(best("wind turbine")).toBe("machine.wind-turbine");
  });

  it("reads Dutch compounds by their last word, but an exact name wins", () => {
    const r = identify("vrachtauto", library);
    expect(r.best.id).toBe("vehicle.wheeled.truck");
    const fire = identify("firetruck", library);
    expect(fire.best.id).toBe("vehicle.wheeled.truck");
    expect(fire.matches[0]!.via).toBe("suffix");
    expect(fire.notes.join(" ")).toMatch(/Check that this is what you meant/);
    expect(best("brandweerauto")).toBe("vehicle.wheeled.car");
  });

  it("forgives small typing mistakes, but not real other words", () => {
    expect(best("helicoptr")).toBe("aircraft.rotorcraft.helicopter");
    expect(best("tracter")).toBe("vehicle.wheeled.tractor");
    expect(best("goat")).toBe("thing");
    expect(best("rotors")).not.toBe("machine.piston-engine");
  });

  it("says so when a word means two things", () => {
    const r = identify("windmolen", library);
    expect(r.ambiguous.sort()).toEqual(["building.windmill", "machine.wind-turbine"]);
    expect(r.generic).toBe(false);
    expect(r.notes.join(" ")).toMatch(/more than one thing/);
    expect(identify("bike", library).ambiguous).toContain("vehicle.wheeled.bicycle");
    expect(identify("wind turbine", library).ambiguous).toEqual([]);
  });

  it("guesses the family from a description, and marks it generic", () => {
    const flies = identify("something that flies and has rotors", library);
    expect(flies.generic).toBe(true);
    expect(flies.best.id).toBe("aircraft.rotorcraft");
    expect(flies.matches.map((m) => m.id)).toContain("aircraft.rotorcraft.helicopter");
    expect(identify("something with wheels and an engine", library).best.id).toBe("vehicle.wheeled");
    expect(identify("castle", library).best.id).toBe("building");
    expect(identify("een kraan", library).best.id).toBe("machine");
  });

  it("lets the rest of the description support a named match", () => {
    expect(best("iets met wielen en een motor")).toBe("vehicle.wheeled.motorcycle");
    expect(best("a car with a trailer")).toBe("vehicle.wheeled.car");
  });

  it("handles empty and silly input, and gives the same answer every time", () => {
    for (const text of ["", "   ", "!!!", "a", "the of and"]) {
      const r = identify(text, library);
      expect(r.generic).toBe(true);
      expect(r.best.id).toBe("thing");
    }
    expect(JSON.stringify(identify("een grote tractor", library))).toBe(JSON.stringify(identify("een grote tractor", library)));
  });

  it("splits and stems words", () => {
    expect(tokens("A big Tractor, with 4 wheels!")).toEqual(["big", "tractor", "wheels"]);
    expect([stem("wheels"), stem("batteries"), stem("boxes"), stem("bus"), stem("glass"), stem("bomen"), stem("car")]).toEqual(["wheel", "battery", "box", "bus", "glass", "bom", "car"]);
  });
});

describe("model identify and model archetypes", () => {
  it("answers in plain text, with the parts and what to anticipate", async () => {
    const run = await runCli(["model", "identify", "een", "tractor"]);
    expect(run.exitCode).toBe(0);
    expect(run.output).toContain("tractor (vehicle.wheeled.tractor)");
    expect(run.output).toContain("needs  WheelRear");
    expect(run.output).toContain("pivot at the hub");
    expect(run.output).toContain("anticipate:");
    expect(run.output).toContain("model spec");
  });

  it("prints JSON", async () => {
    const run = await runCli(["model", "identify", "helicopter", "--json"]);
    const data = JSON.parse(run.output);
    expect(data.best.id).toBe("aircraft.rotorcraft.helicopter");
    expect(data.generic).toBe(false);
  });

  it("shows the family tree and one archetype", async () => {
    const tree = await runCli(["model", "archetypes"]);
    expect(tree.output).toContain("  vehicle");
    expect(tree.output).toContain("      helicopter");
    const one = await runCli(["model", "archetypes", "prop.shipping-container"]);
    expect(one.output).toContain("class A: ISO 668");
    expect((await runCli(["model", "archetypes", "no.such"])).exitCode).toBe(1);
  });
});
