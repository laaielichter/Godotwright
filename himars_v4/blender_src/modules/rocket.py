"""GMLRS rocket master (module 'rocket').

build() returns one object, 'gmlrs_master' (hr_node 'Rocket'), centred on the origin with its
axis on world +Y: nose tip at Y +1.98, nozzle exit at Y -1.98 (length 3.96 m), body diameter
0.227 m. Parts are built along a local Z axis, joined, then the mesh data is rotated once into
world space, so the object keeps an identity transform and all geometry is baked.

Layout along the axis (metres, world Y, nose first):
  +1.98         seeker dome tip, glass
  +1.955..+1.48 tangent ogive nose, olive airframe; 4 canards folded flush against it
  +1.48         nose/warhead seam: collar and fastener row
  +1.48..-0.02  warhead, 1.50 m, tan; 4 band lines at 0.3 m pitch
  -0.02         warhead/motor seam: collar and fastener row
  -0.02..-1.70  motor case, dark grey; 8 strake lines, 2 weld seams, retaining band
  -1.70         motor/boat-tail seam: collar and fastener row
  -1.70..-1.95  boat-tail taper to radius 0.085 (0.25 m); 4 folded tail fins at -1.24..-1.56
  -1.95..-1.98  nozzle skirt, dark exit ring (r 0.06 to 0.034), dished inner throat
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

_HERE = os.path.dirname(os.path.abspath(__file__))
_BUILD = os.path.dirname(_HERE)
for _p in (_HERE, _BUILD):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import hr  # noqa: E402

NODE = "Rocket"
OBJ_NAME = "gmlrs_master"

SEG = 160              # circumferential segments of bodies of revolution
R = 0.1135             # body radius (diameter 0.227 m)
TIP = 1.98             # nose tip, local Z (= world +Y after the final rotation)
TIP_R = 0.012          # rounded tip radius
Z_GLASS = 1.955        # seeker dome base
Z_NOSE = 1.48          # nose / warhead seam (ogive base)
Z_WH = -0.02           # warhead / motor seam
Z_BT0 = -1.70          # motor case ends, boat-tail starts
Z_BT1 = -1.95          # boat-tail ends at R_BT
R_BT = 0.085
Z_TAIL = -1.98         # nozzle exit plane
SINK = 0.0008          # panels and bands start this far inside the body surface
FASTENER_R = 0.0042


def _ogive_fn():
    """Tangent ogive from the body radius at Z_NOSE to a sharp apex, with the apex moved
    up so that the surface reaches radius TIP_R at Z = TIP - TIP_R (rounded tip)."""

    def make(delta):
        apex = TIP + delta
        L = apex - Z_NOSE
        rho = (R * R + L * L) / (2.0 * R)

        def r_of(z):
            t = z - Z_NOSE
            return math.sqrt(max(rho * rho - t * t, 0.0)) + R - rho

        return r_of

    target = TIP - TIP_R
    lo, hi = 0.0, 0.2
    for _ in range(80):
        mid = 0.5 * (lo + hi)
        if make(mid)(target) < TIP_R:
            lo = mid
        else:
            hi = mid
    return make(0.5 * (lo + hi))


def _fix_normals(obj):
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()


def _revolve(name, profile, mat):
    obj = hr.lathe(name, profile, segments=SEG, material=mat, smooth=None)
    _fix_normals(obj)
    return obj


def _rounded_profile(r0, r1, z0, z1, rad, n=3):
    """Closed rounded-rectangle loop in (r, z), returned as a lathe profile."""
    rad = min(rad, 0.49 * (r1 - r0), 0.49 * (z1 - z0))
    corners = (
        (r1 - rad, z1 - rad, 0.0),
        (r0 + rad, z1 - rad, 90.0),
        (r0 + rad, z0 + rad, 180.0),
        (r1 - rad, z0 + rad, 270.0),
    )
    pts = []
    for cr, cz, a0 in corners:
        for k in range(n + 1):
            a = math.radians(a0 + 90.0 * k / n)
            pts.append((cr + rad * math.cos(a), cz + rad * math.sin(a)))
    pts.append(pts[0])
    return pts


def _panel(name, theta_c, half, zlo_fn, zhi_fn, r_fn, t, mat, nu=8, nv=6, bevel=0.002):
    """Thin curved plate (a folded fin or a strake) that follows the body surface.

    The plate is a grid over (u across, v along): u in [-1, 1] maps to the angle
    theta_c +/- half, v in [0, 1] maps to z between zlo(u) and zhi(u). Its inner face sits
    just inside the body (r_fn - SINK), its outer face t outside (r_fn + t). The four edges
    are bevelled by a modifier that is applied before the object is returned."""
    bm = bmesh.new()
    inner, outer = [], []
    for i in range(nu + 1):
        u = -1.0 + 2.0 * i / nu
        th = theta_c + u * half
        c, s = math.cos(th), math.sin(th)
        zl, zh = zlo_fn(u), zhi_fn(u)
        row_i, row_o = [], []
        for j in range(nv + 1):
            z = zl + (zh - zl) * j / nv
            r = r_fn(z)
            row_i.append(bm.verts.new(((r - SINK) * c, (r - SINK) * s, z)))
            row_o.append(bm.verts.new(((r + t) * c, (r + t) * s, z)))
        inner.append(row_i)
        outer.append(row_o)
    for i in range(nu):
        for j in range(nv):
            bm.faces.new((outer[i][j], outer[i + 1][j], outer[i + 1][j + 1], outer[i][j + 1]))
            bm.faces.new((inner[i][j], inner[i][j + 1], inner[i + 1][j + 1], inner[i + 1][j]))
    for j in range(nv):
        bm.faces.new((inner[0][j], inner[0][j + 1], outer[0][j + 1], outer[0][j]))
        bm.faces.new((inner[nu][j], outer[nu][j], outer[nu][j + 1], inner[nu][j + 1]))
    for i in range(nu):
        bm.faces.new((inner[i][0], outer[i][0], outer[i + 1][0], inner[i + 1][0]))
        bm.faces.new((inner[i][nv], inner[i + 1][nv], outer[i + 1][nv], outer[i][nv]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    hr._link(obj)
    obj.data.materials.append(hr.mat(mat))
    hr.bevel(obj, bevel, 2)
    hr.apply_all(obj)
    _fix_normals(obj)
    return obj


def _fasteners(rows, name, mat):
    """Hemispherical fastener heads (UV spheres, half buried) in one object.
    rows: (z, count, radius of centres, head radius)."""
    bm = bmesh.new()
    for z, n, rc, rad in rows:
        for k in range(n):
            a = 2.0 * math.pi * k / n
            m = Matrix.Translation(Vector((rc * math.cos(a), rc * math.sin(a), z)))
            bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=rad, matrix=m)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    hr._link(obj)
    obj.data.materials.append(hr.mat(mat))
    return obj


def _weld(obj):
    """Merge coincident vertices where the parts meet (seams, joint rings)."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(me)
    bm.free()
    me.update()


def build():
    r_of = _ogive_fn()
    r_g = r_of(Z_GLASS)
    parts = []

    # Seeker dome: glass cap from the ogive at Z_GLASS up to the rounded tip.
    glass = [(0.0, Z_GLASS), (r_g, Z_GLASS)]
    for k in range(1, 5):
        z = Z_GLASS + (TIP - TIP_R - Z_GLASS) * k / 5.0
        glass.append((r_of(z), z))
    glass.append((TIP_R, TIP - TIP_R))
    for k in range(1, 7):
        a = (math.pi / 2.0) * (1.0 - k / 6.0)
        glass.append((TIP_R * math.sin(a), (TIP - TIP_R) + TIP_R * math.cos(a)))
    parts.append(_revolve("gmlrs_seeker_dome", glass, "glass"))

    # Nose ogive airframe, closed at the top by the dome base.
    nose = [(0.0, Z_GLASS), (r_g, Z_GLASS)]
    n_og = 96
    for k in range(1, n_og + 1):
        z = Z_GLASS + (Z_NOSE - Z_GLASS) * k / n_og
        nose.append((r_of(z), z))
    nose.append((0.0, Z_NOSE))
    parts.append(_revolve("gmlrs_nose_ogive", nose, "gmlrs_airframe"))

    # Warhead section, 1.50 m, closed.
    warhead = [(0.0, Z_WH), (R, Z_WH), (R, Z_NOSE), (0.0, Z_NOSE)]
    parts.append(_revolve("gmlrs_warhead", warhead, "warhead_tan"))

    # Motor case with the boat-tail; open at the aft end where the nozzle starts.
    motor = [(0.0, Z_WH), (R, Z_WH), (R, Z_BT0), (R_BT, Z_BT1)]
    parts.append(_revolve("gmlrs_motor_case", motor, "rocket_motor"))

    # Nozzle: aft skirt, dark exit lip (r 0.06 at Z_TAIL), inner cone up to a dished throat.
    nozzle = [
        (R_BT, Z_BT1), (R_BT, -1.965), (0.072, -1.972), (0.060, Z_TAIL),
        (0.034, Z_TAIL), (0.016, -1.915), (0.0, -1.90),
    ]
    parts.append(_revolve("gmlrs_nozzle", nozzle, "nozzle_dark"))
    # Sixteen nozzle skirt bolts and a bead on the exit lip.
    parts.append(_fasteners([(-1.958, 16, R_BT + 0.0008, 0.0030)],
                            "gmlrs_nozzle_bolts", "steel_dark"))
    parts.append(hr.torus("gmlrs_exit_bead", 0.047, 0.0022, loc=(0, 0, Z_TAIL + 0.0022),
                          major_seg=SEG, minor_seg=12, material="steel_dark"))

    # Warhead band lines every 0.3 m.
    for i, z in enumerate((1.18, 0.88, 0.58, 0.28)):
        prof = _rounded_profile(R - SINK, R + 0.0014, z - 0.0045, z + 0.0045, 0.0006)
        parts.append(_revolve(f"gmlrs_band_{i}", prof, "steel_dark"))

    # Flush collars at the three seams.
    for i, z in enumerate((Z_NOSE, Z_WH, Z_BT0)):
        prof = _rounded_profile(R - 0.001, R + 0.0026, z - 0.0075, z + 0.0075, 0.0018)
        parts.append(_revolve(f"gmlrs_collar_{i}", prof, "steel_dark"))

    # Retaining band at the boat-tail / nozzle joint and two weld seams on the motor case.
    parts.append(hr.torus("gmlrs_retain_band", R_BT + 0.0012, 0.0036,
                          loc=(0, 0, Z_BT1), major_seg=SEG, minor_seg=16,
                          material="steel_dark"))
    for i, z in enumerate((-0.55, -1.10)):
        parts.append(hr.torus(f"gmlrs_weld_{i}", R + 0.0003, 0.0028,
                              loc=(0, 0, z), major_seg=SEG, minor_seg=16,
                              material="steel_dark"))

    # Eight strake lines on the motor case, between the seams.
    for k in range(8):
        th = math.radians(22.5 + 45.0 * k)
        parts.append(_panel(f"gmlrs_strake_{k}", th, 0.04,
                            lambda u: -0.12, lambda u: -1.62, lambda z: R,
                            0.0022, "rocket_motor", nu=2, nv=10, bevel=0.0007))

    # Four canards, folded flush on the ogive (local angles 0, 90, 180, 270 deg).
    for k in range(4):
        th = math.radians(90.0 * k)
        parts.append(_panel(f"gmlrs_canard_{k}", th, 0.30,
                            lambda u: 1.56 + 0.03 * (1.0 + u) / 2.0, lambda u: 1.80,
                            r_of, 0.009, "steel", nu=8, nv=6, bevel=0.0022))

    # Four folded tail fins on the motor case (local angles 45, 135, 225, 315 deg).
    for k in range(4):
        th = math.radians(45.0 + 90.0 * k)
        parts.append(_panel(f"gmlrs_tailfin_{k}", th, 0.30,
                            lambda u: -1.24, lambda u: -1.52 - 0.04 * (1.0 + u) / 2.0,
                            lambda z: R, 0.009, "steel", nu=8, nv=6, bevel=0.0022))

    # Fastener rows along the three seams.
    parts.append(_fasteners([(Z_NOSE, 36, R + 0.0012, FASTENER_R),
                             (Z_WH, 36, R + 0.0012, FASTENER_R),
                             (Z_BT0, 36, R + 0.0012, FASTENER_R)],
                            "gmlrs_fasteners", "steel"))

    final = hr.join(parts, OBJ_NAME)
    # Rotate once into world space: local Z (nose) -> world +Y.
    final.data.transform(Matrix.Rotation(-math.pi / 2.0, 4, "X"))
    final.data.update()
    _weld(final)
    hr.shade_auto_smooth(final, 35.0)
    final["hr_node"] = NODE
    return [final]
