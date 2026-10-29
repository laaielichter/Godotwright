"""Front and rear bumpers.

Front (layout.FRONT_BUMPER, photo 7948249): heavy full-width box-section bar 0.97..1.23 high,
two round headlamps in steel bezels, amber turn lamps outboard, amber corner markers, two
D-ring shackles in raised housings, a recessed centre with the slave receptacle and trailer
connectors, and a trapezoid louvred skid guard below. The headlamp bezels and shackles are the
foremost parts and touch layout.FRONT_Y.

Rear (layout.REAR_BUMPER_Z, photo 8391601): full-width bar with lamp boxes at both ends (red
stop/tail, amber turn, red reflectors), three red identification lamps on top, two D-ring
shackles, the towing pintle and a lower channel bar. The shackles and pintle touch
layout.REAR_Y."""
import math

import chassis_util as cu
from chassis_util import layout as L

HALF_PI = math.pi / 2
FB = L.FRONT_BUMPER
FY = FB["y_front"]                  # 3.48
FZ0, FZ1 = FB["z"]                  # 0.97, 1.23
FHW = FB["width"] / 2               # 1.13
F_FACE = FY - 0.05                  # bumper face plane; lamps and shackles reach FY
F_BACK = F_FACE - 0.22
RZ0, RZ1 = L.REAR_BUMPER_Z          # 0.89, 1.24
RY = L.REAR_Y
R_FACE = RY + 0.04
R_BACK = R_FACE + 0.24


def _d_shackle(base, x, y_ring, z_pin, sgn, drop=0.13, half=0.055, r=0.017):
    """D-ring shackle hanging in front of a face (ring plane XZ). sgn: +1 front, -1 rear."""
    pts = [(x - half, y_ring, z_pin), (x - half, y_ring, z_pin - drop * 0.55),
           (x - half * 0.75, y_ring, z_pin - drop * 0.9), (x, y_ring, z_pin - drop),
           (x + half * 0.75, y_ring, z_pin - drop * 0.9), (x + half, y_ring, z_pin - drop * 0.55),
           (x + half, y_ring, z_pin)]
    cu.hose(f"{base}_bow", pts, r, mat="steel", segs=14, per=5)
    cu.cyl_x(f"{base}_pin", 0.014, x - half - 0.03, x + half + 0.03, y_ring, z_pin, verts=16,
             mat="steel")
    for k in (-1, 1):
        cu.cyl(f"{base}_pin_head", 0.022, 0.014, (x + k * (half + 0.035), y_ring, z_pin),
               rot=(0, HALF_PI, 0), verts=6, mat="steel")
        # ears of the shackle mount, reaching back to the face
        y_a = y_ring - sgn * 0.06
        cu.box(f"{base}_ear", (0.018, 0.10, 0.08), (x + k * (half + 0.016), y_a, z_pin - 0.01),
               mat="paint_od", bev=0.004, seg=2)


def _round_lamp(base, x, z, y_face, sgn, r_lens, lens_mat, r_bezel=None, depth=0.05,
                hood=False):
    """Lamp on a face at y_face pointing sgn*Y: housing, bezel ring, slightly domed lens."""
    rb = r_bezel or r_lens + 0.018
    yc = y_face + sgn * depth / 2
    cu.cyl(f"{base}_housing", rb, depth, (x, yc, z), rot=(HALF_PI, 0, 0), verts=32,
           mat="steel_dark", bev=0.004, seg=2)
    yb = y_face + sgn * depth
    cu.tube(f"{base}_bezel", rb + 0.002, r_lens - 0.004, 0.012, (x, yb - sgn * 0.004, z),
            rot=(HALF_PI, 0, 0), segments=32, mat="steel")
    prof = [(0.0, 0.0), (r_lens, 0.0), (r_lens * 0.92, 0.010), (r_lens * 0.6, 0.016), (0.0, 0.018)]
    rot = (-HALF_PI, 0, 0) if sgn > 0 else (HALF_PI, 0, 0)
    cu.lathe(f"{base}_lens", prof, (x, yb - sgn * 0.016, z), rot=rot, segments=32, mat=lens_mat)
    if hood:
        cu.tube(f"{base}_hood", rb + 0.006, rb - 0.002, 0.035, (x, yb - sgn * 0.0155, z),
                rot=(HALF_PI, 0, 0), segments=24, mat="paint_od")


def _front_bar():
    zc = (FZ0 + FZ1) / 2
    # outer segments (full section), with chamfered top front edge
    for s, side in cu.SIDES:
        x0, x1 = 0.47, FHW
        prof = [(F_BACK, FZ0), (F_FACE, FZ0), (F_FACE, FZ1 - 0.035), (F_FACE - 0.035, FZ1),
                (F_BACK, FZ1)]
        cu.prism_x(f"fbar_outer_{side}", prof, s * x0, s * x1, bev=0.010, seg=2)
        # wrap-around end plate with a side marker
        xa, xb = s * (FHW - 0.012), s * (FHW + 0.002)
        cu.box_mm(f"fbar_end_{side}", (min(xa, xb), F_BACK - 0.08, FZ0 + 0.01),
                  (max(xa, xb), F_FACE - 0.01, FZ1 - 0.01), bev=0.004, seg=2)
        cu.box(f"side_marker_{side}", (0.012, 0.07, 0.035), (s * (FHW + 0.004), F_FACE - 0.08, zc + 0.05),
               mat="lens_amber", bev=0.003, seg=1)
        # amber corner marker on the top outer corner of the face
        cu.box(f"corner_marker_hsg_{side}", (0.09, 0.03, 0.05), (s * (FHW - 0.06), F_FACE + 0.012, FZ1 - 0.035),
               mat="steel_dark", bev=0.004, seg=1)
        cu.box(f"corner_marker_{side}", (0.07, 0.008, 0.032), (s * (FHW - 0.06), F_FACE + 0.029, FZ1 - 0.035),
               mat="lens_amber", bev=0.002, seg=1)
        # shackle housing: raised block around each D-ring
        sx = FB["shackle_x"]
        cu.box_mm(f"shackle_housing_{side}", (s * sx - 0.085, F_BACK, FZ0),
                  (s * sx + 0.085, F_FACE + 0.012, FZ1 + 0.035), bev=0.010, seg=2)
        _d_shackle(f"fshackle_{side}", s * sx, FY - 0.022, FZ1 - 0.04, 1)
        # headlamp and turn lamp
        _round_lamp(f"headlamp_{side}", s * FB["headlamp_x"], FB["headlamp_z"], F_FACE, 1,
                    FB["headlamp_d"] / 2, "lens_white", r_bezel=FB["headlamp_d"] / 2 + 0.022,
                    depth=FY - F_FACE - 0.002)
        _round_lamp(f"turnlamp_{side}", s * FB["turn_x"], FB["headlamp_z"], F_FACE, 1,
                    0.060, "lens_amber", r_bezel=0.078, depth=0.035, hood=True)
        # face bolts
        for x in (0.56, 0.62, 0.86, 1.03, 1.08):
            cu.bolt_y(f"fbar_bolt_{side}", s * x, F_FACE + 0.004, FZ0 + 0.025, r=0.011, h=0.008)
        for x in (0.56, 1.06):
            cu.bolt_y(f"fbar_bolt_top_{side}", s * x, F_FACE + 0.004, FZ1 - 0.06, r=0.011, h=0.008)
    # recessed centre: lower face strip, back wall and the top cap behind
    cu.box_mm("fbar_centre_low", (-0.31, F_BACK, FZ0), (0.31, F_FACE, FZ0 + 0.10), bev=0.008, seg=2)
    cu.box_mm("fbar_centre_back", (-0.31, F_BACK, FZ0 + 0.09), (0.31, F_BACK + 0.06, FZ1),
              bev=0.006, seg=2, mat="steel_dark")
    cu.box_mm("fbar_centre_top", (-0.31, F_BACK, FZ1 - 0.02), (0.31, F_BACK + 0.10, FZ1),
              bev=0.004, seg=1)
    # connectors in the recess: NATO slave receptacle, trailer socket, two air couplings
    cu.cyl("slave_receptacle", 0.045, 0.06, (-0.12, F_BACK + 0.09, FZ0 + 0.17),
           rot=(HALF_PI, 0, 0), verts=24, mat="steel", bev=0.004, seg=1)
    cu.cyl("slave_cap", 0.050, 0.015, (-0.12, F_BACK + 0.125, FZ0 + 0.17),
           rot=(HALF_PI, 0, 0), verts=24, mat="steel_dark", bev=0.003, seg=1)
    cu.cyl("trailer_socket", 0.038, 0.07, (0.02, F_BACK + 0.095, FZ0 + 0.17),
           rot=(HALF_PI, 0, 0), verts=20, mat="steel_dark", bev=0.003, seg=1)
    for x, m in ((0.14, "lens_red"), (0.22, "steel")):
        cu.cyl(f"gladhand_{m}", 0.026, 0.05, (x, F_BACK + 0.09, FZ0 + 0.165),
               rot=(HALF_PI, 0, 0), verts=16, mat=m)
        cu.box(f"gladhand_lip_{m}", (0.05, 0.02, 0.012), (x, F_BACK + 0.12, FZ0 + 0.14), mat=m,
               bev=0.0)
    cu.hose("recess_cable", [(-0.12, F_BACK + 0.06, FZ0 + 0.17), (-0.20, F_BACK + 0.03, FZ0 + 0.12),
                             (-0.25, F_BACK - 0.05, FZ0 + 0.20)], 0.010, segs=8)
    # mounting brackets back to the rails
    for s, side in cu.SIDES:
        cu.box_mm(f"fbar_bracket_{side}", (s * L.RAIL_X - 0.06, F_BACK - 0.20, L.RAIL_Z[0] - 0.10),
                  (s * L.RAIL_X + 0.06, F_BACK, L.RAIL_Z[1] - 0.02), bev=0.006, seg=2)
        for dz in (0.0, 0.10):
            for dy in (-0.15, -0.05):
                cu.bolt_x(f"fbar_bracket_bolt_{side}", s * (L.RAIL_X + 0.062), F_BACK + dy,
                          L.RAIL_Z[0] - 0.05 + dz, r=0.011, h=0.008)


def _front_guard():
    """Trapezoid skid guard below the bar with two louvred openings (photo: 2 x 4 slots)."""
    zt, zb = FZ0, FZ0 - 0.20
    xt, xb = 0.80, 0.66
    y1 = F_FACE - 0.04
    y0 = y1 - 0.012
    # frame bars of the trapezoid
    cu.box_mm("fguard_top", (-xt, y0 - 0.06, zt - 0.03), (xt, y1, zt), bev=0.004, seg=1)
    cu.box_mm("fguard_bot", (-xb, y0 - 0.10, zb), (xb, y1, zb + 0.03), bev=0.006, seg=2)
    cu.box_mm("fguard_mid", (-0.03, y0, zb), (0.03, y1, zt), bev=0.003, seg=1)
    for s, side in cu.SIDES:
        prof = [(s * xt, zt), (s * (xt - 0.05), zt), (s * (xb - 0.05), zb), (s * xb, zb)]
        if s < 0:
            prof.reverse()
        cu.prism(f"fguard_side_{side}", prof, y0, y1, bev=0.003, seg=1)
        x0, x1 = (0.05, xb - 0.06) if s > 0 else (-(xb - 0.06), -0.05)
        cu.louvre_y(f"fguard_louvre_{side}", y1, 1, x0, x1, zb + 0.035, zt - 0.035, 4)
        # side plates running back to the frame
        cu.box_mm(f"fguard_cheek_{side}", (s * xb - 0.006, y0 - 0.45, zb + 0.02),
                  (s * xb + 0.006, y0, zt), bev=0.003, seg=1)
    cu.box_mm("fguard_floor", (-xb, y0 - 0.45, zb), (xb, y0 - 0.10, zb + 0.012), bev=0.003, seg=1)
    for x in (-0.6, -0.3, 0.3, 0.6):
        cu.bolt_y("fguard_bolt", x, y1 + 0.004, zt - 0.015, r=0.008, h=0.006)


def _rear_bumper():
    zc = (RZ0 + RZ1) / 2
    hw = FHW
    # centre beam (box section), lower than the lamp boxes
    cu.box_mm("rbar_beam", (-0.74, R_FACE + 0.02, RZ0 + 0.06), (0.74, R_BACK, RZ1 - 0.04),
              bev=0.010, seg=2)
    cu.box_mm("rbar_top_plate", (-0.74, R_FACE + 0.01, RZ1 - 0.045), (0.74, R_BACK + 0.10, RZ1 - 0.025),
              bev=0.004, seg=1)
    # three red identification lamps on the top front edge
    for k, x in enumerate((-0.14, 0.0, 0.14)):
        cu.box(f"id_lamp_hsg_{k}", (0.075, 0.03, 0.04), (x, R_FACE + 0.02, RZ1 - 0.065),
               mat="steel_dark", bev=0.003, seg=1)
        cu.box(f"id_lamp_{k}", (0.06, 0.008, 0.026), (x, R_FACE + 0.004, RZ1 - 0.065),
               mat="lens_red", bev=0.002, seg=1)
    for s, side in cu.SIDES:
        # lamp box at each end
        x0, x1 = 0.72, hw
        cu.box_mm(f"rlamp_box_{side}", (min(s * x0, s * x1), R_FACE, RZ0), (max(s * x0, s * x1), R_BACK, RZ1),
                  bev=0.012, seg=2)
        xm = s * 0.93
        # big stop/tail lamp (round red, hooded), amber turn lamp and red reflectors below
        _round_lamp(f"stoplamp_{side}", xm - s * 0.06, RZ1 - 0.10, R_FACE, -1, 0.062,
                    "lens_red", r_bezel=0.082, depth=0.03, hood=True)
        _round_lamp(f"rturn_{side}", xm + s * 0.10, RZ1 - 0.10, R_FACE, -1, 0.040,
                    "lens_amber", r_bezel=0.052, depth=0.025)
        for k, dx in enumerate((-0.07, 0.05)):
            _round_lamp(f"reflector_{side}_{k}", xm + s * dx, RZ0 + 0.075, R_FACE, -1, 0.034,
                        "lens_red", r_bezel=0.044, depth=0.02)
        cu.box(f"blackout_lamp_{side}", (0.07, 0.02, 0.04), (xm + s * 0.14, R_FACE - 0.008, RZ0 + 0.075),
               mat="lens_red", bev=0.003, seg=1)
        # D-ring shackles
        _d_shackle(f"rshackle_{side}", s * 0.46, RY + 0.022, RZ1 - 0.09, -1, drop=0.12)
        # bolts on the lamp-box faces
        for x in (0.75, 1.10):
            for z in (RZ0 + 0.02, RZ1 - 0.02):
                cu.bolt_y(f"rbox_bolt_{side}", s * x, R_FACE - 0.004, z, r=0.010, h=0.008)
        # brackets up to the rail ends and the lower bar hangers
        cu.box_mm(f"rbar_bracket_{side}", (s * L.RAIL_X - 0.07, R_FACE + 0.05, RZ1 - 0.05),
                  (s * L.RAIL_X + 0.07, R_BACK + 0.10, L.RAIL_Z[1]), bev=0.006, seg=2)
        cu.box_mm(f"rlow_hanger_{side}", (s * 0.56 - 0.03, R_FACE + 0.04, 0.70),
                  (s * 0.56 + 0.03, R_FACE + 0.14, RZ0 + 0.07), bev=0.004, seg=2)
    # towing pintle: mounting plate, body, hook with the latch
    py = RY
    cu.box_mm("pintle_plate", (-0.13, R_FACE - 0.012, RZ0 + 0.02), (0.13, R_FACE, RZ0 + 0.20),
              bev=0.005, seg=2, mat="steel")
    for dx in (-0.10, 0.10):
        for dz in (0.05, 0.17):
            cu.bolt_y("pintle_plate_bolt", dx, R_FACE - 0.016, RZ0 + dz, r=0.011, h=0.008)
    cu.cyl("pintle_body", 0.045, R_FACE - 0.012 - (py + 0.006), (0, (R_FACE - 0.012 + py + 0.006) / 2, RZ0 + 0.11),
           rot=(HALF_PI, 0, 0), verts=24, mat="steel", bev=0.004, seg=2)
    hook = [(0, py + 0.03, RZ0 + 0.13), (0, py + 0.025, RZ0 + 0.08), (0, py + 0.03, RZ0 + 0.035),
            (0, py + 0.06, RZ0 + 0.015), (0, py + 0.09, RZ0 + 0.03)]
    cu.hose("pintle_hook", hook, 0.022, mat="steel", segs=12, per=5)
    cu.box("pintle_latch", (0.03, 0.04, 0.05), (0, py + 0.035, RZ0 + 0.17), mat="steel",
           bev=0.004, seg=1, rot=(math.radians(25), 0, 0))
    # lower channel bar (photo: below the bumper, tyre-hub height)
    cu.box_mm("rlow_bar", (-0.80, R_FACE + 0.02, 0.70), (0.80, R_FACE + 0.10, 0.79), bev=0.006, seg=2)
    cu.box_mm("rlow_bar_lip", (-0.80, R_FACE + 0.02, 0.785), (0.80, R_FACE + 0.12, 0.795),
              bev=0.002, seg=1)
    # trailer connector and air couplings under the beam
    cu.cyl("r_trailer_socket", 0.036, 0.06, (0.24, R_FACE - 0.01, RZ0 + 0.10),
           rot=(HALF_PI, 0, 0), verts=20, mat="steel_dark", bev=0.003, seg=1)
    for x, m in ((-0.22, "lens_red"), (-0.30, "steel")):
        cu.cyl(f"r_gladhand_{m}", 0.024, 0.05, (x, R_FACE - 0.01, RZ0 + 0.10),
               rot=(HALF_PI, 0, 0), verts=16, mat=m)
    cu.hose("r_lamp_cable", [(0.24, R_FACE + 0.02, RZ0 + 0.10), (0.35, R_FACE + 0.10, RZ0 + 0.04),
                             (0.60, R_FACE + 0.16, RZ0 + 0.08), (0.80, R_FACE + 0.12, RZ1 - 0.12)],
            0.009, segs=8)


def build():
    _front_bar()
    _front_guard()
    _rear_bumper()
