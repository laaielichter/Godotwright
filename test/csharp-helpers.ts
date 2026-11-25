import { join } from "node:path";
import { newProject } from "../src/scaffold/project.js";
import { CSHARP_TEMPLATES, newScript } from "../src/scaffold/script.js";
import { tempFolder } from "./helpers.js";

/** A new C# project with every C# template in it. */
export function generatedCSharpProject(name = "CsGame"): string {
  const root = join(tempFolder("gw-dotnet-"), name);
  newProject(root, { name, dotnet: true });
  for (const template of CSHARP_TEMPLATES) {
    const className = `T${template.replace(/(^|_)(.)/g, (_m, _s, c: string) => c.toUpperCase())}`;
    newScript(root, `res://scripts/${className}.cs`, { template });
  }
  newScript(root, "res://scripts/TArea3D.cs", { template: "area_trigger", dimension: "3d" });
  newScript(root, "res://scripts/TSprite.cs", { template: "node", base: "Sprite2D" });
  return root;
}
