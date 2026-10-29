import type { Autoload, InputAction } from "../godot/project-settings.js";
import type { Variant } from "../godot/variant.js";

export interface ProjectInfo {
  name?: string;
  description?: string;
  /** `res://` path of the main scene (resolved from a uid when needed). */
  mainScene?: string;
  icon?: string;
  godotVersion?: string;
  renderer?: string;
  features: string[];
  configVersion?: number;
}

export interface NodeInfo {
  path: string;
  name: string;
  /** Built-in class, or the root type of the instanced scene. */
  type?: string;
  script?: string;
  /** `res://` path of the instanced scene. */
  instance?: string;
  groups: string[];
  uniqueName: boolean;
  line: number;
}

export interface ConnectionInfo {
  signal: string;
  from: string;
  to: string;
  method: string;
  line: number;
}

export interface SceneInfo {
  /** Comes from a base project, not from this one. */
  external?: boolean;
  path: string;
  uid?: string;
  rootName?: string;
  rootType?: string;
  rootScript?: string;
  nodes: NodeInfo[];
  connections: ConnectionInfo[];
  /** `res://` paths of instanced scenes. */
  instances: string[];
  subResourceTypes: string[];
}

export interface FunctionSummary {
  name: string;
  signature: string;
  line: number;
  endLine: number;
}

export interface VariableSummary {
  name: string;
  type?: string;
  export?: string;
  onready: boolean;
  line: number;
}

export interface ScriptInfo {
  /** Comes from a base project, not from this one. */
  external?: boolean;
  /** `res://` path, or `res://scene.tscn::Id` for a built-in script. */
  path: string;
  uid?: string;
  className?: string;
  extends?: string;
  tool: boolean;
  signals: { name: string; signature: string; line: number }[];
  functions: FunctionSummary[];
  variables: VariableSummary[];
  constants: string[];
  enums: string[];
  innerClasses: string[];
  /** Scenes that attach this script to a node. */
  usedBy: string[];
  lineCount: number;
}

export interface ResourceInfo {
  /** Comes from a base project, not from this one. */
  external?: boolean;
  path: string;
  uid?: string;
  type?: string;
  script?: string;
}

export interface ShaderInfo {
  /** Comes from a base project, not from this one. */
  external?: boolean;
  path: string;
  shaderType?: string;
}

export interface CSharpScriptInfo {
  /** Comes from a base project, not from this one. */
  external?: boolean;
  path: string;
}

export interface Warning {
  file: string;
  line?: number;
  message: string;
}

export interface ProjectMap {
  project: ProjectInfo;
  settings: Record<string, Variant>;
  autoloads: Autoload[];
  inputActions: InputAction[];
  plugins: string[];
  scenes: SceneInfo[];
  scripts: ScriptInfo[];
  resources: ResourceInfo[];
  shaders: ShaderInfo[];
  /** Counts of other files by kind (texture, audio, model, ...). */
  assets: Record<string, number>;
  csharpScripts: CSharpScriptInfo[];
  /** Set when the project is laid over base projects (a mod over a game). */
  base?: { roots: string[]; files: number; listed?: number };
  warnings: Warning[];
}
