import { Command } from "commander";
import { DepsFileError, depsOf, formatCycles, formatDepsOf, formatUnused, formatWhy, sceneCycles, unusedFiles, whyUsed, whyUsedDetails } from "../deps/deps.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { writeOut } from "./output.js";

export function depsCommand(): Command {
  const deps = new Command("deps").description("the project as a graph of files: unused files with their size, why a file is used, what a scene loads, and scene loops Godot cannot load");
  const path = (c: Command) => (c.optsWithGlobals() as { path?: string }).path ?? ".";
  deps.option("--path <dir>", "project directory (default: the current one)");
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const run = (c: Command, body: () => string | { output: string; failed: boolean }, errorPrefix = "") => {
    try {
      const r = body();
      writeOut(c, typeof r === "string" ? r : r.output);
      if (typeof r !== "string" && r.failed) process.exitCode = 1;
    } catch (error) {
      if (!(error instanceof ProjectNotFoundError) && !(error instanceof DepsFileError)) throw error;
      process.stderr.write(`${errorPrefix}${error.message}\n`);
      process.exitCode = 1;
    }
  };
  deps
    .command("unused")
    .description("files nothing the game starts with reaches (main scene, autoloads, settings, export filters, file lists), biggest first")
    .option("--json", "print the result as JSON")
    .action((o: { json?: boolean }, c: Command) =>
      run(c, () => {
        const r = unusedFiles(path(c));
        return o.json ? json(r) : formatUnused(r, 60);
      }),
    );
  deps
    .command("why")
    .description("the chain from where the game starts to this file, or why nothing reaches it")
    .argument("<file>", "res:// path")
    .option("--json", "print the result as JSON")
    .action((file: string, o: { json?: boolean }, c: Command) =>
      run(c, () => o.json ? json(whyUsedDetails(path(c), file)) : formatWhy(whyUsed(path(c), file))),
    );
  deps
    .command("of")
    .description("what a scene or resource loads with it (and what it can load later), biggest first, with missing paths")
    .argument("<file>", "res:// path")
    .option("--json", "print the result as JSON")
    .action((file: string, o: { json?: boolean }, c: Command) =>
      run(c, () => {
        const r = depsOf(path(c), file);
        return o.json ? json(r) : formatDepsOf(r, 40);
      }),
    );
  deps
    .command("cycles")
    .description("scenes and resources that load each other through ext_resource (Godot cannot load these)")
    .option("--json", "print the result as JSON")
    .action((o: { json?: boolean }, c: Command) =>
      run(c, () => {
        const cycles = sceneCycles(path(c));
        return { output: o.json ? json({ cycles }) : formatCycles(cycles), failed: cycles.length > 0 };
      // The text command previously let the top-level CLI report missing projects.
      }, o.json ? "" : "error: "),
    );
  return deps;
}
