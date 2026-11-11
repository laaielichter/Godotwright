import { Command } from "commander";
import { collisionMap, formatBetween, formatBits, formatCollisions } from "../collisions/collisions.js";
import { ProjectNotFoundError } from "../scan/scan.js";
import { BASE_FILES_HELP, BASE_HELP, collect, parseNumber, writeOut } from "./output.js";

export function collisionsCommand(): Command {
  return new Command("collisions")
    .description("the physics layers of the project: every body, area and ray with its layers and mask by name and value, who detects whom, and what can never work (a mask on an empty layer, monitoring off, no shape)")
    .argument("[path]", "project directory (or any path inside it)", ".")
    .option("--between <names...>", "two names (node, scene, class_name or Godot class): who detects whom, and the mask to set")
    .option("--value <n>", "say which layers a bit value means", parseNumber)
    .option("--layers <numbers...>", "say the bit value of these layer numbers")
    .option("--base <dir>", BASE_HELP, collect, [])
    .option("--base-files <file>", BASE_FILES_HELP, collect, [])
    .option("--json", "print the result as JSON")
    .action((path: string, o: { between?: string[]; value?: number; layers?: string[]; base: string[]; baseFiles: string[]; json?: boolean }, command: Command) => {
      try {
        const report = collisionMap(path, { base: o.base, baseFiles: o.baseFiles });
        if (o.value !== undefined || o.layers?.length) {
          writeOut(command, formatBits(report, o.value, o.layers?.map(Number)));
          return;
        }
        if (o.between) {
          if (o.between.length !== 2) {
            process.stderr.write("--between needs two names\n");
            process.exitCode = 1;
            return;
          }
          const answer = formatBetween(report, o.between[0]!, o.between[1]!);
          writeOut(command, answer.text);
          if (!answer.ok) process.exitCode = 1;
          return;
        }
        writeOut(command, o.json ? `${JSON.stringify(report, null, 2)}\n` : formatCollisions(report, 200));
        if (!report.ok) process.exitCode = 1;
      } catch (error) {
        if (!(error instanceof ProjectNotFoundError)) throw error;
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      }
    });
}
