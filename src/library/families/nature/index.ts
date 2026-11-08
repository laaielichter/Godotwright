import type { Family } from "../../kit.js";
import { broadleafTree } from "./broadleaf-tree.js";
import { bushFamily } from "./bush.js";
import { coniferFamily } from "./conifer.js";
import { flowerFamily } from "./flower.js";
import { grassFamily } from "./grass.js";
import { mushroomFamily } from "./mushroom.js";
import { palmFamily } from "./palm.js";
import { rockFamily } from "./rock.js";
import { stumpFamily } from "./stump.js";

/** The nature families of the asset library. */
export const NATURE: Family[] = [broadleafTree, coniferFamily, palmFamily, bushFamily, rockFamily, flowerFamily, grassFamily, stumpFamily, mushroomFamily];
