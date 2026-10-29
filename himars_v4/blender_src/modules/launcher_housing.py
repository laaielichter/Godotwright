"""Launcher-loader module side housings (hr_node 'LauncherPitch'), v4.

The M142's launcher-loader module is nearly truck-wide: the 1.05 m pod sits centred between two
full-height side housings (layout.MODULE: housing_x = (0.555, 1.15) each side, same Y and Z as the
pod). The whole module tilts with the pod, so the housings are on LauncherPitch.

Seen from behind (photos 8391601, 1808480; a rear view shows the vehicle's left on the image left):
- right housing (+X): a closed box. Rear face with an access door, padlocked latch box, stencil
  plate and handle slot; ribbed, riveted outer wall with three access panels; the boom / hoist
  housing with its sheave standing proud on top (to Z ~2.60).
- left housing (-X): outer wall closed like the right one, but the rear 0.45 m is an open bay:
  a post-and-rail framework holding cable bundles, hydraulic lines, junction boxes and the boom
  arm, with the boom tube running along the top.
Both housings have a floor notch at the rear (Z 1.46..1.58) over the module pivot.
"""
import math

import launcher_util as lu
import layout as L
from launcher_pod import _rivet_row

NODE = "LauncherPitch"
HX0, HX1 = L.MODULE["housing_x"]
YF, YR = L.MODULE["y"]
Z0, Z1 = L.MODULE["z"]
ZC = (Z0 + Z1) / 2
PY = L.PITCH_ORIGIN[1]
NOTCH_Y, NOTCH_Z = YR + 0.18, 1.58          # floor notch over the pivot: Y < -3.30, Z < 1.58
BAY_Y = YR + 0.45                           # open bay depth on the left housing
OD, DARK, STEEL, TAN = "paint_od", "steel_dark", "steel", "paint_tan"
CLOSED_SIDE = 1                             # +X (vehicle right) is the closed box
PANELS = [(-3.18, -2.20), (-2.10, -1.12), (-1.02, -0.30)]
PANEL_Z = (1.64, 2.30)
RIB_Y = [-3.25, -2.15, -1.07, -0.25]


def _shell(sx):
    """Walls, top, floor, corner angles and end posts of one housing."""
    xi, xo = HX0, HX1
    xm, w = sx * (xi + xo) / 2, xo - xi
    yl = YF - NOTCH_Y
    ymain = (YF + NOTCH_Y) / 2
    # outer wall: full height ahead of the notch, above it in the notch
    lu.box("hs_outer", (sx * (xo - 0.016), ymain, ZC), (0.012, yl, Z1 - Z0), OD, NODE)
    lu.box("hs_outer_r", (sx * (xo - 0.016), (YR + NOTCH_Y) / 2, (NOTCH_Z + Z1) / 2), (0.012, NOTCH_Y - YR, Z1 - NOTCH_Z),
           OD, NODE)
    lu.box("hs_inner", (sx * (xi + 0.006), (YF + YR) / 2, (NOTCH_Z + Z1) / 2), (0.012, YF - YR, Z1 - NOTCH_Z), OD, NODE)
    lu.box("hs_inner_lo", (sx * (xi + 0.006), ymain, (Z0 + NOTCH_Z) / 2), (0.012, yl, NOTCH_Z - Z0), OD, NODE)
    lu.box("hs_top", (xm, (YF + YR) / 2, Z1 - 0.016), (w - 0.02, YF - YR - 0.02, 0.012), OD, NODE)
    lu.box("hs_floor", (xm, ymain, Z0 + 0.006), (w, yl, 0.012), OD, NODE)
    lu.box("hs_notch_floor", (xm, (YR + NOTCH_Y) / 2, NOTCH_Z + 0.006), (w, NOTCH_Y - YR, 0.012), OD, NODE)
    lu.box("hs_notch_wall", (xm, NOTCH_Y, (Z0 + NOTCH_Z) / 2), (w, 0.012, NOTCH_Z - Z0), OD, NODE)
    lu.box("hs_front", (xm, YF - 0.016, ZC), (w - 0.02, 0.012, Z1 - Z0 - 0.02), OD, NODE)
    # long corner angles: they set the module's outer extents (X 1.15, Z 1.46 / 2.47)
    for x in (xo, xi):
        sgn = 1 if x == xo else -1           # outward along +X (for sx = +1)
        for zc, sz in ((Z1, -1), (Z0, 1)):
            ya = YR if zc == Z1 else NOTCH_Y
            zz = zc if zc == Z1 else Z0
            lu.box("hs_angle_h", (sx * (x - sgn * 0.022), (YF + ya) / 2, zz + sz * 0.0075), (0.044, YF - ya, 0.015),
                   OD, NODE, bev=0.003)
            lu.box("hs_angle_v", (sx * (x - sgn * 0.0075), (YF + ya) / 2, zz + sz * 0.024), (0.015, YF - ya, 0.048),
                   OD, NODE, bev=0.003)
    # vertical end posts (box sections) at the four end corners
    for y, sy in ((YR, 1), (YF, -1)):
        for x, sgn in ((xo, 1), (xi, -1)):
            zb = NOTCH_Z if y == YR else Z0
            lu.box("hs_post", (sx * (x - sgn * 0.03), y + sy * 0.03, (zb + Z1) / 2), (0.06, 0.06, Z1 - zb), OD, NODE,
                   bev=0.006)
    # lifting rings on the top corners
    for y in (YR + 0.30, YF - 0.25):
        x = sx * (xo - 0.12)
        lu.box("hs_lift_pad", (x, y, Z1 - 0.008), (0.10, 0.10, 0.004), DARK, NODE)
        lu.torus("hs_lift_ring", (x, y, Z1 - 0.004), (0, 0, 1), 0.03, 0.0055, STEEL, NODE, segs=20, msegs=6)


def _outer_wall(sx):
    xf = sx * (HX1 - 0.010)                 # outer skin face
    out = (sx, 0, 0)
    for y in RIB_Y:
        lu.box("hs_rib", (sx * (HX1 - 0.005), y, ZC), (0.010, 0.07, Z1 - Z0 - 0.04), OD, NODE, bev=0.003)
        for dy in (-0.045, 0.045):
            _rivet_row(NODE, (xf, y + dy, Z0 + 0.06), (xf, y + dy, Z1 - 0.06), 0.075, out)
        lu.box("hs_rib_top", (sx * (HX0 + HX1) / 2, y, Z1 - 0.005), (HX1 - HX0 - 0.06, 0.07, 0.010), OD, NODE,
               bev=0.003)
    for z in (1.585, 2.375):
        lu.box("hs_strip", (sx * (HX1 - 0.006), (YF + YR) / 2, z), (0.008, YF - YR - 0.12, 0.03), OD, NODE, bev=0.002)
    for z in (Z0 + 0.055, Z1 - 0.04):
        _rivet_row(NODE, (xf, YR + 0.07, z), (xf, YF - 0.07, z), 0.09, out)
    for ya, yb in PANELS:
        za, zb = PANEL_Z
        yc, ly, zc, lz = (ya + yb) / 2, yb - ya, (za + zb) / 2, zb - za
        lu.box("hs_panel", (sx * (HX1 - 0.008), yc, zc), (0.004, ly, lz), OD, NODE, bev=0.003)
        xr = sx * (HX1 - 0.006)
        for p0, p1 in (((xr, ya + 0.025, za + 0.025), (xr, yb - 0.025, za + 0.025)),
                       ((xr, ya + 0.025, zb - 0.045), (xr, yb - 0.025, zb - 0.045)),
                       ((xr, ya + 0.025, za + 0.06), (xr, ya + 0.025, zb - 0.08)),
                       ((xr, yb - 0.025, za + 0.06), (xr, yb - 0.025, zb - 0.08))):
            _rivet_row(NODE, p0, p1, 0.06, out, r=0.005, h=0.003)
        lu.cyl("hs_panel_hinge", (sx * (HX1 - 0.005), ya + 0.03, zb - 0.012), (sx * (HX1 - 0.005), yb - 0.03, zb - 0.012),
               0.005, OD, NODE, segs=8)
        for f in (0.22, 0.78):
            yy = ya + ly * f
            lu.box("hs_latch", (sx * (HX1 - 0.0045), yy, za + 0.07), (0.007, 0.07, 0.05), DARK, NODE, bev=0.002)
            lu.box("hs_latch_handle", (sx * (HX1 - 0.002), yy, za + 0.07), (0.004, 0.05, 0.012), STEEL, NODE)
    lu.box("hs_stencil_f", (sx * (HX1 - 0.0085), -0.02, 2.12), (0.003, 0.36, 0.20), TAN, NODE, bev=0.002)
    lu.box("hs_stencil_lift", (sx * (HX1 - 0.0085), 0.25, 1.75), (0.003, 0.16, 0.08), TAN, NODE, bev=0.002)
    lu.box("hs_pocket", (sx * (HX1 - 0.008), -3.36, 2.22), (0.004, 0.05, 0.08), DARK, NODE)
    lu.cyl("hs_conduit", (sx * (HX1 - 0.006), -3.25, 1.535), (sx * (HX1 - 0.006), 0.40, 1.535), 0.006, DARK, NODE,
           segs=8)


def _closed_rear(sx):
    """Closed rear face: door, latch box with padlock, stencil plate, handle slot (8391601 right)."""
    xi, xo = HX0, HX1
    xm, w = sx * (xi + xo) / 2, xo - xi
    yf = YR + 0.022                         # door face; fittings reach back to REAR_Y
    lu.box("hs_rear_plate", (xm, YR + 0.028, (NOTCH_Z + Z1) / 2), (w - 0.10, 0.012, Z1 - NOTCH_Z - 0.04), OD, NODE)
    # lower step: a separate box face above the notch (the darker lower band in the photo)
    lu.box("hs_rear_lower", (xm, YR + 0.032, NOTCH_Z + 0.08), (w - 0.10, 0.02, 0.14), OD, NODE, bev=0.004)
    lu.box("hs_rear_stencil", (xm + sx * 0.08, yf - 0.004, NOTCH_Z + 0.08), (0.24, 0.004, 0.09), TAN, NODE, bev=0.002)
    # access door, hinged on the outer edge
    dx0, dx1 = xi + 0.09, xo - 0.10
    dz0, dz1 = NOTCH_Z + 0.20, Z1 - 0.10
    lu.box("hs_door", (sx * (dx0 + dx1) / 2, yf - 0.004, (dz0 + dz1) / 2), (dx1 - dx0, 0.006, dz1 - dz0), OD, NODE,
           bev=0.003)
    _rivet_row(NODE, (sx * (dx0 + 0.02), yf - 0.007, dz0 + 0.02), (sx * (dx1 - 0.02), yf - 0.007, dz0 + 0.02), 0.06,
               (0, -1, 0), r=0.005, h=0.003)
    _rivet_row(NODE, (sx * (dx0 + 0.02), yf - 0.007, dz1 - 0.02), (sx * (dx1 - 0.02), yf - 0.007, dz1 - 0.02), 0.06,
               (0, -1, 0), r=0.005, h=0.003)
    for z in (dz0 + 0.08, dz1 - 0.08):
        lu.cyl("hs_door_hinge", (sx * (dx1 + 0.005), yf - 0.008, z - 0.05), (sx * (dx1 + 0.005), yf - 0.008, z + 0.05),
               0.008, STEEL, NODE, segs=10)
    # latch box with padlock near the inner edge, handle slot higher up
    lx = sx * (dx0 + 0.07)
    lu.box("hs_latch_box", (lx, yf - 0.010, dz0 + 0.20), (0.10, 0.014, 0.16), OD, NODE, bev=0.004)
    lu.box("hs_latch_dark", (lx, yf - 0.0175, dz0 + 0.20), (0.07, 0.002, 0.10), DARK, NODE)
    lu.torus("hs_padlock_shackle", (lx, yf - 0.012, dz0 + 0.16), (0, 1, 0), 0.01, 0.0025, STEEL, NODE, segs=10, msegs=4)
    lu.box("hs_padlock", (lx, yf - 0.012, dz0 + 0.135), (0.024, 0.010, 0.028), "chrome", NODE)
    lu.box("hs_slot_rim", (sx * (dx0 + dx1) / 2, yf - 0.009, dz1 - 0.12), (0.18, 0.006, 0.08), OD, NODE, bev=0.002)
    lu.box("hs_slot", (sx * (dx0 + dx1) / 2, yf - 0.0125, dz1 - 0.12), (0.15, 0.002, 0.055), DARK, NODE)
    # vertical frame strip next to the caps with a small release placard
    lu.box("hs_rear_strip", (sx * (xi + 0.035), yf - 0.004, (NOTCH_Z + Z1) / 2), (0.05, 0.008, Z1 - NOTCH_Z - 0.06),
           OD, NODE, bev=0.002)
    lu.box("hs_release_plate", (sx * (xi + 0.035), yf - 0.009, ZC - 0.05), (0.04, 0.002, 0.06), TAN, NODE)


def _hoist_housing(sx):
    """Boom / hoist housing standing proud on top of the closed housing, with the sheave."""
    x0, x1 = HX0 + 0.06, HX1 - 0.05
    y0, y1 = YR + 0.02, YR + 0.95
    zt = 2.585
    lu.box("hh_body", (sx * (x0 + x1) / 2, (y0 + y1) / 2, (Z1 + zt) / 2), (x1 - x0, y1 - y0, zt - Z1), OD, NODE,
           bev=0.02, seg=3)
    for y in (y0 + 0.25, y0 + 0.5, y0 + 0.75):
        lu.box("hh_rib", (sx * (x0 + x1) / 2, y, zt - 0.002), (x1 - x0 - 0.06, 0.04, 0.008), OD, NODE, bev=0.002)
    _rivet_row(NODE, (sx * (x0 + 0.03), y0 + 0.05, zt), (sx * (x0 + 0.03), y1 - 0.05, zt), 0.08, (0, 0, 1), h=0.003)
    _rivet_row(NODE, (sx * (x1 - 0.03), y0 + 0.05, zt), (sx * (x1 - 0.03), y1 - 0.05, zt), 0.08, (0, 0, 1), h=0.003)
    # sheave (pulley) and its cheek plates at the rear top
    xs = sx * (x0 + 0.08)
    lu.revolve("hh_sheave", lu.rrect(0.015, 0.05, -0.016, 0.016, 0.005, 1), (xs, YR + 0.07, 2.565), (1, 0, 0), STEEL,
               NODE, segs=28, closed=True)
    for dx in (-0.025, 0.025):
        lu.box("hh_cheek", (xs + dx, YR + 0.07, 2.56), (0.008, 0.10, 0.10), OD, NODE, bev=0.003)
    lu.cyl("hh_axle", (xs - 0.035, YR + 0.07, 2.565), (xs + 0.035, YR + 0.07, 2.565), 0.01, STEEL, NODE, segs=10)
    # hoist motor / winch drum lying along Y on the housing, with its hydraulic lines
    xw = sx * (x1 - 0.12)
    lu.cyl("hh_winch", (xw, y1 - 0.30, 2.62 - 0.045), (xw, y1 - 0.02, 2.62 - 0.045), 0.04, DARK, NODE, segs=20)
    for dx in (-0.03, 0.03):
        lu.sweep("hh_line", lu.bezier((xw + dx, y1 - 0.02, 2.575), (xw + dx, y1 + 0.10, 2.575),
                                      (xw + dx, y1 + 0.20, 2.50), (xw + dx, y1 + 0.20, Z1 + 0.004), 8),
                 0.007, "hose", NODE, segs=8)


def _open_rear(sx):
    """Open rear bay: posts and rails holding cables, hydraulic lines, junction boxes and the
    boom arm (8391601, left of the caps)."""
    xi, xo = HX0, HX1
    xm, w = sx * (xi + xo) / 2, xo - xi
    # back wall of the bay (dark, in shadow) and the bay's rails
    lu.box("ob_back", (xm, BAY_Y, (NOTCH_Z + Z1) / 2), (w - 0.02, 0.012, Z1 - NOTCH_Z), DARK, NODE)
    for z in (NOTCH_Z + 0.04, 2.05, Z1 - 0.06):
        lu.box("ob_rail", (xm, YR + 0.03, z), (w - 0.06, 0.05, 0.05), OD, NODE, bev=0.005)
    lu.box("ob_mid_post", (sx * (xi + 0.20), YR + 0.03, (NOTCH_Z + Z1) / 2), (0.05, 0.05, Z1 - NOTCH_Z), OD, NODE,
           bev=0.005)
    # junction boxes and connectors on the back wall
    for (fx, z, bw, bh) in ((0.30, 2.25, 0.20, 0.14), (0.62, 2.20, 0.16, 0.20), (0.62, 1.78, 0.18, 0.12)):
        x = sx * (xi + w * fx)
        lu.box("ob_jbox", (x, BAY_Y - 0.06, z), (bw, 0.11, bh), OD, NODE, bev=0.006)
        for k in range(3):
            lu.cyl("ob_conn", (x - bw / 3 + k * bw / 3, BAY_Y - 0.115, z - bh / 2 - 0.0),
                   (x - bw / 3 + k * bw / 3, BAY_Y - 0.115, z - bh / 2 - 0.03), 0.014, DARK, NODE, segs=10)
    # cable bundles: drop out of the junction boxes, loop down and out through the floor
    for k in range(5):
        x = sx * (xi + 0.10 + k * 0.08)
        top = (x, BAY_Y - 0.115, 2.10 if k < 3 else 2.08)
        pts = lu.bezier(top, (x, YR + 0.06, 1.95), (x + sx * 0.02, YR + 0.05, 1.70), (x, BAY_Y - 0.05, NOTCH_Z + 0.012), 14)
        lu.sweep("ob_cable", pts, 0.011 if k % 2 else 0.016, "hose", NODE, segs=10)
    # hydraulic lines running up the inner post
    for k in range(3):
        x = sx * (xi + 0.07 + k * 0.025)
        lu.cyl("ob_hyd", (x, YR + 0.07, NOTCH_Z + 0.02), (x, YR + 0.07, Z1 - 0.08), 0.008, STEEL, NODE, segs=8)
        lu.cyl("ob_hyd_fit", (x, YR + 0.07, Z1 - 0.10), (x, YR + 0.07, Z1 - 0.07), 0.012, "chrome", NODE, segs=8)
    # boom arm: square tube rising diagonally through the bay to the top
    a = (sx * (xo - 0.12), YR + 0.25, NOTCH_Z + 0.05)
    b = (sx * (xo - 0.25), YR + 0.10, Z1 - 0.05)
    lu.sweep("ob_boom_arm", [a, b], 0.035, OD, NODE, segs=4)
    lu.cyl("ob_boom_pivot", (a[0] - 0.05 * sx, a[1], a[2]), (a[0] + 0.05 * sx, a[1], a[2]), 0.03, STEEL, NODE, segs=14)
    # boom tube along the top of the housing (the long bar over the caps in the photo)
    xb = sx * (xi + 0.18)
    lu.cyl("ob_boom_tube", (xb, YR + 0.01, 2.52), (xb, -1.10, 2.52), 0.035, OD, NODE, segs=16)
    lu.cyl("ob_boom_cap", (xb, YR + 0.005, 2.52), (xb, YR + 0.01, 2.52), 0.03, "paint_tan", NODE, segs=16)
    for y in (YR + 0.15, -2.40, -1.30):
        lu.box("ob_boom_brk", (xb, y, Z1 + 0.02), (0.08, 0.06, 0.05), OD, NODE, bev=0.004)
    lu.box("ob_stencil", (xm, YR + 0.004, Z1 - 0.025), (0.22, 0.004, 0.035), TAN, NODE)


def build():
    for sx in (1, -1):
        _shell(sx)
        _outer_wall(sx)
        if sx == CLOSED_SIDE:
            _closed_rear(sx)
            _hoist_housing(sx)
        else:
            _open_rear(sx)
