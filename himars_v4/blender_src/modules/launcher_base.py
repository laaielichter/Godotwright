"""Fixed launcher base on the chassis rails (hr_node 'Body'), v4.

The stepped, bolted subframe on the rails over the rear tandem: outboard doubler beams on the
rail faces, cross members between the rails under the turntable, outrigger gussets carrying the
fixed race ring (lower bearing ring) at layout.TURNTABLE, the rear travel support pads under the
rotating platform and the front pod rest that the cradle sits on when stowed. The chassis rails,
rear bumper and lamps are built by the chassis module, not here.
"""
import math

import launcher_util as lu
import layout as L

NODE = "Body"
YC, ZT = L.TURNTABLE["y"], L.TURNTABLE["z"]
RZ0, RZ1 = L.RAIL_Z
XO = L.RAIL_X + 0.05            # rail outer face (estimate; FMTV rail ~0.10 wide)
OD, STEEL = "paint_od", "steel"


def _race():
    ring = lu.revolve("race_ring", lu.rrect(0.78, 0.98, 0.0, 0.02, 0.004, 1), (0.0, YC, ZT), (0, 0, 1), OD,
                      NODE, segs=96, closed=True)
    ring["tt_ring"] = 1
    for k in range(32):
        th = math.tau * k / 32
        lu.bolt("race_bolt", (math.cos(th) * 0.965, YC + math.sin(th) * 0.965, ZT + 0.02), (0, 0, 1), 0.009, 0.008,
                STEEL, NODE)


def _subframe():
    for sx in (1, -1):
        # stepped doubler beam on the rail outer face: deeper under the turntable
        lu.box("sub_doubler", (sx * (XO + 0.015), -1.85, (RZ0 + RZ1) / 2), (0.03, 2.90, RZ1 - RZ0), OD, NODE,
               bev=0.004)
        lu.box("sub_doubler_deep", (sx * (XO + 0.015), YC, RZ0 - 0.05), (0.03, 1.30, 0.10), OD, NODE, bev=0.004)
        for row, z in enumerate((RZ0 + 0.03, RZ1 - 0.03)):
            for i in range(24):
                y = -3.25 + i * 0.12
                lu.bolt("sub_bolt", (sx * (XO + 0.03), y, z), (sx, 0, 0), 0.009, 0.007, STEEL, NODE)
        # outrigger gussets under the race ring, outboard of the rails (inside the tyres)
        for y in (YC - 0.55, YC, YC + 0.55):
            lu.box("sub_gusset", (sx * (XO + 0.16), y, ZT - 0.04), (0.29, 0.016, 0.08), OD, NODE, bev=0.003)
            lu.box("sub_gusset_flange", (sx * (XO + 0.16), y, ZT - 0.006), (0.29, 0.07, 0.012), OD, NODE)
    # cross members between the rails
    for y in (-3.20, YC - 0.55, YC, YC + 0.55, -0.40):
        lu.box("sub_cross", (0.0, y, ZT - 0.06), (2 * (L.RAIL_X - 0.05), 0.08, 0.11), OD, NODE, bev=0.004)


def _supports():
    # rear travel support pads under the rotating platform beams
    for sx in (1, -1):
        lu.box("travel_pad", (sx * 0.42, -3.185, ZT + 0.026), (0.12, 0.13, 0.052), OD, NODE, bev=0.004)
    # front pod rest: two pedestals with rubber pads under the cradle beams, tied together
    for sx in (1, -1):
        lu.box("front_rest", (sx * 0.38, 0.25, (ZT + 1.392) / 2), (0.12, 0.16, 1.392 - ZT), OD, NODE, bev=0.005)
        lu.box("front_rest_pad", (sx * 0.38, 0.25, 1.396), (0.11, 0.14, 0.008), "rubber", NODE)
        lu.box("front_rest_gusset", (sx * 0.38, 0.15, ZT + 0.04), (0.014, 0.08, 0.08), OD, NODE)
    lu.box("front_rest_tie", (0.0, 0.25, ZT + 0.025), (0.64, 0.10, 0.05), OD, NODE, bev=0.004)
    # travel lock hook on the tie
    lu.box("travel_lock", (0.0, 0.25, ZT + 0.07), (0.06, 0.10, 0.06), STEEL, NODE, bev=0.004)


def build():
    _race()
    _subframe()
    _supports()
