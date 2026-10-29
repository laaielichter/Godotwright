import { Command, InvalidArgumentError } from "commander";
import { GodotNotFoundError } from "../check/godot.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { TestRunError, formatTests, runTests, testsPassed, type Framework } from "../test/run.js";
import { collect, parseNumber, writeOut } from "./output.js";

interface Options {
  godot?: string;
  framework?: Framework;
  dir: string[];
  filter?: string;
  import: boolean;
  timeout: number;
  json?: boolean;
}

function parseFramework(value: string): Framework {
  if (value !== "gut" && value !== "gdunit") throw new InvalidArgumentError("expected gut or gdunit");
  return value;
}

export function testCommand(): Command {
  return new Command("test")
    .description("run the project's GUT or GdUnit4 tests headless and show only what failed, with file:line")
    .argument("[path]", "project directory (or any path inside it)", ".")
    .option("--godot <path>", "Godot binary (default: $GODOT, then PATH, then the usual install folders)")
    .option("--framework <name>", "gut or gdunit (default: whichever is in res://addons)", parseFramework)
    .option("--dir <res-path>", "test folder or test script (repeatable; default: the framework's config, else res://test and res://tests)", collect, [])
    .option("--filter <text>", "GUT only: run only tests whose name contains this text")
    .option("--no-import", "skip the import step (faster when .godot/ is up to date)")
    .option("--timeout <seconds>", "timeout of the test run", (v: string) => parseNumber(v), 600)
    .option("--json", "print the result as JSON")
    .action(async (path: string, options: Options, command: Command) => {
      try {
        const report = await runTests(path, {
          godot: options.godot,
          ...(options.framework ? { framework: options.framework } : {}),
          ...(options.dir.length ? { paths: options.dir } : {}),
          ...(options.filter ? { filter: options.filter } : {}),
          import: options.import,
          timeoutMs: options.timeout * 1000,
        });
        writeOut(command, options.json ? `${JSON.stringify(report, null, 2)}\n` : formatTests(report));
        if (!testsPassed(report)) process.exitCode = 1;
      } catch (error) {
        if (error instanceof GodotNotFoundError) {
          process.exitCode = 2;
          throw error;
        }
        if (!(error instanceof TestRunError) && !(error instanceof ProjectNotFoundError)) throw error;
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      }
    });
}
