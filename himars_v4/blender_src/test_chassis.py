"""Test for the v4 chassis and wheels.

Builds chassis (per part, then merged per material) and wheels, prints tri counts and the world
bbox, checks the layout contract and renders a side view and a front-3/4 view with Cycles on the
CPU (Workbench aborts here: libEGL missing). RENDER=0 skips the renders.

Run: PYTHONPATH=/tmp/claude-0/bpy_pkg python3 test_chassis.py
"""
import math
import os
import sys
import time

BUILD = os.path.dirname(os.path.abspath(__file__))
SCRATCH = os.path.dirname(BUILD)
sys.path.insert(0, BUILD)
sys.path.insert(0, os.path.join(BUILD, "modules"))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import hr  # noqa: E402
import layout as L  # noqa: E402
import chassis  # noqa: E402
import chassis_util as cu  # noqa: E402
import wheels  # noqa: E402

FAILS = []
TOL = 0.001


def check(name, ok, detail=""):
    print(f"CHECK {name} {'PASS' if ok else 'FAIL'} {detail}", flush=True)
    if not ok:
        FAILS.append(name)


def bbox_of(verts):
    lo = [min(v[i] for v in verts) for i in range(3)]
    hi = [max(v[i] for v in verts) for i in range(3)]
    return lo, hi


hr.reset_scene()
t0 = time.time()
chassis.build(merge=False)
parts = list(cu.PARTS)
print(f"BUILD_PARTS_SECONDS {time.time() - t0:.1f} PARTS {len(parts)}", flush=True)
for o in list(cu.OUT):
    bpy.data.objects.remove(o, do_unlink=True)

# ---------------------------------------------------------------- per-part checks
AXLE_HW = ("axle_", "diff_", "pinion_", "ubolt", "brake_", "dust_shield", "drum_", "kingpin",
           "steer_arm", "tie_rod", "torque_", "shock_low", "slack_", "chamber_", "spring_brake",
           "pushrod", "ctis", "breather")
low, wide, front, rear = [], [], [], []
rail_top = []
for name, mat, verts, faces in parts:
    lo, hi = bbox_of(verts)
    base = name[len("chassis_"):]
    if lo[2] < 0.30 - TOL and not base.startswith(AXLE_HW):
        low.append((name, round(lo[2], 3)))
    if max(abs(lo[0]), abs(hi[0])) > L.WIDTH_HALF + TOL:
        wide.append((name, round(lo[0], 3), round(hi[0], 3)))
    if hi[1] > L.FRONT_Y + TOL:
        front.append((name, round(hi[1], 4)))
    if lo[1] < L.REAR_Y - TOL:
        rear.append((name, round(lo[1], 4)))
    if base.startswith("rail_") and not base.startswith(("rail_rivet", "rail_endplate")):
        rail_top.append((name, round(lo[2], 4), round(hi[2], 4), round(lo[1], 3), round(hi[1], 3)))
check("no_part_below_0.30", not low, str(low[:10]))
check("width_within_1.22", not wide, str(wide[:10]))
check("nothing_beyond_FRONT_Y", not front, str(front[:10]))
check("nothing_beyond_REAR_Y", not rear, str(rear[:10]))
check("rails_top_1.29", bool(rail_top) and all(abs(r[2] - L.RAIL_Z[1]) < TOL and abs(r[1] - L.RAIL_Z[0]) < TOL
                                                for r in rail_top), str(rail_top))
allv = [v for p in parts for v in p[2]]
lo, hi = bbox_of(allv)
check("front_bumper_is_foremost", abs(hi[1] - L.FRONT_Y) < 0.003, f"max_y={hi[1]:.4f}")

# ---------------------------------------------------------------- merged chassis
t0 = time.time()
merged = cu.finish(True, "chassis")
total = 0
for o in merged:
    n = hr.tri_count(o)
    total += n
    print(f"MERGED {o.name} hr_node={o.get('hr_node')} tris={n}")
per_mat = {}
for name, mat, verts, faces in parts:
    per_mat[mat] = per_mat.get(mat, 0) + 1
print("PARTS_PER_MATERIAL", per_mat)
print("CHASSIS_TRIS", total)
lo, hi = hr.world_bbox(merged)
print("CHASSIS_BBOX_LO", [round(v, 3) for v in lo])
print("CHASSIS_BBOX_HI", [round(v, 3) for v in hi])
check("chassis_tris_budget", total <= 260000, str(total))
check("chassis_hr_node", all(o.get("hr_node") == "Body" for o in merged))
check("chassis_materials", all(o.data.materials[0].name in hr.MAT_SPECS for o in merged))

# ---------------------------------------------------------------- wheels
t0 = time.time()
wobjs = wheels.build()
print(f"WHEELS_SECONDS {time.time() - t0:.1f}", flush=True)
wtotal = 0
for o in wobjs:
    n = hr.tri_count(o)
    wtotal += n
    print(f"WHEEL {o.name} hr_node={o.get('hr_node')} tris={n}")
print("WHEELS_TRIS", wtotal)
for wname, pos in L.WHEELS.items():
    tyre = [o for o in wobjs if o.name == f"tyre_{wname}"][0]
    rim = [o for o in wobjs if o.name == f"nuts_{wname}"][0]
    tlo, thi = hr.world_bbox([tyre])
    c = [(tlo[i] + thi[i]) / 2 for i in range(3)]
    err = max(abs(c[i] - pos[i]) for i in range(3))
    rlo, rhi = hr.world_bbox([rim])   # 10 nuts on a symmetric bolt circle
    rc = ((rlo[1] + rhi[1]) / 2, (rlo[2] + rhi[2]) / 2)
    err = max(err, abs(rc[0] - pos[1]), abs(rc[1] - pos[2]))
    check(f"hub_{wname}", err < 0.005, f"centre={[round(v, 4) for v in c]} layout={pos} err={err * 1000:.1f}mm")
    check(f"hr_node_{wname}", all(o.get("hr_node") == wname for o in wobjs if o.name.endswith(wname)))
    check(f"tyre_od_{wname}", abs((thi[2] - tlo[2]) / 2 - L.TYRE_R) < 0.005, f"r={(thi[2] - tlo[2]) / 2:.4f}")
wlo, whi = hr.world_bbox(wobjs)
check("wheels_within_1.22", max(abs(wlo[0]), abs(whi[0])) <= L.WIDTH_HALF + TOL, f"{wlo[0]:.4f} {whi[0]:.4f}")
check("wheels_on_ground", abs(wlo[2]) < 0.003, f"min_z={wlo[2]:.4f}")
alo, ahi = hr.world_bbox(merged + wobjs)
print("ALL_BBOX_LO", [round(v, 3) for v in alo])
print("ALL_BBOX_HI", [round(v, 3) for v in ahi])
print("TOTAL_TRIS", total + wtotal)
print("FAILED", FAILS)

out = os.path.join(BUILD, "out", "chassis.glb")
hr.export_glb(out, merged)
hr.export_glb(os.path.join(BUILD, "out", "wheels.glb"), wobjs)
print("GLB", out, flush=True)

if os.environ.get("RENDER", "1") != "1":
    print("RENDER_SKIPPED")
    sys.exit(1 if FAILS else 0)

# ---------------------------------------------------------------- renders
scn = bpy.context.scene
scn.render.engine = "CYCLES"
scn.cycles.device = "CPU"
scn.cycles.samples = int(os.environ.get("SAMPLES", "48"))
try:
    scn.cycles.use_denoising = True
    scn.cycles.denoiser = "OPENIMAGEDENOISE"
except Exception:  # noqa: BLE001
    scn.cycles.use_denoising = False
scn.render.resolution_x = 1200
scn.render.resolution_y = 700
scn.render.resolution_percentage = 100
scn.render.image_settings.file_format = "PNG"
scn.view_settings.view_transform = "Standard"

world = bpy.data.worlds.new("grey")
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.50, 0.50, 0.50, 1.0)
bg.inputs["Strength"].default_value = 0.9
scn.world = world
sun_d = bpy.data.lights.new("sun", "SUN")
sun_d.energy = 3.5
sun_d.angle = math.radians(3)
sun = bpy.data.objects.new("sun", sun_d)
scn.collection.objects.link(sun)
sun.rotation_euler = (math.radians(50), 0, math.radians(60))
bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
ground = bpy.context.active_object
gm = bpy.data.materials.new("ground")
gm.use_nodes = True
gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.32, 0.32, 0.32, 1)
gm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
ground.data.materials.append(gm)

cam_d = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_d)
scn.collection.objects.link(cam)
scn.camera = cam
REND = os.path.join(SCRATCH, "renders")
os.makedirs(REND, exist_ok=True)
views = {
    # right side, front to the right (as side_ref.png)
    "side": dict(ortho=7.6, loc=(20.0, 0.0, 1.30), rot=(math.radians(90), 0, math.radians(90))),
    "f34": dict(lens=40.0, loc=(6.4, 8.6, 2.5), target=(0.0, 0.4, 0.85)),
    # extra views, rendered only when named on the command line
    "front": dict(ortho=2.9, loc=(0.0, 20.0, 1.05), rot=(math.radians(90), 0, math.radians(180))),
    "r34": dict(lens=40.0, loc=(-5.5, -8.4, 2.2), target=(0.0, -1.6, 0.85)),
}
DEFAULT_VIEWS = ["side", "f34"]
wanted = sys.argv[1:] or DEFAULT_VIEWS
for v in wanted:
    p = views[v]
    if "ortho" in p:
        cam_d.type = "ORTHO"
        cam_d.ortho_scale = p["ortho"]
        cam.rotation_mode = "XYZ"
        cam.rotation_euler = p["rot"]
    else:
        cam_d.type = "PERSP"
        cam_d.lens = p["lens"]
        d = (Vector(p["target"]) - Vector(p["loc"])).normalized()
        cam.rotation_mode = "QUATERNION"
        cam.rotation_quaternion = d.to_track_quat("-Z", "Y")
    cam.location = p["loc"]
    cam_d.clip_end = 200
    scn.render.filepath = os.path.join(REND, f"chassis_v4_{v}.png")
    t = time.time()
    bpy.ops.render.render(write_still=True)
    print("RENDER", scn.render.filepath, f"{time.time() - t:.1f}s", flush=True)
sys.exit(1 if FAILS else 0)
