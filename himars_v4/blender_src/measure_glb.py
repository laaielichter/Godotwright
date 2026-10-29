import sys, bpy
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=sys.argv[-1])
rows=[]
for o in bpy.context.scene.objects:
    if o.type!='MESH': continue
    ws=[o.matrix_world @ Vector(c) for c in o.bound_box]
    ys=[w.y for w in ws]; zs=[w.z for w in ws]; xs=[w.x for w in ws]
    rows.append((min(ys),max(ys),min(xs),max(xs),min(zs),max(zs),o.name))
rows.sort()
print("FRONTMOST (max y):")
for r in sorted(rows,key=lambda r:-r[1])[:8]: print("  %.3f %s"%(r[1],r[6]))
print("REARMOST (min y):")
for r in rows[:8]: print("  %.3f %s"%(r[0],r[6]))
print("TOPMOST:")
for r in sorted(rows,key=lambda r:-r[5])[:6]: print("  %.3f %s"%(r[5],r[6]))
