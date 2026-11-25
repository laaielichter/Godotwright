import { Command } from "commander";
import { complexityReport, formatComplexity } from "../metrics/complexity.js";
import { formatSignals, formatSignalsMermaid, signalFlow } from "../metrics/signals.js";
import { formatStats, projectStats } from "../metrics/stats.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { BASE_FILES_HELP, BASE_HELP, collect, parseNumber, writeOut } from "./output.js";

interface Common {
  path?: string;
  json?: boolean;
  limit?: number;
  base: string[];
  baseFiles: string[];
  addons?: boolean;
}

/** The options every metrics subcommand has. */
function metric(name: string, description: string): Command {
  return new Command(name)
    .description(description)
    .argument("[path]", "project directory (or any path inside it)", ".")
    .option("--path <dir>", "project directory (the same as the argument)")
    .option("--limit <n>", "how many entries each list shows", parseNumber)
    .option("--addons", "also count res://addons/")
    .option("--base <dir>", BASE_HELP, collect, [])
    .option("--base-files <file>", BASE_FILES_HELP, collect, [])
    .option("--json", "print the result as JSON");
}

/** Runs one subcommand: a missing project is a message and exit code 1, not a stack trace. */
function run<T>(command: Command, o: Common, build: () => T, text: (report: T) => string, failed: (report: T) => boolean = () => false): void {
  try {
    const report = build();
    writeOut(command, o.json ? `${JSON.stringify(report, null, 2)}\n` : text(report));
    if (failed(report)) process.exitCode = 1;
  } catch (error) {
    if (!(error instanceof ProjectNotFoundError)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

const load = (o: Common) => ({ base: o.base, baseFiles: o.baseFiles, includeAddons: o.addons === true });

export function metricsCommand(): Command {
  const complexity = metric("complexity", "cyclomatic complexity of every GDScript function with a grade (A 1-5 to F 41+), its lines and nesting depth; the functions above the threshold first")
    .option("--threshold <n>", "list the functions above this complexity (default 10)", parseNumber)
    .action((path: string, o: Common & { threshold?: number }, command: Command) => {
      run(command, o, () => complexityReport(o.path ?? path, { ...load(o), threshold: o.threshold }), (r) => formatComplexity(r, o.limit));
    });
  const signals = metric("signals", "the signal flow: every signal, who emits it and who connects to it, and what is a bug: declared but never emitted, emitted but never connected, connected to a method that does not exist")
    .option("--mermaid", "print a mermaid flowchart: emitter --> signal --> receiver")
    .action((path: string, o: Common & { mermaid?: boolean }, command: Command) => {
      run(
        command,
        o,
        () => signalFlow(o.path ?? path, load(o)),
        (r) => (o.mermaid ? formatSignalsMermaid(r, o.limit) : formatSignals(r, o.limit)),
        (r) => r.missingMethods.length > 0,
      );
    });
  const stats = metric("stats", "project statistics: scripts, scenes, resources, shaders and assets by kind, lines of GDScript (code, comment, blank), typed-ness, the biggest scripts and the heaviest scenes")
    .action((path: string, o: Common, command: Command) => {
      run(command, o, () => projectStats(o.path ?? path, load(o)), (r) => formatStats(r, o.limit));
    });
  return new Command("metrics")
    .description("numbers about the project, from its files: function complexity, the signal flow, and project and scene statistics")
    .addCommand(complexity)
    .addCommand(signals)
    .addCommand(stats);
}
