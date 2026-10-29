import { Command, Option } from "commander";
import { contractFromModel, loadContract } from "../model/contract.js";
import { formatModelInfo, formatModelReport } from "../model/format.js";
import { inspectModel } from "../model/inspect.js";
import { lintModelFile } from "../model/lint.js";
import { ModelError } from "../model/gltf.js";
import type { Detail } from "../scan/format.js";
import { writeOut } from "./output.js";

const detailOption = () => new Option("-d, --detail <level>", "output detail").choices(["brief", "full"]).default("brief");

/** Turns a model problem into a clear message and exit code 1, instead of a stack trace. */
function guard(run: () => void): void {
  try {
    run();
  } catch (error) {
    if (!(error instanceof ModelError)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

export function modelCommand(): Command {
  const model = new Command("model").description("check 3D models (.glb / .gltf) without Godot: size, nodes, textures and lint rules");

  model
    .command("inspect", { isDefault: true })
    .description("show what is in a model: nodes, triangles, materials, textures, size and lowest point")
    .argument("<file>", "a .glb or .gltf file")
    .addOption(detailOption())
    .option("--json", "print the summary as JSON")
    .action((file: string, options: { detail: Detail; json?: boolean }, command: Command) => {
      guard(() => {
        const info = inspectModel(file);
        if (options.json) {
          const { primitives: _skip, ...rest } = info;
          writeOut(command, `${JSON.stringify({ ...rest, primitives: info.primitives.length }, null, 2)}\n`);
        } else writeOut(command, formatModelInfo(info, options.detail));
      });
    });

  model
    .command("lint")
    .description("AAA model review with scores: flipped faces, open edges, normals, UVs, tangents, textures, node names")
    .argument("<file>", "a .glb or .gltf file")
    .addOption(detailOption())
    .option("--max-triangles <n>", "flag a model with more triangles than this")
    .option("--max-texture-mb <n>", "texture memory budget in MB (default 512)")
    .option("--contract <file>", "also check the model against a model.contract.json")
    .option("--min-score <score>", "exit with code 1 when the overall score is lower")
    .option("--json", "print the report as JSON")
    .action((file: string, options: { detail: Detail; maxTriangles?: string; maxTextureMb?: string; contract?: string; minScore?: string; json?: boolean }, command: Command) => {
      guard(() => {
        const report = lintModelFile(file, {
          maxTriangles: options.maxTriangles === undefined ? undefined : Number(options.maxTriangles),
          maxTextureMb: options.maxTextureMb === undefined ? undefined : Number(options.maxTextureMb),
          contract: options.contract === undefined ? undefined : loadContract(options.contract),
        });
        writeOut(command, options.json ? `${JSON.stringify(report, null, 2)}\n` : formatModelReport(report, options.detail));
        const errors = report.categories.reduce((n, c) => n + c.errors, 0);
        if (errors > 0 || (options.minScore !== undefined && report.overall < Number(options.minScore))) process.exitCode = 1;
      });
    });

  model
    .command("contract")
    .description("write a model.contract.json from a model as it is now (node names, size, triangle budget), to review and keep")
    .argument("<file>", "a .glb or .gltf file")
    .action((file: string, _options: object, command: Command) => {
      guard(() => writeOut(command, `${JSON.stringify(contractFromModel(inspectModel(file)), null, 2)}\n`));
    });

  return model;
}
