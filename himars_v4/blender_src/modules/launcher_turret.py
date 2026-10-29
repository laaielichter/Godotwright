"""Rotating launcher base (hr_node 'LauncherYaw') and pod cradle (hr_node 'LauncherPitch'), v4.

Yaw: turntable ring at layout.TURNTABLE, a long low platform running back to the module pivot
(platform Z 1.345..1.40), pivot clevises at layout.PITCH_ORIGIN under the side housings,
elevation-cylinder anchors, traverse drive, hydraulic manifold and accumulator.
Pitch: cradle under the pod (Z 1.40..1.46, the pod sits on it at Z 1.46) tied into the side
housings (launcher_housing), hinge lugs on the pivot axis, the elevation-cylinder rod lugs under
the housings, the U-shaped hoist frame folded on top of the module, hoses.

The two elevation cylinders are separate objects so the game can aim them:
launcher_elev_barrel_L/R (LauncherYaw, origin on the anchor pin) and launcher_elev_rod_L/R
(LauncherPitch, origin on the rod-eye pin). Both point at each other in the stowed pose. They lie
almost flat under the side housings when stowed (Z 1.35..1.455, below the module floor 1.46).
"""
import math

from mathutils import Vector

import launcher_util as lu
import layout as L

YAW, PITCH = "LauncherYaw", "LauncherPitch"
YC, ZT, RT = L.TURNTABLE["y"], L.TURNTABLE["z"], L.TURNTABLE["radius"]
PY, PZ = L.PITCH_ORIGIN[1], L.PITCH_ORIGIN[2]
X1 = L.POD["half_width"]
HX0, HX1 = L.MODULE["housing_x"]
YR, YF = L.MODULE["y"][1], L.MODULE["y"][0]
Z_RING0, Z_RING1 = ZT + 0.02, ZT + 0.055          # rotating ring 1.31..1.345
Z_PLAT1 = 1.40                                     # platform top = cradle bottom
Z_POD0 = L.POD["z"][0]                             # 1.46, module floor
HINGE_X = 0.75                                     # hinge lug centre, under the housings
NOTCH_Z = 1.58                                     # housing floor notch over the hinge
ANCHOR_Y, ANCHOR_Z, LUG_Y, LUG_Z, CYL_X = -2.35, 1.400, -0.55, 1.405, 0.70
XH = (X1 + HX0) / 2                                # hoist arms over the pod / housing gap (0.54)
OD, DARK, STEEL = "paint_od", "steel_dark", "steel"


def _bolt_ring(node, c, r, n, z, h=0.012, rb=0.011):
    for k in range(n):
        th = math.tau * (k + 0.5) / n
        lu.bolt("ring_bolt", (c[0] + math.cos(th) * r, c[1] + math.sin(th) * r, z), (0, 0, 1), rb, h, STEEL, node)


def _bolt_line(node, p0, p1, n, axis, r=0.009, h=0.008):
    for i in range(n):
        f = (i + 0.5) / n
        c = tuple(p0[j] + (p1[j] - p0[j]) * f for j in range(3))
        lu.bolt("bolt", c, axis, r, h, STEEL, node)


def _clevis(node, xs, y, z, r, below_z, t=0.02, dy=None, up=False):
    """Clevis plates (normal X) at each x in xs: a rounded ear of radius r round (y, z) on a web
    down to below_z (or up to it when up=True)."""
    dy = dy or r
    for x in xs:
        z0, z1 = (z, below_z) if up else (below_z, z)
        lu.box("clevis_web", (x, y, (z0 + z1) / 2), (t, 2 * dy, z1 - z0), OD, node, bev=0.003)
        lu.cyl("clevis_ear", (x - t / 2, y, z), (x + t / 2, y, z), r, OD, node, segs=24)


# ------------------------------------------------------------------------------------ yaw
def _turntable():
    ring = lu.revolve("turntable_ring", lu.rrect(0.80, RT, 0.0, Z_RING1 - Z_RING0, 0.006, 2),
                      (0.0, YC, Z_RING0), (0, 0, 1), OD, YAW, segs=96, closed=True)
    ring["tt_ring"] = 1
    _bolt_ring(YAW, (0.0, YC), 0.875, 40, Z_RING1)
    lu.revolve("turntable_seal", lu.rrect(RT - 0.004, RT + 0.006, -0.012, 0.004, 0.002, 1),
               (0.0, YC, Z_RING0), (0, 0, 1), "rubber", YAW, segs=96, closed=True)


def _platform():
    y0, y1 = PY, -0.62
    zc, hz = (Z_RING1 + Z_PLAT1) / 2, Z_PLAT1 - Z_RING1
    for sx in (1, -1):
        lu.box("plat_beam", (sx * 0.42, (y0 + y1) / 2, zc), (0.12, y1 - y0, hz), OD, YAW, bev=0.006)
        _bolt_line(YAW, (sx * 0.483, y0 + 0.1, 1.372), (sx * 0.483, y1 - 0.1, 1.372), 18, (sx, 0, 0), r=0.008, h=0.006)
    for y, hx, w in ((-2.85, 0.48, 0.08), (-1.75, 0.48, 0.10), (-1.15, 0.48, 0.08), (-0.67, 0.48, 0.08)):
        lu.box("plat_cross", (0.0, y, zc - 0.004), (2 * hx, w, hz - 0.008), OD, YAW, bev=0.005)
    # pivot cross beam (the stepped bracket seen under the module's rear end)
    lu.box("plat_pivot_beam", (0.0, PY, zc - 0.02), (2 * (HINGE_X + 0.11), 0.12, hz + 0.04), OD, YAW, bev=0.006)
    lu.box("plat_pivot_step", (0.0, PY + 0.04, Z_RING0 - 0.03), (0.70, 0.04, 0.06), OD, YAW, bev=0.004)
    _bolt_line(YAW, (-0.80, PY - 0.061, 1.36), (0.80, PY - 0.061, 1.36), 14, (0, -1, 0), r=0.008, h=0.005)
    # outrigger plates carrying the elevation-cylinder anchors
    for sx in (1, -1):
        x0, x1 = 0.48, CYL_X + 0.06
        lu.box("plat_outrigger", (sx * (x0 + x1) / 2, ANCHOR_Y, 1.351), (x1 - x0, 0.12, 0.012), OD, YAW, bev=0.003)
        lu.box("plat_outrigger_web", (sx * (x0 + x1) / 2, ANCHOR_Y, 1.325), (x1 - x0, 0.012, 0.04), OD, YAW)
    for ya, yb in ((-3.30, -2.92), (-2.78, -2.42)):
        lu.box("plat_deck", (0.0, (ya + yb) / 2, Z_PLAT1 - 0.006), (0.70, yb - ya, 0.008), OD, YAW)
    for sx in (1, -1):
        for y in (-2.45, -1.05):
            lu.box("plat_gusset", (sx * 0.56, y, 1.37), (0.16, 0.014, 0.05), OD, YAW)
    # hinge clevises on the module pivot axis
    for sx in (1, -1):
        _clevis(YAW, (sx * (HINGE_X - 0.045), sx * (HINGE_X + 0.045)), PY, PZ, 0.065, Z_RING1)
        lu.cyl("pivot_pin", (sx * (HINGE_X - 0.075), PY, PZ), (sx * (HINGE_X + 0.075), PY, PZ), 0.028, STEEL, YAW,
               segs=20)
        lu.bolt("pivot_nut", (sx * (HINGE_X + 0.075), PY, PZ), (sx, 0, 0), 0.036, 0.018, STEEL, YAW)
        lu.cyl("pivot_grease", (sx * (HINGE_X + 0.093), PY, PZ), (sx * (HINGE_X + 0.105), PY, PZ), 0.006, "chrome",
               YAW, segs=8)
    # elevation-cylinder anchor clevises
    for sx in (1, -1):
        _clevis(YAW, (sx * (CYL_X - 0.045), sx * (CYL_X + 0.045)), ANCHOR_Y, ANCHOR_Z, 0.04, 1.345, t=0.016)
        lu.cyl("anchor_pin", (sx * (CYL_X - 0.06), ANCHOR_Y, ANCHOR_Z), (sx * (CYL_X + 0.06), ANCHOR_Y, ANCHOR_Z),
               0.018, STEEL, YAW, segs=16)


def _traverse_drive():
    x, y = -0.24, -0.95
    lu.box("trav_gearbox", (x, y, 1.37), (0.12, 0.18, 0.12), OD, YAW, bev=0.010, seg=2)
    lu.cyl("trav_motor", (x, y, 1.31), (x, y, 1.17), 0.05, DARK, YAW, segs=24)
    lu.cyl("trav_motor_cap", (x, y, 1.17), (x, y, 1.155), 0.04, DARK, YAW, segs=24)
    lu.box("trav_brake", (x, y - 0.075, 1.25), (0.06, 0.04, 0.07), OD, YAW, bev=0.006)


def _hydraulics():
    lu.box("hyd_manifold", (0.0, -2.98, 1.372), (0.30, 0.18, 0.055), DARK, YAW, bev=0.006)
    for x in (-0.09, -0.03, 0.03, 0.09):
        lu.cyl("hyd_fitting", (x, -2.89, 1.372), (x, -2.86, 1.372), 0.012, "chrome", YAW, segs=8)
    lu.cyl("hyd_accumulator", (0.20, -2.75, 1.372), (0.20, -2.15, 1.372), 0.028, DARK, YAW, segs=20)
    lu.cyl("hyd_reservoir", (-0.20, -2.70, 1.372), (-0.20, -2.25, 1.372), 0.026, OD, YAW, segs=20)
    for sx in (1, -1):
        pts = lu.bezier((sx * 0.06, -2.86, 1.372), (sx * 0.30, -2.70, 1.36), (sx * 0.50, -2.55, 1.36),
                        (sx * (CYL_X - 0.03), ANCHOR_Y - 0.06, ANCHOR_Z - 0.035), 10)
        lu.sweep("hyd_line", pts, 0.008, "hose", YAW, segs=8)


def _elevation_barrels():
    for sx, s in ((1, "R"), (-1, "L")):
        A = Vector((sx * CYL_X, ANCHOR_Y, ANCHOR_Z))
        B = Vector((sx * CYL_X, LUG_Y, LUG_Z))
        d = (B - A)
        prof = [(0.0, 0.03), (0.036, 0.03), (0.036, 0.05), (0.052, 0.06), (0.052, 0.12), (0.047, 0.13),
                (0.047, 0.95), (0.052, 0.96), (0.052, 1.03), (0.034, 1.05), (0.0, 1.05)]
        o = lu.revolve("elev_barrel", prof, A, d, OD, YAW, segs=28)
        lu.keep(o, f"launcher_elev_barrel_{s}", A)
        lu.cyl("elev_eye", A - Vector((0.025 * sx, 0, 0)), A + Vector((0.025 * sx, 0, 0)), 0.035, OD, YAW, segs=20)
        u = d.normalized()
        side = Vector((sx * 0.055, 0, 0))
        h0 = A + u * 0.10 + side
        h1 = A + u * 0.95 + side
        lu.sweep("elev_hose", lu.bezier(h0, h0 + side * 0.6, h1 + side * 0.6, h1, 10), 0.007, "hose", YAW, segs=8)


def build_yaw():
    _turntable()
    _platform()
    _traverse_drive()
    _hydraulics()
    _elevation_barrels()


# ---------------------------------------------------------------------------------- pitch
def _cradle():
    y0, y1 = PY, YF - 0.08
    for sx in (1, -1):
        lu.box("cradle_beam", (sx * 0.38, (y0 + y1) / 2, (Z_PLAT1 + Z_POD0) / 2), (0.10, y1 - y0, Z_POD0 - Z_PLAT1),
               OD, PITCH, bev=0.006)
        # hinge lug hanging from the housing floor notch onto the pivot pin
        lu.box("hinge_lug_web", (sx * HINGE_X, PY + 0.02, (PZ + NOTCH_Z) / 2), (0.05, 0.10, NOTCH_Z - PZ), OD,
               PITCH, bev=0.004)
        lu.cyl("hinge_lug_ear", (sx * (HINGE_X - 0.025), PY, PZ), (sx * (HINGE_X + 0.025), PY, PZ), 0.055, OD,
               PITCH, segs=24)
        # elevation-cylinder rod lug hanging under the housing floor
        _clevis(PITCH, (sx * (CYL_X - 0.045), sx * (CYL_X + 0.045)), LUG_Y, LUG_Z, 0.035, Z_POD0, t=0.016,
                up=True)
        lu.box("rod_lug_pad", (sx * CYL_X, LUG_Y, Z_POD0 - 0.006), (0.14, 0.14, 0.012), OD, PITCH, bev=0.003)
        lu.cyl("rod_pin", (sx * (CYL_X - 0.06), LUG_Y, LUG_Z), (sx * (CYL_X + 0.06), LUG_Y, LUG_Z), 0.016, STEEL,
               PITCH, segs=16)
    # cross members from the pod cradle into the housings' inner walls
    for y in (-3.30, -2.60, -1.80, -1.00, -0.20, 0.42):
        lu.box("cradle_cross", (0.0, y, 1.428), (2 * (HX0 + 0.05), 0.08, 0.056), OD, PITCH, bev=0.005)


def _hoist():
    """U-shaped self-loading hoist frame folded flat on top of the module: two square-tube arms
    over the pod / housing seams, pivoting at the rear, closed by a crossbar at the front end
    with the hook block."""
    za, zb = 2.478, 2.535
    zc = (za + zb) / 2
    ya, yb = YR + 0.08, YF - 0.12
    for sx in (1, -1):
        lu.box("hoist_arm", (sx * XH, (ya + yb) / 2, zc), (0.06, yb - ya, zb - za), OD, PITCH, bev=0.006)
        lu.box("hoist_arm_inner", (sx * XH, yb - 0.30, zc), (0.066, 0.5, zb - za + 0.006), OD, PITCH, bev=0.004)
        lu.box("hoist_pivot_brk", (sx * XH, ya, 2.50), (0.10, 0.10, 0.06), OD, PITCH, bev=0.006)
        lu.cyl("hoist_knuckle", (sx * (XH - 0.07), ya, zc), (sx * (XH + 0.07), ya, zc), 0.024, STEEL, PITCH, segs=16)
        for y in (-2.6, -1.4, -0.3):
            lu.box("hoist_rest_pad", (sx * XH, y, 2.474), (0.07, 0.08, 0.008), "rubber", PITCH)
    lu.box("hoist_crossbar", (0.0, yb - 0.03, zc), (2 * XH + 0.06, 0.06, zb - za), OD, PITCH, bev=0.006)
    lu.box("hoist_hook_block", (0.0, yb - 0.12, zc), (0.14, 0.12, zb - za), DARK, PITCH, bev=0.008)
    lu.torus("hoist_hook", (0.0, yb - 0.21, 2.496), (0, 0, 1), 0.035, 0.009, STEEL, PITCH, segs=20, msegs=8)
    # rail bar across the rear between the arms (the bar seen over the caps in 8391601)
    lu.cyl("hoist_rear_bar", (-(XH - 0.03), YR + 0.08, 2.53), (XH - 0.03, YR + 0.08, 2.53), 0.022, OD, PITCH, segs=16)


def _hoses():
    """Heavy hoses from the turntable platform up to the module floor near the pivot."""
    for sx in (1, -1):
        for k, dx in enumerate((0.0, 0.05, 0.10)):
            p0 = (sx * (0.50 + dx), -2.95, 1.40)
            p3 = (sx * (0.60 + dx), -3.20, Z_POD0)
            pts = lu.bezier(p0, (sx * (0.52 + dx), -3.05, 1.31), (sx * (0.60 + dx), -3.25, 1.33), p3, 12)
            lu.sweep("hose", pts, 0.014, "hose", PITCH, segs=10)


def _elevation_rods():
    for sx, s in ((1, "R"), (-1, "L")):
        A = Vector((sx * CYL_X, ANCHOR_Y, ANCHOR_Z))
        B = Vector((sx * CYL_X, LUG_Y, LUG_Z))
        d = A - B
        prof = [(0.0, 0.03), (0.028, 0.03), (0.028, 0.95), (0.0, 0.95)]
        o = lu.revolve("elev_rod", prof, B, d, STEEL, PITCH, segs=20)
        lu.keep(o, f"launcher_elev_rod_{s}", B)
        lu.cyl("elev_rod_eye", B - Vector((0.025 * sx, 0, 0)), B + Vector((0.025 * sx, 0, 0)), 0.03, OD, PITCH,
               segs=20)


def build_pitch():
    _cradle()
    _hoist()
    _hoses()
    _elevation_rods()
