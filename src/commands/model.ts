import { readFileSync, writeFileSync } from "node:fs";
import { Command, Option } from "commander";
import { BuildError } from "../build/params.js";
import { buildKind, GENERATORS } from "../build/generators/index.js";
import { buildGlb } from "../build/glb.js";
import { contractFromModel, loadContract } from "../model/contract.js";
import { formatModelInfo, formatModelReport } from "../model/format.js";
import { inspectModel } from "../model/inspect.js";
import { lintModelFile } from "../model/lint.js";
import { ModelError } from "../model/gltf.js";
import type { Detail } from "../scan/format.js";
import { collect, writeOut } from "./output.js";

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

  model
    .command("kinds")
    .description("list the model kinds that `model build` can make, with their parameters")
    .action((_options: object, command: Command) => {
      const out: string[] = [];
      for (const g of Object.values(GENERATORS)) {
        out.push(`${g.kind}: ${g.description}`);
        for (const d of g.params) {
          const range = d.options ? d.options.join("|") : [d.min !== undefined && `min ${d.min}`, d.max !== undefined && `max ${d.max}`].filter(Boolean).join(", ");
          out.push(`  ${d.name} = ${String(d.default)}${range ? ` (${range})` : ""}  ${d.description}`);
        }
      }
      writeOut(command, `${out.join("\n")}\n`);
    });

  model
    .command("build")
    .description("make a model from code: a clean .glb with UVs, tangents, named parts and a lint-ready build")
    .argument("<kind>", `what to build (${Object.keys(GENERATORS).join(", ")}); see \`model kinds\``)
    .option("-o, --out <file>", "output file (default <kind>.glb)")
    .option("--spec <file>", "a JSON file with parameters")
    .option("--set <name=value>", "set one parameter (repeatable)", collect, [])
    .option("--contract-out <file>", "also write a model.contract.json for the result")
    .action((kind: string, options: { out?: string; spec?: string; set: string[]; contractOut?: string }, command: Command) => {
      guard(() => {
        const input: Record<string, unknown> = {};
        if (options.spec) {
          try {
            Object.assign(input, JSON.parse(readFileSync(options.spec, "utf8")) as object);
          } catch (error) {
            throw new BuildError(`${options.spec}: cannot read the spec (${(error as Error).message})`);
          }
        }
        for (const pair of options.set) {
          const at = pair.indexOf("=");
          if (at < 1) throw new BuildError(`--set needs name=value, got "${pair}"`);
          input[pair.slice(0, at)] = pair.slice(at + 1);
        }
        const file = options.out ?? `${kind}.glb`;
        writeFileSync(file, buildGlb(buildKind(kind, input)));
        const info = inspectModel(file);
        const report = lintModelFile(file);
        const size = info.bounds?.size.map((v) => v.toFixed(2)).join(" x ") ?? "?";
        writeOut(command, `built ${file}: ${info.triangles.toLocaleString("en-US")} triangles, ${info.nodes.length} nodes, ${size} m (x y z), lint ${report.overall}/100\n`);
        if (options.contractOut) writeFileSync(options.contractOut, `${JSON.stringify(contractFromModel(info), null, 2)}\n`);
        if (report.categories.some((c) => c.errors > 0)) process.exitCode = 1;
      });
    });

  return model;
}
