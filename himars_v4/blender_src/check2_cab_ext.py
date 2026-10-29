import sys, os, importlib
BUILD = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BUILD); sys.path.insert(0, os.path.join(BUILD, "modules"))
import hr, bpy, bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
hr.reset_scene()
mod = importlib.import_module("cab_ext")
objs = mod.build()
by = {o.name: o for o in objs}
shell = by["cab_shell"]
dg = bpy.context.evaluated_depsgraph_get()
ev = shell.evaluated_get(dg)
me = ev.to_mesh()
bm = bmesh.new(); bm.from_mesh(me)
vol = 0.0
for f in bm.faces:
    if len(f.verts) < 3: continue
    p0 = f.verts[0].co
    for i in range(1, len(f.verts) - 1):
        a, b = f.verts[i].co, f.verts[i + 1].co
        vol += p0.dot(a.cross(b)) / 6.0
print("SHELL signed volume", round(vol, 4), "(positive = outward normals)")
bvh = BVHTree.FromBMesh(bm)
def wc(o):
    pts = [o.matrix_world @ v.co for v in o.data.vertices]
    return Vector([sum(p[i] for p in pts) / len(pts) for i in range(3)])
for prefix in ["cab_ws_glass_L_", "cab_ws_glass_R_", "cab_rear_glass_", "cab_side_glass_L_", "cab_side_glass_R_", "cab_roof_hatch_", "cab_mirror_glass_L_", "cab_mirror_glass_R_"]:
    for o in objs:
        if o.name.startswith(prefix):
            c = wc(o)
            loc, nrm, idx, d = bvh.find_nearest(c)
            print("NEAR", o.name, "centre", tuple(round(v, 3) for v in c), "dist_to_shell", round(d, 4))
            break
# wheel arch clearance: shell verts in the front wheel zone must sit above the arch
bad = [v.co for v in bm.verts if abs(v.co.x) > 0.75 and 2.45 < v.co.y < 3.35 and v.co.z < 1.0]
print("ARCH verts inside wheel zone below Z 1.0:", len(bad))
ev.to_mesh_clear(); bm.free()
