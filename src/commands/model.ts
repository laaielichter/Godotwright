import { readFileSync, writeFileSync } from "node:fs";
import { Command, Option } from "commander";
import { briefFor } from "../archetype/brief.js";
import { chooseArchetype } from "../archetype/check.js";
import { formatArchetype, formatChecked, formatIdentify, formatTree } from "../archetype/format.js";
import { identify } from "../archetype/identify.js";
import { ArchetypeError, loadLibrary } from "../archetype/library.js";
import { BuildError } from "../build/params.js";
import { allKinds, buildKind } from "../build/generators/index.js";
import { loadRecipes } from "../build/recipes.js";
import { buildModel } from "../build/run.js";
import { buildSpec } from "../build/spec.js";
import { EXAMPLE_SPEC, SPEC_CHEAT, SPEC_HELP } from "../build/spec-help.js";
import { contractFromArchetype, contractFromModel, loadContract } from "../model/contract.js";
import { formatModelInfo, formatModelReport } from "../model/format.js";
import { inspectModel } from "../model/inspect.js";
import { lintModelFile } from "../model/lint.js";
import { viewModel } from "../model/view.js";
import { ModelError } from "../model/gltf.js";
import type { Detail } from "../scan/format.js";
import { collect, parseNumber, writeOut } from "./output.js";

const detailOption = () => new Option("-d, --detail <level>", "output detail").choices(["brief", "full"]).default("brief");

/** Turns a model problem into a clear message and exit code 1, instead of a stack trace. */
function guard(run: () => void): void {
  try {
    run();
  } catch (error) {
    if (!(error instanceof ModelError) && !(error instanceof ArchetypeError)) throw error;
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
    .option("--max-triangles <n>", "flag a model with more triangles than this", parseNumber)
    .option("--max-texture-mb <n>", "texture memory budget in MB (default 512)", parseNumber)
    .option("--contract <file>", "also check the model against a model.contract.json")
    .option("--archetype <text>", "also check the model against what it should be, e.g. car or helikopter (see `model identify`)")
    .option("--min-score <score>", "exit with code 1 when the overall score is lower", parseNumber)
    .option("--json", "print the report as JSON")
    .action((file: string, options: { detail: Detail; maxTriangles?: number; maxTextureMb?: number; contract?: string; archetype?: string; minScore?: number; json?: boolean }, command: Command) => {
      guard(() => {
        const choice = options.archetype === undefined ? undefined : chooseArchetype(options.archetype);
        const report = lintModelFile(file, {
          ...(choice ? { archetype: choice.archetype } : {}),
          maxTriangles: options.maxTriangles,
          maxTextureMb: options.maxTextureMb,
          contract: options.contract === undefined ? undefined : loadContract(options.contract),
        });
        if (choice && !options.json) writeOut(command, formatChecked(choice, report.compared));
        writeOut(command, options.json ? `${JSON.stringify(report, null, 2)}\n` : formatModelReport(report, options.detail));
        const errors = report.categories.reduce((n, c) => n + c.errors, 0);
        if (errors > 0 || (options.minScore !== undefined && report.overall < options.minScore)) process.exitCode = 1;
      });
    });

  model
    .command("view")
    .description("see a model as text: three views (front, side, top) made of letters, the parts with their sizes, and which parts do not touch the rest")
    .argument("<file>", "a .glb or .gltf file")
    .addOption(new Option("--only <view>", "show one view only").choices(["front", "side", "top"]))
    .option("--width <n>", "width of the views in characters (default 48)")
    .action((file: string, options: { width?: string; only?: "front" | "side" | "top" }, command: Command) => {
      guard(() => writeOut(command, viewModel(inspectModel(file), { ...(options.width === undefined ? {} : { width: Number(options.width) }), ...(options.only ? { only: options.only } : {}) })));
    });

  model
    .command("contract")
    .description("write a model.contract.json: from a model as it is now (node names, size, triangle budget), or from what a thing usually is (--archetype), to review and keep")
    .argument("[file]", "a .glb or .gltf file")
    .option("--archetype <what>", 'start from an archetype id or a name instead of a file, e.g. "helicopter"')
    .action((file: string | undefined, options: { archetype?: string }, command: Command) => {
      guard(() => {
        if (options.archetype !== undefined) {
          if (file) throw new ModelError("give a model file or --archetype, not both");
          const choice = chooseArchetype(options.archetype);
          for (const note of choice.notes) process.stderr.write(`note: ${note}\n`);
          if (choice.generic) process.stderr.write(`note: no exact match for "${options.archetype}"; this contract is for the closest family, ${choice.archetype.id}\n`);
          return writeOut(command, `${JSON.stringify(contractFromArchetype(choice.archetype), null, 2)}\n`);
        }
        if (!file) throw new ModelError("give a model file, or --archetype <what> to start from what a thing usually is");
        writeOut(command, `${JSON.stringify(contractFromModel(inspectModel(file)), null, 2)}\n`);
      });
    });

  model
    .command("recipes")
    .description("list the ready-made recipes (data/recipes) with the archetype each one is checked against, or print one recipe's spec to edit")
    .argument("[kind]", "a recipe: print its full spec (JSON) as a base for your own")
    .option("--json", "print the list as JSON")
    .action((kind: string | undefined, options: { json?: boolean }, command: Command) => {
      guard(() => {
        const all = loadRecipes();
        if (kind !== undefined) {
          const recipe = all.get(kind);
          if (!recipe) throw new BuildError(`no recipe "${kind}" (known: ${[...all.keys()].join(", ")}; house, terrain and sea are generators without a spec)`);
          return writeOut(command, `${JSON.stringify(recipe.spec, null, 2)}\n`);
        }
        const recipes = [...all.values()];
        if (options.json) {
          const rows = recipes.map((r) => ({ kind: r.kind, archetype: r.archetype ?? null, description: r.description, params: r.params.map((p) => ({ name: p.name, default: p.default, min: p.min ?? null, max: p.max ?? null })) }));
          return writeOut(command, `${JSON.stringify(rows, null, 2)}\n`);
        }
        const out = recipes.map((r) => `${r.kind}  (${r.archetype ?? "no archetype"}, ${r.params.length} parameter${r.params.length === 1 ? "" : "s"})\n  ${r.description}`);
        writeOut(command, `${out.join("\n")}\n\nBuild one with: godotwright model build <kind> -o <file>.glb   (parameters: godotwright model kinds)\nEdit one: godotwright model recipes <kind> > my.spec.json\n`);
      });
    });

  model
    .command("kinds")
    .description("list the model kinds that `model build` can make, with their parameters")
    .action((_options: object, command: Command) => {
      const out: string[] = [];
      for (const g of allKinds()) {
        out.push(`${g.kind}: ${g.description}`);
        for (const d of g.params) {
          const range = d.options ? d.options.join("|") : [d.min !== undefined && `min ${d.min}`, d.max !== undefined && `max ${d.max}`].filter(Boolean).join(", ");
          out.push(`  ${d.name} = ${String(d.default)}${range ? ` (${range})` : ""}  ${d.description}`);
        }
      }
      writeOut(command, `${out.join("\n")}\n`);
    });

  model
    .command("brief")
    .description("one page to read before you build: what the thing is, the ready-made kind to start from, parts, size, rules, usual mistakes, the commands in order and a spec cheat sheet (made for small models)")
    .argument("<what...>", 'what you want to make, e.g. "a rowing boat" or "dragon"')
    .option("--json", "print as JSON")
    .action((what: string[], options: { json?: boolean }, command: Command) => {
      guard(() => {
        const brief = briefFor(what.join(" "));
        writeOut(command, options.json ? `${JSON.stringify({ archetype: brief.result.best.id, generic: brief.result.generic, relation: brief.relation, kinds: brief.kinds }, null, 2)}\n` : brief.text);
      });
    });

  model
    .command("identify")
    .description("say what a thing is: its parts, typical size, variants, conventions and what to anticipate (English or Dutch)")
    .argument("<text...>", 'what you want to make, e.g. "a tractor" or "helikopter"')
    .option("--json", "print the result as JSON")
    .action((text: string[], options: { json?: boolean }, command: Command) => {
      guard(() => {
        const library = loadLibrary();
        const result = identify(text.join(" "), library);
        writeOut(command, options.json ? `${JSON.stringify(result, null, 2)}\n` : formatIdentify(result, library));
      });
    });

  model
    .command("archetypes")
    .description("show the family tree of known things, or one archetype by id (e.g. aircraft.rotorcraft.helicopter)")
    .argument("[id]", "an archetype id")
    .option("--json", "print as JSON")
    .action((id: string | undefined, options: { json?: boolean }, command: Command) => {
      guard(() => {
        const library = loadLibrary();
        if (!id) return writeOut(command, options.json ? `${JSON.stringify(library.archetypes.map((a) => a.id), null, 2)}\n` : formatTree(library));
        if (!library.get(id)) throw new ArchetypeError(`unknown archetype "${id}" (see \`model archetypes\`)`);
        const resolved = library.resolve(id);
        writeOut(command, options.json ? `${JSON.stringify(resolved, null, 2)}\n` : formatArchetype(resolved));
      });
    });

  model
    .command("spec")
    .description("explain the model spec format (a JSON tree of parts) and print an example")
    .option("--short", "a dozen lines instead of the full explanation (for small models)")
    .action((options: { short?: boolean }, command: Command) => {
      writeOut(command, options.short ? `${SPEC_CHEAT}\n` : `${SPEC_HELP}\n${JSON.stringify(EXAMPLE_SPEC, null, 2)}\n`);
    });

  model
    .command("build")
    .description("make a model from code: a clean .glb with UVs, tangents, named parts, ready for lint")
    .argument("[kind]", `a ready-made kind (${allKinds().map((k) => k.kind).join(", ")}); leave out when you give a full spec with --spec`)
    .option("-o, --out <file>", "output file (default <kind>.glb, or the name in the spec)")
    .option("--spec <file>", "with a kind: parameters as JSON. Without a kind: a full model spec (see `model spec`)")
    .option("--set <name=value>", "set one parameter (repeatable)", collect, [])
    .option("--contract-out <file>", "also write a model.contract.json for the result")
    .addOption(new Option("--collision <kind>", "name the meshes so Godot makes collision shapes on import: convex (a hull per mesh) or trimesh (exact, for static things)").choices(["convex", "trimesh"]))
    .action((kind: string | undefined, options: { out?: string; spec?: string; set: string[]; contractOut?: string; collision?: "convex" | "trimesh" }, command: Command) => {
      guard(() => {
        const input: Record<string, unknown> = {};
        let spec: unknown;
        if (options.spec) {
          try {
            spec = JSON.parse(readFileSync(options.spec, "utf8"));
          } catch (error) {
            throw new BuildError(`${options.spec}: cannot read the spec (${(error as Error).message})`);
          }
        }
        if (!kind && !spec) throw new BuildError("give a kind (see `model kinds`) or a full spec with --spec (see `model spec`)");
        for (const pair of options.set) {
          const at = pair.indexOf("=");
          if (at < 1) throw new BuildError(`--set needs name=value, got "${pair}"`);
          input[pair.slice(0, at)] = pair.slice(at + 1);
        }
        const name = kind ?? ((spec as { name?: unknown }).name as string | undefined) ?? "model";
        const outcome = buildModel({ ...(kind ? { kind } : {}), spec: kind ? undefined : spec, params: kind ? { ...(spec as object | undefined), ...input } : input, out: options.out ?? `${name}.glb`, ...(options.contractOut ? { contractOut: options.contractOut } : {}), ...(options.collision ? { collision: options.collision } : {}) });
        writeOut(command, `${outcome.summary}\n`);
        if (outcome.report.categories.some((c) => c.errors > 0)) process.exitCode = 1;
      });
    });

  return model;
}
