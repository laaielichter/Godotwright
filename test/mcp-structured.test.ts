import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer, type ServerOptions } from "../src/mcp/server.js";
import { schemas } from "../src/mcp/structured.js";
import { fakeGodot } from "./fake-godot.js";
import { DEMO, FIXTURES, makeProject } from "./helpers.js";
import { join } from "node:path";

async function connect(options: ServerOptions = {}) {
  const server = createServer({ root: DEMO, godot: "/no/such/godot", ...options });
  const client = new Client({ name: "test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}

type Result = { content: { type: string; text: string }[]; isError?: boolean; structuredContent?: unknown };

describe("structured results", () => {
  it("declares an output schema on review, check, doctor and test", async () => {
    const { client, close } = await connect();
    const { tools } = await client.listTools();
    await close();
    const withSchema = tools.filter((t) => t.outputSchema).map((t) => t.name).sort();
    expect(withSchema).toEqual(["godot_check", "godot_doctor", "godot_review", "godot_test"]);
    const review = tools.find((t) => t.name === "godot_review")?.outputSchema as { required?: string[] };
    expect(review.required).toEqual(expect.arrayContaining(["ok", "errors", "warnings", "findings", "truncated", "overall"]));
  });

  it("returns the review as JSON next to the same text, capped like the text", async () => {
    const { client, close } = await connect({ root: join(FIXTURES, "messy"), tier: "cheap" });
    const r = (await client.callTool({ name: "godot_review", arguments: {} })) as Result;
    await close();
    expect(r.content).toHaveLength(1);
    expect(r.content[0]?.text).toMatch(/^AAA review: /);
    const data = schemas.review.parse(r.structuredContent);
    expect(data.findings.length).toBeLessThanOrEqual(15);
    expect(data.findings.length + data.truncated).toBeGreaterThan(15);
    expect(data.categories).toHaveProperty("api");
    const first = data.findings[0]!;
    expect(first.file).toMatch(/^res:\/\//);
    // Every finding in the JSON is a line of the text.
    for (const f of data.findings) expect(r.content[0]?.text).toContain(`${f.file}${f.line ? `:${f.line}` : ""}: ${f.severity} [${f.rule}] ${f.message}`);
  });

  it("reviews unsaved code with structured findings and marks a missing focus file as an error", async () => {
    const { client, close } = await connect();
    const code = "extends Node\n\nfunc _ready():\n\tyield(get_tree(), \"idle_frame\")\n";
    const r = (await client.callTool({ name: "godot_review", arguments: { code, file: "res://new.gd" } })) as Result;
    const data = schemas.review.parse(r.structuredContent);
    expect(data.ok).toBe(false);
    expect(data.findings.every((f) => f.file === "res://new.gd")).toBe(true);
    const missing = (await client.callTool({ name: "godot_review", arguments: { files: ["res://nope.gd"] } })) as Result;
    await close();
    expect(missing.isError).toBe(true);
    schemas.review.parse(missing.structuredContent);
  });

  it("returns the doctor's problems without Godot", async () => {
    const { client, close } = await connect({ root: join(FIXTURES, "messy") });
    const r = (await client.callTool({ name: "godot_doctor", arguments: { godot: false } })) as Result;
    await close();
    const data = schemas.doctor.parse(r.structuredContent);
    expect(data.godot).toBe("skipped");
    expect(data.findings.length).toBeGreaterThan(0);
    expect(data.next.length).toBeGreaterThan(0);
  });

  it("returns Godot's diagnostics from godot_check, also on an error result, and only text without Godot", async () => {
    const root = makeProject({ "project.godot": "config_version=5\n", "broken.gd": "extends Node\n" });
    const fake = fakeGodot({ error: true });
    const { client, close } = await connect({ root, godot: fake.bin });
    const r = (await client.callTool({ name: "godot_check", arguments: {} })) as Result;
    await close();
    expect(r.isError).toBe(true);
    // The SDK skips the schema check on error results, so check it here.
    const data = schemas.check.parse(r.structuredContent);
    expect(data.ok).toBe(false);
    expect(data.godotVersion).toContain("fake");
    expect(data.findings).toContainEqual(expect.objectContaining({ file: "res://broken.gd", line: 4, severity: "error" }));
    const none = await connect({ root });
    const missing = (await none.client.callTool({ name: "godot_check", arguments: {} })) as Result;
    await none.close();
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent).toBeUndefined();
  });
});
