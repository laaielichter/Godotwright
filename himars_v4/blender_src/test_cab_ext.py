"""Build cab_ext (v4 armoured LSAC cab) and check it against layout.py.

Run: PYTHONPATH=/tmp/claude-0/bpy_pkg python3 test_cab_ext.py
Prints per-object tris, total, bbox; CHECK lines; exports out/cab_ext.glb.
Envelope check: the body, glass and doors must fit |X| <= CAB half_width_low,
Y rear_y..front_y, Z body_bottom_z..roof_z. cab_fittings (mirrors, grab rails, hatch ring,
antenna bases, lifting eyes) stand proud by design and are reported, not limited.
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
import cab_ext  # noqa: E402

objs = cab_ext.build()
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

eps = 0.002
core = [o for o in objs if o.name != "cab_fittings"]
lo, hi = hr.world_bbox(core)
check("envelope_x", max(abs(lo[0]), abs(hi[0])) <= C["half_width_low"] + eps,
      f"|X|max={max(abs(lo[0]), abs(hi[0])):.3f}")
check("envelope_y", lo[1] >= C["rear_y"] - eps and hi[1] <= C["front_y"] + eps,
      f"Y {lo[1]:.3f}..{hi[1]:.3f}")
check("envelope_z", lo[2] >= C["body_bottom_z"] - eps and hi[2] <= C["roof_z"] + eps,
      f"Z {lo[2]:.3f}..{hi[2]:.3f}")
fit = [o for o in objs if o.name == "cab_fittings"]
if fit:
    flo, fhi = hr.world_bbox(fit)
    print("FITTINGS_BBOX", [round(v, 3) for v in flo], [round(v, 3) for v in fhi])
    check("fittings_rear_front", flo[1] >= C["rear_y"] - eps and fhi[1] <= C["front_y"] + eps,
          f"Y {flo[1]:.3f}..{fhi[1]:.3f}")
names = {o.name for o in objs}
for d in ("DoorL", "DoorR"):
    o = bpy.data.objects.get(d)
    ok = o is not None and o.get("hr_node") == d and \
        (o.location - Vector(L.DOOR_HINGE[d])).length < 1e-5
    check(f"door_{d}", ok, f"origin={tuple(round(v, 4) for v in o.location) if o else None} "
          f"hinge={L.DOOR_HINGE[d]}")
    if o:
        dlo, dhi = hr.world_bbox([o])
        check(f"door_{d}_span", abs(dlo[1] - C["door_y"][0]) < 0.02 and
              dhi[1] <= C["door_y"][1] + 0.06 and abs(dlo[2] - C["door_z"][0]) < 0.02 and
              abs(dhi[2] - C["door_z"][1]) < 0.02,
              f"Y {dlo[1]:.3f}..{dhi[1]:.3f} Z {dlo[2]:.3f}..{dhi[2]:.3f}")
gl = bpy.data.objects.get("cab_glass")
check("glass_material", gl is not None and all(m.name == "glass" for m in gl.data.materials))
check("glass_z", gl is not None and abs(hr.world_bbox([gl])[0][2] - C["glass_z"][0]) < 0.03
      and abs(hr.world_bbox([gl])[1][2] - C["glass_z"][1]) < 0.03,
      f"Z {hr.world_bbox([gl])[0][2]:.3f}..{hr.world_bbox([gl])[1][2]:.3f}" if gl else "")
check("hr_nodes", all(o.get("hr_node") in ("Body", "DoorL", "DoorR") for o in objs))
check("tri_budget", total <= 275000, f"{total}")

# chassis keep-out volumes (from the finished chassis): front wheel wells under the fenders,
# the fender front slope, the frame rails with shock tops and steering gear between them
KEEP_OUT = {
    "wheel_well": ((0.80, 1.30), (1.70, 2.95), (0.0, 1.45)),       # |X|, Y, Z
    "rails": ((0.0, 0.60), (-9.0, 3.23), (0.0, 1.30)),
}


def verts_in(objs, box):
    (x0, x1), (y0, y1), (z0, z1) = box
    dg = bpy.context.evaluated_depsgraph_get()
    hits = []
    for o in objs:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        mw = ev.matrix_world
        for v in me.vertices:
            w = mw @ v.co
            if x0 < abs(w.x) < x1 and y0 < w.y < y1 and z0 < w.z < z1:
                hits.append((o.name, tuple(round(c, 3) for c in w)))
        ev.to_mesh_clear()
    return hits


for kname, box in KEEP_OUT.items():
    h = verts_in(objs, box)
    check(f"keepout_{kname}", not h, f"{len(h)} verts {h[:3]}")

out = os.path.join(BUILD, "out", "cab_ext.glb")
hr.export_glb(out, objs)
print("GLB", out)
print("FAILS", fails)
