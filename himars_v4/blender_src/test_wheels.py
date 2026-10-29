import math
import os
import sys

ROOT = "/tmp/claude-0/-home-user-Godotwright/7ae2e237-e8ec-5fe8-a3ff-1443b29100bf/scratchpad/v4"
BUILD = os.path.join(ROOT, "build")
sys.path.insert(0, BUILD)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import hr  # noqa: E402
from modules import wheels  # noqa: E402

NAME = "wheels"
RENDER_OK = True

hr.reset_scene()
objs = wheels.build()

total = 0
for o in objs:
    n = hr.tri_count(o)
    total += n
    print(f"OBJ {o.name} hr_node={o['hr_node']} tris={n}")
print("TOTAL_TRIS", total)
lo, hi = hr.world_bbox(objs)
print("BBOX_LO", [round(v, 4) for v in lo])
print("BBOX_HI", [round(v, 4) for v in hi])

os.makedirs(os.path.join(ROOT, "build", "out"), exist_ok=True)
os.makedirs(os.path.join(ROOT, "renders"), exist_ok=True)
hr.export_glb(os.path.join(ROOT, "build", "out", NAME + ".glb"), objs)
print("EXPORT_OK")

# ---------------------------------------------------------------- renders
# Workbench needs an EGL/GL context; without libEGL the bpy process aborts (not an exception),
# so the render is skipped up front when libEGL.so.1 is missing.
import ctypes.util  # noqa: E402

if ctypes.util.find_library("EGL") is None and not os.path.exists("/usr/lib/x86_64-linux-gnu/libEGL.so.1"):
    RENDER_OK = False
    print("RENDER_SKIPPED: libEGL.so.1 not installed, Workbench cannot create a GL context in background mode")
    sys.exit(0)
try:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    sh = scene.display.shading
    sh.light = "STUDIO"
    sh.color_type = "MATERIAL"
    sh.background_type = "WORLD"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("W")
    scene.world.color = (0.55, 0.57, 0.6)
    for m in bpy.data.materials:
        spec = hr.MAT_SPECS.get(m.name)
        if spec:
            m.diffuse_color = (*spec[0], 1.0)

    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam


    def look_at(eye, target, up=(0, 0, 1)):
        d = (Vector(target) - Vector(eye)).normalized()
        cam.location = Vector(eye)
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        return cam


    def shot(path, eye, target, ortho=None, lens=None):
        if ortho:
            cam_data.type = "ORTHO"
            cam_data.ortho_scale = ortho
        else:
            cam_data.type = "PERSP"
            cam_data.lens = lens or 50
        look_at(eye, target)
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print("RENDER", path)

    R = os.path.join(ROOT, "renders", NAME)
    # front: camera on +Y looking toward -Y (vehicle front)
    shot(R + "_front.png", (0.0, 20.0, 0.6), (0.0, 0.6, 0.6), ortho=6.2)
    # side: camera on -X looking toward +X (left side of the vehicle)
    shot(R + "_side.png", (-20.0, -0.4, 0.6), (0.0, -0.4, 0.6), ortho=7.2)
    # top: camera above looking down, +Y up on screen
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 6.2
    look_at((0.0, -0.4, 20.0), (0.0, -0.4, 0.0))
    scene.render.filepath = R + "_top.png"
    bpy.ops.render.render(write_still=True)
    print("RENDER", R + "_top.png")
    # extra close-up of the front-left wheel from outside, perspective
    shot(R + "_detail.png", (-3.2, 2.55 - 1.5, 1.5), (-1.02, 2.55, 0.59), lens=50)
except Exception as exc:  # Workbench may not work in background mode
    RENDER_OK = False
    print("RENDER_FAILED", type(exc).__name__, exc)
print("RENDER_OK", RENDER_OK)
