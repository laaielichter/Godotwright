import sys, os, importlib
BUILD = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BUILD); sys.path.insert(0, os.path.join(BUILD, "modules"))
import hr, bpy, bmesh
hr.reset_scene()
mod = importlib.import_module("cab_ext")
objs = mod.build()
shell = [o for o in objs if o.name == "cab_shell"][0]
ev = shell.evaluated_get(bpy.context.evaluated_depsgraph_get())
me = ev.to_mesh(); bm = bmesh.new(); bm.from_mesh(me)
for sd, lab in ((-1, "L"), (1, "R")):
    inside = [v.co for v in bm.verts if sd * v.co.x > 0.9 and 3.0 - 0.02 < v.co.y < 3.4 + 0.02 and 1.6 - 0.02 < v.co.z < 2.4 + 0.02]
    print("SIDEWIN", lab, "verts in opening zone", len(inside), "min |X| there", round(min((abs(p.x) for p in inside), default=0), 3))
    door = [v.co for v in bm.verts if sd * v.co.x > 1.0 and 1.9 < v.co.y < 2.9 and 1.0 < v.co.z < 2.4]
    print("DOORWIN", lab, "verts in door opening zone", len(door))
ev.to_mesh_clear(); bm.free()
