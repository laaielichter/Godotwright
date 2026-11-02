import { Command } from "commander";
import { ProjectNotFoundError } from "../scan/scan.js";
import { ResourceEditError, editResource, formatResourcePlan, planFailed, type ResourceOp } from "../resource/edit.js";
import { OPS, toOps } from "../resource/types.js";
import { writeOut } from "./output.js";

interface Common {
  write?: boolean;
  json?: boolean;
  project?: string;
  godot?: string;
  reimport?: boolean;
  sub?: string;
  id?: string;
}

async function run(command: Command, file: string, ops: ResourceOp[], options: Common): Promise<void> {
  try {
    const plan = await editResource(file, ops, {
      write: options.write === true,
      ...(options.project ? { project: options.project } : {}),
      ...(options.godot ? { godot: options.godot } : {}),
      ...(options.reimport === false ? { reimport: false } : {}),
    });
    writeOut(command, options.json ? `${JSON.stringify(plan, null, 2)}\n` : formatResourcePlan(plan));
    if (planFailed(plan)) process.exitCode = 1;
  } catch (error) {
    if (!(error instanceof ResourceEditError) && !(error instanceof ProjectNotFoundError)) throw error;
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}

const FILE = "a .tres, a .tscn (sub_resources only), or an imported asset / its .import file (path, or res:// with --project)";
const SUB = "--sub <sub>";
const SUB_HELP = "a sub_resource id (.tres/.tscn), or kind/name in a .import: animations/run, meshes/body, materials/paint, nodes/PATH:Car/Wheel";

const common = (c: Command, sub = false): Command => {
  if (sub) c.option(SUB, SUB_HELP);
  return c
    .option("--write", "apply the change (default: only show what would change)")
    .option("--no-reimport", "after writing a .import, do not run Godot to reimport and verify")
    .option("--godot <path>", "Godot binary for the reimport (default: $GODOT, PATH, usual install folders)")
    .option("--json", "print the plan as JSON")
    .option("--project <path>", "project directory, for a res:// path (default: the current directory)");
};

export function resourceCommand(): Command {
  const resource = new Command("resource").description(
    "edit .tres resources and import settings safely: properties and sub_resources checked against Godot 4.7 with uids kept; .import options (audio loop, texture compression, mipmaps, glTF materials, per-animation loop, per-mesh shadows) checked against the importer, then reimported headless and verified; nothing is written without --write",
  );
  const sub = (o: Common) => (o.sub ? { sub: o.sub } : {});

  resource.addCommand(
    common(new Command("get").description("show a resource's properties, or an asset's import options (changed ones marked *) and sub-resources").argument("<file>", FILE).argument("[key]", "one property or option, with its type, default and choices"), true).action(
      (file: string, key: string | undefined, o: Common, c: Command) => run(c, file, [{ op: "get", ...(key ? { key } : {}), ...sub(o) }], o),
    ),
  );
  resource.addCommand(
    common(new Command("diff").description("import options that differ from the importer's defaults").argument("<file>", FILE)).action((file: string, o: Common, c: Command) => run(c, file, [{ op: "diff" }], o)),
  );
  resource.addCommand(
    common(
      new Command("set")
        .description("set a property or import option: name and type checked (enums by name: Forward, VRAM Compressed; resources as res:// or SubResource(\"id\"); byte arrays as [0, 255] or base64:...)")
        .argument("<file>", FILE)
        .argument("<key>", "property or option name, e.g. albedo_color, edit/loop_mode, loop, compress/mode, settings/loop_mode")
        .argument("<value>", "the value"),
      true,
    ).action((file: string, key: string, value: string, o: Common, c: Command) => run(c, file, [{ op: "set", key, value, ...sub(o) }], o)),
  );
  resource.addCommand(
    common(new Command("unset").description("remove a property (Godot's default applies), or put an import option back to its default").argument("<file>", FILE).argument("<key>", "property or option name"), true).action(
      (file: string, key: string, o: Common, c: Command) => run(c, file, [{ op: "unset", key, ...sub(o) }], o),
    ),
  );
  resource.addCommand(
    common(new Command("add-sub").description("add an empty sub_resource of a Resource class; set its properties with set --sub <id>").argument("<file>", FILE).argument("<type>", "a Resource class, e.g. StyleBoxFlat").option("--id <id>", "the id to give it (default: Type_xxxxx)")).action(
      (file: string, type: string, o: Common, c: Command) => run(c, file, [{ op: "add_sub", type, ...(o.id ? { id: o.id } : {}) }], o),
    ),
  );
  resource.addCommand(
    common(new Command("remove-sub").description("remove a sub_resource nothing uses any more").argument("<file>", FILE).argument("<id>", "the sub_resource id")).action((file: string, id: string, o: Common, c: Command) =>
      run(c, file, [{ op: "remove_sub", sub: id }], o),
    ),
  );
  resource.addCommand(
    common(new Command("importer").description("switch an asset's importer, keeping its uid: scene <-> animation_library, texture <-> image, or keep").argument("<asset>", FILE).argument("<importer>", "the importer id")).action(
      (file: string, as: string, o: Common, c: Command) => run(c, file, [{ op: "importer", as }], o),
    ),
  );
  resource.addCommand(
    common(new Command("reimport").description("run Godot's headless import and say whether this asset was reimported and its output changed").argument("<asset>", FILE)).action((file: string, o: Common, c: Command) =>
      run(c, file, [{ op: "reimport" }], o),
    ),
  );
  resource.addCommand(
    common(new Command("apply").description(`several ops in one go (one write, one reimport): a JSON list of {op, key, value, sub, type, id, as}; op is ${OPS.join(", ")}`).argument("<file>", FILE).argument("<ops>", "the JSON list")).action(
      (file: string, json: string, o: Common, c: Command) => {
        let ops: ResourceOp[];
        try {
          ops = toOps(JSON.parse(json));
        } catch (error) {
          process.stderr.write(`ops must be a JSON list of ops: ${(error as Error).message}\n`);
          process.exitCode = 1;
          return;
        }
        return run(c, file, ops, o);
      },
    ),
  );
  return resource;
}
