"""Chassis frame: two C-channel rails at layout.RAIL_Z (1.12..1.29) over the full length, nine
cross members with gusset plates, bolt and rivet rows, spring/shock hangers are in
chassis_axles. The rails run from the rear frame end at layout.REAR_Y to the back of the
front bumper."""
import math

import chassis_util as cu
from chassis_util import layout as L

HALF_PI = math.pi / 2
Z0, Z1 = L.RAIL_Z                     # 1.12, 1.29
RX = L.RAIL_X                         # rail centre |X|
FL_W = 0.090                          # flange width
WEB_T = 0.010
FL_T = 0.012
X_OUT = RX + FL_W / 2                 # outboard web face
X_IN = RX - FL_W / 2                  # inboard flange lips
RAIL_Y0 = L.REAR_Y + 0.02             # rear frame end (end plate reaches REAR_Y)
RAIL_Y1 = L.FRONT_Y - 0.25            # back of the front bumper
CROSS_Y = [3.05, 2.72, 1.72, 0.95, 0.15, -0.62, -1.92, -3.00]


def _rails():
    for s, side in cu.SIDES:
        prof = [(X_OUT, Z0), (X_IN, Z0), (X_IN, Z0 + FL_T), (X_OUT - WEB_T, Z0 + FL_T),
                (X_OUT - WEB_T, Z1 - FL_T), (X_IN, Z1 - FL_T), (X_IN, Z1), (X_OUT, Z1)]
        prof = [(s * x, z) for x, z in prof]
        if s < 0:
            prof.reverse()
        cu.prism(f"rail_{side}", prof, RAIL_Y0, RAIL_Y1, mat="paint_od", bev=0.004, seg=2)
        # rear end plate closes the rail at REAR_Y
        cu.box_mm(f"rail_endplate_{side}", (s * RX - 0.06, L.REAR_Y, Z0 - 0.01),
                  (s * RX + 0.06, RAIL_Y0, Z1 + 0.01), bev=0.003, seg=1)


def _bolt_rows():
    for s, side in cu.SIDES:
        x = s * (X_OUT + 0.003)
        n = int((RAIL_Y1 - RAIL_Y0 - 0.3) / 0.22)
        for z in (Z0 + 0.028, Z1 - 0.028):
            cu.rivet_row(f"rail_rivet_{side}_{int(z * 100)}", "x", (x, RAIL_Y0 + 0.15, z),
                         (x, RAIL_Y1 - 0.15, z), n, r=0.009)
        # bolt clusters where each cross member meets the web
        for j, y in enumerate(CROSS_Y):
            for dy in (-0.045, 0.045):
                for z in (Z0 + 0.06, Z1 - 0.06):
                    cu.bolt_x(f"cm_bolt_{side}_{j}", x + s * 0.002, y + dy, z, r=0.012, h=0.009)


def _cross_members():
    w = 2 * (X_OUT - WEB_T)
    zc = (Z0 + Z1) / 2
    h = Z1 - Z0 - 2 * FL_T - 0.004
    for i, y in enumerate(CROSS_Y):
        # C channel: web in the XZ plane plus two flanges
        cu.box(f"cross_web_{i}", (w, 0.010, h), (0, y, zc), bev=0.003, seg=1)
        for z in (zc - h / 2 + 0.005, zc + h / 2 - 0.005):
            cu.box(f"cross_flg_{i}", (w, 0.075, 0.010), (0, y - 0.03, z), bev=0.003, seg=1)
        for s, side in cu.SIDES:
            # gusset plate against the web inner face
            cu.box(f"gusset_{side}_{i}", (0.010, 0.17, h), (s * (X_OUT - WEB_T - 0.006), y, zc),
                   bev=0.003, seg=1)
            for dx in (0.10, 0.20):
                cu.bolt_y(f"cross_bolt_{side}_{i}", s * (X_IN - dx + 0.04), y + 0.008, zc,
                          r=0.009, h=0.006)


def _end_tie():
    # heavy rear cross tube between the rail ends, carries the bumper and pintle
    cu.box_mm("rear_tie", (-X_OUT, RAIL_Y0 + 0.02, Z0 + 0.02), (X_OUT, RAIL_Y0 + 0.14, Z1 - 0.02),
              bev=0.006, seg=2)


def build():
    _rails()
    _cross_members()
    _bolt_rows()
    _end_tie()
