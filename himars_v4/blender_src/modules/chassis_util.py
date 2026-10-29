"""Chassis-private helpers: naming, tagging, fasteners, bevelled prisms, swept hoses and leaves,
louvre panels and the per-material merge. Every object created here is tagged hr_node 'Body'.
All geometry is built in world coordinates (front +Y, up +Z, right +X, ground Z 0)."""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

_HERE = os.path.dirname(os.path.abspath(__file__))
_BUILD = os.path.dirname(_HERE)
for _p in (_HERE, _BUILD):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import hr  # noqa: E402
import layout  # noqa: E402,F401  (re-exported for the chassis modules)

NODE = "Body"
OUT = []
PARTS = []          # (name, material, verts, faces) collected by build(), turned into objects by finish()
_counter = [0]
HALF_PI = math.pi / 2
SIDES = ((1, "R"), (-1, "L"))
BEVEL_ANGLE = 35.0
SHARP_ANGLE = 36.0


def reset():
    OUT.clear()
    PARTS.clear()
    _counter[0] = 0


def nm(base):
    _counter[0] += 1
    return f"chassis_{base}_{_counter[0]:04d}"


def _matrix(loc, rot):
    return Matrix.Translation(Vector(loc)) @ Euler(rot, "XYZ").to_matrix().to_4x4()


def _emit(base, bm, mat, bev=0.0, seg=2, matrix=None, recalc=False):
    """Bevel the hard edges of a bmesh (angle limited, like hr.bevel), transform it and store
    it as a part. No bpy.ops are used, so building ~2000 parts stays fast."""
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    if matrix is not None:
        bmesh.ops.transform(bm, matrix=matrix, verts=list(bm.verts))
    if bev > 0:
        lim = math.radians(BEVEL_ANGLE)
        edges = [e for e in bm.edges if e.calc_face_angle(0.0) > lim]
        if edges:
            bmesh.ops.bevel(bm, geom=edges, offset=bev, offset_type="OFFSET", segments=seg,
                            profile=0.5, affect="EDGES", clamp_overlap=True)
    bm.verts.index_update()
    verts = [tuple(v.co) for v in bm.verts]
    faces = [tuple(v.index for v in f.verts) for f in bm.faces]
    bm.free()
    name = nm(base)
    PARTS.append((name, mat, verts, faces))
    return name


def _mesh_obj(base, verts, faces, mat, bev=0.0, seg=2, smooth=None, bev_angle=None):
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in verts]
    for f in faces:
        try:
            bm.faces.new([vs[i] for i in f])
        except ValueError:
            pass
    return _emit(base, bm, mat, bev, seg, recalc=True)


def _new_object(name, mat, verts, faces):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate(clean_customdata=False)
    me.update()
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(SHARP_ANGLE))
    if mat in hr.MAT_SPECS:
        me.materials.append(hr.mat(mat))
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o["hr_node"] = NODE
    return o


def finish(merge=True, prefix="chassis"):
    """Turn the collected parts into objects: one per material (merge) or one per part."""
    objs = []
    if merge:
        groups = {}
        for name, mat, verts, faces in PARTS:
            g = groups.setdefault(mat, ([], []))
            base = len(g[0])
            g[0].extend(verts)
            g[1].extend(tuple(base + i for i in f) for f in faces)
        for mat, (verts, faces) in groups.items():
            objs.append(_new_object(f"{prefix}_{mat}", mat, verts, faces))
    else:
        for name, mat, verts, faces in PARTS:
            o = _new_object(name, mat, verts, faces)
            o["material_group"] = mat
            objs.append(o)
    OUT[:] = objs
    return objs


# ------------------------------------------------------------------ primitives
def box(base, size, loc, mat="paint_od", bev=0.006, seg=2, subdiv=0, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=list(bm.verts))
    return _emit(base, bm, mat, bev, seg, _matrix(loc, rot))


def box_mm(base, lo, hi, mat="paint_od", bev=0.006, seg=2):
    """Axis-aligned box from its min and max corners."""
    size = tuple(h - l for l, h in zip(lo, hi))
    loc = tuple((l + h) / 2 for l, h in zip(lo, hi))
    return box(base, size, loc, mat=mat, bev=bev, seg=seg)


def cyl(base, r, depth, loc, rot=(0, 0, 0), verts=24, mat="steel", bev=0.0, seg=2, subdiv=0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=verts, radius1=r,
                          radius2=r, depth=depth)
    return _emit(base, bm, mat, bev, seg, _matrix(loc, rot))


def cyl_x(base, r, x0, x1, y, z, verts=24, mat="steel", bev=0.0, seg=2):
    return cyl(base, r, abs(x1 - x0), ((x0 + x1) / 2, y, z), rot=(0, HALF_PI, 0),
               verts=verts, mat=mat, bev=bev, seg=seg)


def cyl_y(base, r, y0, y1, x, z, verts=24, mat="steel", bev=0.0, seg=2):
    return cyl(base, r, abs(y1 - y0), (x, (y0 + y1) / 2, z), rot=(HALF_PI, 0, 0),
               verts=verts, mat=mat, bev=bev, seg=seg)


def cyl_z(base, r, z0, z1, x, y, verts=24, mat="steel", bev=0.0, seg=2):
    return cyl(base, r, abs(z1 - z0), (x, y, (z0 + z1) / 2), verts=verts, mat=mat,
               bev=bev, seg=seg)


def lathe(base, profile, loc, rot=(0, 0, 0), segments=32, mat="steel"):
    """Spin a (radius, z) profile around the local Z axis (as hr.lathe)."""
    bm = bmesh.new()
    vs = [bm.verts.new((r, 0.0, z)) for r, z in profile]
    es = [bm.edges.new((vs[i], vs[i + 1])) for i in range(len(vs) - 1)]
    bmesh.ops.spin(bm, geom=vs + es, angle=2 * math.pi, steps=segments, axis=(0, 0, 1),
                   cent=(0, 0, 0))
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return _emit(base, bm, mat, 0.0, 2, _matrix(loc, rot))


def tube(base, r_out, r_in, depth, loc, rot=(0, 0, 0), segments=24, mat="steel"):
    prof = [(r_in, -depth / 2), (r_out, -depth / 2), (r_out, depth / 2), (r_in, depth / 2)]
    return lathe(base, prof + [prof[0]], loc, rot, segments, mat)


def torus(base, major, minor, loc, rot=(0, 0, 0), mat="steel", major_seg=32, minor_seg=12):
    verts, faces = [], []
    for i in range(major_seg):
        a = 2 * math.pi * i / major_seg
        for j in range(minor_seg):
            b = 2 * math.pi * j / minor_seg
            rr = major + minor * math.cos(b)
            verts.append((rr * math.cos(a), rr * math.sin(a), minor * math.sin(b)))
    for i in range(major_seg):
        i2 = (i + 1) % major_seg
        for j in range(minor_seg):
            j2 = (j + 1) % minor_seg
            faces.append((i * minor_seg + j, i2 * minor_seg + j, i2 * minor_seg + j2, i * minor_seg + j2))
    M = _matrix(loc, rot)
    verts = [tuple(M @ Vector(v)) for v in verts]
    return _mesh_obj(base, verts, faces, mat)


def sphere(base, r, loc, scale=(1, 1, 1), mat="steel", segments=20, rings=10):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=r)
    bmesh.ops.scale(bm, vec=Vector(scale), verts=list(bm.verts))
    return _emit(base, bm, mat, 0.0, 2, _matrix(loc, (0, 0, 0)))


def rod(base, p0, p1, r, verts=16, mat="steel", bev=0.0, seg=2):
    """Cylinder from point p0 to point p1."""
    a, b = Vector(p0), Vector(p1)
    d = b - a
    q = d.normalized().to_track_quat("Z", "Y")
    return cyl(base, r, d.length, tuple((a + b) / 2), rot=tuple(q.to_euler()), verts=verts,
               mat=mat, bev=bev, seg=seg)


# ------------------------------------------------------------------ fasteners
def bolt_x(base, x, y, z, r=0.011, h=0.008, mat="steel"):
    """Hex head whose axis points along X."""
    return cyl(base, r, h, (x, y, z), rot=(0, HALF_PI, 0), verts=6, mat=mat)


def bolt_y(base, x, y, z, r=0.011, h=0.008, mat="steel"):
    """Hex head whose axis points along Y."""
    return cyl(base, r, h, (x, y, z), rot=(HALF_PI, 0, 0), verts=6, mat=mat)


def bolt_z(base, x, y, z, r=0.011, h=0.008, mat="steel"):
    """Hex head whose axis points along Z."""
    return cyl(base, r, h, (x, y, z), rot=(0, 0, 0), verts=6, mat=mat)


def bolt_row(base, axis, p0, p1, n, r=0.010, h=0.007, mat="steel"):
    """n bolt heads evenly from p0 to p1 (inclusive), head axis along 'x', 'y' or 'z'."""
    fn = {"x": bolt_x, "y": bolt_y, "z": bolt_z}[axis]
    for i in range(n):
        t = i / (n - 1) if n > 1 else 0.5
        fn(f"{base}_{i}", *(a + (b - a) * t for a, b in zip(p0, p1)), r=r, h=h, mat=mat)


def rivet_row(base, axis, p0, p1, n, r=0.006, mat="steel"):
    """Round rivet heads (low domes), 8 sided, axis along 'x', 'y' or 'z'."""
    rot = {"x": (0, HALF_PI, 0), "y": (HALF_PI, 0, 0), "z": (0, 0, 0)}[axis]
    for i in range(n):
        t = i / (n - 1) if n > 1 else 0.5
        p = tuple(a + (b - a) * t for a, b in zip(p0, p1))
        cyl(f"{base}_{i}", r, 0.006, p, rot=rot, verts=8, mat=mat)


# ------------------------------------------------------------------ prisms
def _prism_verts(profile, a0, a1, axis):
    def P(u, v, a):
        if axis == "y":
            return (u, a, v)        # profile (x, z)
        if axis == "x":
            return (a, u, v)        # profile (y, z)
        return (u, v, a)            # axis z, profile (x, y)
    n = len(profile)
    verts = [P(u, v, a0) for u, v in profile] + [P(u, v, a1) for u, v in profile]
    faces = [list(range(n)), list(range(2 * n - 1, n - 1, -1))]
    for i in range(n):
        j = (i + 1) % n
        faces.append([i, j, n + j, n + i])
    return verts, faces


def prism(base, profile, y0, y1, mat="paint_od", bev=0.004, seg=3, smooth=35.0):
    """Closed (x, z) profile extruded along Y from y0 to y1, bevelled on its hard edges."""
    v, f = _prism_verts(profile, y0, y1, "y")
    return _mesh_obj(base, v, f, mat, bev, seg, smooth)


def prism_x(base, profile, x0, x1, mat="paint_od", bev=0.004, seg=3, smooth=35.0):
    """Closed (y, z) profile extruded along X from x0 to x1."""
    v, f = _prism_verts(profile, x0, x1, "x")
    return _mesh_obj(base, v, f, mat, bev, seg, smooth)


def prism_z(base, profile, z0, z1, mat="paint_od", bev=0.004, seg=3, smooth=35.0):
    """Closed (x, y) profile extruded along Z from z0 to z1."""
    v, f = _prism_verts(profile, z0, z1, "z")
    return _mesh_obj(base, v, f, mat, bev, seg, smooth)


def rounded_rect(w, h, r, cx=0.0, cz=0.0, n=4):
    """Closed profile of a w x h rectangle with corner radius r (n segments per corner)."""
    pts = []
    corners = ((w / 2 - r, h / 2 - r, 0.0), (-w / 2 + r, h / 2 - r, HALF_PI),
               (-w / 2 + r, -h / 2 + r, math.pi), (w / 2 - r, -h / 2 + r, 1.5 * math.pi))
    for ccx, ccz, a0 in corners:
        for k in range(n + 1):
            a = a0 + HALF_PI * k / n
            pts.append((cx + ccx + r * math.cos(a), cz + ccz + r * math.sin(a)))
    return pts


# ------------------------------------------------------------------ sweeps
def _catmull(pts, per):
    out = []
    n = len(pts)
    for i in range(n - 1):
        p0, p1 = pts[max(i - 1, 0)], pts[i]
        p2, p3 = pts[i + 1], pts[min(i + 2, n - 1)]
        for k in range(per):
            t = k / per
            out.append(Vector(tuple(
                0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t
                       + (-a + 3 * b - 3 * c + d) * t ** 3)
                for a, b, c, d in zip(p0, p1, p2, p3))))
    out.append(Vector(pts[-1]))
    return out


def hose(base, pts, r, mat="hose", segs=10, per=6, caps=True):
    """Round tube swept through the control points (Catmull-Rom smoothed, parallel transport
    frames). Used for hoses, cables, brake lines and bent rods."""
    path = _catmull([tuple(p) for p in pts], per) if len(pts) > 2 else \
        [Vector(pts[0]).lerp(Vector(pts[1]), k / per) for k in range(per + 1)]
    tans = []
    for i in range(len(path)):
        a = path[max(i - 1, 0)]
        b = path[min(i + 1, len(path) - 1)]
        tans.append((b - a).normalized())
    ref = Vector((0, 0, 1)) if abs(tans[0].z) < 0.9 else Vector((1, 0, 0))
    nrm = tans[0].cross(ref).normalized()
    verts, faces = [], []
    for i, (p, t) in enumerate(zip(path, tans)):
        if i > 0:
            nrm = (nrm - t * nrm.dot(t)).normalized()
        bin_ = t.cross(nrm)
        for k in range(segs):
            a = 2 * math.pi * k / segs
            verts.append(tuple(p + r * (math.cos(a) * nrm + math.sin(a) * bin_)))
    m = len(path)
    for i in range(m - 1):
        for k in range(segs):
            k2 = (k + 1) % segs
            faces.append([i * segs + k, i * segs + k2, (i + 1) * segs + k2, (i + 1) * segs + k])
    if caps:
        faces.append(list(range(segs - 1, -1, -1)))
        faces.append([(m - 1) * segs + k for k in range(segs)])
    return _mesh_obj(base, verts, faces, mat, 0.0, 2, 40.0)


def strip_yz(base, pts, w, th, x, mat="steel"):
    """Rectangular section (w along X, th normal to the path) swept along a path in the YZ
    plane at X = x. pts are (y, z). Used for curved spring leaves."""
    verts, faces = [], []
    n = len(pts)
    for i, (y, z) in enumerate(pts):
        a = pts[max(i - 1, 0)]
        b = pts[min(i + 1, n - 1)]
        ty, tz = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(ty, tz)
        ny, nz = -tz / ln, ty / ln
        if nz < 0:
            ny, nz = -ny, -nz
        for sx, sn in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            verts.append((x + sx * w / 2, y + sn * ny * th / 2, z + sn * nz * th / 2))
    for i in range(n - 1):
        for k in range(4):
            k2 = (k + 1) % 4
            faces.append([i * 4 + k, i * 4 + k2, (i + 1) * 4 + k2, (i + 1) * 4 + k])
    faces.append([3, 2, 1, 0])
    faces.append([(n - 1) * 4 + k for k in range(4)])
    return _mesh_obj(base, verts, faces, mat, 0.0, 2, 40.0)


# ------------------------------------------------------------------ panels
def louvre_x(base, x_face, s, y0, y1, z0, z1, n, mat="paint_od", back="steel_dark"):
    """Surface-mounted louvre on a solid side face at X = x_face (outward normal s * X): a dark
    back plate on the face, a raised frame, and n downward-tilted slats in front of it."""
    box_mm(f"{base}_back", (min(x_face, x_face + s * 0.004), y0, z0),
           (max(x_face, x_face + s * 0.004), y1, z1), mat=back, bev=0.0)
    fw = 0.018
    xa, xb = x_face, x_face + s * 0.024
    for (a0, a1, b0, b1) in ((y0 - fw, y1 + fw, z1, z1 + fw), (y0 - fw, y1 + fw, z0 - fw, z0),
                             (y0 - fw, y0, z0, z1), (y1, y1 + fw, z0, z1)):
        box_mm(f"{base}_frame", (min(xa, xb), a0, b0), (max(xa, xb), a1, b1), mat=mat, bev=0.002, seg=1)
    pitch = (z1 - z0) / n
    for i in range(n):
        zc = z0 + pitch * (i + 0.5)
        box(f"{base}_slat_{i}", (0.003, y1 - y0, pitch * 1.1), (x_face + s * 0.013, (y0 + y1) / 2, zc),
            mat=mat, bev=0.0, rot=(0, s * math.radians(-40), 0))


def louvre_y(base, y_face, s, x0, x1, z0, z1, n, mat="paint_od", back="steel_dark", mounted=False):
    """Louvre in a face at Y = y_face (outward normal s * Y). mounted=False: an open frame with
    a recessed dark back plate behind the slats; mounted=True: on a solid face (see louvre_x)."""
    if mounted:
        ya, yb = y_face, y_face + s * 0.004
        box_mm(f"{base}_back", (x0, min(ya, yb), z0), (x1, max(ya, yb), z1), mat=back, bev=0.0)
        fw = 0.018
        ya, yb = y_face, y_face + s * 0.024
        for (a0, a1, b0, b1) in ((x0 - fw, x1 + fw, z1, z1 + fw), (x0 - fw, x1 + fw, z0 - fw, z0),
                                 (x0 - fw, x0, z0, z1), (x1, x1 + fw, z0, z1)):
            box_mm(f"{base}_frame", (a0, min(ya, yb), b0), (a1, max(ya, yb), b1), mat=mat, bev=0.002, seg=1)
        y_slat = y_face + s * 0.013
    else:
        yb = y_face - s * 0.025
        box_mm(f"{base}_back", (x0, yb - 0.004, z0), (x1, yb + 0.004, z1), mat=back, bev=0.0)
        y_slat = y_face - s * 0.010
    pitch = (z1 - z0) / n
    for i in range(n):
        zc = z0 + pitch * (i + 0.5)
        box(f"{base}_slat_{i}", (x1 - x0, 0.003, pitch * 1.1), ((x0 + x1) / 2, y_slat, zc),
            mat=mat, bev=0.0, rot=(s * math.radians(40), 0, 0))


# ------------------------------------------------------------------ merge
def merge_by_material(objs=None, prefix="chassis"):
    """Compatibility wrapper: the parts are already collected per material; build the merged
    objects (any objects passed in are removed first)."""
    for o in objs or []:
        me = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if me is not None and me.users == 0:
            bpy.data.meshes.remove(me)
    return finish(True, prefix)
