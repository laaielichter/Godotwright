/** Shapes of data/godot-api.json.gz, built by scripts/build-api.ts from Godot's class reference. */

export interface ApiStatus {
  deprecated?: string;
  experimental?: string;
}

export interface ApiParam {
  name: string;
  type: string;
  enum?: string;
  default?: string;
}

export interface ApiMethod extends ApiStatus {
  name: string;
  returns: string;
  returnEnum?: string;
  params?: ApiParam[];
  /** Space-separated: const, static, virtual, vararg, required. */
  qualifiers?: string;
  description?: string;
  keywords?: string;
}

export interface ApiMember extends ApiStatus {
  name: string;
  type: string;
  enum?: string;
  default?: string;
  setter?: string;
  getter?: string;
  overrides?: string;
  description?: string;
  keywords?: string;
}

export interface ApiSignal extends ApiStatus {
  name: string;
  params?: ApiParam[];
  description?: string;
}

export interface ApiConstant extends ApiStatus {
  name: string;
  value: string;
  enum?: string;
  bitfield?: boolean;
  description?: string;
}

export interface ApiThemeItem {
  name: string;
  dataType: string;
  type: string;
  default?: string;
  description?: string;
}

export interface ApiClass extends ApiStatus {
  name: string;
  inherits?: string;
  apiType?: string;
  keywords?: string;
  brief?: string;
  description?: string;
  tutorials?: { title: string; url: string }[];
  constructors?: ApiMethod[];
  methods?: ApiMethod[];
  operators?: ApiMethod[];
  annotations?: ApiMethod[];
  members?: ApiMember[];
  signals?: ApiSignal[];
  constants?: ApiConstant[];
  themeItems?: ApiThemeItem[];
}

export interface ApiRenames {
  classes?: Record<string, string>;
  functions?: Record<string, string>;
  properties?: Record<string, string>;
  signals?: Record<string, string>;
  constants?: Record<string, string>;
  builtinTypes?: Record<string, string>;
  shaders?: Record<string, string>;
  projectSettings?: Record<string, string>;
}

export interface ApiData {
  godot: string;
  commit: string;
  license: string;
  classes: ApiClass[];
  renames: ApiRenames;
}

export type EntryKind =
  | "class"
  | "method"
  | "property"
  | "signal"
  | "constant"
  | "enum"
  | "constructor"
  | "operator"
  | "annotation"
  | "theme_item";

/** One thing found by a lookup: a class, or a member of a class. */
export interface ApiEntry {
  kind: EntryKind;
  /** Class that defines it. */
  owner: string;
  name: string;
  item: ApiClass | ApiMethod | ApiMember | ApiSignal | ApiConstant | ApiThemeItem | EnumInfo;
}

export interface EnumInfo {
  name: string;
  bitfield: boolean;
  values: ApiConstant[];
}
