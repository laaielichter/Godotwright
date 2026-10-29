"""Render orthographic silhouette masks of the assembled GLB at the reference photos' scale.

Usage: PYTHONPATH=<bpy> python3 silhouette.py -- <glb> <out_dir>
Writes side_model.png (camera on +X, front to image right, 171.8 px/m) and
front_model.png (camera on +Y, 568 px/m). White = vehicle, black = background.
PodSingle / PodDual are hidden (stowed six-pod configuration).
"""
import os
import sys

import bpy

glb, out = sys.argv[-2], sys.argv[-1]
os.makedirs(out, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
sc = bpy.context.scene


def under(o, names):
    p = o
    while p is not None:
        if any(n in p.name for n in names):
            return True
        p = p.parent
    return False


white = bpy.data.materials.new("mask_white")
white.use_nodes = True
nt = white.node_tree
nt.nodes.clear()
em = nt.nodes.new("ShaderNodeEmission")
em.inputs["Color"].default_value = (1, 1, 1, 1)
outn = nt.nodes.new("ShaderNodeOutputMaterial")
nt.links.new(em.outputs[0], outn.inputs[0])
for o in sc.objects:
    if o.type != "MESH":
        continue
    if under(o, ("PodSingle", "PodDual")):
        o.hide_render = True
        continue
    o.data.materials.clear()
    o.data.materials.append(white)

world = bpy.data.worlds.new("black")
world.color = (0, 0, 0)
sc.world = world
sc.render.engine = "CYCLES"
sc.cycles.samples = 4
sc.cycles.device = "CPU"
sc.render.film_transparent = False
sc.view_settings.view_transform = "Standard"

cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam = bpy.data.objects.new("cam", cam_data)
sc.collection.objects.link(cam)
sc.camera = cam

# (name, px_per_m, camera location, rotation euler, centre the vehicle box in the frame)
VIEWS = [
    ("side_model", 171.8, (20.0, 0.0, 1.5), (1.5708, 0.0, 1.5708), (8.6, 3.6)),
    ("front_model", 568.0, (0.0, 20.0, 1.5), (1.5708, 0.0, 3.14159), (3.0, 3.4)),
]
for name, ppm, loc, rot, (w_m, h_m) in VIEWS:
    cam.location = loc
    cam.rotation_euler = rot
    sc.render.resolution_x = int(w_m * ppm)
    sc.render.resolution_y = int(h_m * ppm)
    sc.render.resolution_percentage = 100
    cam_data.ortho_scale = max(w_m, h_m)
    sc.render.filepath = os.path.join(out, name + ".png")
    bpy.ops.render.render(write_still=True)
    print("MASK", name, sc.render.resolution_x, sc.render.resolution_y)
