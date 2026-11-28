import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { runGodot } from "../src/check/godot.js";
import { CancelledError, ProgressParser, phaseOf, throttle, withRun } from "../src/check/progress.js";
import { createServer } from "../src/mcp/server.js";
import { alive, fakeGodot, trackProcess, waitForExit, waitForFakeProcesses, within, type FakeProcess } from "./fake-godot.js";
import { makeProject } from "./helpers.js";

// Run every cleanup even when one fails. Vitest records hook failures alongside the original assertion failure.
async function cleanup(...work: Promise<unknown>[]): Promise<void> {
  const results = await Promise.allSettled(work);
  const errors = results.filter((r) => r.status === "rejected").map((r) => r.reason);
  if (errors.length) throw new AggregateError(errors, "cancellation test cleanup failed");
}

describe("progress parser", () => {
  it("reads import steps through ANSI codes, checker counts and play frames", () => {
    const p = new ProgressParser("import");
    expect(p.line("\x1b[0m[  16% ] first_scan_filesystem | Loading global class names...\x1b[0m")).toBe("import: first_scan_filesystem 16%");
    expect(p.line("[ DONE ] first_scan_filesystem")).toBe("import: first_scan_filesystem done");
    const load = new ProgressParser("load");
    expect(load.line("GODOTWRIGHT_TOTAL 4")).toBe("load: 4 files");
    expect(load.line("GODOTWRIGHT_BEGIN res://a.gd")).toBeUndefined();
    expect(load.line("GODOTWRIGHT_END res://a.gd")).toBe("load: 1/4 files");
    expect(new ProgressParser("play").line("GODOTWRIGHT_PLAY_PROGRESS 60 600")).toBe("play: frame 60/600");
    expect(load.line("SCRIPT ERROR: nope")).toBeUndefined();
  });

  it("names the phase from Godot's arguments", () => {
    expect(phaseOf(["--headless", "--import"])).toBe("import");
    expect(phaseOf(["--script", "res://.godot/godotwright/check.gd"])).toBe("load");
    expect(phaseOf(["-s", "res://.godot/godotwright/play.gd"])).toBe("play");
    expect(phaseOf(["--export-pack", "Linux", "x.pck"])).toBe("export");
    expect(phaseOf(["--quit-after", "10"])).toBe("run");
    expect(phaseOf(["--version"])).toBe("version");
    // xvfb-run's own -s comes first; the script is Godot's.
    const xvfb = ["-a", "-s", "-screen 0 1920x1080x24", "/bin/godot", "--path", "/p", "-s", "res://.godot/godotwright/screenshot.gd"];
    expect(phaseOf(xvfb)).toBe("screenshot");
    expect(phaseOf(["-a", "-s", "-screen 0 1920x1080x24", "/bin/godot", "--path", "/p", "--quit-after", "5"])).toBe("run");
  });
});

describe("progress throttle", () => {
  it("holds back a message that comes too soon and sends the newest one once the interval has passed", () => {
    vi.useFakeTimers();
    try {
      const sent: string[] = [];
      const t = throttle((m) => sent.push(m), 1000);
      t("play: started", true);
      t("play: frame 0/5000");
      t("play: frame 1/5000");
      expect(sent).toEqual(["play: started"]);
      vi.advanceTimersByTime(1000);
      expect(sent).toEqual(["play: started", "play: frame 1/5000"]);
      t("import: scan done");
      vi.advanceTimersByTime(10);
      expect(sent).toHaveLength(2);
      // The end of a run sends what is held back, before the next phase.
      t.flush();
      t("load: started", true);
      expect(sent.slice(2)).toEqual(["import: scan done", "load: started"]);
      t("load: 1/4 files");
      t.stop();
      vi.advanceTimersByTime(5000);
      expect(sent).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("cancelling a Godot run", () => {
  // 10 s readiness + 10 s cancellation + 10 s exit + bounded cleanup; below the fixture child's 60 s lifetime.
  it("stops Godot and the process it started, and rejects with CancelledError", { timeout: 45_000 }, async () => {
    const fake = fakeGodot({ hang: true });
    const controller = new AbortController();
    const run = runGodot(fake.bin, ["--headless", "--script", "res://check.gd"], { signal: controller.signal, timeoutMs: 60_000 });
    void run.catch(() => undefined); // Observe an early failure even while waiting for readiness.
    const processes: FakeProcess[] = [];
    onTestFinished(async () => {
      controller.abort();
      await cleanup(within(run.catch(() => undefined), "cancelled run cleanup", 5000), waitForExit(processes, 5000));
    }, 10_000);
    await waitForFakeProcesses(fake, processes);
    controller.abort();
    await within(expect(run).rejects.toBeInstanceOf(CancelledError), "CancelledError");
    await waitForExit(processes);
  });

  it("keeps waiting when one owned process exits and another stays live", { timeout: 15_000 }, async () => {
    // Helper-level negative control: both handles belong to this test, so there is no orphan to clean up.
    const children = [0, 1].map(() => spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" }));
    const exits = children.map((child) => once(child, "exit"));
    exits.forEach((exited) => void exited.catch(() => undefined));
    onTestFinished(() => cleanup(...children.map(async (child, i) => {
      child.kill("SIGKILL");
      await within(exits[i]!, "owned process reaping", 5000);
    })), 10_000);
    await Promise.all(children.map((child) => once(child, "spawn")));
    const processes = children.map((child) => trackProcess(child.pid!)!);
    children[0]!.kill("SIGKILL");
    await within(exits[0]!, "owned process exit", 5000);
    await waitForExit([processes[0]!]);
    expect(alive(processes[1]!)).toBe(true);
    await expect(waitForExit(processes, 100)).rejects.toThrow("still alive:");
    expect(alive(processes[1]!)).toBe(true);
  });

  it("does not start Godot when the run is already cancelled", async () => {
    const fake = fakeGodot();
    const controller = new AbortController();
    controller.abort();
    await expect(withRun({ signal: controller.signal }, () => runGodot(fake.bin, ["--import"]))).rejects.toBeInstanceOf(CancelledError);
    expect(existsSync(join(fake.dir, "calls.log"))).toBe(false);
  });
});

describe("MCP progress and cancel", () => {
  const project = () => makeProject({ "project.godot": "config_version=5\n", "a.gd": "extends Node\n" });

  async function connect(root: string, godot: string) {
    const server = createServer({ root, godot });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    return { client, close: () => Promise.all([client.close(), server.close()]) };
  }

  it("sends progress per phase of godot_check when the client asks for it", async () => {
    const fake = fakeGodot();
    const { client, close } = await connect(project(), fake.bin);
    const seen: { progress: number; message?: string }[] = [];
    const r = await client.callTool({ name: "godot_check", arguments: {} }, undefined, { onprogress: (p) => seen.push(p) });
    await close();
    expect(r.isError).toBeFalsy();
    const messages = seen.map((p) => p.message);
    expect(messages).toEqual(expect.arrayContaining(["import: started", "load: started"]));
    // Progress only goes up, as the protocol requires.
    expect(seen.map((p) => p.progress)).toEqual(seen.map((_, i) => i + 1));
  });

  it("stops the Godot process tree when the client cancels godot_check", { timeout: 45_000 }, async () => {
    const fake = fakeGodot({ hang: true });
    const { client, close } = await connect(project(), fake.bin);
    const controller = new AbortController();
    const call = client.callTool({ name: "godot_check", arguments: {} }, undefined, { signal: controller.signal });
    void call.catch(() => undefined);
    const processes: FakeProcess[] = [];
    const reason = new McpError(ErrorCode.RequestTimeout, "intentional cancellation of the process-tree test");
    onTestFinished(async () => {
      controller.abort(reason);
      await cleanup(within(close(), "MCP cleanup", 5000), waitForExit(processes, 5000));
    }, 10_000);
    await waitForFakeProcesses(fake, processes);
    controller.abort(reason);
    await within(expect(call).rejects.toBe(reason), "MCP cancellation reason");
    await waitForExit(processes);
  });
});
