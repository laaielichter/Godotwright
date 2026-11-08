import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadLibrary } from "../../src/archetype/library.js";
import { buildKind } from "../../src/build/generators/index.js";
import { buildSpec } from "../../src/build/spec.js";
import { catalogMarkdown } from "../../src/library/format.js";
import { CATEGORIES, box, combos, num, type Family } from "../../src/library/kit.js";
import { assetsOf, getAsset, libraryOverview, loadAssetLibrary, searchAssets } from "../../src/library/library.js";
import { createServer } from "../../src/mcp/server.js";
import { makeProject, runCli, tempFolder } from "../helpers.js";

const library = loadAssetLibrary();
const archetypes = loadLibrary();
const CHAIR = "furniture/dining-chair-oak-ladder";

describe("the asset library", () => {
  it("holds a thousand assets with unique ids, in every category", () => {
    expect(library.size).toBeGreaterThanOrEqual(1000);
    const overview = libraryOverview();
    expect(overview.map((c) => c.category)).toEqual([...CATEGORIES]);
    expect(overview.reduce((n, c) => n + c.count, 0)).toBe(library.size);
  });

  it("gives every asset a known archetype, text, tags and parameters with a range", () => {
    for (const a of library.values()) {
      expect(archetypes.get(a.archetype), a.id).toBeDefined();
      expect(a.id.startsWith(`${a.category}/${a.family}`), a.id).toBe(true);
      expect(a.title.length, a.id).toBeGreaterThan(3);
      expect(a.description.length, a.id).toBeGreaterThan(30);
      expect(a.tags.length, a.id).toBeGreaterThan(0);
      const params = a.spec["params"] as { min?: number; max?: number }[];
      expect(params.length, a.id).toBeGreaterThanOrEqual(2);
      expect(params.every((p) => p.min !== undefined && p.max !== undefined && p.min < p.max), a.id).toBe(true);
    }
  });

  it("has no two assets with the same spec", () => {
    const seen = new Map<string, string>();
    for (const a of library.values()) {
      const key = JSON.stringify({ ...a.spec, name: "", description: "" });
      expect(seen.get(key), `${a.id} is a copy of ${seen.get(key)}`).toBeUndefined();
      seen.set(key, a.id);
    }
  });

  it("refuses bad ids, duplicates and drafts without parameters", () => {
    const fam = (slugs: string[], params = [num("w", 1, 0.5, 2, "width")]): Family => ({
      id: "thing",
      category: "props",
      archetype: "thing",
      tags: [],
      assets: () => slugs.map((slug) => ({ slug, title: "T", description: "d", params, materials: {}, nodes: [box("Body", [1, 1, 1], { material: "wood" })] })),
    });
    expect(() => assetsOf([fam(["Bad Slug"])])).toThrow(/not a valid id/);
    expect(() => assetsOf([fam(["a", "a"])])).toThrow(/defined twice/);
    expect(() => assetsOf([fam(["a"]), fam(["b"])])).toThrow(/family "thing" defined twice/);
    expect(() => assetsOf([fam(["a"], [])])).toThrow(/no parameters/);
    expect(assetsOf([fam(["a-b"])]).get("props/a-b")!.spec["version"]).toBe(1);
  });

  it("crosses option lists in a fixed order", () => {
    expect(combos({ a: [1, 2], b: ["x", "y"] })).toEqual([{ a: 1, b: "x" }, { a: 1, b: "y" }, { a: 2, b: "x" }, { a: 2, b: "y" }]);
  });
});

describe("searching the library", () => {
  it("finds assets by English words, title first", () => {
    const hits = searchAssets({ text: "oak chair" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.title.toLowerCase()).toContain("oak");
    expect(hits.every((a) => /chair|stool/.test(`${a.title} ${a.tags.join(" ")}`.toLowerCase()))).toBe(true);
  });

  it("understands Dutch words for finishes, colours and things", () => {
    const dutch = searchAssets({ text: "eiken stoel" }).map((a) => a.id);
    expect(dutch).toContain(CHAIR);
    expect(dutch).toEqual(searchAssets({ text: "oak chair" }).map((a) => a.id));
  });

  it("filters by category, family and archetype, and finds nothing for nonsense", () => {
    expect(searchAssets({ family: "dining-chair" }).length).toBe(24);
    expect(searchAssets({ category: "nature" }).every((a) => a.category === "nature")).toBe(true);
    expect(searchAssets({ archetype: "plant.tree" }).every((a) => a.archetype.startsWith("plant.tree"))).toBe(true);
    expect(searchAssets({ archetype: "plant.tree" }).length).toBeGreaterThan(0);
    expect(searchAssets({ text: "zzqx flurb" })).toEqual([]);
  });
});

describe("using an asset", () => {
  it("builds as a kind, with parameters, and refuses an unknown id", () => {
    const scene = buildKind(CHAIR, { seatHeight: 0.5 });
    expect(scene.archetype).toBe("prop.chair");
    expect(scene).toEqual(buildSpec(getAsset(CHAIR)!.spec, { seatHeight: 0.5 }));
    expect(() => buildKind("furniture/no-such-thing")).toThrow(/model library/);
  });

  it("shows, searches and prints the spec through the CLI", async () => {
    const overview = await runCli(["model", "library"]);
    expect(overview.output).toMatch(/Asset library: \d{4} base recipes/);
    expect(overview.output).toContain("furniture (");
    const one = await runCli(["model", "library", CHAIR]);
    expect(one.output).toContain("archetype prop.chair");
    expect(one.output).toContain("seatHeight=0.46");
    const spec = await runCli(["model", "library", CHAIR, "--spec"]);
    expect(JSON.parse(spec.output).archetype).toBe("prop.chair");
    const found = await runCli(["model", "library", "eiken", "stoel", "--limit", "2"]);
    expect(found.output).toContain("furniture/dining-chair-oak");
    expect(found.output).toMatch(/and \d+ more/);
    expect((await runCli(["model", "library", "nothing-like-this", "--spec"])).exitCode).toBe(1);
  });

  it("builds by id through the CLI, named after the asset", async () => {
    const dir = tempFolder("godotwright-library-");
    const run = await runCli(["model", "build", CHAIR, "-o", join(dir, "chair.glb")]);
    expect(run.exitCode).toBe(0);
    expect(run.output).toContain("lint 100/100 (checked as prop.chair)");
    expect(existsSync(join(dir, "chair.glb"))).toBe(true);
  });

  it("answers through the MCP tool, and builds by id with godot_model_build", async () => {
    const root = makeProject({ "project.godot": 'config_version=5\n[application]\nconfig/name="L"\n' });
    const server = createServer({ root, godot: "/no/such/godot" });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      return { text: r.content.map((c) => c.text).join("\n"), error: r.isError === true };
    };
    expect((await call("godot_model_library", {})).text).toContain("base recipes");
    expect((await call("godot_model_library", { query: "rode bank", limit: 5 })).text).toMatch(/red/i);
    expect((await call("godot_model_library", { id: CHAIR })).text).toContain("Build it:");
    expect(JSON.parse((await call("godot_model_library", { id: CHAIR, spec: true })).text).name).toBe("dining-chair-oak-ladder");
    expect((await call("godot_model_library", { id: "furniture/nope" })).error).toBe(true);
    expect((await call("godot_model_library", { spec: true })).error).toBe(true);
    const built = await call("godot_model_build", { out: "models/chair.glb", kind: CHAIR });
    expect(built.error).toBe(false);
    expect(built.text).toContain("checked as prop.chair");
    expect(client.getInstructions()).toContain("godot_model_library");
    await Promise.all([client.close(), server.close()]);
  });
});

describe("the catalogue", () => {
  it("LIBRARY.md lists every asset and is up to date (regenerate with: npm run build:library)", () => {
    const text = readFileSync(new URL("../../LIBRARY.md", import.meta.url), "utf8");
    expect(text).toBe(catalogMarkdown());
    for (const id of library.keys()) expect(text).toContain(`\`${id}\``);
  });
});
