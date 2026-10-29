"""Launcher-private geometry helpers (v4).

Every primitive is written as vertex lists in vehicle world coordinates (metres, +Y front, +Z up,
vehicle centred on Y 0, Z 0 on the ground; see layout.py). Nothing is rotated or moved after
creation, so each object keeps an identity matrix. Objects carry hr_node and are collected in OUT.
merge() joins them per (hr_node, material) for the glTF export, except objects marked with
keep(): those stay separate under a fixed name with their origin at a given pivot (pod caps that
the game hides when a rocket fires, elevation cylinder parts the game can aim).
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector  # noqa: F401  (Matrix re-exported for the callers)

_HERE = os.path.dirname(os.path.abspath(__file__))
_BUILD = os.path.dirname(_HERE)
for _p in (_HERE, _BUILD):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import hr  # noqa: E402

TAU = 2.0 * math.pi
OUT = []
_cnt = [0]
BOX_FACES = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (0, 4, 7, 3), (1, 2, 6, 5)]


def reset():
    OUT.clear()
    _cnt[0] = 0


def _name(base):
    _cnt[0] += 1
    return f"lch_{base}_{_cnt[0]:05d}"


def _finish(base, verts, faces, mat, node, bev=0.0, seg=2):
    name = _name(base)
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    me.materials.append(hr.mat(mat))
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    if bev > 0:
        hr.bevel(o, bev, seg)
    o["hr_node"] = node
    OUT.append(o)
    return o


def keep(o, name, origin):
    """Keep o out of the merge, under this exact name, with its origin at origin (world)."""
    o["keep_name"] = name
    o["keep_origin"] = tuple(origin)
    return o


def _basis(axis):
    a = Vector(axis).normalized()
    t = Vector((1.0, 0.0, 0.0)) if abs(a.x) < 0.9 else Vector((0.0, 1.0, 0.0))
    u = a.cross(t).normalized()
    v = a.cross(u).normalized()
    return a, u, v


# ------------------------------------------------------------------ primitives
def box(base, c, size, mat, node, bev=0.0, seg=2, R=None):
    """Box centred on c. R (3x3 Matrix) tilts the box about its centre."""
    hx, hy, hz = size[0] / 2.0, size[1] / 2.0, size[2] / 2.0
    offs = [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
            (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]
    cv = Vector(c)
    verts = []
    for o in offs:
        v = Vector(o)
        if R is not None:
            v = R @ v
        verts.append(tuple(cv + v))
    return _finish(base, verts, [tuple(f) for f in BOX_FACES], mat, node, bev, seg)


def revolve(base, prof, origin, axis, mat, node, segs=32, closed=False, bev=0.0, seg=2):
    """Spin a (radius, t) profile around the axis through origin. t is the distance along the
    axis. An open profile whose ends sit on the axis (r = 0) is a solid; a closed profile is a
    ring or tube wall."""
    a, u, v = _basis(axis)
    O = Vector(origin)
    verts = []
    rings = []
    for r, t in prof:
        c = O + a * t
        if r <= 1e-9:
            verts.append(tuple(c))
            rings.append((True, len(verts) - 1))
        else:
            idx = []
            for i in range(segs):
                th = TAU * i / segs
                p = c + (u * math.cos(th) + v * math.sin(th)) * r
                verts.append(tuple(p))
                idx.append(len(verts) - 1)
            rings.append((False, idx))
    n = len(prof)
    faces = []
    for j in range(n if closed else n - 1):
        k = (j + 1) % n
        ca, A = rings[j]
        cb, B = rings[k]
        if ca and cb:
            continue
        for i in range(segs):
            i2 = (i + 1) % segs
            if ca:
                faces.append((A, B[i], B[i2]))
            elif cb:
                faces.append((A[i], A[i2], B))
            else:
                faces.append((A[i], A[i2], B[i2], B[i]))
    return _finish(base, verts, faces, mat, node, bev, seg)


def cyl(base, p0, p1, r, mat, node, segs=32, bev=0.0, seg=2, r1=None):
    """Cylinder with flat caps from p0 to p1 (radius r at p0, r1 at p1)."""
    p0 = Vector(p0)
    p1 = Vector(p1)
    d = p1 - p0
    length = d.length
    r1 = r if r1 is None else r1
    prof = [(0.0, 0.0), (r, 0.0), (r1, length), (0.0, length)]
    return revolve(base, prof, p0, d, mat, node, segs, False, bev, seg)


def torus(base, c, axis, R, r, mat, node, segs=96, msegs=20):
    prof = [(R + r * math.cos(TAU * k / msegs), r * math.sin(TAU * k / msegs))
            for k in range(msegs)]
    return revolve(base, prof, c, axis, mat, node, segs, True)


def bolt(base, c, axis, r, h, mat, node, segs=6):
    """Bolt head or nut: a short prism starting at c and running h along axis."""
    a = Vector(axis).normalized()
    c = Vector(c)
    return cyl(base, c, c + a * h, r, mat, node, segs)


def rivet(base, c, axis, r, h, mat, node, segs=10):
    """Domed rivet head starting at c."""
    a = Vector(axis).normalized()
    prof = [(0.0, 0.0), (r, 0.0), (r * 0.92, h * 0.35), (r * 0.60, h * 0.85), (0.0, h)]
    return revolve(base, prof, c, a, mat, node, segs)


def hollow_y(base, outer, inner, y0, y1, mat, node, bev=0.0, seg=2):
    """Box section along Y. outer and inner are (x0, x1, z0, z1) rectangles, open at both ends."""
    def ring(rc, y):
        x0, x1, z0, z1 = rc
        return [(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)]

    verts = ring(outer, y0) + ring(outer, y1) + ring(inner, y0) + ring(inner, y1)
    faces = []
    for i in range(4):
        j = (i + 1) % 4
        faces.append((i, j, 4 + j, 4 + i))
        faces.append((8 + i, 12 + i, 12 + j, 8 + j))
        faces.append((i, j, 8 + j, 8 + i))
        faces.append((4 + i, 12 + i, 12 + j, 4 + j))
    return _finish(base, verts, faces, mat, node, bev, seg)


# -------------------------------------------------------------- profile helpers
def _arc(cr, ct, rad, a0, a1, n):
    pts = []
    for k in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * k / n)
        pts.append((cr + rad * math.cos(a), ct + rad * math.sin(a)))
    return pts


def rrect(r0, r1, t0, t1, rad, n=1):
    """Closed rounded rectangle in (radius, t): a ring section with rounded corners."""
    rad = min(rad, (r1 - r0) / 2.0 - 1e-6, (t1 - t0) / 2.0 - 1e-6)
    pts = []
    pts += _arc(r0 + rad, t0 + rad, rad, 180, 270, n)
    pts += _arc(r1 - rad, t0 + rad, rad, 270, 360, n)
    pts += _arc(r1 - rad, t1 - rad, rad, 0, 90, n)
    pts += _arc(r0 + rad, t1 - rad, rad, 90, 180, n)
    return pts


def disc(R, t0, t1, rad, n=4):
    """Open solid-of-revolution profile: a solid cylinder with rounded top and bottom edges."""
    pts = [(0.0, t0)]
    pts += _arc(R - rad, t0 + rad, rad, 270, 360, n)
    pts += _arc(R - rad, t1 - rad, rad, 0, 90, n)
    pts += [(0.0, t1)]
    return pts


def sweep(base, pts, r, mat, node, segs=12, caps=True):
    """Round tube of radius r along a polyline (parallel-transported frames). Hoses, rods."""
    P = [Vector(p) for p in pts]
    tans = []
    for i in range(len(P)):
        a = P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]
        tans.append(a.normalized())
    _a, u, _v = _basis(tans[0])
    verts, rings = [], []
    for i, p in enumerate(P):
        t = tans[i]
        u = (u - t * u.dot(t)).normalized()
        v = t.cross(u).normalized()
        idx = []
        for k in range(segs):
            th = TAU * k / segs
            verts.append(tuple(p + (u * math.cos(th) + v * math.sin(th)) * r))
            idx.append(len(verts) - 1)
        rings.append(idx)
    faces = []
    for j in range(len(rings) - 1):
        A, B = rings[j], rings[j + 1]
        for k in range(segs):
            k2 = (k + 1) % segs
            faces.append((A[k], A[k2], B[k2], B[k]))
    if caps:
        faces.append(tuple(reversed(rings[0])))
        faces.append(tuple(rings[-1]))
    return _finish(base, verts, faces, mat, node)


def bezier(p0, p1, p2, p3, n=16):
    """Points on a cubic Bezier curve (for hoses)."""
    P = [Vector(p) for p in (p0, p1, p2, p3)]
    out = []
    for i in range(n + 1):
        t = i / n
        a = (1 - t) ** 3
        b = 3 * (1 - t) ** 2 * t
        c = 3 * (1 - t) * t * t
        d = t ** 3
        out.append(tuple(P[0] * a + P[1] * b + P[2] * c + P[3] * d))
    return out


def holed_plate(base, y0, y1, cells, mat, node, k=12):
    """A plate normal to Y (from y0 to y1) made of rectangular cells, each with one round hole.
    cells: (x0, x1, z0, z1, cx, cz, r). The hole centre must lie inside the cell and r must be
    smaller than its distance to every cell edge. Each cell is a closed square donut."""
    verts, faces = [], []
    for x0, x1, z0, z1, cx, cz, r in cells:
        corners = [(x1, z0), (x1, z1), (x0, z1), (x0, z0)]
        bnd = []
        for i in range(4):
            a = corners[i]
            b = corners[(i + 1) % 4]
            for j in range(k):
                f = j / k
                bnd.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f))
        n = len(bnd)
        circ = []
        for bx, bz in bnd:
            dx, dz = bx - cx, bz - cz
            d = math.hypot(dx, dz)
            circ.append((cx + dx / d * r, cz + dz / d * r))
        base_i = len(verts)
        for y in (y0, y1):
            for bx, bz in bnd:
                verts.append((bx, y, bz))
            for hx, hz in circ:
                verts.append((hx, y, hz))
        B0, C0, B1, C1 = base_i, base_i + n, base_i + 2 * n, base_i + 3 * n
        for i in range(n):
            j = (i + 1) % n
            faces.append((B0 + i, B0 + j, C0 + j, C0 + i))      # face at y0
            faces.append((B1 + i, C1 + i, C1 + j, B1 + j))      # face at y1
            faces.append((C0 + i, C0 + j, C1 + j, C1 + i))      # hole wall
            faces.append((B0 + i, B1 + i, B1 + j, B0 + j))      # outer wall
    return _finish(base, verts, faces, mat, node)


# ------------------------------------------------------------------------ merge
def merge(objs, prefix="launcher"):
    """Join the objects per (hr_node, material). Modifiers are baked first, then the merged
    mesh is shaded with hard edges above 30 degrees. The originals are removed."""
    dg = bpy.context.evaluated_depsgraph_get()
    groups = {}
    kept = []
    for o in objs:
        if o.get("keep_name"):
            kept.append(o)
            continue
        key = (o["hr_node"], o.data.materials[0].name)
        groups.setdefault(key, []).append(o)
    merged = []
    for (node, mname), members in groups.items():
        verts, faces = [], []
        for o in members:
            ev = o.evaluated_get(dg)
            me = ev.to_mesh()
            base = len(verts)
            verts.extend(tuple(v.co) for v in me.vertices)
            faces.extend(tuple(base + i for i in p.vertices) for p in me.polygons)
            ev.to_mesh_clear()
        name = f"{prefix}_{node}_{mname}"
        me = bpy.data.meshes.new(name)
        me.from_pydata(verts, [], faces)
        me.update()
        me.materials.append(hr.mat(mname))
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        hr.shade_auto_smooth(ob, 30.0)
        ob["hr_node"] = node
        merged.append(ob)
    for o in objs:
        if o.get("keep_name"):
            continue
        me = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if me is not None and me.users == 0:
            bpy.data.meshes.remove(me)
    for o in kept:
        hr.apply_all(o)
        hr.set_origin(o, o["keep_origin"])
        o.name = o["keep_name"]
        o.data.name = o["keep_name"]
        hr.shade_auto_smooth(o, 30.0)
        del o["keep_name"]
        del o["keep_origin"]
        merged.append(o)
    return merged
