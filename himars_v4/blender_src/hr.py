"""Shared Blender helpers for the M142 HIMARS v3 build (bpy 5.x, background mode).

Conventions: metres, Blender front = +Y, up = +Z. Every builder returns the created
object. Names are the Godot node names; keep them unique in the scene.
"""
import math

import bpy
import bmesh
from mathutils import Matrix, Vector

# ----------------------------------------------------------------- materials
MAT_SPECS = {
    # name: (base_colour_linear_rgb, metallic, roughness, emission_rgb or None, alpha or None)
    "paint_od": ((0.060, 0.068, 0.034), 0.0, 0.55, None, None),       # FS 34088 olive drab (linear approx)
    "paint_tan": ((0.230, 0.200, 0.110), 0.0, 0.60, None, None),      # FS 33446 tan 686A (linear approx)
    "rubber": ((0.012, 0.012, 0.012), 0.0, 0.85, None, None),
    "steel": ((0.120, 0.120, 0.125), 0.9, 0.42, None, None),
    "steel_dark": ((0.030, 0.030, 0.032), 0.8, 0.55, None, None),
    "chrome": ((0.700, 0.700, 0.720), 1.0, 0.12, None, None),
    "glass": ((0.010, 0.016, 0.022), 0.0, 0.04, None, 0.35),
    "lens_red": ((0.500, 0.010, 0.006), 0.0, 0.18, (0.800, 0.020, 0.010), None),
    "lens_white": ((0.800, 0.800, 0.760), 0.0, 0.10, (0.600, 0.600, 0.560), None),
    "lens_amber": ((0.600, 0.250, 0.010), 0.0, 0.15, (0.700, 0.300, 0.010), None),
    "canvas": ((0.030, 0.035, 0.020), 0.0, 0.92, None, None),
    "interior_dark": ((0.020, 0.020, 0.022), 0.0, 0.70, None, None),
    "interior_grey": ((0.090, 0.095, 0.098), 0.0, 0.60, None, None),
    "fabric": ((0.030, 0.034, 0.022), 0.0, 0.95, None, None),
    "screen": ((0.010, 0.040, 0.030), 0.0, 0.25, (0.050, 0.700, 0.450), None),
    "hose": ((0.010, 0.010, 0.010), 0.0, 0.60, None, None),
    "rocket_motor": ((0.300, 0.300, 0.290), 0.2, 0.50, None, None),
    "gmlrs_airframe": ((0.110, 0.120, 0.060), 0.0, 0.45, None, None),
    "warhead_tan": ((0.230, 0.200, 0.110), 0.0, 0.55, None, None),
    "nozzle_dark": ((0.020, 0.020, 0.020), 0.5, 0.45, None, None),
    "decal_white": ((0.800, 0.800, 0.800), 0.0, 0.70, None, None),
}


def mat(name):
    """Return (creating once) the named Principled material."""
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    base, metal, rough, emit, alpha = MAT_SPECS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*base, 1.0)
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 1.0
    if alpha is not None:
        bsdf.inputs["Alpha"].default_value = alpha
        m.blend_method = "BLEND" if hasattr(m, "blend_method") else m.blend_method
    m["hr_group"] = name
    return m


# ---------------------------------------------------------------- collections
def collection(name, parent=None):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(col)
    return col


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _link(obj, col_name=None):
    col = collection(col_name) if col_name else bpy.context.scene.collection
    if obj.name not in col.objects:
        col.objects.link(obj)
    return obj


def _assign(obj, material_name):
    if material_name:
        obj.data.materials.clear()
        obj.data.materials.append(mat(material_name))


def _finish(obj, material_name=None, smooth_angle=None, col_name=None):
    _assign(obj, material_name)
    if smooth_angle is not None:
        shade_auto_smooth(obj, smooth_angle)
    _link(obj, col_name)
    return obj


def shade_auto_smooth(obj, angle_deg=30.0):
    """Smooth shading with hard edges above the angle (works in bpy 4.1+ and 5.x)."""
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(angle_deg))
    except Exception:  # fallback: plain smooth + edge split modifier
        bpy.ops.object.shade_smooth()
        em = obj.modifiers.new("EdgeSplit", "EDGE_SPLIT")
        em.split_angle = math.radians(angle_deg)
    obj.select_set(False)


def bevel(obj, width=0.01, segments=3, angle_deg=35.0):
    m = obj.modifiers.new("Bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(angle_deg)
    m.harden_normals = True
    return obj


def subdivide(obj, levels=1, render_levels=None):
    m = obj.modifiers.new("Subsurf", "SUBSURF")
    m.levels = levels
    m.render_levels = render_levels if render_levels is not None else levels
    return obj


def apply_all(obj):
    bpy.context.view_layer.objects.active = obj
    for m in list(obj.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=m.name)
        except RuntimeError:
            obj.modifiers.remove(m)
    return obj


# ------------------------------------------------------------------ primitives
def box(name, size, loc=(0, 0, 0), rot=(0, 0, 0), bev=0.0, seg=2, subdiv=0,
        material=None, smooth=30.0, col=None):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.dimensions = size
    bpy.ops.object.transform_apply(scale=True)
    if bev > 0:
        bevel(o, bev, seg)
    if subdiv:
        subdivide(o, subdiv)
    return _finish(o, material, smooth, col)


def cyl(name, r, depth, loc=(0, 0, 0), rot=(0, 0, 0), verts=48, bev=0.0, seg=2,
        subdiv=0, material=None, smooth=30.0, col=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth,
                                        location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    if bev > 0:
        bevel(o, bev, seg)
    if subdiv:
        subdivide(o, subdiv)
    return _finish(o, material, smooth, col)


def sphere(name, r, loc=(0, 0, 0), scale=(1, 1, 1), segments=32, rings=16,
           material=None, smooth=None, col=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings,
                                         radius=r, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    return _finish(o, material, smooth if smooth is not None else 40.0, col)


def torus(name, major, minor, loc=(0, 0, 0), rot=(0, 0, 0), major_seg=96, minor_seg=32,
          material=None, col=None):
    bpy.ops.mesh.primitive_torus_add(major_segments=major_seg, minor_segments=minor_seg,
                                     major_radius=major, minor_radius=minor,
                                     location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    return _finish(o, material, 40.0, col)


def lathe(name, profile, loc=(0, 0, 0), rot=(0, 0, 0), segments=64, material=None,
          smooth=40.0, col=None):
    """Spin a (radius, z) profile around the local Z axis. Profile points run bottom to top.
    A radius of 0 at an end caps it. Use for rockets, nozzles, bolts, rims."""
    bm = bmesh.new()
    verts = []
    for r, z in profile:
        verts.append(bm.verts.new((r, 0.0, z)))
    bm.verts.ensure_lookup_table()
    edges = []
    for i in range(len(verts) - 1):
        edges.append(bm.edges.new((verts[i], verts[i + 1])))
    res = bmesh.ops.spin(bm, geom=verts + edges, angle=2 * math.pi, steps=segments,
                         axis=(0, 0, 1), cent=(0, 0, 0))
    # remove duplicate verts at the seam produced by the spin
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    o.location = loc
    o.rotation_euler = rot
    _link(o, col)
    return _finish(o, material, smooth, col)


def tube(name, r_out, r_in, depth, loc=(0, 0, 0), rot=(0, 0, 0), segments=48,
         material=None, col=None):
    """Hollow cylinder (open ends) made by spinning a 4-point profile."""
    prof = [(r_in, -depth / 2), (r_out, -depth / 2), (r_out, depth / 2), (r_in, depth / 2)]
    return lathe(name, prof + [prof[0]], loc, rot, segments, material, 40.0, col)


def make_empty(name, loc=(0, 0, 0), rot=(0, 0, 0), col=None, empty_type="PLAIN_AXES",
               size=0.2):
    o = bpy.data.objects.new(name, None)
    o.empty_display_type = empty_type
    o.empty_display_size = size
    o.location = loc
    o.rotation_euler = rot
    _link(o, col)
    return o


def parent_keep(child, parent):
    """Parent while keeping the world transform."""
    mw = child.matrix_world.copy()
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()
    child.matrix_world = mw
    return child


def set_origin(obj, world_point):
    """Move the object origin to a world-space point without moving the geometry."""
    wp = Vector(world_point)
    me = obj.data
    off = obj.matrix_world.inverted().to_3x3() @ (wp - obj.location)
    me.transform(Matrix.Translation(-off))
    obj.location = wp
    return obj


def join(objs, name, col=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    return o


# ---------------------------------------------------------------- measurement
def tri_count(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    n = sum(max(len(p.vertices) - 2, 0) for p in me.polygons)
    ev.to_mesh_clear()
    return n


def world_bbox(objs):
    lo = [math.inf] * 3
    hi = [-math.inf] * 3
    for o in objs:
        if o.type != "MESH":
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
    return lo, hi


def all_mesh_objects():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def export_glb(path, objects=None, apply_modifiers=True):
    bpy.ops.object.select_all(action="DESELECT")
    objs = objects if objects is not None else all_mesh_objects()
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=apply_modifiers,
        export_yup=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="NONE",
    )
    return path
