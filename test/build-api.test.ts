import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { docText, parseXml, readRenames } from "../scripts/build-api.js";

const SCRIPT = fileURLToPath(new URL("../scripts/build-api.ts", import.meta.url));

describe("build-api command", () => {
  it("prints usage and exits 1 without a Godot source directory", () => {
    const result = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("usage: node scripts/build-api.ts <godot-source-dir>");
  });

  it("builds the data when the script runs from a path with spaces", () => {
    // A copy of the script in a folder whose name has a space, with its own data folder to write to.
    const root = mkdtempSync(join(tmpdir(), "build api "));
    try {
      mkdirSync(join(root, "scripts"));
      mkdirSync(join(root, "data"));
      writeFileSync(join(root, "package.json"), '{"type":"module"}\n');
      copyFileSync(SCRIPT, join(root, "scripts", "build-api.ts"));
      const source = join(root, "godot source");
      mkdirSync(join(source, "doc", "classes"), { recursive: true });
      writeFileSync(
        join(source, "doc", "classes", "Foo.xml"),
        '<?xml version="1.0" encoding="UTF-8" ?>\n<class name="Foo" inherits="Object"><brief_description>Hi.</brief_description></class>\n',
      );
      const result = spawnSync(process.execPath, [join(root, "scripts", "build-api.ts"), source, "4.7.2-stable", "abc123"], { encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("1 classes");
      expect(existsSync(join(root, "data", "godot-api.json.gz"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("build-api", () => {
  it("reads the constant renames as Godot 3 name -> Godot 4 name", () => {
    const root = mkdtempSync(join(tmpdir(), "godot-src-"));
    try {
      mkdirSync(join(root, "editor", "project_upgrade"), { recursive: true });
      writeFileSync(
        join(root, "editor", "project_upgrade", "renames_map_3_to_4.cpp"),
        [
          "const char *RenamesMap3To4::enum_renames[][2] = {",
          '\t{ "BUTTON_LEFT", "MOUSE_BUTTON_LEFT" },',
          '\t{ "SIDE_LEFT", "MARGIN_LEFT" },',
          '\t{ "SIDE_TOP", "MARGIN_TOP" },',
          "};",
          "",
        ].join("\n"),
      );
      expect(readRenames(root).constants).toEqual({
        BUTTON_LEFT: "MOUSE_BUTTON_LEFT",
        MARGIN_LEFT: "SIDE_LEFT",
        MARGIN_TOP: "SIDE_TOP",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("parses class reference XML", () => {
    const node = parseXml(
      '<?xml version="1.0" encoding="UTF-8" ?>\n<class name="A" inherits="B"><methods><method name="f" qualifiers="const"><return type="int" /><param index="0" name="x" type="float" default="1.0" /></method></methods><brief_description>Hi &amp; bye</brief_description></class>',
    );
    expect(node.attrs).toEqual({ name: "A", inherits: "B" });
    const method = node.children[0]!.children[0]!;
    expect(method.attrs).toEqual({ name: "f", qualifiers: "const" });
    expect(method.children.map((c) => c.tag)).toEqual(["return", "param"]);
    expect(node.children[1]!.text).toBe("Hi & bye");
  });

  it("keeps GDScript code blocks literal", () => {
    const raw = [
      "\t\t[codeblock]",
      "\t\tvar arr: Array[int] = [1, 2]",
      "\t\tprint(arr[0])",
      "\t\t[/codeblock]",
      "\t\t[gdscript]",
      "\t\tfor x in arr: print(x[i])",
      "\t\t[/gdscript]",
    ].join("\n");
    expect(docText(raw)).toBe(
      ["```gdscript", "var arr: Array[int] = [1, 2]", "print(arr[0])", "```", "", "```gdscript", "for x in arr: print(x[i])", "```"].join("\n"),
    );
  });

  it("turns BBCode into compact text", () => {
    const raw = [
      "\t\tCalls [method foo] on [Node2D] with [param delta], see [member Node.name] and [constant FOO].",
      "\t\t[b]Note:[/b] [code]Array[lb]int[rb][/code] is typed. [url=https://x.org]Link[/url].",
      "\t\t[codeblocks]",
      "\t\t[gdscript]",
      "\t\tvar a = 1",
      "\t\t[/gdscript]",
      "\t\t[csharp]",
      "\t\tvar a = 1;",
      "\t\t[/csharp]",
      "\t\t[/codeblocks]",
    ].join("\n");
    expect(docText(raw)).toBe(
      [
        "Calls `foo()` on `Node2D` with `delta`, see `Node.name` and `FOO`.",
        "Note: `Array[int]` is typed. Link (https://x.org).",
        "",
        "```gdscript",
        "var a = 1",
        "```",
      ].join("\n"),
    );
  });
});
