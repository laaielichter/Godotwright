"""Render the v4 LSAC cab (cab_ext + cab_int) with Cycles CPU.

Run: PYTHONPATH=/tmp/claude-0/bpy_pkg python3 render_cab_v4.py [front] [f34] [interior] [side]
Env: SAMPLES (default 48), RES (default 1200x900), DOORS_OPEN=1 swings both doors 70 deg.
Writes v4/renders/cab_v4_<view>.png. Workbench aborts headless here (libEGL missing).
"""
import math
import os
import sys
import time

BUILD = os.path.dirname(os.path.abspath(__file__))
V4 = os.path.dirname(BUILD)
sys.path.insert(0, BUILD)
sys.path.insert(0, os.path.join(BUILD, "modules"))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import hr  # noqa: E402
import layout as L  # noqa: E402

T0 = time.time()
hr.reset_scene()
import cab_ext  # noqa: E402
import cab_int  # noqa: E402

objs = cab_ext.build() + cab_int.build()
print(f"BUILT {len(objs)} objects in {time.time() - T0:.1f}s", flush=True)
if os.environ.get("DOORS_OPEN") == "1":
    for o in objs:
        if o.name.startswith("DoorL"):
            o.rotation_euler.z = math.radians(-70)
        if o.name.startswith("DoorR"):
            o.rotation_euler.z = math.radians(70)

scn = bpy.context.scene
scn.render.engine = "CYCLES"
scn.cycles.device = "CPU"
scn.cycles.samples = int(os.environ.get("SAMPLES", "48"))
try:
    scn.cycles.use_denoising = True
    scn.cycles.denoiser = "OPENIMAGEDENOISE"
except Exception:
    scn.cycles.use_denoising = False
rx, ry = (int(v) for v in os.environ.get("RES", "1200x900").split("x"))
scn.render.resolution_x = rx
scn.render.resolution_y = ry
scn.render.image_settings.file_format = "PNG"
scn.view_settings.view_transform = "Standard"

world = bpy.data.worlds.new("grey")
scn.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.45, 0.46, 0.47, 1.0)
bg.inputs["Strength"].default_value = 1.0
sun_d = bpy.data.lights.new("sun", "SUN")
sun_d.energy = 4.0
sun_d.angle = math.radians(3)
sun = bpy.data.objects.new("sun", sun_d)
scn.collection.objects.link(sun)
sun.rotation_euler = (math.radians(45), 0.0, math.radians(200))

bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
ground = bpy.context.active_object
gm = bpy.data.materials.new("ground")
gm.use_nodes = True
gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.3, 0.3, 0.3, 1)
gm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
ground.data.materials.append(gm)


def cam(name, pos, target, lens):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    cd.clip_start = 0.02
    co = bpy.data.objects.new(name, cd)
    scn.collection.objects.link(co)
    co.location = pos
    d = (Vector(target) - Vector(pos)).normalized()
    co.rotation_mode = "QUATERNION"
    co.rotation_quaternion = d.to_track_quat("-Z", "Y")
    return co


VIEWS = {
    "front": (cam("c_front", (0.0, 9.6, 1.75), (0.0, 3.0, 1.88), 62.0), False),
    "f34": (cam("c_f34", (-4.6, 8.0, 3.3), (0.0, 2.55, 1.85), 42.0), False),
    "side": (cam("c_side", (8.0, 2.5, 1.9), (0.0, 2.5, 1.9), 50.0), False),
    "interior": (cam("c_int", L.DRIVER_EYE, (0.35, 3.25, 1.95), 18.0), True),
}

# interior fill light (only for the interior view): the armoured cab is dark inside
fill_d = bpy.data.lights.new("cab_fill", "AREA")
fill_d.energy = 60.0
fill_d.size = 0.8
fill = bpy.data.objects.new("cab_fill", fill_d)
fill.location = (0.0, 2.2, 2.70)
scn.collection.objects.link(fill)

wanted = sys.argv[1:] or ["front", "f34", "interior"]
for v in wanted:
    co, inside = VIEWS[v]
    fill.hide_render = not inside
    scn.camera = co
    path = os.path.join(V4, "renders", f"cab_v4_{v}.png")
    scn.render.filepath = path
    t = time.time()
    bpy.ops.render.render(write_still=True)
    print(f"RENDER {v} {path} {time.time() - t:.1f}s", flush=True)
