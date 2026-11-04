import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { annotationFile, ciAnnotations, escapeAnnotationData, escapeAnnotationProperty, reviewAnnotations } from "../src/review/annotations.js";
import { makeProject } from "./helpers.js";

describe("GitHub Actions annotations", () => {
  it("escapes message data and property values using workflow-command rules", () => {
    expect(escapeAnnotationData("100%,\nnext:line\r")).toBe("100%25,%0Anext:line%0D");
    expect(escapeAnnotationProperty("a,b:c%")).toBe("a%2Cb%3Ac%25");
  });

  it("resolves project files from the workspace and normalizes separators", () => {
    const workspace = makeProject({ "game/project.godot": "", "game/level.tscn": "" });
    const project = join(workspace, "game");
    expect(annotationFile("res://level.tscn", project, workspace, workspace)).toBe("game/level.tscn");
    expect(annotationFile("res://level.tscn::GDScript_abc", project, workspace, workspace)).toBe("game/level.tscn");
    expect(annotationFile("res://missing.gd", project, workspace, workspace)).toBeUndefined();
  });

  it("uses the current directory when the project is outside the workspace", () => {
    const cwd = makeProject({ "game/project.godot": "", "game/main.gd": "" });
    const project = join(cwd, "game");
    const elsewhere = makeProject({ "project.godot": "" });
    expect(annotationFile("res://main.gd", project, cwd, elsewhere)).toBe("game/main.gd");
  });

  it("emits safe annotations and includes infos only in full detail", () => {
    const root = makeProject({ "project.godot": "", "main.gd": "", "a,b.gd": "" });
    const report = {
      findings: [
        { severity: "error", message: "bad %\n::warning::injected", file: "res://main.gd", line: 7, rule: "api/bad,rule" },
        { severity: "info", message: "extra", file: "res://missing.gd", rule: "quality/info" },
      ],
    } as never;
    const brief = reviewAnnotations(report, { projectRoot: root });
    expect(brief).toEqual(["::error file=main.gd,line=7,title=api/bad%2Crule::bad %25%0A::warning::injected"]);
    expect(reviewAnnotations(report, { detailFull: true, projectRoot: root })).toHaveLength(2);
    expect(annotationFile("res://a,b.gd", root, root, root)).toBe("a,b.gd");
    const comma = { findings: [{ severity: "warning", message: "comma, colon: and %", file: "res://a,b.gd", line: 8, rule: "rule:comma" }] } as never;
    expect(reviewAnnotations(comma, { projectRoot: root })).toEqual(["::warning file=a%2Cb.gd,line=8,title=rule%3Acomma::comma,%3A and %25"]);
  });

  it("includes Godot diagnostics and omits the file property for missing files", () => {
    const root = makeProject({ "project.godot": "", "main.gd": "" });
    const lines = ciAnnotations(undefined, [
      { severity: "error", message: "bad", file: "res://main.gd", line: 4, source: "script" },
      { severity: "warning", message: "missing", file: "res://absent.gd", line: 2, source: "engine" },
    ], root);
    expect(lines).toEqual(["::error file=main.gd,line=4,title=script::bad", "::warning line=2,title=engine::missing"]);
  });
});
