import math
import os
import sys
import time

ROOT = "/tmp/claude-0/-home-user-Godotwright/7ae2e237-e8ec-5fe8-a3ff-1443b29100bf/scratchpad/v4"
BUILD = os.path.join(ROOT, "build")
sys.path.insert(0, BUILD)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import hr  # noqa: E402
from modules import rocket  # noqa: E402

NAME = "rocket"
t0 = time.time()
hr.reset_scene()
objs = rocket.build()
print(f"BUILD_SECONDS {time.time() - t0:.1f}")

total = 0
for o in objs:
    n = hr.tri_count(o)
    total += n
    print(f"OBJ {o.name} hr_node={o['hr_node']} tris={n}")
print("TOTAL_TRIS", total)
lo, hi = hr.world_bbox(objs)
print("BBOX_LO", [round(v, 4) for v in lo])
print("BBOX_HI", [round(v, 4) for v in hi])
for o in objs:
    print("MATERIALS", o.name, [s.material.name if s.material else None for s in o.material_slots])

out_dir = os.path.join(BUILD, "out")
os.makedirs(out_dir, exist_ok=True)
hr.export_glb(os.path.join(out_dir, NAME + ".glb"), objs)
hr.export_glb(os.path.join(out_dir, "gmlrs_master.glb"), objs)
print("EXPORT_OK")

# ---------------------------------------------------------------- renders (Workbench)
# Workbench aborts the process when libEGL is missing, so renders run only with RENDER=1.
ENGINE = os.environ.get("RENDER_ENGINE", "BLENDER_WORKBENCH")
if os.environ.get("RENDER") != "1":
    print("RENDER_SKIPPED (set RENDER=1 to try the renders; RENDER_ENGINE=CYCLES for CPU Cycles)")
    sys.exit(0)
try:
    scene = bpy.context.scene
    scene.render.engine = ENGINE
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    if ENGINE == "CYCLES":
        scene.render.resolution_x = 900
        scene.render.resolution_y = 600
        scene.cycles.device = "CPU"
        scene.cycles.samples = 32
        scene.cycles.use_denoising = False
        scene.cycles.max_bounces = 4
        if scene.world is None:
            scene.world = bpy.data.worlds.new("W")
        scene.world.use_nodes = False
        scene.world.color = (0.55, 0.57, 0.6)
        sun_d = bpy.data.lights.new("sun", "SUN")
        sun_d.energy = 3.0
        sun = bpy.data.objects.new("sun", sun_d)
        scene.collection.objects.link(sun)
        sun.rotation_euler = (0.9, 0.25, 0.7)
    else:
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

    def look_at(eye, target):
        d = (Vector(target) - Vector(eye)).normalized()
        cam.location = Vector(eye)
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()

    def shot(path, eye, target, ortho=None, lens=50):
        if ortho:
            cam_data.type = "ORTHO"
            cam_data.ortho_scale = ortho
        else:
            cam_data.type = "PERSP"
            cam_data.lens = lens
        look_at(eye, target)
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print("RENDER", path, flush=True)

    R = os.path.join(ROOT, "renders", NAME)
    os.makedirs(os.path.join(ROOT, "renders"), exist_ok=True)
    # nose-on from +Y: canard cross and the tail beyond
    suffix = "" if ENGINE != "CYCLES" else "_cy"
    shot(R + suffix + "_front.png", (0.0, 12.0, 0.0), (0.0, 0.0, 0.0), ortho=0.5)
    # side from -X: full length along Y (nose on the right of the image)
    shot(R + suffix + "_side.png", (-12.0, 0.0, 0.0), (0.0, 0.0, 0.0), ortho=6.2)
    # top from +Z: full length along Y
    shot(R + suffix + "_top.png", (0.0, 0.0, 12.0), (0.0, 0.0, 0.0), ortho=6.2)
    # close-ups, perspective
    shot(R + suffix + "_detail_nose.png", (0.55, 1.35, 0.45), (0.0, 1.80, 0.0), lens=50)
    shot(R + suffix + "_detail_tail.png", (0.55, -1.35, 0.45), (0.0, -1.80, 0.0), lens=50)
except Exception as exc:  # Workbench may still fail in background mode
    print("RENDER_FAILED", type(exc).__name__, exc)
print("RENDER_DONE")
