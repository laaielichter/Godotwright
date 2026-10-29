/** A small car, as a spec. Used by `model spec` and by the tests, so the documentation stays true. */
export const EXAMPLE_SPEC = {
  version: 1,
  name: "car",
  params: [
    { name: "width", type: "number", default: 1.8, min: 1.4, max: 2.6, description: "Body width in metres." },
    { name: "wheelbase", type: "number", default: 2.6, min: 1.8, max: 4, description: "Distance between the axles." },
    { name: "wheelRadius", type: "number", default: 0.33, min: 0.2, max: 0.6, description: "Tyre radius." },
  ],
  nodes: [
    {
      name: "Car",
      children: [
        {
          name: "Body",
          shape: "loft",
          material: "paint",
          sections: [
            { z: -2.2, superellipse: { width: "$width * 0.62", height: 0.45, n: 3, count: 32, cy: 0.55 } },
            { z: -1.7, superellipse: { width: "$width * 0.96", height: 0.62, n: 3, count: 32, cy: 0.62 } },
            { z: -0.3, superellipse: { width: "$width", height: 0.7, n: 3, count: 32, cy: 0.7 } },
            { z: 1.5, superellipse: { width: "$width", height: 0.7, n: 3, count: 32, cy: 0.7 } },
            { z: 2.2, superellipse: { width: "$width * 0.8", height: 0.55, n: 3, count: 32, cy: 0.62 } },
          ],
        },
        {
          name: "Cabin",
          shape: "loft",
          material: "glass",
          sections: [
            { z: -1.0, superellipse: { width: "$width * 0.75", height: 0.35, n: 2.5, count: 32, cy: 1.0 } },
            { z: -0.5, superellipse: { width: "$width * 0.83", height: 0.62, n: 2.5, count: 32, cy: 1.1 } },
            { z: 0.9, superellipse: { width: "$width * 0.83", height: 0.6, n: 2.5, count: 32, cy: 1.1 } },
            { z: 1.5, superellipse: { width: "$width * 0.72", height: 0.35, n: 2.5, count: 32, cy: 1.0 } },
          ],
        },
        {
          name: "Wheels",
          vars: { x: "$width / 2 - 0.12", z: "$wheelbase / 2" },
          children: [
            { name: "Wheel_FL", shape: "cylinder", material: "rubber", axis: "x", radius: "$wheelRadius", height: 0.22, at: ["-$x", "$wheelRadius", "-$z"], mirror: "Wheel_FR" },
            { name: "Wheel_RL", shape: "cylinder", material: "rubber", axis: "x", radius: "$wheelRadius", height: 0.22, at: ["-$x", "$wheelRadius", "$z"], mirror: "Wheel_RR" },
          ],
        },
      ],
    },
  ],
};

export const SPEC_HELP = `A model spec is JSON that describes a model as a tree of named parts.

  { "version": 1,
    "params":    [ { "name": "width", "type": "number", "default": 1.8, "min": 1, "max": 3 } ],
    "materials": { "my_paint": { "color": [0.1, 0.2, 0.6], "metallic": 0.3, "roughness": 0.4 } },
    "nodes":     [ <node>, ... ] }

A node has a "name" and any of these (every node becomes a Godot node with the same name):
  shape      box | cylinder | ellipsoid | lathe | loft | extrude | roof   (no shape = an empty pivot or group)
  material   a preset (see below) or one from "materials"; children inherit it
  at         [x, y, z] position of the node (its pivot) in its parent
  rotate     [rx, ry, rz] degrees, applied x, then y, then z
  mirror     "Name": also add a mirror image of this node and its children in the x = 0 plane, with that name
  repeat     { "count": n, "step": [dx, dy, dz] }: n copies; name them with {i} (1, 2, 3, ...) or get _1, _2, ...
  vars       { "x": "$width / 2" }: variables for this node and its children
  children   [ <node>, ... ]

Shapes and their keys:
  box        size [w, h, d], anchor "center" | "bottom"
  cylinder   radius, height, axis "x" | "y" | "z", segments, anchor "center" | "base"
  ellipsoid  radii [rx, ry, rz], segments
  lathe      profile [[radius, y], ...], segments, caps   (a surface of revolution around y: wheels, tanks, masts)
  loft       sections [{ "z": z, "superellipse": { width, height, n, count, cx, cy } }  or  { "z": z, "points": [[x, y], ...] }]
             Every section has the same number of points. Hulls, fuselages, car bodies.
  extrude    plan [[x, z], ...], y0, y1     (a prism from a floor plan: walls, slabs)
  roof       x0, x1, z0, z1, y, rise, kind "gable" | "hip"

Numbers can be expressions: "$width / 2 - 0.1", "max($a, 1) * 2", "pi", "rad(45)", "$i * 0.5" inside repeat.
Functions: min max abs sqrt sin cos tan floor ceil round pow rad clamp lerp. Variables start with $.
Conventions: +y is up, the front faces -z, the model stands on y = 0, a moving part gets its own node with its pivot at its origin
(a wheel at its hub). Presets: plaster brick concrete asphalt roof_tile roof_slate wood frame_white glass metal rubber paint bark leaf.

Example (a car); save it, then: godotwright model build --spec car.json --set width=1.9 -o car.glb
`;
