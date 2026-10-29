/** What a 3D object is: its parts, size, variants and what to anticipate. Data lives in data/archetypes/*.json. */
export type MoveKind = "spin" | "hinge" | "slide" | "steer" | "yaw" | "pitch";
export type PivotRule = "center" | "hub" | "hinge" | "base" | "mount";
export type Confidence = "A" | "B" | "C" | "D" | "X";
export type Range = [number, number];

export interface Move {
  kind: MoveKind;
  axis: "x" | "y" | "z";
}

export interface ArchetypePart {
  /** Suggested node name (PascalCase). */
  name: string;
  /** What the part does: body, wheel, door, rotor, glazing, ... */
  role: string;
  required: boolean;
  /** A number, or [min, max]. */
  count?: number | Range;
  moves?: Move[];
  pivot?: PivotRule;
  /** Lowercase words that identify this part by node name (English and Dutch). */
  aliases?: string[];
  note?: string;
  /** Parts of an ancestor that this one stands in for (a Frame replaces the Body of a wheeled vehicle). */
  replaces?: string[];
}

export interface ArchetypeScale {
  length?: Range;
  width?: Range;
  height?: Range;
  /** Where the numbers come from. Never left empty. */
  source: string;
  /** A = official figure, B = manufacturer or public data, C = general knowledge, D = derived, X = unknown. */
  confidence: Confidence;
}

export interface ArchetypeVariant {
  axis: string;
  options: string[];
}

export interface Archetype {
  /** Dotted path, e.g. vehicle.wheeled.car. */
  id: string;
  /** The id of the parent archetype; everything is inherited from it. */
  extends?: string;
  name: string;
  description: string;
  /** Lowercase words and phrases (English and Dutch) that name this thing. */
  aliases: string[];
  /** Lowercase words that suggest this family when the user only describes it. */
  hints?: string[];
  parts?: ArchetypePart[];
  scale?: ArchetypeScale;
  variants?: ArchetypeVariant[];
  conventions?: string[];
  anticipate?: string[];
  pitfalls?: string[];
  /** True when the thing is a surface by nature (terrain, water): its outer border is open on purpose. */
  sheet?: boolean;
}

/** An archetype with everything its ancestors define merged in. */
export interface ResolvedArchetype extends Omit<Archetype, "extends" | "parts" | "variants" | "conventions" | "anticipate" | "pitfalls" | "sheet"> {
  /** True when this archetype or one of its ancestors is a sheet (see Archetype.sheet). */
  sheet?: boolean;
  /** From the root down to this archetype. */
  chain: string[];
  parts: ArchetypePart[];
  variants: ArchetypeVariant[];
  conventions: string[];
  anticipate: string[];
  pitfalls: string[];
}
