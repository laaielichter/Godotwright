"""Build cab_int (v4 LSAC cab interior) and check it.

Run: PYTHONPATH=/tmp/claude-0/bpy_pkg python3 test_cab_int.py
Prints per-object tris, total, bbox; CHECK lines; exports out/cab_int.glb.
"""
import os
import sys

BUILD = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BUILD)
sys.path.insert(0, os.path.join(BUILD, "modules"))
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import hr  # noqa: E402
import layout as L  # noqa: E402

hr.reset_scene()
import cab_int  # noqa: E402

objs = cab_int.build()
bpy.context.view_layer.update()
C = L.CAB
fails = 0


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(f"CHECK {name} {'PASS' if ok else 'FAIL'} {detail}")


total = 0
for o in objs:
    n = hr.tri_count(o)
    total += n
    lo, hi = hr.world_bbox([o])
    print(f"OBJ {o.name} hr_node={o.get('hr_node')} tris={n} "
          f"bbox={[round(v, 3) for v in lo]}..{[round(v, 3) for v in hi]}")
print("TOTAL_TRIS", total)
lo, hi = hr.world_bbox(objs)
print("BBOX_LO", [round(v, 3) for v in lo])
print("BBOX_HI", [round(v, 3) for v in hi])
t = 0.03
check("inside_cab", abs(lo[0]) <= C["half_width_low"] - t + 0.002 and
      hi[0] <= C["half_width_low"] - t + 0.002 and lo[1] >= C["rear_y"] + t - 0.002 and
      hi[1] <= C["front_y"] - t + 0.002 and lo[2] >= 1.45 + t - 0.002 and
      hi[2] <= C["roof_z"] + 0.002, f"{[round(v, 3) for v in lo]}..{[round(v, 3) for v in hi]}")
check("hr_node", all(o.get("hr_node") == "Interior" for o in objs))
for i in (1, 2):
    o = bpy.data.objects.get(f"fcc_screen_{i}")
    ok = o is not None and len(o.data.polygons) == 1 and o.data.uv_layers and \
        o.data.materials[0].name == "screen"
    if ok:
        uvs = sorted(tuple(round(c, 3) for c in d.uv) for d in o.data.uv_layers[0].data)
        ok = uvs == [(0.0, 0.0), (0.0, 1.0), (1.0, 0.0), (1.0, 1.0)]
        nrm = o.matrix_world.to_3x3() @ o.data.polygons[0].normal
        cen = o.matrix_world @ o.data.polygons[0].center
        to_view = (Vector(L.FCC_VIEW) - cen).normalized()
        ok = ok and nrm.dot(to_view) > 0.95
        print(f"SCREEN {o.name} centre={tuple(round(v, 3) for v in cen)} "
              f"facing_view={nrm.dot(to_view):.3f}")
    check(f"fcc_screen_{i}", ok)
floor = min(v for v in [hr.world_bbox([bpy.data.objects['cab_int_shell']])[0][2]])
print("FLOOR_PLATE_TOP", C["floor_z"])
check("tri_budget", total <= 220000, f"{total}")
out = os.path.join(BUILD, "out", "cab_int.glb")
hr.export_glb(out, objs)
print("GLB", out)
print("FAILS", fails)
