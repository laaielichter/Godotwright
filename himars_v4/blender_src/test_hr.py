import sys
sys.path.insert(0, ".")
import hr, bpy
hr.reset_scene()
a = hr.box("Body", (2.44, 7.8, 1.0), (0, 0, 1.0), bev=0.04, seg=3, subdiv=1, material="paint_od")
w = hr.torus("TyreTest", 0.49, 0.2, loc=(1.0, 0, 0.59), rot=(0, 1.5708, 0), material="rubber")
r = hr.lathe("RocketTest", [(0,0),(0.1135,0),(0.1135,3.0),(0.05,3.2),(0,3.25)], loc=(0,0,0), rot=(1.5708,0,0), material="gmlrs_airframe")
t = hr.tube("TubeTest", 0.13, 0.115, 1.0, loc=(0,0,2), rot=(1.5708,0,0), material="steel")
p = hr.make_empty("PivotTest", loc=(0,0,1))
objs = hr.all_mesh_objects()
for o in objs:
    print("OBJ", o.name, "tris", hr.tri_count(o))
lo, hi = hr.world_bbox(objs)
print("BBOX", [round(v,3) for v in lo], [round(v,3) for v in hi])
hr.export_glb("/tmp/claude-0/hr_test.glb", objs)
print("EXPORT_OK")
