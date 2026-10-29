"""Wheels for the M142 HIMARS v4: six 395/85R20 tyres, 20 inch rims and wheel nuts.

Positions come from layout.WHEELS, centre height layout.AXLE_Z and radius layout.TYRE_R.
Ground is Z = 0. Per wheel position three
objects are built, all carrying hr_node = <wheel name>:
  tyre_<W>  rubber  carcass (lathe), chunky off-road tread (photos: Goodyear/Michelin
                    military MV/T pattern): two staggered rows of crown blocks plus big shoulder
                    blocks that wrap down onto the sidewall, with open voids; sidewall ribs
  rim_<W>   paint_od/steel  dished 20 inch disc, bead flange, bead-lock ring, hub ring,
                    planetary hub cover, valve, 10 studs
  nuts_<W>  steel   10 hex wheel nuts with washers and 20 bead-lock bolts

Every object is built in world coordinates. Primitives from hr are created, their
modifiers applied and their transforms baked, so each object has an identity transform.
Tread lugs and sidewall ribs are generated directly in world space (annular sectors).

No top-level side effects: build() only creates objects in the current scene.
"""
import math

import bpy  # noqa: F401  (bmesh is only importable once bpy is loaded)
import bmesh
from mathutils import Vector

import hr

import layout  # noqa: E402

# ------------------------------------------------------------------ dimensions
ZC = layout.AXLE_Z   # wheel centre height, so the lowest lug touches Z = 0
R_OUT = layout.TYRE_R  # outer radius: lug tops (exact)
R_BASE = 0.50        # crown lug base, buried in the carcass
LUG_BEV = 0.008      # bevel width (m)
LUG_BEV_SEG = 3
LUG_N = 28           # blocks per row around the circumference
# (axial centre u, phase in pitches, axial width, arc length, base radius); u < 0 is inboard.
# Phase 0 puts a crown block exactly at the bottom so the tyre touches Z = 0.
LUG_ROWS = (
    (-0.052, 0.0, 0.082, 0.080, R_BASE), (0.052, 0.5, 0.082, 0.080, R_BASE),
    (-0.149, 0.5, 0.092, 0.092, 0.445), (0.149, 0.0, 0.092, 0.092, 0.445),
)
CARCASS_SEGS = 240
RIB_SEGS = 240
RIB_R = (0.305, 0.340, 0.375, 0.410, 0.445)  # sidewall rib positions (radius)
RIB_W = 0.0045       # half width of a rib base
RIB_H = 0.0025       # rib height above the sidewall
RIB_DEPTH = 0.002    # rib base sunk into the sidewall
RIM_SEGS = 96
STUD_N = 10
BOLT_R = 0.100       # bolt circle radius
STUD_U = 0.1075      # stud centre (outward from the wheel centre)
NUT_U = 0.110
WASHER_U = 0.0985
HUB_U = 0.100        # hub ring centre
BEAD_N = 20          # bead-lock bolts
BEAD_R = 0.205       # bead-lock bolt circle radius
BEAD_U = 0.150       # bead-lock bolt head centre (on the ring over the dished face)

WHEELS = [(n, x, y) for n, (x, y, _z) in layout.WHEELS.items()]

# Carcass control curve, (u, r): u = axial offset (outward is +u), r = radius from the axle.
# Right half from the crown centre down to the bead heel; the left half is the mirror.
CARCASS_CTRL = [
    (0.000, 0.515), (0.080, 0.515), (0.130, 0.5118), (0.160, 0.503), (0.180, 0.487),
    (0.1905, 0.460), (0.1942, 0.425), (0.1952, 0.390), (0.1937, 0.350), (0.188, 0.315),
    (0.180, 0.290), (0.173, 0.273), (0.1685, 0.2625), (0.165, 0.260),
]

# Rim cross-section (r, u), closed: hub face, dished disc, bead flange, barrel, well floor.
RIM_PROFILE = [
    (0.000, 0.080), (0.000, 0.096), (0.060, 0.096), (0.110, 0.098), (0.140, 0.106),
    (0.200, 0.135), (0.240, 0.160), (0.254, 0.170), (0.262, 0.178), (0.262, -0.178),
    (0.254, -0.178), (0.254, 0.150), (0.240, 0.140), (0.200, 0.122), (0.140, 0.092),
    (0.110, 0.085), (0.060, 0.082), (0.000, 0.080),
]


def _side(xc):
    return -1.0 if xc < 0 else 1.0


def _bake(obj):
    """Apply the object transform to its mesh (object ends up at identity)."""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.select_set(False)
    return obj


def _settle(obj):
    """Apply every modifier, then bake the transform."""
    hr.apply_all(obj)
    return _bake(obj)


def _catmull(ctrl, per_span):
    """Open uniform Catmull-Rom through the (u, r) control points."""
    out = []
    last = len(ctrl) - 1
    for i in range(last):
        p0, p1 = ctrl[max(i - 1, 0)], ctrl[i]
        p2, p3 = ctrl[i + 1], ctrl[min(i + 2, last)]
        for k in range(per_span):
            t = k / per_span
            out.append(tuple(
                0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t
                       + (-a + 3 * b - 3 * c + d) * t ** 3)
                for a, b, c, d in zip(p0, p1, p2, p3)))
    out.append(ctrl[-1])
    return out


def _carcass_right():
    return _catmull(CARCASS_CTRL, 2)


def _carcass_profile(right):
    """Closed (r, u) profile for hr.lathe: right half, mirrored left half, closing point."""
    left = [(-u, r) for (u, r) in reversed(right)][:-1]
    ur = right + left
    prof = [(r, u) for (u, r) in ur]
    prof.append(prof[0])
    return prof


def _rib_frame(right, r_t):
    """Point, tangent and outward normal (all in u, r) on the right sidewall at radius r_t."""
    for i in range(len(right) - 1):
        u0, r0 = right[i]
        u1, r1 = right[i + 1]
        if r0 >= r_t >= r1 and r0 != r1:
            f = (r0 - r_t) / (r0 - r1)
            pu = u0 + f * (u1 - u0)
            du, dr = u1 - u0, r1 - r0
            n = math.hypot(du, dr)
            tu, tr = du / n, dr / n
            return pu, r_t, tu, tr, -tr, tu
    return None


def _lug_template(lug_w, lug_l, lug_h):
    """One tread lug in (u, t, z) space: cube split into a 2x2 grid, top and corners bevelled."""
    LUG_H = lug_h
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        x, y, z = v.co
        v.co = (x * lug_w, y * lug_l, (z + 0.5) * lug_h)
    bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=1, use_grid_fill=True)
    hw, hl = lug_w / 2, lug_l / 2

    def on_boundary(v):
        return abs(abs(v.co.x) - hw) < 1e-6 or abs(abs(v.co.y) - hl) < 1e-6

    bevel_edges = []
    for e in bm.edges:
        a, b = e.verts
        top_edge = (abs(a.co.z - LUG_H) < 1e-6 and abs(b.co.z - LUG_H) < 1e-6
                    and on_boundary(a) and on_boundary(b))
        corner_edge = (abs(abs(a.co.x) - hw) < 1e-6 and abs(abs(a.co.y) - hl) < 1e-6
                       and abs(abs(b.co.x) - hw) < 1e-6 and abs(abs(b.co.y) - hl) < 1e-6
                       and abs(a.co.z - b.co.z) > 1e-6)
        if top_edge or corner_edge:
            bevel_edges.append(e)
    bmesh.ops.bevel(bm, geom=bevel_edges, offset=LUG_BEV, offset_type="OFFSET",
                    segments=LUG_BEV_SEG, profile=0.5, affect="EDGES", clamp_overlap=True)
    bm.verts.index_update()
    bm.faces.ensure_lookup_table()
    verts = [tuple(v.co) for v in bm.verts]
    faces = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    return verts, faces


def _world(u, r, phi, side, xc, yc):
    return (xc + side * u, yc + r * math.cos(phi), ZC + r * math.sin(phi))


def _centroid(face):
    s = Vector((0.0, 0.0, 0.0))
    for v in face.verts:
        s += v.co
    return s / len(face.verts)


def _add_lug(bm, tv, tf, uc, phi_k, side, xc, yc, r_base, lug_h):
    """Map a lug template onto the tyre: t is arc length at the vertex radius."""
    vs = []
    for (u, t, z) in tv:
        r = r_base + z
        vs.append(bm.verts.new(_world(uc + u, r, phi_k + t / r, side, xc, yc)))
    centre = Vector(_world(uc, r_base + lug_h / 2, phi_k, side, xc, yc))
    for f in tf:
        face = bm.faces.new([vs[i] for i in f])
        face.normal_update()
        c = _centroid(face)
        if face.normal.dot(c - centre) < 0:
            face.normal_flip()


def _add_rib(bm, pu, pr, tu, tr, nu, nr, side, xc, yc):
    """Raised circumferential rib: a closed-around strip of two quads per segment."""
    pts = (
        (pu - tu * RIB_W - nu * RIB_DEPTH, pr - tr * RIB_W - nr * RIB_DEPTH),
        (pu + nu * RIB_H, pr + nr * RIB_H),
        (pu + tu * RIB_W - nu * RIB_DEPTH, pr + tr * RIB_W - nr * RIB_DEPTH),
    )
    n = RIB_SEGS
    ring = []
    for (u, r) in pts:
        ring.append([bm.verts.new(_world(u, r, 2 * math.pi * j / n, side, xc, yc))
                     for j in range(n)])
    for j in range(n):
        j2 = (j + 1) % n
        phm = 2 * math.pi * (j + 0.5) / n
        p_mid = _world(pu, pr, phm, side, xc, yc)
        p_mid = Vector(p_mid)
        for k0, k1 in ((0, 1), (1, 2)):
            face = bm.faces.new([ring[k0][j], ring[k1][j], ring[k1][j2], ring[k0][j2]])
            face.normal_update()
            if face.normal.dot(_centroid(face) - p_mid) < 0:
                face.normal_flip()


def _tyre(name, xc, yc, side):
    right = _carcass_right()
    obj = hr.lathe(name, _carcass_profile(right), loc=(xc, yc, ZC),
                   rot=(0.0, side * math.pi / 2, 0.0), segments=CARCASS_SEGS,
                   material="rubber", smooth=None)
    _bake(obj)
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])

    pitch = 2 * math.pi / LUG_N
    for uc, phase, lw, ll, rb in LUG_ROWS:
        lh = R_OUT - rb
        tv, tf = _lug_template(lw, ll, lh)
        for k in range(LUG_N):
            # phase-0 rows have a lug centred exactly on the bottom (phi = -90 deg): Z = 0 contact
            _add_lug(bm, tv, tf, uc, -math.pi / 2 + (k + phase) * pitch, side, xc, yc, rb, lh)

    for r_t in RIB_R:
        fr = _rib_frame(right, r_t)
        if fr is None:
            continue
        pu, pr, tu, tr, nu, nr = fr
        _add_rib(bm, pu, pr, tu, tr, nu, nr, side, xc, yc)
        _add_rib(bm, -pu, pr, -tu, tr, -nu, nr, side, xc, yc)

    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    me.update()
    hr.shade_auto_smooth(obj, 30.0)
    return obj


def _bolt_pos(k, xc, yc, radius=BOLT_R, offset=0.0):
    th = 2 * math.pi * k / STUD_N + offset
    return yc + radius * math.cos(th), ZC + radius * math.sin(th)


def _rim(name, xc, yc, side):
    parts = []
    disc = hr.lathe(name + "_disc", RIM_PROFILE, loc=(xc, yc, ZC),
                    rot=(0.0, side * math.pi / 2, 0.0), segments=RIM_SEGS,
                    material="paint_od", smooth=None)
    hr.bevel(disc, 0.003, 2)
    parts.append(_settle(disc))

    hub = hr.torus(name + "_hubring", 0.052, 0.006, loc=(xc + side * HUB_U, yc, ZC),
                   rot=(0.0, side * math.pi / 2, 0.0), major_seg=40, minor_seg=10,
                   material="steel")
    parts.append(_settle(hub))

    cap = hr.cyl(name + "_hubcap", 0.032, 0.008, loc=(xc + side * 0.104, yc, ZC),
                 rot=(0.0, side * math.pi / 2, 0.0), verts=32, bev=0.002, seg=2,
                 material="steel", smooth=None)
    parts.append(_settle(cap))

    # valve stem: radial, through the barrel on the inboard side (mostly inside the tyre)
    phi_v = 0.3
    valve = hr.cyl(name + "_valve", 0.0065, 0.040,
                   loc=(xc - side * 0.12, yc + 0.262 * math.cos(phi_v), ZC + 0.262 * math.sin(phi_v)),
                   rot=(phi_v - math.pi / 2, 0.0, 0.0), verts=12, material="steel", smooth=None)
    parts.append(_settle(valve))

    for k in range(STUD_N):
        y, z = _bolt_pos(k, xc, yc)
        stud = hr.cyl(f"{name}_stud{k}", 0.0085, 0.045,
                      loc=(xc + side * STUD_U, y, z), rot=(0.0, side * math.pi / 2, 0.0),
                      verts=12, material="steel", smooth=None)
        parts.append(_settle(stud))

    # bead-lock ring on the dished face (photos: a ring of ~20 bolts around the hub)
    ring_prof = [(0.181, 0.124), (0.229, 0.151), (0.229, 0.160), (0.181, 0.133), (0.181, 0.124)]
    ring = hr.lathe(name + "_beadring", ring_prof, loc=(xc, yc, ZC),
                    rot=(0.0, side * math.pi / 2, 0.0), segments=RIM_SEGS, material="paint_od",
                    smooth=None)
    parts.append(_settle(ring))
    # planetary hub cover in the middle, protruding past the wheel nuts
    hub_prof = [(0.0, 0.0), (0.075, 0.0), (0.075, 0.014), (0.068, 0.030), (0.064, 0.050),
                (0.050, 0.058), (0.0, 0.060)]
    dome = hr.lathe(name + "_hubdome", hub_prof, loc=(xc + side * 0.096, yc, ZC),
                    rot=(0.0, side * math.pi / 2, 0.0), segments=40, material="steel_dark",
                    smooth=None)
    parts.append(_settle(dome))
    obj = hr.join(parts, name)
    hr.shade_auto_smooth(obj, 30.0)
    return obj


def _nuts(name, xc, yc, side):
    parts = []
    for k in range(STUD_N):
        y, z = _bolt_pos(k, xc, yc)
        rot = (0.0, side * math.pi / 2, 0.0)
        nut = hr.cyl(f"{name}_nut{k}", 0.0156, 0.020, loc=(xc + side * NUT_U, y, z),
                     rot=rot, verts=6, bev=0.0025, seg=2, material="steel", smooth=None)
        parts.append(_settle(nut))
        washer = hr.cyl(f"{name}_washer{k}", 0.0115, 0.003,
                        loc=(xc + side * WASHER_U, y, z), rot=rot, verts=24,
                        material="steel", smooth=None)
        parts.append(_settle(washer))
    for k in range(BEAD_N):
        th = 2 * math.pi * (k + 0.5) / BEAD_N
        y, z = yc + BEAD_R * math.cos(th), ZC + BEAD_R * math.sin(th)
        bolt = hr.cyl(f"{name}_bead{k}", 0.0125, 0.014, loc=(xc + side * BEAD_U, y, z),
                      rot=(0.0, side * math.pi / 2, 0.0), verts=6, bev=0.002, seg=1,
                      material="steel", smooth=None)
        parts.append(_settle(bolt))
    obj = hr.join(parts, name)
    hr.shade_auto_smooth(obj, 30.0)
    return obj


def build():
    """Create the six wheels. Returns the objects; each has hr_node set."""
    out = []
    for W, xc, yc in WHEELS:
        side = _side(xc)
        tyre = _tyre(f"tyre_{W}", xc, yc, side)
        rim = _rim(f"rim_{W}", xc, yc, side)
        nuts = _nuts(f"nuts_{W}", xc, yc, side)
        for o in (tyre, rim, nuts):
            o["hr_node"] = W
        out += [tyre, rim, nuts]
    return out
