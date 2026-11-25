import { spawn, spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { DOTNET_ENV, findCSharpProject, findDotnet, isRestored } from "../check/csharp-build.js";
import { fromResPath, listProjectFiles } from "../project/files.js";
import { RpcConnection } from "./jsonrpc.js";
import { LanguageServer, LanguageServerError, LanguageServerPool, trackProcess, uriOf, type ServerStamp } from "./server.js";

/**
 * The C# language server: csharp-ls (https://github.com/razzmatazz/csharp-language-server, MIT), a Roslyn server that
 * speaks standard LSP over stdin and stdout and needs no editor. The user installs it; Godotwright never does.
 * Observed with csharp-ls 0.16.0 on dotnet 8.0.134 and a Godot.NET.Sdk 4.7.0 project:
 * - It finds the .sln (or the .csproj) under the root, loads it in 2-4 s and says so with a `$/progress` "end" (when
 *   the client declares window.workDoneProgress). Before that every request answers null.
 * - The project must be restored (project.assets.json): without it the Godot API is unknown and hover answers null.
 * - Godot's source generators run in it: `SignalName.X`, `PropertyName.X`, `MethodName.X` and the signal events are
 *   known, and they are missing again in the diagnostics once the delegate is renamed.
 * - Diagnostics are pulled (`textDocument/diagnostic`), also for a file that is not open. An opened document's text
 *   stays after didClose; a file changed, added or removed on disk is only seen after
 *   `workspace/didChangeWatchedFiles`.
 * - A symbol from Godot's assembly has a `csharp:/metadata/...` definition, not a file.
 * - `shutdown` and `exit` work.
 */

/** The version of csharp-ls that runs on each .NET SDK: every release targets one .NET (0.16.0 net8.0, 0.17-0.20 net9.0, 0.29.0 net11.0). */
export const CSHARP_LS_FOR_DOTNET_8 = "0.16.0";

export class CSharpLsMissingError extends LanguageServerError {
  constructor(readonly installCommand: string) {
    super(
      `the C# language server csharp-ls is not installed, so this needs it and nothing was done. Install it yourself with: ${installCommand} ` +
        "(MIT, https://github.com/razzmatazz/csharp-language-server; Godotwright does not install tools). Everything else keeps working: godot_check builds the C# code, godot_review, godot_scan and godot_usages read it.",
    );
    this.name = "CSharpLsMissingError";
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The csharp-ls executable: `$CSHARP_LS`, PATH, then the folder `dotnet tool install --global` uses. */
export function findCSharpLs(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home: string = homedir()): string | undefined {
  const explicit = env["CSHARP_LS"];
  if (explicit) return isFile(explicit) ? explicit : undefined;
  const names = platform === "win32" ? ["csharp-ls.exe", "csharp-ls.cmd", "csharp-ls"] : ["csharp-ls"];
  const dirs = [...(env["PATH"] ?? env["Path"] ?? "").split(delimiter).filter(Boolean), join(home, ".dotnet", "tools")];
  for (const dir of dirs) for (const name of names) if (isFile(join(dir, name))) return join(dir, name);
  return undefined;
}

/** The exact command that installs csharp-ls for the .NET SDK on this machine (`sdkVersion` as `dotnet --version` prints it). */
export function csharpLsInstallCommand(sdkVersion?: string): string {
  const major = Number(/^(\d+)\./.exec(sdkVersion ?? "")?.[1]);
  // The newest csharp-ls needs the newest .NET; on .NET 8 only 0.16.0 installs ("DotnetToolSettings.xml was not found").
  return major === 8 ? `dotnet tool install --global csharp-ls --version ${CSHARP_LS_FOR_DOTNET_8}` : "dotnet tool install --global csharp-ls";
}

function sdkVersion(): string | undefined {
  const dotnet = findDotnet();
  if (!dotnet) return undefined;
  try {
    const run = spawnSync(dotnet, ["--version"], { encoding: "utf8", timeout: 20_000, env: { ...process.env, ...DOTNET_ENV } });
    return run.status === 0 ? run.stdout.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** The error for a machine without csharp-ls, with the install command for its .NET SDK. */
export function csharpLsMissing(): CSharpLsMissingError {
  const version = sdkVersion();
  return new CSharpLsMissingError(version === undefined ? `${csharpLsInstallCommand()} (after installing the .NET SDK 8 or later; with the .NET 8 SDK add --version ${CSHARP_LS_FOR_DOTNET_8})` : csharpLsInstallCommand(version));
}

function mtime(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return -1;
  }
}

/** LSP FileChangeType. */
export interface FileChange {
  path: string;
  type: 1 | 2 | 3;
}

/**
 * What a warm csharp-ls knows of the project. The project files (.csproj, .sln, the restored packages) are read once,
 * at its start: a change there needs a new server. C# files changed, added or removed on disk are told to the running
 * server (`changes`), which is all it needs.
 */
export class CSharpStamp implements ServerStamp {
  private project = "";
  private files = new Map<string, number>();
  private initialized = false;

  constructor(private readonly root: string) {}

  private projectKey(): string {
    const found = findCSharpProject(this.root);
    const assets = [join(this.root, ".godot", "mono", "temp", "obj", "project.assets.json"), join(this.root, "obj", "project.assets.json")];
    return [found.csproj, found.sln].map((f) => (f ? `${f}@${mtime(join(this.root, f))}` : "-")).concat(assets.map((a) => String(mtime(a)))).join("|");
  }

  refresh(): string | undefined {
    const key = this.projectKey();
    const changed = this.initialized && key !== this.project;
    this.project = key;
    if (!this.initialized) {
      this.initialized = true;
      this.changes();
    }
    return changed ? "the .csproj, the .sln or the restored packages changed" : undefined;
  }

  /** The C# files that changed on disk since the last call (the first call lists none: the server reads them at its start). */
  changes(): FileChange[] {
    const first = this.files.size === 0 && !this.seen;
    this.seen = true;
    const now = new Map<string, number>();
    const out: FileChange[] = [];
    for (const res of listProjectFiles(this.root)) {
      if (!/\.cs$/i.test(res)) continue;
      const path = fromResPath(this.root, res);
      const time = mtime(path);
      now.set(path, time);
      const before = this.files.get(path);
      if (before === undefined) out.push({ path, type: 1 });
      else if (before !== time) out.push({ path, type: 2 });
    }
    for (const path of this.files.keys()) if (!now.has(path)) out.push({ path, type: 3 });
    this.files = now;
    return first ? [] : out;
  }

  private seen = false;
}

export interface CSharpStartOptions {
  root: string;
  /** The csharp-ls executable; found when omitted. */
  bin?: string;
  /** How long to wait for the solution to load (default 180 s). */
  startTimeoutMs?: number;
  /** Timeout of each request (default 60 s: the first request after a load compiles the project). */
  requestTimeoutMs?: number;
}

/** Starts csharp-ls on the project and waits until it has loaded the solution. */
export async function startCSharpServer(options: CSharpStartOptions): Promise<LanguageServer> {
  const started = Date.now();
  const { root } = options;
  const found = findCSharpProject(root);
  if (!found.csproj && !found.sln) {
    throw new LanguageServerError("no .csproj or .sln in the project root: this is not a C# project, or Godot has not made the C# solution yet (Project > Tools > C# > Create C# solution)");
  }
  const bin = options.bin ?? findCSharpLs();
  if (!bin) throw csharpLsMissing();
  if (!isRestored(root, found.csproj)) {
    throw new LanguageServerError(
      `the NuGet packages of ${found.csproj ?? found.sln} were never restored, so the C# language server would not know Godot's API. Run godot_check once (it runs dotnet build, which restores), or \`dotnet restore\` in the project folder; that needs the network`,
    );
  }
  const stamp = new CSharpStamp(root);
  stamp.refresh();
  // A .slnx or several solutions: csharp-ls then loads the .csproj files it finds under the root.
  const args = found.sln && /\.sln$/i.test(found.sln) ? ["--solution", found.sln] : [];
  const child = spawn(bin, args, { cwd: root, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...DOTNET_ENV } });
  trackProcess(child);
  let output = "";
  let exited: string | undefined;
  child.stderr.on("data", (chunk: Buffer) => {
    output = (output + chunk.toString("utf8")).slice(-8000);
  });
  child.on("error", (error) => (exited = `could not start csharp-ls (${bin}): ${error.message}`));
  child.on("exit", (code, signal) => (exited ??= `csharp-ls exited (${signal ?? `code ${code}`})`));
  child.unref();
  for (const pipe of [child.stdin, child.stdout, child.stderr]) (pipe as unknown as { unref?: () => void }).unref?.();
  const rpc = new RpcConnection({ input: child.stdout, output: child.stdin }, options.requestTimeoutMs ?? 60_000);
  // csharp-ls asks for its settings (one answer per item) and registers file watching; neither needs anything.
  rpc.onRequest = (method, params) => (method === "workspace/configuration" ? ((params as { items?: unknown[] } | undefined)?.items ?? []).map(() => null) : null);
  const server = new LanguageServer(root, rpc, child, () => output, stamp, "csharp");
  const startTimeout = options.startTimeoutMs ?? 180_000;
  const messages: string[] = [];
  rpc.onNotification((method, params) => {
    if (method !== "window/showMessage") return;
    const text = String((params as { message?: unknown } | undefined)?.message ?? "");
    if (text) messages.push(text.replace(/^csharp-ls:\s*/, ""));
    if (messages.length > 12) messages.shift();
  });
  const tail = () => (messages.length ? `\nlast messages:\n${messages.slice(-4).join("\n")}` : output.trim() ? `\nlast output:\n${output.trim().split(/\r?\n/).slice(-4).join("\n")}` : "");
  try {
    const loaded = rpc.waitFor(
      (method, params) => (method === "$/progress" && (params as { value?: { kind?: string } } | undefined)?.value?.kind === "end" ? true : undefined),
      startTimeout,
      "the solution to load",
    );
    loaded.catch(() => undefined);
    await rpc.request(
      "initialize",
      {
        processId: process.pid,
        rootUri: uriOf(root),
        rootPath: root,
        capabilities: {
          window: { workDoneProgress: true },
          workspace: { workspaceEdit: { documentChanges: true }, configuration: true },
          textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true }, hover: { contentFormat: ["markdown", "plaintext"] }, rename: { prepareSupport: true } },
        },
      },
      startTimeout,
    );
    rpc.notify("initialized", {});
    await loaded;
  } catch (error) {
    server.stop();
    throw new LanguageServerError(`${exited ?? "csharp-ls did not load the project"}: ${error instanceof Error ? error.message : String(error)}${tail()}`);
  }
  server.startMs = Date.now() - started;
  return server;
}

/** Tells a warm csharp-ls which C# files changed on disk since it last looked. */
export function syncCSharpFiles(server: LanguageServer): number {
  if (!(server.stamp instanceof CSharpStamp)) return 0;
  const changes = server.stamp.changes();
  if (changes.length) server.rpc.notify("workspace/didChangeWatchedFiles", { changes: changes.map((c) => ({ uri: uriOf(c.path), type: c.type })) });
  return changes.length;
}

let shared: LanguageServerPool | undefined;

/** A pool of csharp-ls servers: the same warm, idle-stop and restart rules as the GDScript pool. */
export function csharpPool(options: { keepWarm?: boolean; idleMs?: number } = {}): LanguageServerPool {
  return new LanguageServerPool({ ...options, start: (root, bin) => startCSharpServer({ root, ...(bin ? { bin } : {}) }) });
}

/** The C# pool the MCP server shares in this process. */
export function sharedCSharpPool(): LanguageServerPool {
  shared ??= csharpPool();
  return shared;
}
