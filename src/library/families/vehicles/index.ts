import type { Family } from "../../kit.js";
import { car } from "./car.js";
import { truck } from "./truck.js";
import { bus } from "./bus.js";
import { bicycle } from "./bicycle.js";
import { motorcycle } from "./motorcycle.js";
import { boat } from "./boat.js";

/** The vehicles families of the asset library. */
export const VEHICLES: Family[] = [car, truck, bus, bicycle, motorcycle, boat];
