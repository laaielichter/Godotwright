"""Powertrain between the rails: Caterpillar C7 style inline-6 behind the front axle, the
automatic transmission and transfer case behind it, three propeller shafts with yokes and
cardan crosses (front, middle, inter-axle), the exhaust with muffler and tail pipe on the
right, and the duct from the air-intake box down to the engine. Under the cab (Y > cab rear
wall) everything stays below the cab body bottom (Z 1.0)."""
import math

import chassis_util as cu
from chassis_util import layout as L

HALF_PI = math.pi / 2
AZ = L.AXLE_Z
CAB_REAR = L.CAB["rear_y"]
CAB_BOT = L.CAB["body_bottom_z"]
ENG_Y = (0.78, 1.58)               # block, behind the cab rear wall
ENG_Z = (0.72, 1.20)
PZ = AZ + 0.03                     # pinion flange height
F_PIN = (0.0, L.AXLE_Y["F"] - 0.285, PZ)
M_PIN_F = (0.0, L.AXLE_Y["M"] + 0.285, PZ)
M_PIN_R = (0.0, L.AXLE_Y["M"] - 0.285, PZ)
R_PIN = (0.0, L.AXLE_Y["R"] + 0.285, PZ)
TC_Y = (0.02, 0.40)
TC_FRONT = (0.0, TC_Y[1] + 0.03, 0.50)
TC_REAR = (0.0, TC_Y[0] - 0.03, 0.56)


def _shaft(base, p0, p1, r=0.042):
    """Propeller shaft between two flange points: tube, slip joint, yokes and cardan crosses."""
    a = [p0[i] for i in range(3)]
    b = [p1[i] for i in range(3)]
    d = [b[i] - a[i] for i in range(3)]
    ln = math.sqrt(sum(c * c for c in d))
    u = [c / ln for c in d]

    def at(t):
        return tuple(a[i] + u[i] * t for i in range(3))
    cu.rod(base + "_tube", at(0.10), at(ln - 0.10), r, verts=20, mat="steel_dark", bev=0.003)
    cu.rod(base + "_slip", at(0.10), at(0.30), r + 0.012, verts=20, mat="steel", bev=0.003)
    for t0, t1, tq in ((0.0, 0.03, 0.06), (ln - 0.03, ln, ln - 0.06)):
        cu.rod(base + "_flange", at(t0), at(t1), 0.075, verts=24, mat="steel")
        q = at(tq)
        cu.cyl_x(base + "_cross", 0.013, q[0] - 0.06, q[0] + 0.06, q[1], q[2], verts=10)
        for k in (-1, 1):
            cu.box(base + "_yoke", (0.02, 0.06, 0.07), (q[0] + k * 0.055, q[1], q[2]), mat="steel",
                   bev=0.004, seg=1)


def _engine():
    y0, y1 = ENG_Y
    z0, z1 = ENG_Z
    yc = (y0 + y1) / 2
    cu.box_mm("engine_block", (-0.24, y0, z0), (0.24, y1, z1 - 0.12), mat="steel_dark", bev=0.02, seg=2)
    cu.box_mm("engine_head", (-0.22, y0 + 0.02, z1 - 0.13), (0.22, y1 - 0.02, z1 - 0.04),
              mat="steel_dark", bev=0.012, seg=2)
    cu.box_mm("valve_cover", (-0.19, y0 + 0.05, z1 - 0.05), (0.19, y1 - 0.05, z1), mat="paint_od",
              bev=0.012, seg=2)
    for k in range(6):
        cu.bolt_z("valve_cover_bolt", 0.0, y0 + 0.10 + k * 0.12, z1, r=0.012, h=0.01)
    cu.box_mm("oil_pan", (-0.19, y0 + 0.04, 0.64), (0.19, y1 - 0.04, z0 + 0.02), mat="steel_dark",
              bev=0.015, seg=2)
    # exhaust manifold (right) with turbo; intake manifold and fuel rail (left)
    cu.cyl_y("exhaust_manifold", 0.04, y0 + 0.05, y1 - 0.05, 0.27, z1 - 0.20, verts=16, mat="steel_dark")
    for k in range(6):
        cu.cyl_x("exh_runner", 0.028, 0.22, 0.28, y0 + 0.10 + k * 0.12, z1 - 0.20, verts=12,
                 mat="steel_dark")
    cu.cyl_y("turbo", 0.085, y1 - 0.30, y1 - 0.12, 0.29, z1 - 0.04, verts=28, mat="steel", bev=0.01)
    cu.box_mm("intake_manifold", (-0.33, y0 + 0.05, z1 - 0.26), (-0.24, y1 - 0.05, z1 - 0.12),
              mat="steel_dark", bev=0.012, seg=2)
    cu.cyl_y("fuel_rail", 0.014, y0 + 0.05, y1 - 0.05, -0.26, z1 - 0.07, verts=10)
    for k in range(6):
        cu.hose("injector_line", [(-0.26, y0 + 0.10 + k * 0.12, z1 - 0.07),
                                  (-0.18, y0 + 0.10 + k * 0.12, z1 - 0.02),
                                  (-0.08, y0 + 0.10 + k * 0.12, z1 + 0.005)], 0.005, mat="steel", segs=6, per=3)
    cu.cyl_x("starter", 0.06, -0.38, -0.22, y0 + 0.08, z0 + 0.10, verts=20, mat="steel_dark", bev=0.006)
    cu.cyl_y("oil_filter", 0.055, yc - 0.07, yc + 0.07, -0.30, z0 + 0.06, verts=20, mat="paint_od", bev=0.006)
    cu.cyl_x("alternator", 0.08, 0.20, 0.34, y1 + 0.02, z0 + 0.20, verts=24, mat="steel", bev=0.008)
    # front cover, damper and fan under the cab floor
    cu.box_mm("front_cover", (-0.22, y1, z0), (0.22, y1 + 0.06, CAB_BOT - 0.03), mat="steel_dark",
              bev=0.012, seg=2)
    cu.cyl_y("damper", 0.12, y1 + 0.06, y1 + 0.11, 0.0, z0 + 0.10, verts=32, mat="steel", bev=0.006)
    for s in (1, -1):
        cu.box_mm("engine_mount", (s * 0.24, yc - 0.06, z0 + 0.05), (s * (L.RAIL_X - 0.045), yc + 0.06, z0 + 0.12),
                  mat="steel", bev=0.006, seg=1)
        cu.box_mm("engine_mount_rubber", (s * 0.25, yc - 0.05, z0 + 0.12), (s * 0.33, yc + 0.05, z0 + 0.18),
                  mat="rubber", bev=0.008, seg=2)
    # coolant hoses towards the front radiator (behind the cab front)
    cu.hose("coolant_upper", [(0.10, y1 + 0.06, CAB_BOT - 0.06), (0.15, y1 + 0.5, CAB_BOT - 0.05),
                              (0.20, L.AXLE_Y["F"] + 0.75, CAB_BOT - 0.04)], 0.032, segs=12)
    cu.hose("coolant_lower", [(-0.12, y1 + 0.06, z0 + 0.05), (-0.20, y1 + 0.4, 0.86),
                              (-0.20, L.AXLE_Y["F"] + 0.75, 0.88)], 0.030, segs=12)
    # radiator lower tank and core bottom, visible behind the front bumper
    ry = L.FRONT_Y - 0.45
    cu.box_mm("radiator_core", (-0.42, ry - 0.04, 0.84), (0.42, ry + 0.04, CAB_BOT - 0.01),
              mat="steel_dark", bev=0.004, seg=1)
    cu.box_mm("radiator_tank", (-0.45, ry - 0.07, 0.80), (0.45, ry + 0.07, 0.86), mat="steel",
              bev=0.010, seg=2)
    for k in range(28):
        x = -0.40 + k * 0.0296
        cu.box_mm("radiator_fin", (x - 0.002, ry + 0.04, 0.86), (x + 0.002, ry + 0.05, CAB_BOT - 0.02),
                  mat="steel", bev=0.0)


def _transmission():
    cu.box_mm("bell_housing", (-0.25, ENG_Y[0] - 0.12, ENG_Z[0] - 0.02), (0.25, ENG_Y[0], ENG_Z[1] - 0.16),
              mat="steel_dark", bev=0.03, seg=2)
    cu.box_mm("transmission", (-0.20, 0.30, 0.70), (0.20, ENG_Y[0] - 0.12, 1.06),
              mat="steel_dark", bev=0.025, seg=2)
    cu.box_mm("trans_pan", (-0.17, TC_Y[1] + 0.01, 0.66), (0.17, ENG_Y[0] - 0.15, 0.71),
              mat="steel_dark", bev=0.008, seg=1)
    for k in range(5):
        cu.bolt_z("trans_pan_bolt", -0.14 + k * 0.07, TC_Y[1] + 0.04, 0.655, r=0.008, h=0.006)
    cu.box_mm("transfer_case", (-0.24, TC_Y[0], 0.40), (0.20, TC_Y[1], 0.72), mat="steel_dark",
              bev=0.03, seg=2)
    cu.cyl_y("tc_front_output", 0.06, TC_Y[1], TC_FRONT[1], 0.0, TC_FRONT[2], verts=20, mat="steel")
    cu.cyl_y("tc_rear_output", 0.06, TC_REAR[1], TC_Y[0], 0.0, TC_REAR[2], verts=20, mat="steel")
    cu.box_mm("tc_shift_motor", (0.10, TC_Y[0] + 0.10, 0.72), (0.20, TC_Y[0] + 0.22, 0.80), mat="steel",
              bev=0.008, seg=1)
    for s in (1, -1):
        cu.box_mm("tc_hanger", (s * 0.20 if s > 0 else -0.30, TC_Y[0] + 0.12, 0.62),
                  (0.30 if s > 0 else -0.20, TC_Y[0] + 0.24, L.RAIL_Z[0]), mat="paint_od", bev=0.006, seg=1)
    cu.hose("trans_cooler_line_a", [(0.20, ENG_Y[0] - 0.3, 0.95), (0.30, ENG_Y[0], 1.0),
                                    (0.32, ENG_Y[1], 1.02)], 0.010, segs=8)
    cu.hose("trans_cooler_line_b", [(0.20, ENG_Y[0] - 0.3, 0.90), (0.31, ENG_Y[0], 0.96),
                                    (0.33, ENG_Y[1], 0.98)], 0.010, segs=8)


def _driveline():
    _shaft("prop_front", TC_FRONT, F_PIN, r=0.045)
    _shaft("prop_mid", TC_REAR, M_PIN_F, r=0.045)
    _shaft("prop_inter", M_PIN_R, R_PIN, r=0.040)
    # centre bearing on the long front shaft
    mid = [(TC_FRONT[i] + F_PIN[i]) / 2 for i in range(3)]
    cu.cyl_y("carrier_bearing", 0.065, mid[1] - 0.04, mid[1] + 0.04, mid[0], mid[2], verts=20,
             mat="rubber", bev=0.008)


def _exhaust():
    # turbo outlet, down pipe, muffler under the right rail and the tail pipe turned down
    y1 = ENG_Y[1]
    pts = [(0.29, y1 - 0.21, ENG_Z[1] - 0.12), (0.31, y1 - 0.35, 1.0), (0.31, ENG_Y[0], 0.86),
           (0.28, 0.30, 0.82), (0.26, 0.0, 0.82)]
    cu.hose("exhaust_pipe", pts, 0.050, mat="steel_dark", segs=16)
    cu.cyl_y("muffler", 0.16, -0.62, -0.01, 0.25, 0.82, verts=36, mat="steel_dark", bev=0.02, seg=2)
    for y in (-0.52, -0.10):
        cu.torus("muffler_band", 0.163, 0.008, (0.25, y, 0.82), rot=(HALF_PI, 0, 0), major_seg=36,
                 minor_seg=6)
        cu.box_mm("muffler_hanger", (0.22, y - 0.02, 0.97), (0.28, y + 0.02, L.RAIL_Z[0]), mat="steel",
                  bev=0.003, seg=1)
    cu.hose("tail_pipe", [(0.25, -0.62, 0.82), (0.30, -0.72, 0.80), (0.50, -0.76, 0.70),
                          (0.56, -0.76, 0.58)], 0.045, mat="steel_dark", segs=14)
    cu.tube("tail_pipe_tip", 0.050, 0.040, 0.06, (0.56, -0.76, 0.57), segments=16, mat="steel_dark")


def _intake_duct():
    ib = L.INTAKE_BOX
    # air cleaner outlet under the intake box down to the turbo inlet
    y0 = ib["y"][0] + 0.20
    cu.hose("intake_duct", [(0.28, y0, ib["z"][0] + 0.02), (0.28, y0 + 0.10, 1.25),
                            (0.29, ENG_Y[1] - 0.48, 1.18), (0.29, ENG_Y[1] - 0.32, ENG_Z[1] - 0.04)],
            0.060, mat="hose", segs=16)
    cu.torus("intake_clamp", 0.063, 0.006, (0.28, y0, ib["z"][0] - 0.01), major_seg=24, minor_seg=6)


def build():
    _engine()
    _transmission()
    _driveline()
    _exhaust()
    _intake_duct()
