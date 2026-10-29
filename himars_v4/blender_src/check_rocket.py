import math, os, sys
ROOT = "/tmp/claude-0/-home-user-Godotwright/7ae2e237-e8ec-5fe8-a3ff-1443b29100bf/scratchpad/v4"
sys.path.insert(0, os.path.join(ROOT, "build"))
import bpy
import bmesh
from mathutils import Vector
import hr
from modules import rocket

hr.reset_scene()
objs = rocket.build()
o = objs[0]
bm = bmesh.new()
bm.from_mesh(o.data)
bm.faces.ensure_lookup_table()
n_b = sum(1 for e in bm.edges if len(e.link_faces) == 1)
n_nm = sum(1 for e in bm.edges if len(e.link_faces) > 2)
print("VERTS", len(bm.verts), "EDGES", len(bm.edges), "FACES", len(bm.faces))
print("BOUNDARY_EDGES", n_b, "NONMANIFOLD_EDGES", n_nm)
# orientation: for faces well outside the axis, normal should point away from the Y axis
out = 0; inn = 0
for f in bm.faces:
    c = f.calc_center_median()
    radial = Vector((c.x, 0.0, c.z))
    if radial.length < 1e-4:
        continue
    d = f.normal.dot(radial.normalized())
    if abs(d) < 0.2:
        continue  # end faces: skip
    if d > 0: out += 1
    else: inn += 1
print("SIDE_FACES_OUTWARD", out, "INWARD", inn)
# radius profile vs Y (max radial distance of vertices in bins)
bins = {}
for v in bm.verts:
    y = v.co.y
    r = math.hypot(v.co.x, v.co.z)
    k = round(y / 0.1) * 0.1
    bins[k] = max(bins.get(k, 0.0), r)
for k in sorted(bins):
    print(f"Y {k:+.1f} rmax {bins[k]:.4f}")
bm.free()
