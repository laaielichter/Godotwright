import { execFileSync } from "node:child_process";
import {
  chmodSync, closeSync, constants, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import { checkProject, cleanup, runOutput, unexplainedExit } from "../src/check/check.js";
import { checkerSource } from "../src/check/checker-script.js";
import { findGodot, GodotNotFoundError, runGodot } from "../src/check/godot.js";
import { alive, trackProcess, waitForExit, within, type FakeProcess } from "./fake-godot.js";
import { FIXTURES, runCli } from "./helpers.js";

/** Temp folders this file creates; removed once the tests are done. */
const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** A stand-in for the Godot binary that replays canned output. */
function fakeGodot(behavior: {
  version?: string;
  checkLog?: string;
  finish?: boolean;
  runLog?: string;
  runOut?: string;
  holdPipes?: boolean;
  importLog?: string;
  importExit?: number | "signal";
  runExit?: number | "signal";
  verboseOut?: string;
}): string {
  const dir = tempDir("fake-godot-");
  const bin = join(dir, "godot");
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const b = ${JSON.stringify(behavior)};
fs.appendFileSync(${JSON.stringify(join(dir, "calls.log"))}, JSON.stringify(args) + "\\n");
if (args.includes("--version")) { console.log(b.version ?? "4.7.2.stable.official.fake"); process.exit(0); }
function exitWith(code) { if (code === "signal") process.kill(process.pid, "SIGKILL"); else process.exit(code); }
if (args.includes("--import")) { console.log("Godot Engine v4.7.2.stable.official.fake - https://godotengine.org"); process.stderr.write(b.importLog ?? ""); exitWith(b.importExit ?? 0); }
const scriptAt = args.indexOf("--script");
if (scriptAt >= 0 && b.holdPipes) {
  // Like OS.create_process: a child that inherits the output pipes and outlives this run. Godot itself never finishes.
  const grandchild = require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { stdio: "inherit" });
  fs.writeFileSync(${JSON.stringify(join(dir, "grandchild.pid"))}, String(grandchild.pid));
  setInterval(() => {}, 1000);
  return;
} else if (scriptAt >= 0) {
  const root = args[args.indexOf("--path") + 1];
  const checker = path.join(root, args[scriptAt + 1].replace("res://", ""));
  if (!fs.existsSync(checker)) { console.error("ERROR: checker missing"); process.exit(1); }
  process.stderr.write(b.checkLog ?? "");
  if (b.finish !== false) process.stderr.write("\\nGODOTWRIGHT_DONE 3 1\\n");
  process.exit(0);
}
if (args.includes("--quit-after") && args.includes("--verbose")) { process.stdout.write(b.verboseOut ?? ""); process.stderr.write(b.runLog ?? ""); process.exit(0); }
if (args.includes("--quit-after")) { process.stdout.write(b.runOut ?? ""); process.stderr.write(b.runLog ?? ""); exitWith(b.runExit ?? 0); }
process.exit(0);
`;
  writeFileSync(bin, script);
  chmodSync(bin, 0o755);
  return bin;
}

function copyFixture(name: string): string {
  const dir = tempDir(`godotwright-${name}-`);
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  return dir;
}

describe("checkProject", () => {
  it("collects script errors, scan warnings and run errors", async () => {
    const root = copyFixture("broken");
    const godot = fakeGodot({
      checkLog: [
        "GODOTWRIGHT_BEGIN res://scripts/broken.gd",
        'SCRIPT ERROR: Parse Error: Identifier "undefined_name" not declared in the current scope.',
        "   at: GDScript::reload (res://scripts/broken.gd:5)",
        'ERROR: Failed to load script "res://scripts/broken.gd" with error "Parse error".',
        "   at: load (modules/gdscript/gdscript.cpp:2936)",
        "GODOTWRIGHT_END res://scripts/broken.gd",
        "WARNING: 4 ObjectDB instances were leaked at exit (run with `--verbose` for details).",
        "   at: cleanup (core/object/object.cpp:2600)",
        "ERROR: 2 resources still in use at exit (run with --verbose for details).",
        "   at: clear (core/io/resource.cpp:810)",
      ].join("\n"),
      runLog: [
        "SCRIPT ERROR: Out of bounds get index '3' (on base: 'Array[int]')",
        "   at: _ready (res://scripts/main.gd:7)",
        "ERROR: 38 resources still in use at exit (run with --verbose for details).",
        "   at: clear (core/io/resource.cpp:810)",
      ].join("\n"),
      verboseOut: "Loading resource: res://main.tscn\nResource still in use: res://scripts/main.gd (GDScript)\nResource still in use: res://.godot/godotwright/x.gd (GDScript)\n",
    });
    // The journal shares .godot/godotwright with the checker; a check must leave it, so godot_undo still works.
    mkdirSync(join(root, ".godot", "godotwright", "journal"), { recursive: true });
    writeFileSync(join(root, ".godot", "godotwright", "journal", "keep"), "x");
    const result = await checkProject(root, { godot, runFrames: 10 });
    expect(result.godotVersion).toBe("4.7.2.stable.official.fake");
    expect([result.scripts, result.scenes]).toEqual([3, 1]);
    expect(result.diagnostics).toEqual([
      { severity: "warning", file: "res://main.tscn", line: 4, message: "missing Texture2D: res://missing.png", source: "scan" },
      {
        severity: "error",
        file: "res://scripts/broken.gd",
        line: 5,
        message: 'Parse Error: Identifier "undefined_name" not declared in the current scope.',
        source: "script",
      },
      {
        severity: "error",
        file: "res://scripts/main.gd",
        line: 7,
        message: "Out of bounds get index '3' (on base: 'Array[int]')",
        source: "script",
      },
      {
        severity: "warning",
        message: "at exit: 38 resources still in use at exit: res://scripts/main.gd (GDScript)",
        source: "run",
      },
    ]);
    expect(result.errors).toBe(2);
    // The leak at exit made a second, --verbose run that names what was still in use.
    expect(result.steps.map((s) => s.name)).toEqual(["import", "check", "run", "run-verbose"]);
    const quiet = await checkProject(root, { godot, runFrames: 10, leakDetails: false });
    expect(quiet.steps.map((s) => s.name)).toEqual(["import", "check", "run"]);
    // The checker script is removed afterwards.
    expect(existsSync(join(root, ".godot", "godotwright", "check"))).toBe(false);
    expect(existsSync(join(root, ".godot", "godotwright", "journal", "keep"))).toBe(true);
  });

  it("ends a run at its timeout even when a process Godot started keeps the output open", async () => {
    const root = copyFixture("demo");
    const godot = fakeGodot({ holdPipes: true });
    try {
      const result = await checkProject(root, { godot, import: false, timeoutMs: 1000 });
      expect(result.steps).toEqual([{ name: "check", ms: expect.any(Number), exitCode: null, timedOut: true }]);
      expect(result.diagnostics).toEqual([expect.objectContaining({ severity: "error", message: "check timed out after 1s" })]);
    } finally {
      try {
        process.kill(Number(readFileSync(join(dirname(godot), "grandchild.pid"), "utf8")), "SIGKILL");
      } catch {
        // The grandchild was already gone.
      }
    }
  });

  it("skips scan warnings from excluded folders", async () => {
    const root = copyFixture("broken");
    mkdirSync(join(root, "addons", "plugin"), { recursive: true });
    writeFileSync(
      join(root, "addons", "plugin", "bad.tscn"),
      '[gd_scene format=3]\n\n[ext_resource type="Texture2D" path="res://gone.png" id="1"]\n\n[node name="Root" type="Node2D"]\n',
    );
    const godot = fakeGodot({});
    const scanFiles = async (exclude?: string[], includeAddons?: boolean) => {
      const result = await checkProject(root, { godot, import: false, exclude, includeAddons });
      return result.diagnostics.filter((d) => d.source === "scan").map((d) => d.file);
    };
    // res://addons/ is third-party code and skipped by default; --include-addons brings it back.
    expect(await scanFiles()).toEqual(["res://main.tscn"]);
    expect(await scanFiles([], true)).toEqual(["res://addons/plugin/bad.tscn", "res://main.tscn"]);
    expect(await scanFiles(["addons"], true)).toEqual(["res://main.tscn"]);
    expect(await scanFiles(["res://addons/"], true)).toEqual(["res://main.tscn"]);
  });

  it("reports an import or run step that exits badly without an error line", async () => {
    const root = copyFixture("demo");
    const godot = fakeGodot({ importExit: 3, runExit: "signal" });
    const result = await checkProject(root, { godot, runFrames: 10 });
    expect(result.diagnostics.filter((d) => d.source === "import" || d.source === "run")).toEqual([
      { severity: "error", message: "import exited with code 3", source: "import" },
      { severity: "error", message: "run was killed by SIGKILL (the system does this when memory runs out); last output: (none)", source: "run" },
    ]);
    // Godot's crash handler catches the fault, prints it and aborts: the report names the crash, not only the abort.
    const crashed = {
      code: null,
      signal: "SIGABRT",
      stdout: "",
      stderr: "ERROR: boom\n   at: crash (core/core_bind.cpp:349)\n\n================================================================\nhandle_crash: Program crashed with signal 11\nEngine version: Godot Engine v4.7.2.stable.official\n[1] 7fe4d9645330 (libc.so.6+45330)\n-- END OF C++ BACKTRACE --\n",
      timedOut: false,
      ms: 1,
    };
    expect(unexplainedExit("import", crashed, [])?.message).toBe(
      "import was killed by SIGABRT: Godot crashed (signal 11); last output before the crash: ERROR: boom |    at: crash (core/core_bind.cpp:349)",
    );
    // An exit that Godot explained with an error is not reported twice.
    const explained = fakeGodot({
      importLog: "ERROR: Failed loading resource: res://missing.png.\n   at: _load (core/io/resource_loader.cpp:317)\n",
      importExit: 1,
    });
    const again = await checkProject(copyFixture("demo"), { godot: explained, runFrames: 0 });
    expect(again.diagnostics.filter((d) => d.source === "import")).toEqual([
      { severity: "error", file: "res://missing.png", message: "Failed loading resource: res://missing.png.", source: "import" },
    ]);
  });

  it("warns about other Godot versions and a checker that does not finish", async () => {
    const root = copyFixture("demo");
    const godot = fakeGodot({ version: "4.6.1.stable.official.fake", finish: false, checkLog: "boom" });
    const result = await checkProject(root, { godot, import: false });
    expect(result.steps.map((s) => s.name)).toEqual(["check"]);
    expect(result.diagnostics.map((d) => `${d.severity}: ${d.message}`)).toEqual([
      "warning: Godot 4.6.1.stable.official.fake found; Godotwright targets Godot 4.7.x",
      "error: checker did not finish (exit code 0); last output: boom",
    ]);
  });
});

describe("findGodot", () => {
  it("prefers an explicit path, then $GODOT, then PATH", () => {
    const godot = fakeGodot({});
    expect(findGodot(godot, {})).toBe(godot);
    expect(findGodot(undefined, { GODOT: godot })).toBe(godot);
    expect(findGodot(undefined, { PATH: join(godot, "..") })).toBe(godot);
    expect(() => findGodot(undefined, { PATH: "" })).toThrow(GodotNotFoundError);
    expect(() => findGodot("/no/such/godot", {})).toThrow(/not found or not executable/);
  });

  it("treats an unexpanded ${...} placeholder in $GODOT as unset (an empty setting in an MCP bundle)", () => {
    const godot = fakeGodot({});
    expect(findGodot(undefined, { GODOT: "${user_config.godot}", PATH: join(godot, "..") })).toBe(godot);
    expect(() => findGodot(undefined, { GODOT: "${user_config.godot}", PATH: "" })).toThrow(GodotNotFoundError);
  });

  it("returns an absolute path, so a relative --godot still works when Godot runs from the project", () => {
    const godot = fakeGodot({});
    // Godot is spawned from the project folder, so a path relative to the shell's folder would not resolve there.
    const rel = relative(process.cwd(), godot);
    expect(findGodot(rel, {})).toBe(godot);
    expect(findGodot(undefined, { GODOT: rel })).toBe(godot);
    expect(findGodot(undefined, { PATH: relative(process.cwd(), dirname(godot)) })).toBe(godot);
  });

  it("looks up a bare command name such as godot on PATH", () => {
    const godot = fakeGodot({});
    const dir = dirname(godot);
    expect(findGodot("godot", { PATH: dir })).toBe(godot);
    expect(findGodot(undefined, { GODOT: "godot", PATH: dir })).toBe(godot);
    expect(() => findGodot("godot", { PATH: "" })).toThrow(/not found or not executable: godot/);
  });

  /** Creates empty executables at the given paths under a fresh home folder. */
  function home(files: string[]): string {
    const root = tempDir("godot-home-");
    for (const file of files) {
      mkdirSync(join(root, file, ".."), { recursive: true });
      writeFileSync(join(root, file), "");
      chmodSync(join(root, file), 0o755);
    }
    return root;
  }

  it("finds the newest unzipped download on Windows, console build first", () => {
    const root = home([
      "Downloads/Godot_v4.6.1-stable_win64.exe",
      "Downloads/Godot_v4.7.2-stable_win64.exe/Godot_v4.7.2-stable_win64.exe",
      "Downloads/Godot_v4.7.2-stable_win64.exe/Godot_v4.7.2-stable_win64_console.exe",
      "Downloads/notes.txt",
    ]);
    expect(findGodot(undefined, { USERPROFILE: root }, "win32")).toBe(
      join(root, "Downloads", "Godot_v4.7.2-stable_win64.exe", "Godot_v4.7.2-stable_win64_console.exe"),
    );
  });

  it("finds Godot from Steam on Windows", () => {
    const root = home(["Steam/steamapps/common/Godot Engine/godot.windows.opt.tools.64.exe"]);
    expect(findGodot(undefined, { "ProgramFiles(x86)": root }, "win32")).toBe(
      join(root, "Steam", "steamapps", "common", "Godot Engine", "godot.windows.opt.tools.64.exe"),
    );
  });

  it("finds a download in the home folder on Linux", () => {
    const root = home(["Downloads/Godot_v4.7.2-stable_linux.x86_64"]);
    expect(findGodot(undefined, { HOME: root }, "linux")).toBe(join(root, "Downloads", "Godot_v4.7.2-stable_linux.x86_64"));
    expect(() => findGodot(undefined, { HOME: home(["Downloads/godot.txt"]) }, "linux")).toThrow(GodotNotFoundError);
  });
});

/** Capture a live sleep that has already exec'd and is still a direct child of the wrapper. */
function trackWrapperSleep(pid: number, wrapperPid: number): FakeProcess | undefined {
  try {
    const child = trackProcess(pid);
    if (!child) return undefined;
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const sleep = new RegExp(`^${pid} \\(sleep\\) [A-Za-z] ${wrapperPid} `);
    return sleep.test(stat) && alive(child) ? child : undefined;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ESRCH") return undefined;
    throw error;
  }
}

describe("runGodot on a timeout", () => {
  it.skipIf(process.platform !== "linux")("stops what a wrapper such as xvfb-run started, and lets the wrapper clean up", async () => {
    const dir = tempDir("gw-kill-");
    const marker = join(dir, "marker");
    const readinessFile = join(dir, "ready");
    const lifetimePipe = join(dir, "lifetime");
    const wrapper = join(dir, "wrapper.sh");
    writeFileSync(marker, "");
    // Like xvfb-run: a server in the background, a command in the foreground, and cleanup in an EXIT trap.
    writeFileSync(wrapper, `trap 'rm -f marker' EXIT
exec 3> lifetime
sleep 20 &
sh -c 'printf "%s %s %s\\n" "$1" "$2" "$$" > ready; exec sleep 20' sh "$$" "$!"
exit 0
`);

    // The wrapper opens the writer before it forks. Both sleepers inherit it even if startup fails before
    // the PID record is written. The reader never blocks, and EOF after the run settles means all writers closed.
    execFileSync("mkfifo", [lifetimePipe]);
    const reader = openSync(lifetimePipe, constants.O_RDONLY | constants.O_NONBLOCK);

    const timeoutMs = 3000;
    const watchdogMs = 7500;
    const started = performance.now();
    const deadline = started + timeoutMs;
    let settled = false;
    const run = runGodot("sh", [wrapper], { cwd: dir, timeoutMs }).then(({ timedOut }) => ({
      timedOut,
      elapsed: performance.now() - started,
      markerPresent: existsSync(marker),
    })).finally(() => { settled = true; });
    const result = within(run, "wrapper run to settle", watchdogMs);
    void result.catch(() => undefined); // Observe rejection while polling for readiness.

    const children = new Map<string, FakeProcess>();
    onTestFinished(async () => {
      const deadline = performance.now() + 30_000;
      try {
        await within(run.catch(() => undefined), "wrapper run cleanup", 30_000);
        const buffer = Buffer.alloc(1);
        while (performance.now() < deadline) {
          try {
            if (readSync(reader, buffer, 0, 1, null) === 0) return;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EAGAIN") throw error;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error("timed out waiting for the wrapper fixture to close its lifetime pipe");
      } finally {
        closeSync(reader);
      }
    }, 31_000);

    let ready = false;
    let observation = "waiting for a complete wrapper, background, and foreground PID record";
    while (!settled && performance.now() < deadline) {
      const record = existsSync(readinessFile) ? readFileSync(readinessFile, "utf8") : "";
      const match = /^([1-9]\d*) ([1-9]\d*) ([1-9]\d*)\n$/.exec(record);
      if (match) {
        const wrapperPid = Number(match[1]);
        const backgroundPid = Number(match[2]);
        const foregroundPid = Number(match[3]);
        const pids = [wrapperPid, backgroundPid, foregroundPid];
        if (new Set(pids).size !== 3 || pids.some((pid) => pid > 0x7fffffff || pid === process.pid)) {
          throw new Error(`invalid wrapper readiness record: ${record.trim()}`);
        }
        const roles = [["background", backgroundPid], ["foreground", foregroundPid]] as const;
        for (const [role, pid] of roles) {
          if (children.has(role)) continue;
          const child = trackWrapperSleep(pid, wrapperPid);
          if (child) children.set(role, child);
        }
        const missing = roles.filter(([role]) => {
          const child = children.get(role);
          return !child || !alive(child);
        });
        if (!missing.length && performance.now() < deadline) {
          ready = true;
          break;
        }
        observation = missing.length
          ? `missing live sleep under wrapper ${wrapperPid}: ${missing.map(([role, pid]) => `${role} (${pid})`).join(", ")}`
          : "both sleeps observed after the startup deadline";
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const { timedOut, elapsed, markerPresent } = await result.catch((error: unknown) => {
      throw new Error(`wrapper run failed (readiness: ${ready ? "both sleeps ready" : observation})`, { cause: error });
    });

    const processes = [...children.values()];
    const exitError = await waitForExit(processes, 3000).catch((error: unknown) => String(error));
    // Check the original identities even if the wrapper has exited and the sleepers have been reparented.
    const survivors = processes.filter(alive).map(({ pid }) => pid);
    expect({
      readiness: ready ? "both sleeps observed ready" : observation,
      timedOut,
      settledWithinWatchdog: elapsed < watchdogMs,
      markerPresent,
      exitError,
      survivors,
    }, `wrapper run settled after ${Math.round(elapsed)} ms`).toEqual({
      readiness: "both sleeps observed ready",
      timedOut: true,
      settledWithinWatchdog: true,
      markerPresent: false,
      exitError: undefined,
      survivors: [],
    });
  });

  it.skipIf(process.platform === "win32")("still kills a process that started nothing at once", async () => {
    const started = Date.now();
    const result = await runGodot("sleep", ["60"], { timeoutMs: 300 });
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("godotwright check", () => {
  it("prints compiler-style lines and exits with 1 on errors", async () => {
    const root = copyFixture("broken");
    const godot = fakeGodot({
      checkLog: 'SCRIPT ERROR: Parse Error: Unexpected "Indent".\n   at: GDScript::reload (res://scripts/broken.gd:5)\n',
    });
    const previous = process.exitCode;
    const { output } = await runCli(["check", root, "--godot", godot]);
    expect(output).toContain('res://scripts/broken.gd:5: error: Parse Error: Unexpected "Indent".');
    expect(output).toContain("1 error, 1 warning (Godot 4.7.2.stable.official.fake, 3 scripts, 1 scene)");
    expect(process.exitCode).toBe(1);
    process.exitCode = previous;
  });
});

describe("checkerSource", () => {
  it("writes exclude paths literally, even when they contain $ sequences", () => {
    const source = checkerSource({ instantiate: true, exclude: ["vendor/a$&b", "tools/$$"] });
    expect(source).toContain('const INSTANTIATE: bool = true\nconst EXCLUDE: Array[String] = ["res://vendor/a$&b", "res://tools/$$"]\n');
    expect(source.split("const MARKER").length).toBe(2);
  });
});

describe("running a scene and reading its output", () => {
  it("runs the scene asked for, returns what the game printed without engine noise, and keeps the tail", async () => {
    const root = copyFixture("demo");
    const godot = fakeGodot({ runOut: ["Godot Engine v4.7.2.stable.official.fake - https://godotengine.org", "", ...Array.from({ length: 250 }, (_, i) => `frame ${i}`), "score 3"].join("\n") });
    const result = await checkProject(root, { godot, scene: "scenes/Main.tscn" });
    const calls = readFileSync(join(godot, "..", "calls.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[]);
    const run = calls.find((c) => c.includes("--quit-after"))!;
    expect(run.slice(run.indexOf("--quit-after"))).toEqual(["--quit-after", "120", "res://scenes/Main.tscn"]);
    expect(result.output).toContain("score 3");
    expect(result.output).toContain("(first 51 lines left out)");
    expect(result.output).not.toContain("Godot Engine v");
    expect(result.output!.split("\n").length).toBe(201);
    expect(runOutput("")).toBe("");
  });

  it("shows the output from the CLI with --scene, and not without --run", async () => {
    const root = copyFixture("demo");
    const godot = fakeGodot({ runOut: "hello from _ready\n" });
    const run = await runCli(["check", root, "--godot", godot, "--scene", "res://scenes/Main.tscn"]);
    expect(run.output).toContain("--- output of the run (120 frames = 2 s of game time) ---\nhello from _ready\n---");
    const plain = await runCli(["check", root, "--godot", godot]);
    expect(plain.output).not.toContain("output of the run");
    const json = JSON.parse((await runCli(["check", root, "--godot", godot, "--run", "10", "--json"])).output) as { output?: string };
    expect(json.output).toBe("hello from _ready");
  });
});

describe("shader errors found headless and by drawing", () => {
  it("reports an error both passes find once, keeping the copy with the most to say", () => {
    const kept = cleanup([
      { severity: "error", file: "res://fx/a.gdshader", line: 3, message: "SCREEN_TEXTURE has been removed in favor of using hint_screen_texture with a uniform. To continue with minimal code changes add it.", source: "shader" },
      { severity: "error", file: "res://fx/lib.gdshaderinc", line: 2, message: "Unknown identifier in expression: 'x'.", source: "shader" },
      { severity: "error", file: "res://level.tscn", message: 'Invalid arguments for the built-in function: "vec4(float,float)". (shader line 4)', source: "scene" },
      { severity: "error", file: "res://fx/a.gdshader", line: 3, message: "SCREEN_TEXTURE has been removed in favor of using hint_screen_texture with a uniform. (Godot 3; use a uniform)", source: "shader" },
      { severity: "error", file: "res://fx/lib.gdshaderinc", line: 2, message: "Unknown identifier in expression: 'x'. (included from res://fx/b.gdshader:2)", source: "shader" },
      { severity: "error", file: "res://level.tscn", line: 7, message: 'Invalid arguments for the built-in function: "vec4(float,float)".', source: "shader" },
      { severity: "error", file: "res://fx/b.gdshader", line: 3, message: "Unknown identifier in expression: 'x'.", source: "shader" },
    ]);
    expect(kept.map((d) => `${d.file}:${d.line ?? ""} ${d.message.slice(0, 40)}`)).toEqual([
      "res://fx/a.gdshader:3 SCREEN_TEXTURE has been removed in favor",
      "res://fx/lib.gdshaderinc:2 Unknown identifier in expression: 'x'. (",
      'res://level.tscn:7 Invalid arguments for the built-in funct',
      "res://fx/b.gdshader:3 Unknown identifier in expression: 'x'.",
    ]);
    expect(kept[0]!.message).toContain("To continue");
  });
});
