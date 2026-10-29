"""Three drive axles at layout.AXLE_Y (front, middle, rear tandem), centre height layout.AXLE_Z:
axle tubes, differential carriers with pinion housings and cover plates, wheel-end hubs with
brake drums and air brake chambers, CTIS lines; parabolic leaf springs under the rails with
hangers, shackles, U-bolts and bump stops; shock absorbers from the axle up to brackets on the
rail web; front steering (knuckles, tie rod, drag link, steering gear); tandem torque rods."""
import math

import chassis_util as cu
from chassis_util import layout as L

HALF_PI = math.pi / 2
AZ = L.AXLE_Z
TUBE_R = 0.075
RX = L.RAIL_X
RAIL_BOT = L.RAIL_Z[0]
# (tag, pinion directions: +1 input faces front, -1 faces rear)
AXLES = [("F", [-1]), ("M", [1, -1]), ("R", [1])]
SPRING_HALF = {"F": 0.70, "M": 0.52, "R": 0.52}
SPRING_AMP = 0.12
LEAF_T = 0.011
LEAF_W = 0.090
N_LEAVES = 5
SHOCK_X = 0.645
WHEEL_IN = L.TRACK_HALF - 0.178          # inner face of the rim barrel


def _axle(tag, y, pinions):
    for s, side in cu.SIDES:
        cu.cyl_x(f"axle_tube_{tag}_{side}", TUBE_R, s * 0.16, s * 0.70, y, AZ, verts=32,
                 bev=0.004, seg=2)
        cu.cyl_x(f"axle_flange_{tag}_{side}", 0.115, s * 0.68, s * 0.71, y, AZ, verts=32,
                 bev=0.004, seg=2)
        for j in range(8):
            a = j * math.pi / 4 + math.pi / 8
            cu.bolt_x(f"axle_flange_bolt_{tag}_{side}", s * 0.665, y + 0.095 * math.cos(a),
                      AZ + 0.095 * math.sin(a), r=0.009, h=0.008)
        # wheel end: brake dust shield, drum and hub inside the rim
        cu.cyl_x(f"dust_shield_{tag}_{side}", 0.215, s * 0.71, s * 0.725, y, AZ, verts=40,
                 mat="steel_dark", bev=0.003, seg=1)
        cu.cyl_x(f"brake_drum_{tag}_{side}", 0.205, s * 0.725, s * (WHEEL_IN + 0.01), y, AZ,
                 verts=40, mat="steel_dark", bev=0.008, seg=2)
        for j in range(6):   # drum cooling ribs
            cu.cyl_x(f"drum_rib_{tag}_{side}", 0.212, s * (0.74 + j * 0.017),
                     s * (0.746 + j * 0.017), y, AZ, verts=40, mat="steel_dark")
        # air brake chamber behind the axle with pushrod and slack adjuster
        cy = y - 0.17
        cu.cyl_y(f"brake_chamber_{tag}_{side}", 0.072, cy - 0.10, cy + 0.02, s * 0.56, AZ + 0.08,
                 verts=28, mat="steel_dark", bev=0.008, seg=2)
        cu.torus(f"chamber_clamp_{tag}_{side}", 0.074, 0.007, (s * 0.56, cy - 0.04, AZ + 0.08),
                 rot=(HALF_PI, 0, 0), major_seg=28, minor_seg=6)
        if tag != "F":   # spring brake piggyback on the tandem
            cu.cyl_y(f"spring_brake_{tag}_{side}", 0.072, cy - 0.20, cy - 0.10, s * 0.56, AZ + 0.08,
                     verts=28, mat="steel_dark", bev=0.008, seg=2)
        cu.rod(f"pushrod_{tag}_{side}", (s * 0.56, cy + 0.02, AZ + 0.08), (s * 0.60, y - 0.06, AZ + 0.02),
               0.008, verts=8)
        cu.box(f"slack_adj_{tag}_{side}", (0.025, 0.05, 0.14), (s * 0.61, y - 0.06, AZ - 0.02),
               mat="steel", bev=0.004, seg=1)
        cu.box(f"chamber_bracket_{tag}_{side}", (0.10, 0.10, 0.012), (s * 0.56, cy - 0.01, AZ + 0.01),
               mat="steel", bev=0.003, seg=1)
        # brake hose from the chamber up to the frame, and the CTIS air line to the hub
        cu.hose(f"brake_hose_{tag}_{side}", [(s * 0.56, cy - 0.04, AZ + 0.15),
                                             (s * 0.53, cy - 0.10, AZ + 0.32),
                                             (s * 0.50, cy - 0.12, RAIL_BOT - 0.04)], 0.010, segs=8)
        cu.hose(f"ctis_line_{tag}_{side}", [(s * 0.18, y + 0.06, AZ + 0.07), (s * 0.45, y + 0.07, AZ + 0.075),
                                            (s * 0.66, y + 0.07, AZ + 0.08),
                                            (s * 0.73, y + 0.05, AZ + 0.17)], 0.007, segs=8)
    # differential carrier
    cu.sphere(f"diff_carrier_{tag}", 1.0, (0, y, AZ), scale=(0.20, 0.19, 0.21), mat="paint_od",
              segments=32, rings=16)
    cu.torus(f"diff_seam_{tag}", 0.195, 0.010, (0, y, AZ), rot=(0, HALF_PI, 0), mat="paint_od",
             major_seg=40, minor_seg=8)
    for k, d in enumerate(pinions):
        big = d == pinions[0]
        r0 = 0.11 if big else 0.085
        prof = [(0.0, 0.10), (r0, 0.10), (r0 * 0.8, 0.22), (0.075, 0.25), (0.075, 0.27), (0.0, 0.27)]
        cu.lathe(f"pinion_housing_{tag}_{k}", prof, (0, y, AZ + 0.03),
                 rot=(-HALF_PI * d, 0, 0), segments=32, mat="paint_od")
        fy = y + d * 0.285
        cu.cyl_y(f"pinion_flange_{tag}_{k}", 0.085, fy - 0.012, fy + 0.012, 0, AZ + 0.03, verts=32,
                 mat="steel", bev=0.003, seg=1)
        for j in range(8):
            a = j * math.pi / 4
            cu.bolt_y(f"pinion_bolt_{tag}_{k}", 0.065 * math.cos(a), fy + d * 0.014,
                      AZ + 0.03 + 0.065 * math.sin(a), r=0.007, h=0.006)
    # cover plate with bolt ring on the face without a pinion
    if len(pinions) == 1:
        d = -pinions[0]
        cy = y + d * 0.17
        cu.cyl_y(f"diff_cover_{tag}", 0.15, cy - 0.025, cy + 0.025, 0, AZ, verts=40, mat="paint_od",
                 bev=0.008, seg=2)
        for j in range(12):
            a = j * math.pi / 6
            cu.bolt_y(f"diff_cover_bolt_{tag}", 0.135 * math.cos(a), cy + d * 0.028,
                      AZ + 0.135 * math.sin(a), r=0.008, h=0.006)
        cu.cyl_y(f"diff_drain_{tag}", 0.018, cy, cy + d * 0.04, 0, AZ - 0.10, verts=6)
    # breather with hose up to the frame
    cu.cyl_z(f"breather_{tag}", 0.012, AZ + 0.19, AZ + 0.25, 0.08, y, verts=12)
    cu.hose(f"breather_hose_{tag}", [(0.08, y, AZ + 0.25), (0.10, y + 0.05, AZ + 0.40),
                                     (0.30, y + 0.08, RAIL_BOT - 0.02)], 0.008, segs=8)


def _leaf_spring(tag, y, s):
    """Parabolic leaf pack under the rail: longest leaf on top with eyes, clamp, U-bolts,
    front hanger, rear shackle and a bump stop under the rail."""
    x = s * RX
    half = SPRING_HALF[tag]
    seat_top = AZ + TUBE_R + 0.008
    cu.box(f"spring_seat_{tag}", (0.13, 0.24, 0.02), (x, y, seat_top - 0.005), mat="steel",
           bev=0.004, seg=1)
    cu.box(f"spring_spacer_{tag}", (0.10, 0.16, 0.05), (x, y, seat_top + 0.03), mat="steel",
           bev=0.004, seg=1)
    z_bot = seat_top + 0.055
    for i in range(N_LEAVES):
        zc = z_bot + LEAF_T * (N_LEAVES - i - 0.5)
        hl = half * (1.0 - 0.16 * i)
        n = 18
        pts = []
        for k in range(n + 1):
            t = -hl + 2 * hl * k / n
            pts.append((y + t, zc + SPRING_AMP * (t / half) ** 2))
        cu.strip_yz(f"leaf_{tag}_{i}", pts, LEAF_W, LEAF_T * 0.96, x, mat="steel")
    z_top = z_bot + LEAF_T * N_LEAVES
    z_eye = z_top - LEAF_T / 2 + SPRING_AMP + 0.02
    for e in (-1, 1):
        ye = y + e * half
        cu.tube(f"spring_eye_{tag}", 0.034, 0.016, LEAF_W, (x, ye + e * 0.01, z_eye),
                rot=(0, HALF_PI, 0), segments=20)
        cu.cyl_x(f"spring_pin_{tag}", 0.016, x - 0.075, x + 0.075, ye + e * 0.01, z_eye, verts=12)
        if e > 0:   # fixed hanger
            cu.box_mm(f"spring_hanger_{tag}", (x - 0.075, ye - 0.05, z_eye - 0.03),
                      (x + 0.075, ye + 0.07, RAIL_BOT), mat="paint_od", bev=0.006, seg=2)
        else:       # shackle links to a short hanger
            cu.box_mm(f"shackle_hanger_{tag}", (x - 0.075, ye - 0.07, z_eye + 0.08),
                      (x + 0.075, ye + 0.04, RAIL_BOT), mat="paint_od", bev=0.006, seg=2)
            for k in (-1, 1):
                cu.rod(f"shackle_link_{tag}", (x + k * 0.062, ye - 0.01, z_eye),
                       (x + k * 0.062, ye - 0.03, z_eye + 0.11), 0.016, verts=10)
        for k in (-1, 1):
            cu.bolt_x(f"hanger_bolt_{tag}", x + k * 0.08, ye, z_eye + 0.10, r=0.012, h=0.008)
    # centre clamp, U-bolts and bottom plate
    cu.box(f"spring_clamp_{tag}", (0.12, 0.20, 0.022), (x, y, z_top + 0.011), mat="steel",
           bev=0.004, seg=1)
    bot = AZ - TUBE_R - 0.012
    cu.box(f"ubolt_plate_{tag}", (0.17, 0.20, 0.022), (x, y, bot), mat="steel", bev=0.004, seg=1)
    for dx in (-0.068, 0.068):
        for dy in (-0.075, 0.075):
            cu.cyl_z(f"ubolt_{tag}", 0.011, bot, z_top + 0.045, x + dx, y + dy, verts=10)
            cu.bolt_z(f"ubolt_nut_{tag}", x + dx, y + dy, z_top + 0.03, r=0.017, h=0.016)
            cu.bolt_z(f"ubolt_nut_lo_{tag}", x + dx, y + dy, bot - 0.016, r=0.017, h=0.014)
    # bump stop under the rail
    cu.box_mm(f"bump_bracket_{tag}", (x - 0.07, y - 0.08, RAIL_BOT - 0.03), (x + 0.07, y + 0.08, RAIL_BOT),
              mat="paint_od", bev=0.004, seg=1)
    cu.box_mm(f"bump_stop_{tag}", (x - 0.05, y - 0.06, RAIL_BOT - 0.10), (x + 0.05, y + 0.06, RAIL_BOT - 0.03),
              mat="rubber", bev=0.010, seg=2)


def _shock(tag, y, s):
    xs = s * SHOCK_X
    d = 1 if tag == "F" else (1 if tag == "M" else -1)
    a = (xs, y + d * 0.14, AZ + 0.02)
    b = (xs, y + d * 0.30, RAIL_BOT + 0.07)
    cu.box(f"shock_low_bracket_{tag}", (0.10, 0.17, 0.05), (s * (SHOCK_X - 0.04), y + d * 0.09, AZ + 0.02),
           mat="steel", bev=0.005, seg=2)
    cu.cyl_x(f"shock_low_eye_{tag}", 0.030, xs - 0.035, xs + 0.035, a[1], a[2], verts=16)
    cu.cyl_x(f"shock_up_eye_{tag}", 0.030, xs - 0.035, xs + 0.035, b[1], b[2], verts=16)
    ax = [a[i] + (b[i] - a[i]) * 0.08 for i in range(3)]
    am = [a[i] + (b[i] - a[i]) * 0.62 for i in range(3)]
    bm = [a[i] + (b[i] - a[i]) * 0.48 for i in range(3)]
    bx = [a[i] + (b[i] - a[i]) * 0.92 for i in range(3)]
    cu.rod(f"shock_body_{tag}", ax, am, 0.038, verts=20, mat="steel_dark", bev=0.004)
    cu.rod(f"shock_cover_{tag}", bm, bx, 0.047, verts=20, mat="steel_dark", bev=0.004)
    cu.rod(f"shock_rod_{tag}", am, bm, 0.016, verts=12, mat="chrome")
    # upper bracket bolted to the rail outer web
    xo = L.RAIL_X + 0.045
    cu.box_mm(f"shock_up_bracket_{tag}", (min(s * xo, xs + s * 0.04), b[1] - 0.06, b[2] - 0.05),
              (max(s * xo, xs + s * 0.04), b[1] + 0.06, L.RAIL_Z[1] - 0.02), mat="paint_od",
              bev=0.005, seg=2)
    for dz in (0.03, 0.10):
        cu.bolt_x(f"shock_up_bolt_{tag}", s * (xo + 0.004), b[1], b[2] + dz, r=0.011, h=0.008)


def _steering():
    y = L.AXLE_Y["F"]
    for s, side in cu.SIDES:
        x = s * 0.745
        cu.cyl_z(f"kingpin_{side}", 0.062, AZ - 0.17, AZ + 0.17, x, y, verts=24, bev=0.006)
        cu.cyl_z(f"kingpin_cap_{side}", 0.050, AZ + 0.17, AZ + 0.20, x, y, verts=20, bev=0.004)
        cu.box(f"steer_arm_{side}", (0.04, 0.20, 0.05), (x - s * 0.02, y - 0.12, AZ - 0.10),
               mat="steel", bev=0.006, seg=2)
    tr_y = y - 0.21
    cu.cyl_x("tie_rod", 0.022, -0.70, 0.70, tr_y, AZ - 0.10, verts=16)
    for s in (1, -1):
        cu.sphere("tie_rod_end", 0.035, (s * 0.72, tr_y, AZ - 0.10), segments=16, rings=8)
    # steering gear on the left rail web, pitman arm and drag link to the left knuckle
    gx = -(L.RAIL_X + 0.045 + 0.08)
    gy = y + 0.62
    cu.box("steering_gear", (0.15, 0.22, 0.17), (gx, gy, RAIL_BOT + 0.02), mat="steel_dark",
           bev=0.012, seg=2)
    cu.cyl_x("steering_gear_input", 0.03, gx - 0.02, gx + 0.08, gy + 0.05, RAIL_BOT + 0.12, verts=16)
    cu.box("pitman_arm", (0.035, 0.05, 0.22), (gx - 0.09, gy - 0.03, RAIL_BOT - 0.12), mat="steel",
           bev=0.005, seg=1)
    cu.rod("drag_link", (gx - 0.09, gy - 0.03, RAIL_BOT - 0.22), (-0.77, y + 0.06, AZ + 0.17), 0.022,
           verts=14)
    cu.box("knuckle_arm_top", (0.05, 0.16, 0.04), (-0.77, y + 0.02, AZ + 0.17), mat="steel",
           bev=0.006, seg=1)
    # steering column up into the cab floor
    cu.hose("steering_shaft", [(gx + 0.05, gy + 0.05, RAIL_BOT + 0.12), (gx + 0.07, gy + 0.07, RAIL_BOT + 0.22),
                               (gx + 0.10, gy + 0.10, L.CAB["floor_z"] + 0.03)], 0.02, mat="steel", segs=10, per=4)
    for k in range(4):
        cu.bolt_x("steering_gear_bolt", gx + 0.077, gy - 0.08 + k * 0.05, RAIL_BOT + 0.08, r=0.011)


def _torque_rods():
    ym = (L.AXLE_Y["M"] + L.AXLE_Y["R"]) / 2
    for s, side in cu.SIDES:
        x = s * 0.27
        cu.box_mm(f"torque_bracket_{side}", (x - 0.05, ym - 0.08, AZ + 0.10), (x + 0.05, ym + 0.08, RAIL_BOT),
                  mat="paint_od", bev=0.006, seg=2)
        for tag in ("M", "R"):
            ya = L.AXLE_Y[tag]
            e = 1 if ya > ym else -1
            p0 = (x, ya - e * 0.12, AZ - 0.05)
            p1 = (x, ym + e * 0.06, AZ + 0.16)
            cu.rod(f"torque_rod_{tag}_{side}", p0, p1, 0.028, verts=14, mat="steel")
            for p in (p0, p1):
                cu.cyl_x(f"torque_bush_{tag}", 0.045, x - 0.05, x + 0.05, p[1], p[2], verts=18,
                         mat="steel_dark")
            cu.box(f"torque_axle_bracket_{tag}", (0.08, 0.14, 0.10), (x, ya - e * 0.08, AZ - 0.04),
                   mat="steel", bev=0.005, seg=1)


def build():
    for tag, pinions in AXLES:
        y = L.AXLE_Y[tag]
        _axle(tag, y, pinions)
        for s, _side in cu.SIDES:
            _leaf_spring(tag, y, s)
            _shock(tag, y, s)
    _steering()
    _torque_rods()
