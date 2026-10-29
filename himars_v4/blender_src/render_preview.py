"""Four-view preview of the assembled vehicle, rendered with Cycles (CPU).

Workbench cannot run headless here (libEGL.so.1 is missing, the process aborts at render start),
so the requested Workbench turnaround is not produced. This script re-imports out/himars_v3.glb
(which also checks the export), hides the alternative pods (PodSingle, PodDual) so the default
six-tube pod shows, and renders four views at 1200x800 to renders/assembly_preview_cycles_*.png.

Run: PYTHONPATH=/tmp/claude-0/bpy_pkg python3 render_preview.py [view ...]
"""
import math
import os
import sys
import time

BUILD = os.path.dirname(os.path.abspath(__file__))
SCRATCH = os.path.dirname(BUILD)
GLB = os.path.join(BUILD, "out", "himars_v3.glb")
REND = os.path.join(SCRATCH, "renders")
os.makedirs(REND, exist_ok=True)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

T0 = time.time()
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
print(f"IMPORTED {GLB} objects={len(bpy.data.objects)} secs={time.time() - T0:.1f}", flush=True)


def under(obj, node):
    p = obj
    while p is not None:
        if p.name == node:
            return True
        p = p.parent
    return False


hidden = 0
for o in bpy.data.objects:
    if o.type == "MESH" and (under(o, "PodSingle") or under(o, "PodDual")):
        o.hide_render = True
        o.hide_viewport = True
        hidden += 1
print(f"HIDDEN_ALT_POD_MESHES {hidden}", flush=True)

scn = bpy.context.scene
scn.render.engine = "CYCLES"
scn.cycles.device = "CPU"
scn.cycles.samples = int(os.environ.get("SAMPLES", "24"))
scn.cycles.use_denoising = False
scn.render.resolution_x = 1200
scn.render.resolution_y = 800
scn.render.image_settings.file_format = "PNG"

# world light and a sun; a plain ground disc just under the tyres
world = bpy.data.worlds.new("preview_world")
scn.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.62, 0.66, 0.70, 1.0)
bg.inputs["Strength"].default_value = 1.0
sun_l = bpy.data.lights.new("sun", "SUN")
sun_l.energy = 3.2
sun_o = bpy.data.objects.new("sun", sun_l)
scn.collection.objects.link(sun_o)
sun_o.rotation_euler = (math.radians(55), 0.0, math.radians(40))

bpy.ops.mesh.primitive_circle_add(radius=40.0, fill_type="NGON", location=(0.0, 0.0, -0.002))
ground = bpy.context.active_object
ground.name = "preview_ground"
gm = bpy.data.materials.new("preview_ground_mat")
gm.use_nodes = True
gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.20, 0.21, 0.19, 1.0)
gm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.95
ground.data.materials.append(gm)


def camera(name, pos, target=None, ortho=None, lens=35.0, euler=None):
    cd = bpy.data.cameras.new(name)
    if ortho:
        cd.type = "ORTHO"
        cd.ortho_scale = ortho
    else:
        cd.lens = lens
    co = bpy.data.objects.new(name, cd)
    scn.collection.objects.link(co)
    co.location = pos
    if euler is not None:
        co.rotation_euler = euler
    else:
        d = (Vector(target) - Vector(pos)).normalized()
        co.rotation_mode = "QUATERNION"
        co.rotation_quaternion = d.to_track_quat("-Z", "Y")
    return co


VIEWS = {
    # name: camera object
    "front34": camera("cam_front34", (8.0, 9.5, 4.8), target=(0.0, 0.1, 1.25)),
    "rear34": camera("cam_rear34", (-8.0, -9.5, 4.8), target=(0.0, -0.4, 1.25)),
    "side": camera("cam_side", (22.0, 0.1, 1.45), ortho=10.5, euler=(math.radians(90), 0.0, math.radians(90))),
    "top": camera("cam_top", (0.0, 0.1, 30.0), ortho=12.0, euler=(0.0, 0.0, 0.0)),
}

wanted = sys.argv[1:] or list(VIEWS)
for v in wanted:
    co = VIEWS[v]
    scn.camera = co
    path = os.path.join(REND, f"assembly_preview_cycles_{v}.png")
    scn.render.filepath = path
    t = time.time()
    bpy.ops.render.render(write_still=True)
    print(f"RENDER_CYCLES {v} {path} {time.time() - t:.1f}s", flush=True)
print("RENDER_DONE", flush=True)
