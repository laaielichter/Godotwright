"""Mesh kit for the armoured LSAC cab (cab_ext*, cab_int).

Geometry is built in bmesh and merged into accumulators (Acc), one per output object, so a
few thousand parts stay fast and end up as a handful of objects. Every position comes from
layout.py (layout.CAB and friends); the derived planes of the cab (raked windscreen plate,
side chamfer) are computed here once.

Blender coords: X right, Y front, Z up, metres. Vehicle left (driver side) is -X.
"""
import math
import os
import sys

_BUILD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BUILD not in sys.path:
    sys.path.insert(0, _BUILD)

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import hr  # noqa: E402
import layout as L  # noqa: E402

C = L.CAB
OUT = []

# ------------------------------------------------------------------ cab geometry (derived)
# The layout values are the outer envelope measured on the photos (bolts, plates and hinge
# leaves included), so the bare armour shell sits a detail allowance inside them.
FY = C["front_y"] - 0.02               # lower front face plane (shell)
RY = C["rear_y"] + 0.025               # rear wall plane (shell)
ZB = 1.45                              # underside of the cab shell (floor pan); the front
#                                        lower block reaches C["body_bottom_z"]
ZR = C["roof_z"] - 0.01                # shell roof; bolts and lamps reach CAB roof_z
XW = C["half_width_low"] - 0.025       # widest half width of the shell
XR = C["half_width_roof"] - 0.005      # roof half width
ZK = 2.12                              # side knee: widest point, upper side chamfer starts
FZ = C["windscreen_plate_z"][0]        # front knee: raked plate starts (2.19)
CC = 0.07                              # vertical front-corner chamfer
FXW = XW - CC                          # front face half width
RAKE = math.radians(C["windscreen_rake_deg"])
TAN_R = math.tan(RAKE)
RYF = FY - (ZR - FZ) * TAN_R           # roof front edge Y (about 2.956)
SIDE_K = (XW - XR) / (ZR - ZK)         # side chamfer: X shrinks this much per metre up
SHELL_T = 0.03                         # armour shell thickness (solidify)


def side_x(z):
    """Outer |X| of the side wall at height z."""
    return XW if z <= ZK else XW - (z - ZK) * SIDE_K


def rake_y(z):
    """Y of the raked plate outer surface at height z (z >= FZ)."""
    return FY - (z - FZ) * TAN_R


# raked plate frame: origin at the knee centre, U = +X, S up the plate, N outward
RK_O = Vector((0.0, FY, FZ))
RK_S = Vector((0.0, -math.sin(RAKE), math.cos(RAKE)))
RK_N = Vector((0.0, math.cos(RAKE), math.sin(RAKE)))
RK_LEN = (ZR - FZ) / math.cos(RAKE)


def rk(u, s, n=0.0):
    """World point on the raked plate: u across (X), s metres up the slope, n out of it."""
    return Vector((u, 0, 0)) + RK_O + RK_S * s + RK_N * n


def rk_s(z):
    return (z - FZ) / math.cos(RAKE)


def rk_half(s):
    """Outer half width of the raked plate at slope distance s (front face width at the
    knee, the roof width at the top)."""
    return FXW + (XR - FXW) * s / RK_LEN


# side chamfer frame (right side; mirror X for the left): T along the chamfer up, N outward
SC_T = Vector((-SIDE_K, 0, 1)).normalized()
SC_N = Vector((1, 0, SIDE_K)).normalized()

# windscreen panes (u = X): driver (vehicle left, -X) wider
G_Z0, G_Z1 = C["glass_z"]
G_S0, G_S1 = rk_s(G_Z0), rk_s(G_Z1)
_GAP_C = 0.02                          # gap centre is a little to vehicle right (photo)
PANES = {
    "drv": (_GAP_C - C["pane_gap"] / 2 - C["pane_driver_w"], _GAP_C - C["pane_gap"] / 2),
    "oth": (_GAP_C + C["pane_gap"] / 2, _GAP_C + C["pane_gap"] / 2 + C["pane_other_w"]),
}

# doors
DY0, DY1 = C["door_y"]
DZ0, DZ1 = C["door_z"]
DOOR_GAP = 0.006
DOOR_T = 0.055
DOOR_PROUD = 0.006
DOOR_CLIP_Z = FZ + (FY - 0.10 - DY1) / TAN_R     # front edge clipped above this height
WIN_Z0, WIN_Z1 = C["door_window_z"]
WIN_W = C["door_window_w"]
WIN_Y1 = DY1 - 0.20 - 0.0
WIN_Y0 = WIN_Y1 - WIN_W

# roof hatch
HATCH_C = (0.22, 2.30)
HATCH_R = 0.30


# ------------------------------------------------------------------ matrices
def mat_loc(loc):
    return Matrix.Translation(Vector(loc))


def basis(loc, ax, ay, az):
    """4x4 matrix whose local X, Y, Z axes are ax, ay, az (normalised, orthogonal)."""
    m = Matrix((Vector(ax).normalized(), Vector(ay).normalized(),
                Vector(az).normalized())).transposed().to_4x4()
    m.translation = Vector(loc)
    return m


def eul(loc, rot):
    from mathutils import Euler
    m = Euler(rot).to_matrix().to_4x4()
    m.translation = Vector(loc)
    return m


def look(p0, p1, up=(0, 0, 1)):
    """Matrix at p0 with local Z along p1 - p0."""
    p0, p1 = Vector(p0), Vector(p1)
    z = (p1 - p0).normalized()
    upv = Vector(up)
    if abs(z.dot(upv)) > 0.98:
        upv = Vector((1, 0, 0)) if abs(z.x) < 0.9 else Vector((0, 1, 0))
    x = upv.cross(z).normalized()
    y = z.cross(x)
    return basis(p0, x, y, z)


RK_M = basis(RK_O, (1, 0, 0), RK_S, RK_N)          # local x=u, y=s, z=n


def rk_m(u, s, n=0.0):
    m = RK_M.copy()
    m.translation = rk(u, s, n)
    return m


def sc_m(sd, y, z_on_chamfer, n=0.0):
    """Frame on the side chamfer (sd = -1 left, +1 right): x = vehicle Y, y = up the chamfer,
    z = outward. The point is on the outer surface at height z_on_chamfer, plus n outward."""
    t = Vector((sd * -SIDE_K, 0, 1)).normalized()
    nn = Vector((sd * 1, 0, SIDE_K)).normalized()
    x = Vector((0, 1, 0)) if sd > 0 else Vector((0, -1, 0))
    p = Vector((sd * side_x(z_on_chamfer), y, z_on_chamfer)) + nn * n
    return basis(p, x, t, nn)


def side_m(sd, y, z, n=0.0):
    """Frame on the vertical side wall: x along the vehicle (front for the right side), y up,
    z outward."""
    x = Vector((0, 1, 0)) if sd > 0 else Vector((0, -1, 0))
    return basis((sd * (XW + n), y, z), x, (0, 0, 1), (sd, 0, 0))


FRONT_M = basis((0, FY, 0), (-1, 0, 0), (0, 0, 1), (0, 1, 0))  # x = vehicle left in view


def front_m(x, z, n=0.0):
    """Frame on the lower front face: local x = world X, y = up, z = forward (+Y)."""
    return basis((x, FY + n, z), (1, 0, 0), (0, 0, 1), (0, 1, 0))


def rear_m(x, z, n=0.0):
    return basis((x, RY - n, z), (-1, 0, 0), (0, 0, 1), (0, -1, 0))


def roof_m(x, y, n=0.0):
    return basis((x, y, ZR + n), (1, 0, 0), (0, 1, 0), (0, 0, 1))


# ------------------------------------------------------------------ bmesh primitives
def _new():
    return bmesh.new()


def bm_box(sx, sy, sz, bev=0.0, seg=2, center=(0, 0, 0)):
    bm = _new()
    bmesh.ops.create_cube(bm, size=1.0)
    cx, cy, cz = center
    for v in bm.verts:
        v.co = Vector((v.co.x * sx + cx, v.co.y * sy + cy, v.co.z * sz + cz))
    if bev > 0:
        bev = min(bev, 0.45 * min(sx, sy, sz))
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bev, segments=seg, affect="EDGES",
                        profile=0.5, clamp_overlap=True)
    return bm


def bm_cyl(r, depth, verts=24, bev=0.0, seg=1, r2=None, z0=None):
    """Cylinder (or cone with r2) along local Z. Centred unless z0 gives the base height."""
    bm = _new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=verts, radius1=r,
                          radius2=r if r2 is None else r2, depth=depth)
    if z0 is not None:
        for v in bm.verts:
            v.co.z += z0 + depth / 2
    if bev > 0:
        caps = [e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) < 1e-7]
        bev = min(bev, 0.45 * depth, 0.45 * r)
        bmesh.ops.bevel(bm, geom=caps, offset=bev, segments=seg, affect="EDGES", profile=0.5,
                        clamp_overlap=True)
    return bm


def bm_sphere(r, u=16, v=8, scale=(1, 1, 1)):
    bm = _new()
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=r)
    for vv in bm.verts:
        vv.co = Vector((vv.co.x * scale[0], vv.co.y * scale[1], vv.co.z * scale[2]))
    return bm


def bm_hull(points, bev=0.0, seg=2):
    bm = _new()
    vs = [bm.verts.new(Vector(p)) for p in points]
    res = bmesh.ops.convex_hull(bm, input=vs)
    junk = [g for g in res["geom_interior"] + res["geom_unused"] if isinstance(g, bmesh.types.BMVert)]
    if junk:
        bmesh.ops.delete(bm, geom=junk, context="VERTS")
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(0.3), verts=bm.verts[:],
                             edges=bm.edges[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if bev > 0:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bev, segments=seg, affect="EDGES",
                        profile=0.5, clamp_overlap=True)
    return bm


def bm_prism(poly, z0, z1, bev=0.0, seg=2):
    """Polygon (list of local (x, y)) extruded along local Z from z0 to z1."""
    bm = _new()
    a = [bm.verts.new((x, y, z0)) for x, y in poly]
    b = [bm.verts.new((x, y, z1)) for x, y in poly]
    n = len(poly)
    bm.faces.new(a[::-1])
    bm.faces.new(b)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if bev > 0:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bev, segments=seg, affect="EDGES",
                        profile=0.5, clamp_overlap=True)
    return bm


def bm_lathe(profile, segs=32):
    """Spin (r, z) points around local Z. Ends with r = 0 close the shape."""
    bm = _new()
    vs = [bm.verts.new((r, 0, z)) for r, z in profile]
    es = [bm.edges.new((vs[i], vs[i + 1])) for i in range(len(vs) - 1)]
    bmesh.ops.spin(bm, geom=vs + es, angle=2 * math.pi, steps=segs, axis=(0, 0, 1),
                   cent=(0, 0, 0))
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def bm_quad(w, h):
    bm = _new()
    vs = [bm.verts.new(p) for p in ((-w / 2, -h / 2, 0), (w / 2, -h / 2, 0), (w / 2, h / 2, 0),
                                    (-w / 2, h / 2, 0))]
    bm.faces.new(vs)
    return bm


def bm_torus(R, r, segs=32, rsegs=10):
    prof = []
    for i in range(rsegs + 1):
        a = 2 * math.pi * i / rsegs
        prof.append((R + r * math.cos(a), r * math.sin(a)))
    return bm_lathe(prof, segs)


def bm_helix(r_coil, r_wire, z0, z1, turns, segs_per_turn=12, wire_segs=6):
    """Coil spring along local Z (for antenna bases)."""
    bm = _new()
    n = int(turns * segs_per_turn)
    rings = []
    for i in range(n + 1):
        t = i / n
        a = 2 * math.pi * turns * t
        c = Vector((r_coil * math.cos(a), r_coil * math.sin(a), z0 + (z1 - z0) * t))
        tan = Vector((-math.sin(a) * r_coil * 2 * math.pi * turns, math.cos(a) * r_coil * 2 *
                      math.pi * turns, z1 - z0)).normalized()
        nrm = Vector((math.cos(a), math.sin(a), 0))
        bi = tan.cross(nrm)
        ring = []
        for k in range(wire_segs):
            b = 2 * math.pi * k / wire_segs
            ring.append(bm.verts.new(c + (nrm * math.cos(b) + bi * math.sin(b)) * r_wire))
        rings.append(ring)
    for i in range(n):
        for k in range(wire_segs):
            k2 = (k + 1) % wire_segs
            bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def bm_sweep(points, r, segs=12, closed=False):
    """Round tube through world-space points with mitred joints."""
    pts = [Vector(p) for p in points]
    bm = _new()
    n = len(pts)
    rings = []
    prev_x = None
    for i in range(n):
        if closed:
            d0 = (pts[i] - pts[i - 1]).normalized()
            d1 = (pts[(i + 1) % n] - pts[i]).normalized()
        else:
            d0 = (pts[i] - pts[i - 1]).normalized() if i > 0 else (pts[1] - pts[0]).normalized()
            d1 = (pts[i + 1] - pts[i]).normalized() if i < n - 1 else d0
        t = (d0 + d1)
        t = t.normalized() if t.length > 1e-6 else d1
        if prev_x is None:
            up = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
            x = up.cross(t).normalized()
        else:
            x = (prev_x - t * prev_x.dot(t)).normalized()
        y = t.cross(x)
        prev_x = x
        scale = 1.0 / max(0.35, d0.dot(t)) if i not in (0, n - 1) or closed else 1.0
        ring = []
        for k in range(segs):
            a = 2 * math.pi * k / segs
            off = x * math.cos(a) * r + y * math.sin(a) * r
            # stretch the ring in the bend plane so the tube keeps its radius
            if scale != 1.0:
                bend = (d1 - d0)
                if bend.length > 1e-6:
                    bn = bend.normalized()
                    off = off + bn * off.dot(bn) * (scale - 1.0)
            ring.append(bm.verts.new(pts[i] + off))
        rings.append(ring)
    last = n if closed else n - 1
    for i in range(last):
        a, b = rings[i], rings[(i + 1) % n]
        for k in range(segs):
            k2 = (k + 1) % segs
            bm.faces.new((a[k], a[k2], b[k2], b[k]))
    if not closed:
        bm.faces.new(rings[0][::-1])
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def bm_from_obj(obj):
    bm = _new()
    bm.from_mesh(obj.data)
    bmesh.ops.transform(bm, matrix=obj.matrix_world, verts=bm.verts[:])
    return bm


# ------------------------------------------------------------------ accumulator
def shade(bm, angle_deg):
    lim = math.radians(angle_deg)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) != 2:
            e.smooth = False
        else:
            try:
                e.smooth = e.calc_face_angle() <= lim
            except ValueError:
                e.smooth = False


class Acc:
    """Collects bmesh parts with per-part materials and sharp edges into one object."""

    def __init__(self, name, node):
        self.name = name
        self.node = node
        self.bm = bmesh.new()
        self.mats = []

    def mi(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def put(self, src, m=None, mat="paint_od", angle=30.0):
        if m is not None:
            bmesh.ops.transform(src, matrix=m, verts=src.verts[:])
            if m.determinant() < 0:
                bmesh.ops.reverse_faces(src, faces=src.faces[:])
        shade(src, angle)
        idx = self.mi(mat)
        dst = self.bm
        vm = {v: dst.verts.new(v.co) for v in src.verts}
        for f in src.faces:
            try:
                nf = dst.faces.new([vm[v] for v in f.verts])
            except ValueError:
                continue
            nf.material_index = idx
            nf.smooth = f.smooth
        for e in src.edges:
            if not e.smooth:
                de = dst.edges.get((vm[e.verts[0]], vm[e.verts[1]]))
                if de is not None:
                    de.smooth = False
        src.free()

    # convenience wrappers ------------------------------------------------
    def box(self, size, m, mat="paint_od", bev=0.004, seg=2, angle=30.0, center=(0, 0, 0)):
        self.put(bm_box(*size, bev=bev, seg=seg, center=center), m, mat, angle)

    def cyl(self, r, depth, m, mat="steel", verts=24, bev=0.0, seg=1, r2=None, z0=None,
            angle=40.0):
        self.put(bm_cyl(r, depth, verts, bev, seg, r2, z0), m, mat, angle)

    def rod(self, p0, p1, r, mat="steel", verts=12, bev=0.0):
        p0, p1 = Vector(p0), Vector(p1)
        self.put(bm_cyl(r, (p1 - p0).length, verts, bev), look((p0 + p1) / 2, p1), mat, 40.0)

    def bar(self, p0, p1, w, h=None, mat="paint_od", bev=0.002, up=(0, 0, 1)):
        """Rectangular bar from p0 to p1; w across, h along the `up`-ish axis."""
        p0, p1 = Vector(p0), Vector(p1)
        h = w if h is None else h
        m = look((p0 + p1) / 2, p1, up)
        self.put(bm_box(w, h, (p1 - p0).length, bev=bev), m, mat, 30.0)

    def tube(self, pts, r, mat="steel", segs=12, closed=False):
        self.put(bm_sweep(pts, r, segs, closed), None, mat, 50.0)

    def bolt(self, m, r=0.011, h=0.008, mat="paint_od", washer=True):
        """Hex bolt head (and washer) on a surface frame m (local Z out of the surface)."""
        if washer:
            self.put(bm_cyl(r * 1.4, 0.002, 16, z0=0.0), m.copy(), mat, 40.0)
        self.put(bm_cyl(r, h, 6, bev=min(0.0016, 0.25 * h), seg=2, z0=0.0), m.copy(), mat, 40.0)

    def finish(self, smooth_obj=True):
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for mname in self.mats:
            me.materials.append(hr.mat(mname))
        obj = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(obj)
        obj["hr_node"] = self.node
        OUT.append(obj)
        return obj


def obj_from_bm(bm, name):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def boolean(obj, cutter_bm, op="DIFFERENCE"):
    cutter = obj_from_bm(cutter_bm, "cutter_tmp")
    m = obj.modifiers.new("Cut", "BOOLEAN")
    m.operation = op
    m.object = cutter
    m.solver = "EXACT"
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=m.name)
    me = cutter.data
    bpy.data.objects.remove(cutter, do_unlink=True)
    bpy.data.meshes.remove(me)
    return obj


def booleans(obj, cutter_bms):
    """Union all cutters into one object, then apply one difference."""
    big = bmesh.new()
    for c in cutter_bms:
        me = bpy.data.meshes.new("tmp")
        c.to_mesh(me)
        c.free()
        big.from_mesh(me)
        bpy.data.meshes.remove(me)
    return boolean(obj, big)


def transformed(bm, m):
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts[:])
    if m.determinant() < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    return bm


def solidify(obj, t, offset=-1.0):
    m = obj.modifiers.new("Solid", "SOLIDIFY")
    m.thickness = t
    m.offset = offset
    m.use_even_offset = True
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=m.name)
    return obj


def reset():
    OUT.clear()


def frange(a, b, step):
    """Evenly spaced values from a to b with spacing close to step (both ends included)."""
    n = max(1, int(round(abs(b - a) / step)))
    return [a + (b - a) * i / n for i in range(n + 1)]
