"""Standalone test for the v4 launcher module (layout.py driven).

Builds the parts, checks them against layout.py, merges per (hr_node, material), prints OBJ lines,
tri totals and the world bbox, exports out/launcher.glb and renders (Cycles CPU; Workbench aborts
headless because libEGL is missing) a rear 3/4 and a side view to renders/launcher_v4_*.png.
Grey proxies (tyres, rails, bumper, cab block from layout.py) give context in the renders only;
they are not part of the launcher and are not counted. RENDER=0 skips the renders.

Run: PYTHONPATH=/tmp/claude-0/bpy_pkg python3 test_launcher.py
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
import launcher_util as lu  # noqa: E402
import launcher  # noqa: E402

NAME = "launcher"
RESULTS = []


def check(name, ok, detail):
    RESULTS.append(ok)
    print(f"CHECK {name} {'OK' if ok else 'FAIL'} {detail}", flush=True)


def vbbox(objs):
    lo = [math.inf] * 3
    hi = [-math.inf] * 3
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        mw = o.matrix_world
        for v in me.vertices:
            w = mw @ v.co
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
        ev.to_mesh_clear()
    return lo, hi


hr.reset_scene()
t0 = time.time()
parts = launcher.build(merge=False)
print(f"BUILD_PARTS_SECONDS {time.time() - t0:.1f} PARTS {len(parts)}", flush=True)

# turntable: ring parts (fixed race and rotating ring) centred on YAW_ORIGIN, bottom on its Z
rings = [o for o in parts if o.get("tt_ring")]
lo, hi = vbbox(rings)
c = [(lo[i] + hi[i]) / 2 for i in range(3)]
d = math.hypot(c[0] - L.YAW_ORIGIN[0], c[1] - L.YAW_ORIGIN[1])
check("turntable_centre", d < 0.002 and abs(lo[2] - L.YAW_ORIGIN[2]) < 0.002 and len(rings) == 2,
      f"centre=({c[0]:.4f},{c[1]:.4f}) bottom_z={lo[2]:.4f} yaw_origin={L.YAW_ORIGIN} rings={len(rings)}")

merged = lu.merge(parts, NAME)
lu.OUT[:] = merged
bpy.context.view_layer.update()

total = 0
node_tris = {}
for o in sorted(merged, key=lambda o: o.name):
    n = hr.tri_count(o)
    total += n
    node_tris[o["hr_node"]] = node_tris.get(o["hr_node"], 0) + n
    print(f"OBJ {o.name} hr_node={o.get('hr_node')} tris={n} origin={tuple(round(v, 4) for v in o.location)}")
for k in sorted(node_tris):
    print(f"NODE_TRIS {k} {node_tris[k]}")
print("TOTAL_TRIS", total)
lo, hi = vbbox(merged)
print("BBOX_LO", [round(v, 4) for v in lo])
print("BBOX_HI", [round(v, 4) for v in hi])

# pod boxes equal layout.POD within 1 cm
want_lo = (-L.POD["half_width"], L.POD["y"][1], L.POD["z"][0])
want_hi = (L.POD["half_width"], L.POD["y"][0], L.POD["z"][1])
for node in ("PodSix", "PodSingle", "PodDual"):
    plo, phi = vbbox([o for o in merged if o.get("hr_node") == node])
    err = max(max(abs(plo[i] - want_lo[i]), abs(phi[i] - want_hi[i])) for i in range(3))
    check(f"pod_bbox_{node}", err <= 0.01,
          f"lo={[round(v, 4) for v in plo]} hi={[round(v, 4) for v in phi]} max_err={err:.4f}")

# module (side housings) spans layout.MODULE in X
mlo, mhi = vbbox([o for o in merged if o.get("hr_node") == "LauncherPitch"])
mhw = L.MODULE["half_width"]
check("module_width", abs(mlo[0] + mhw) <= 0.01 and abs(mhi[0] - mhw) <= 0.01,
      f"x=({mlo[0]:.4f},{mhi[0]:.4f}) want +-{mhw}")

# rear caps centred on the rocket axes (x, z), origins on those axes at the pod end
worst = 0.0
missing = []
for i, (rx, _ry, rz) in enumerate(L.ROCKETS, 1):
    o = bpy.data.objects.get(f"pod_cap_rear_{i}")
    if o is None or o.get("hr_node") != "PodSix":
        missing.append(i)
        continue
    clo, chi = vbbox([o])
    cx, cz = (clo[0] + chi[0]) / 2, (clo[2] + chi[2]) / 2
    worst = max(worst, abs(cx - rx), abs(cz - rz), abs(o.location.x - rx), abs(o.location.z - rz))
check("rear_caps_on_rockets", not missing and worst < 0.002, f"missing={missing} max_dev={worst:.5f}")
fronts = [n for n in (f"pod_cap_front_{i}" for i in range(1, 7)) if bpy.data.objects.get(n) is None]
check("front_caps_present", not fronts, f"missing={fronts}")

# stowed envelope
check("stowed_abs_x", max(abs(lo[0]), abs(hi[0])) <= 1.16 + 1e-4, f"max|x|={max(abs(lo[0]), abs(hi[0])):.4f}")
check("stowed_rear_y", lo[1] >= L.REAR_Y - 1e-4, f"min_y={lo[1]:.4f} rear_y={L.REAR_Y}")
check("stowed_top_z", hi[2] <= 2.62 + 1e-4 and hi[2] < L.CAB_ROOF_Z, f"max_z={hi[2]:.4f} limit=2.62")
check("tri_budget_300k", total <= 300000, f"total={total}")

out = os.path.join(BUILD, "out", f"{NAME}.glb")
os.makedirs(os.path.dirname(out), exist_ok=True)
hr.export_glb(out, merged)
print("GLB", out, flush=True)
print("CHECKS_ALL", "OK" if all(RESULTS) else "FAIL", flush=True)

if os.environ.get("RENDER", "1") != "1":
    print("RENDER_SKIPPED")
    sys.exit(0)

# -------------------------------------------------------------------------------- renders
for o in merged:
    if o.get("hr_node") in ("PodSingle", "PodDual"):
        o.hide_render = True


def proxy_mat():
    m = bpy.data.materials.new("proxy")
    m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.32, 0.32, 0.32, 1)
    m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.8
    return m


PM = proxy_mat()


def proxy(o):
    o.data.materials.clear()
    o.data.materials.append(PM)
    return o


if os.environ.get("CONTEXT", "1") == "1":
    for wname, (x, y, z) in L.WHEELS.items():
        proxy(hr.cyl(f"px_tyre_{wname}", L.TYRE_R, L.TYRE_W, loc=(x, y, z), rot=(0, math.pi / 2, 0), verts=48))
    for sx in (1, -1):
        proxy(hr.box(f"px_rail_{sx}", (0.10, 6.2, L.RAIL_Z[1] - L.RAIL_Z[0]),
                     loc=(sx * L.RAIL_X, -0.3, sum(L.RAIL_Z) / 2)))
    proxy(hr.box("px_rear_bumper", (2.3, 0.15, L.REAR_BUMPER_Z[1] - L.REAR_BUMPER_Z[0]),
                 loc=(0, L.REAR_Y + 0.075, sum(L.REAR_BUMPER_Z) / 2)))
    C = L.CAB
    proxy(hr.box("px_cab", (2 * C["half_width_low"], C["front_y"] - C["rear_y"], C["roof_z"] - C["body_bottom_z"]),
                 loc=(0, (C["front_y"] + C["rear_y"]) / 2, (C["roof_z"] + C["body_bottom_z"]) / 2)))
    IB = L.INTAKE_BOX
    proxy(hr.box("px_intake", (IB["x"][1] - IB["x"][0], IB["y"][1] - IB["y"][0], IB["z"][1] - IB["z"][0]),
                 loc=(sum(IB["x"]) / 2, sum(IB["y"]) / 2, sum(IB["z"]) / 2)))
    gp = hr.box("px_ground", (30, 30, 0.02), loc=(0, 0, -0.01))
    proxy(gp)

scn = bpy.context.scene
scn.render.engine = "CYCLES"
scn.cycles.device = "CPU"
scn.cycles.samples = int(os.environ.get("SAMPLES", "48"))
try:
    scn.cycles.use_denoising = True
    scn.cycles.denoiser = "OPENIMAGEDENOISE"
except Exception:
    scn.cycles.use_denoising = False
scn.render.resolution_x = 1200
scn.render.resolution_y = 800
scn.render.resolution_percentage = 100
scn.render.image_settings.file_format = "PNG"
scn.view_settings.view_transform = "Standard"

world = bpy.data.worlds.new("grey")
scn.world = world
try:
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.45, 0.45, 0.45, 1)
    bg.inputs["Strength"].default_value = 1.0
except Exception:
    world.color = (0.45, 0.45, 0.45)
sun_d = bpy.data.lights.new("Sun", "SUN")
sun_d.energy = 5.0
sun_d.angle = math.radians(3)
sun = bpy.data.objects.new("Sun", sun_d)
scn.collection.objects.link(sun)
sun.rotation_euler = (math.radians(35), 0, math.radians(-125))

cam_d = bpy.data.cameras.new("RCam")
cam = bpy.data.objects.new("RCam", cam_d)
scn.collection.objects.link(cam)
scn.camera = cam
cam_d.clip_start = 0.05
cam_d.clip_end = 200.0


def aim(location, target):
    cam.location = Vector(location)
    d = (Vector(target) - cam.location).normalized()
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


REND = os.path.join(SCRATCH, "renders")
os.makedirs(REND, exist_ok=True)
views = os.environ.get("VIEWS", "r34,side").split(",")
def show_pod(node):
    for o in merged:
        if o.get("hr_node") in ("PodSix", "PodSingle", "PodDual"):
            o.hide_render = o.get("hr_node") != node


for v in views:
    show_pod({"rear_single": "PodSingle", "rear_dual": "PodDual"}.get(v, "PodSix"))
    if v == "r34":      # like dvids_8391601: behind and right of the truck, eye height, close
        sun.rotation_euler = (math.radians(35), 0, math.radians(40))
        cam_d.type = "PERSP"
        cam_d.lens = 24
        aim((2.9, -6.9, 1.65), (-0.05, -2.75, 1.85))   # behind and right
    elif v == "side":   # right side, square on (like side_ref.png), orthographic
        sun.rotation_euler = (math.radians(40), 0, math.radians(70))   # light the right side
        cam_d.type = "ORTHO"
        cam_d.ortho_scale = 7.6
        cam.location = (20.0, -0.2, 1.45)
        cam.rotation_euler = (math.pi / 2, 0, math.pi / 2)
    elif v.startswith("rear"):
        cam_d.type = "ORTHO"
        cam_d.ortho_scale = 3.2
        cam.location = (0.0, -20.0, 1.75)
        cam.rotation_euler = (math.pi / 2, 0, 0)
    elif v == "top":
        cam_d.type = "PERSP"
        cam_d.lens = 30
        aim((2.6, -6.5, 4.4), (0.0, -1.6, 1.9))
    scn.render.filepath = os.path.join(REND, f"{NAME}_v4_{v}.png")
    t1 = time.time()
    bpy.ops.render.render(write_still=True)
    print("RENDER", scn.render.filepath, f"{time.time() - t1:.1f}s", flush=True)
