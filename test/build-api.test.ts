import { describe, expect, it } from "vitest";
import { docText, parseXml } from "../scripts/build-api.js";

describe("build-api", () => {
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
