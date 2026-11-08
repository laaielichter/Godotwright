import type { Family } from "../../kit.js";
import { bikeRack } from "./bike-rack.js";
import { bin } from "./bin.js";
import { bollard } from "./bollard.js";
import { busStop } from "./bus-stop.js";
import { fence } from "./fence.js";
import { fireHydrant } from "./fire-hydrant.js";
import { mailbox } from "./mailbox.js";
import { parkBench } from "./park-bench.js";
import { planter } from "./planter.js";
import { roadBarrier } from "./road-barrier.js";
import { streetLamp } from "./street-lamp.js";
import { trafficCone } from "./traffic-cone.js";
import { trafficSign } from "./traffic-sign.js";

/** The street families of the asset library. */
export const STREET: Family[] = [parkBench, streetLamp, bin, bollard, planter, trafficSign, fireHydrant, mailbox, bikeRack, busStop, trafficCone, roadBarrier, fence];
