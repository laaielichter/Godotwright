import { Command } from "commander";
import { depsOf, formatCycles, formatDepsOf, formatUnused, formatWhy, sceneCycles, unusedFiles, whyUsed } from "../deps/deps.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { writeOut } from "./output.js";

export function depsCommand(): Command {
  const deps = new Command("deps").description("the project as a graph of files: unused files with their size, why a file is used, what a scene loads, and scene loops Godot cannot load");
  const path = (c: Command) => (c.optsWithGlobals() as { path?: string }).path ?? ".";
  deps.option("--path <dir>", "project directory (default: the current one)");
  const run = (c: Command, body: () => string, failed = false) => {
    try {
      writeOut(c, body());
      if (failed) process.exitCode = 1;
    } catch (error) {
      if (!(error instanceof ProjectNotFoundError)) throw error;
      process.stderr.write(`${error.message}\n`);
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
        return o.json ? `${JSON.stringify(r, null, 2)}\n` : formatUnused(r, 60);
      }),
    );
  deps
    .command("why")
    .description("the chain from where the game starts to this file, or why nothing reaches it")
    .argument("<file>", "res:// path")
    .action((file: string, _o: unknown, c: Command) => run(c, () => formatWhy(whyUsed(path(c), file))));
  deps
    .command("of")
    .description("what a scene or resource loads with it (and what it can load later), biggest first, with missing paths")
    .argument("<file>", "res:// path")
    .action((file: string, _o: unknown, c: Command) => run(c, () => formatDepsOf(depsOf(path(c), file), 40)));
  deps
    .command("cycles")
    .description("scenes and resources that load each other through ext_resource (Godot cannot load these)")
    .action((_o: unknown, c: Command) => {
      const cycles = sceneCycles(path(c));
      run(c, () => formatCycles(cycles), cycles.length > 0);
    });
  return deps;
}
