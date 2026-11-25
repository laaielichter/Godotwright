import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bisectProject, formatBisect } from "../src/bisect/bisect.js";
import { commitAll } from "./git-helpers.js";
import { makeProject, runCli } from "./helpers.js";

const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-C", root, "-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args], { stdio: ["ignore", "pipe", "pipe"] }).toString("utf8");

const MAIN = `[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://player.gd" id="1_p"]\n\n[node name="Main" type="Node"]\nscript = ExtResource("1_p")\n`;
const PROJECT = 'config_version=5\n\n[application]\n\nconfig/name="T"\nrun/main_scene="res://main.tscn"\n';

/** Twelve commits; the sixth moves player.gd, which breaks main.tscn (a file that commit does not touch). */
function history(): { root: string; breaking: string } {
  const root = makeProject({ "project.godot": PROJECT, "main.tscn": MAIN, "player.gd": "extends Node\n", "notes.gd": "extends Node\n# 0\n" });
  commitAll(root, "c0");
  let breaking = "";
  for (let i = 1; i <= 11; i++) {
    if (i === 6) git(root, "mv", "player.gd", "hero.gd");
    writeFileSync(join(root, "notes.gd"), `extends Node\n# ${i}\n`);
    git(root, "commit", "-q", "-am", i === 6 ? "rename player.gd to hero.gd" : `c${i}`);
    if (i === 6) breaking = git(root, "rev-parse", "--short", "HEAD").trim();
  }
  return { root, breaking };
}

describe("bisectProject", () => {
  it("finds the commit that broke another file, without a good commit to start from", () => {
    const { root, breaking } = history();
    const before = git(root, "status", "--porcelain");
    const report = bisectProject(root);
    expect(report.ok).toBe(true);
    expect(report.first).toMatchObject({ hash: breaking, subject: "rename player.gd to hero.gd" });
    expect(report.lastGood?.subject).toBe("c5");
    expect(report.findings?.[0]).toMatchObject({ file: "res://main.tscn", rule: "structure/broken-reference" });
    expect(report.changed).toEqual(["R res://player.gd -> res://hero.gd", "M res://notes.gd"]);
    // 12 commits, found with far fewer reviews than commits.
    expect(report.tested).toBeLessThanOrEqual(8);
    const text = formatBisect(report);
    expect(text).toMatch(new RegExp(`^First commit with the problem \\(an error the review reports\\): ${breaking} `));
    expect(text).toMatch(/The finding is in a file this commit did not touch/);
    expect(text).toMatch(/godot_diff with ref \w+ and to \w+/);
    // Nothing in the working tree or the repository changed.
    expect(git(root, "status", "--porcelain")).toBe(before);
    expect(readFileSync(join(root, "notes.gd"), "utf8")).toBe("extends Node\n# 11\n");
  });

  it("works between a good and a bad commit, and with a rule, a file and words", () => {
    const { root, breaking } = history();
    const rule = bisectProject(root).findings?.[0]?.rule ?? "";
    const report = bisectProject(root, { good: "HEAD~10", bad: "HEAD~2", rule, file: "main.tscn", text: "player.gd" });
    expect(report).toMatchObject({ ok: true, range: 8 });
    expect(report.first?.hash).toBe(breaking);
    expect(report.looking).toBe(`rule ${rule} in res://main.tscn with "player.gd" in the message`);
    expect(bisectProject(root, { rule: "no/such-rule" })).toMatchObject({ ok: false });
  });

  it("explains why there is no answer", () => {
    const { root } = history();
    expect(bisectProject(root, { bad: "HEAD~8" }).reason).toMatch(/HEAD~8 does not have the problem/);
    expect(bisectProject(root, { good: "HEAD~1" }).reason).toMatch(/HEAD~1 already has the problem/);
    expect(() => bisectProject(root, { good: "nope" })).toThrow(/git does not know/);
    expect(() => bisectProject(root, { bad: "--exec=x" })).toThrow(/not a commit name/);
    // An error that was always there is not what broke: with only that one, there is no first bad commit.
    const always = makeProject({ "project.godot": "config_version=5\n", "x.gd": "extends Node\n" });
    commitAll(always, "first");
    writeFileSync(join(always, "y.gd"), "extends Node\n");
    git(always, "add", "-A");
    git(always, "commit", "-q", "-m", "second");
    const report = bisectProject(always);
    expect(report.ok).toBe(false);
    expect(report.reason).toMatch(/in every commit looked at, back to .* It was there from the first commit/);
    expect(report.findings?.[0]?.message).toMatch(/no main scene/);
  });

  it("leaves out errors that were there all along and finds the one that came later", () => {
    const root = makeProject({ "project.godot": "config_version=5\n", "main.tscn": MAIN, "player.gd": "extends Node\n" });
    commitAll(root, "no main scene from the start");
    writeFileSync(join(root, "a.gd"), "extends Node\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "a");
    git(root, "mv", "player.gd", "hero.gd");
    git(root, "commit", "-q", "-m", "move");
    writeFileSync(join(root, "b.gd"), "extends Node\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "b");
    const report = bisectProject(root);
    expect(report).toMatchObject({ ok: true, ignored: 1 });
    expect(report.first?.subject).toBe("move");
    expect(report.findings?.map((f) => f.file)).toEqual(["res://main.tscn"]);
    expect(formatBisect(report)).toMatch(/1 error was there before the range and is left out\./);
    expect(bisectProject(root, { good: "HEAD~3" })).toMatchObject({ ok: true, ignored: 1, first: { subject: "move" } });
  });

  it("handles a project in a subfolder that did not exist in the oldest commits", () => {
    const root = makeProject({ "README.md": "x\n" });
    commitAll(root, "empty");
    const game = join(root, "game");
    execFileSync("mkdir", ["-p", game]);
    for (const [name, content] of Object.entries({ "project.godot": PROJECT, "main.tscn": MAIN, "player.gd": "extends Node\n" })) writeFileSync(join(game, name), content);
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "add game");
    git(root, "mv", "game/player.gd", "game/hero.gd");
    git(root, "commit", "-q", "-m", "break");
    const report = bisectProject(game);
    expect(report.first?.subject).toBe("break");
    expect(report.changed).toEqual(["R res://player.gd -> res://hero.gd"]);
  });

  it("CLI: prints the commit, exit code 1 when there is none", async () => {
    const { root, breaking } = history();
    const found = await runCli(["bisect", "--path", root, "--good", "HEAD~11"]);
    expect(found.exitCode).toBe(0);
    expect(found.output).toContain(breaking);
    const json = JSON.parse((await runCli(["bisect", "--path", root, "--json"])).output) as { first: { hash: string } };
    expect(json.first.hash).toBe(breaking);
    expect((await runCli(["bisect", "--path", root, "--bad", "HEAD~9"])).exitCode).toBe(1);
    rmSync(join(root, ".git"), { recursive: true, force: true });
    const none = await runCli(["bisect", "--path", root]);
    expect(none.exitCode).toBe(1);
  });
});
