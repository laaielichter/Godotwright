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
nonman = [e for e in bm.edges if not e.is_manifold]
print("SHELL verts", len(bm.verts), "faces", len(bm.faces), "non_manifold_edges", len(nonman))
# normals outward: compare face normal with direction from the shell centroid
c = Vector((0, 2.7, 1.7))
out_ok = sum(1 for f in bm.faces if (f.calc_center_median() - c).dot(f.normal) > 0)
print("SHELL faces facing outward (vs centroid)", out_ok, "of", len(bm.faces))
lo = [min(v.co[i] for v in bm.verts) for i in range(3)]
hi = [max(v.co[i] for v in bm.verts) for i in range(3)]
print("SHELL bbox lo", [round(x, 3) for x in lo], "hi", [round(x, 3) for x in hi])
bvh = BVHTree.FromBMesh(bm)
def dist_to_shell(p):
    loc, nrm, idx, d = bvh.find_nearest(Vector(p))
    return d
for name in ["cab_ws_glass_L_", "cab_ws_glass_R_", "cab_rear_glass", "cab_side_glass_L", "cab_side_glass_R"]:
    for o in objs:
        if o.name.startswith(name):
            print("GLASS", o.name, "centre", tuple(round(v, 3) for v in o.location), "dist_to_shell", round(dist_to_shell(o.location), 4))
            break
for n in ["cab_door_panel_L_0147", "cab_door_panel_R_0158", "cab_door_glass_L_0150", "cab_door_glass_R_0161"]:
    o = by[n]
    ws = [o.matrix_world @ v.co for v in o.data.vertices]
    lo_d = [min(p[i] for p in ws) for i in range(3)]; hi_d = [max(p[i] for p in ws) for i in range(3)]
    print("DOOR", n, "origin", tuple(round(v, 3) for v in o.location), "lo", [round(x, 3) for x in lo_d], "hi", [round(x, 3) for x in hi_d])
ev.to_mesh_clear()
bm.free()
print("TRIS shell", hr.tri_count(shell))
