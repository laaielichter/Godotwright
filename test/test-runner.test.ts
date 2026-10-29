import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TestRunError, detectFramework, formatTests, parseJUnit, runTests, testsPassed } from "../src/test/run.js";
import { makeProject, runCli } from "./helpers.js";

const GUT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="GutTests" failures="1" tests="3">
    <testsuite name="test/unit/test_player.gd" tests="3" failures="1" skipped="1" time="0.042" >
        <testcase name="test_jump" assertions="1" status="pass" classname="test/unit/test_player.gd" time="0.01" >
        </testcase>
        <testcase name="test_damage" assertions="1" status="fail" classname="test/unit/test_player.gd" time="0.02" >
            <failure message="failed"><![CDATA[[Failed]:  [2] expected to equal [3]:  health after a hit
      at line 14]]></failure>
        </testcase>
        <testcase name="test_later" assertions="0" status="pending" classname="test/unit/test_player.gd" time="0.0" >
            <skipped message="pending"><![CDATA[not done]]></skipped>
        </testcase>
    </testsuite>
</testsuites>
`;

const GDUNIT_XML = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites id="2026-10-29" name="report_1" tests="3" failures="1" skipped="0" flaky="0" time="0.120">
	<testsuite id="0" name="PlayerTest" package="res://test/player_test.gd" timestamp="2026-10-29" hostname="localhost" tests="3" failures="1" errors="1" skipped="0" flaky="0" time="0.120">
		<testcase name="test_move" classname="PlayerTest" time="0.010">
		</testcase>
		<testcase name="test_speed" classname="PlayerTest" time="0.020">
			<failure message="FAILED: res://test/player_test.gd:22" type="FAILURE">
				<![CDATA[Expecting:
 '300'
 but was
 '250']]>
			</failure>
		</testcase>
		<testcase name="test_crash" classname="PlayerTest" time="0.020">
			<error message="ERROR: res://test/player_test.gd:31" type="ABORT"><![CDATA[Invalid call &amp; crash]]></error>
		</testcase>
	</testsuite>
</testsuites>
`;

/** A stand-in for Godot: writes the report where the runner asks for it, and logs its arguments. */
function fakeGodot(dir: string, xml: string, log: string): string {
  const bin = join(dir, "fake-godot.sh");
  writeFileSync(join(dir, "report.xml"), xml);
  writeFileSync(
    bin,
    `#!/bin/sh
echo "$@" >> "${log}"
for a in "$@"; do
  case "$a" in
    --version) echo "4.7.2.stable.official.fake"; exit 0;;
    --import) exit 0;;
    -gjunit_xml_file=*) cp "${join(dir, "report.xml")}" "\${a#-gjunit_xml_file=}";;
  esac
done
prev=""
for a in "$@"; do
  if [ "$prev" = "-rd" ]; then d="${dir}/\${a#res://}/report_1"; mkdir -p "$d"; cp "${join(dir, "report.xml")}" "$d/results.xml"; fi
  prev="$a"
done
echo "SCRIPT ERROR: Parse Error: Identifier \\"nope\\" not declared in the current scope." >&2
echo "          at: GDScript::reload (res://test/broken_test.gd:3)" >&2
exit 1
`,
  );
  chmodSync(bin, 0o755);
  return bin;
}

function project(framework: "gut" | "gdunit"): string {
  const root = makeProject({ "project.godot": "[application]\n", "test/.keep": "" });
  if (framework === "gut") {
    mkdirSync(join(root, "addons/gut"), { recursive: true });
    writeFileSync(join(root, "addons/gut/gut_cmdln.gd"), "extends SceneTree\n");
  } else {
    mkdirSync(join(root, "addons/gdUnit4/bin"), { recursive: true });
    writeFileSync(join(root, "addons/gdUnit4/bin/GdUnitCmdTool.gd"), "extends SceneTree\n");
  }
  return root;
}

describe("test runner", () => {
  it("reads a GUT JUnit report: counts, the failure with its line, skipped tests", () => {
    const r = parseJUnit(GUT_XML);
    expect(r).toMatchObject({ tests: 3, passed: 1, failed: 1, errors: 0, skipped: 1, seconds: 0.042 });
    expect(r.failures).toEqual([
      { suite: "test/unit/test_player.gd", test: "test_damage", file: "res://test/unit/test_player.gd", line: 14, kind: "failure", message: "[Failed]: [2] expected to equal [3]: health after a hit" },
    ]);
  });

  it("reads a GdUnit4 report: failures and errors with res://file:line", () => {
    const r = parseJUnit(GDUNIT_XML);
    expect(r).toMatchObject({ tests: 3, passed: 1, failed: 1, errors: 1, skipped: 0 });
    expect(r.failures.map((f) => `${f.file}:${f.line} ${f.test} ${f.kind} ${f.message}`)).toEqual([
      "res://test/player_test.gd:22 test_speed failure Expecting: '300' but was '250'",
      "res://test/player_test.gd:31 test_crash error Invalid call & crash",
    ]);
  });

  it("finds the framework from res://addons and refuses a project without one", async () => {
    expect(detectFramework(project("gut"))).toBe("gut");
    expect(detectFramework(project("gdunit"))).toBe("gdunit");
    const none = makeProject({ "project.godot": "[application]\n" });
    await expect(runTests(none)).rejects.toThrow(TestRunError);
    await expect(runTests(project("gut"), { framework: "gdunit" })).rejects.toThrow(/GdUnit4 .* is not installed/);
  });

  it("runs GUT headless with a JUnit file and reports only what failed", async () => {
    const root = project("gut");
    const log = join(root, "args.log");
    const report = await runTests(root, { godot: fakeGodot(root, GUT_XML, log), filter: "damage" });
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls[0]).toContain("--import");
    expect(calls[1]).toMatch(/--headless --path .* -s res:\/\/addons\/gut\/gut_cmdln\.gd -gexit -gdisable_colors -gjunit_xml_file=\S+ -gdir=res:\/\/test -ginclude_subdirs -gunit_test_name=damage/);
    expect(testsPassed(report)).toBe(false);
    const text = formatTests(report);
    expect(text).toContain("GUT: 1 passed, 1 failed, 1 skipped of 3 (0.042s)");
    expect(text).toContain("res://test/unit/test_player.gd:14  test_damage  [Failed]");
    expect(text).toContain("res://test/broken_test.gd:3  error: Parse Error");
    expect(text).not.toContain("test_jump");
  });

  it("runs GdUnit4 with its report folder", async () => {
    const root = project("gdunit");
    const log = join(root, "args.log");
    const report = await runTests(root, { godot: fakeGodot(root, GDUNIT_XML, log), paths: ["res://test/player_test.gd"] });
    const call = readFileSync(log, "utf8").trim().split("\n")[1] ?? "";
    expect(call).toMatch(/-s res:\/\/addons\/gdUnit4\/bin\/GdUnitCmdTool\.gd --ignoreHeadlessMode -a res:\/\/test\/player_test\.gd -rd res:\/\/\.godot\/godotwright\/gdunit-report -rc 1/);
    expect(report).toMatchObject({ framework: "gdunit", failed: 1, errors: 1 });
    await expect(runTests(root, { godot: fakeGodot(root, GDUNIT_XML, log), filter: "x" })).rejects.toThrow(/GUT only/);
  });

  it("says so when no report comes out, and shows the tail of the output", async () => {
    const root = project("gut");
    const bin = join(root, "silent.sh");
    writeFileSync(bin, '#!/bin/sh\ncase "$*" in *--import*) exit 0;; esac\necho "GUT could not start: classes not imported"\nexit 0\n');
    chmodSync(bin, 0o755);
    const report = await runTests(root, { godot: bin });
    expect(testsPassed(report)).toBe(false);
    expect(formatTests(report)).toContain("no test report came out of the run (exit code 0); last output:\nGUT could not start");
  });

  it("runs from the CLI with exit code 1 on failures", async () => {
    const root = project("gut");
    const run = await runCli(["test", root, "--godot", fakeGodot(root, GUT_XML, join(root, "a.log"))]);
    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("1 failed");
    const json = JSON.parse((await runCli(["test", root, "--json", "--godot", fakeGodot(root, GUT_XML, join(root, "a.log"))])).output) as { failures: unknown[] };
    expect(json.failures.length).toBe(1);
    process.exitCode = undefined;
  });
});
