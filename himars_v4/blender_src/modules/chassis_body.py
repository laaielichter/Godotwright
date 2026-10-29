"""Chassis body parts (photos 5619346, 8996787, 8391598):
- flat steel fender plates over the front wheels only (no arches), with the sloped front plate,
  inner splash plate, brackets and a black mud flap behind each front wheel;
- hanging two-tread steps ahead of each front wheel, up to the door sill;
- on both frame sides between the front and middle wheels: a stowage box with a sloped lid and
  round port (rear) and a rounded tank with straps and filler cap (front; fuel on the left);
  battery / tool boxes above the tank fronts;
- between cab and pod: the right-side air-intake box (layout.INTAKE_BOX) with louvres and a
  tall rear section, the black air-intake stack on it, and a stowage box on the left;
- air tanks, air and brake lines, the wiring loom, fuel and battery cables.
No fenders over the rear tandem."""
import math

import chassis_util as cu
from chassis_util import layout as L

HALF_PI = math.pi / 2
RX = L.RAIL_X
X_WEB = RX + 0.045                    # outboard rail web face
RZ0, RZ1 = L.RAIL_Z
YF = L.AXLE_Y["F"]
TR = L.TYRE_R
W_OUT = L.WIDTH_HALF - 0.02           # outermost body X (inside the tyre width)
FENDER_Z = 1.40
FENDER_Y = (YF - TR - 0.08, YF + 0.47)
STEP_Y = (YF + TR + 0.06, YF + TR + 0.28)
BOX_Y = (L.AXLE_Y["M"] + TR + 0.04, 0.42)
TANK_Y = (0.47, FENDER_Y[0] - 0.02)
SIDE_X = (0.53, 1.08)


def _sx(s, a, b):
    """Return (min, max) of s*a and s*b."""
    return (min(s * a, s * b), max(s * a, s * b))


def _fenders():
    for s, side in cu.SIDES:
        x0, x1 = _sx(s, 0.80, W_OUT)
        y0, y1 = FENDER_Y
        cu.box_mm(f"fender_plate_{side}", (x0, y0, FENDER_Z), (x1, y1, FENDER_Z + 0.015), bev=0.004, seg=2)
        # outer down-turned lip
        xl0, xl1 = _sx(s, W_OUT - 0.014, W_OUT)
        cu.box_mm(f"fender_lip_{side}", (xl0, y0, FENDER_Z - 0.07), (xl1, y1, FENDER_Z + 0.015),
                  bev=0.003, seg=1)
        # sloped front plate down towards the bumper / step
        zb = 1.02
        yb = STEP_Y[0] + 0.02
        prof = [(y1, FENDER_Z + 0.015), (y1 + 0.02, FENDER_Z - 0.005), (yb + 0.015, zb), (yb - 0.005, zb + 0.012)]
        cu.prism_x(f"fender_slope_{side}", prof, x0, x1, bev=0.003, seg=1)
        # inner splash plate and two brackets to the rail
        xi0, xi1 = _sx(s, 0.79, 0.80)
        cu.box_mm(f"fender_inner_{side}", (xi0, y0, RZ0 + 0.05), (xi1, y1, FENDER_Z), bev=0.003, seg=1)
        for yb_ in (y0 + 0.15, y1 - 0.15):
            bx0, bx1 = _sx(s, X_WEB, 0.80)
            cu.box_mm(f"fender_bracket_{side}", (bx0, yb_ - 0.03, RZ0 + 0.06), (bx1, yb_ + 0.03, RZ0 + 0.14),
                      bev=0.004, seg=1)
            cu.rod(f"fender_strut_{side}", (s * X_WEB, yb_, RZ0 + 0.02), (s * 0.79, yb_, FENDER_Z - 0.01),
                   0.014, verts=10)
        cu.rivet_row(f"fender_rivets_{side}", "x", (s * (W_OUT + 0.002), y0 + 0.05, FENDER_Z - 0.035),
                     (s * (W_OUT + 0.002), y1 - 0.05, FENDER_Z - 0.035), 9, r=0.007)
        # black rubber mud flap behind the wheel, clamped by a steel strip
        fy = y0 + 0.006
        fx0, fx1 = _sx(s, 0.82, W_OUT - 0.02)
        cu.box_mm(f"mud_flap_{side}", (fx0, fy - 0.006, 0.44), (fx1, fy + 0.006, FENDER_Z), mat="rubber",
                  bev=0.004, seg=1)
        cu.box_mm(f"mud_flap_clamp_{side}", (fx0, fy - 0.014, FENDER_Z - 0.10), (fx1, fy - 0.006, FENDER_Z - 0.04),
                  mat="steel", bev=0.002, seg=1)
        cu.bolt_row(f"mud_flap_bolt_{side}", "y", (s * 0.86, fy - 0.017, FENDER_Z - 0.07),
                    (s * (W_OUT - 0.06), fy - 0.017, FENDER_Z - 0.07), 4)


def _steps():
    y0, y1 = STEP_Y
    for s, side in cu.SIDES:
        x0, x1 = _sx(s, 0.96, W_OUT - 0.04)
        # front and rear hanger plates (stringers)
        for yy in (y0, y1):
            cu.box_mm(f"step_stringer_{side}", (x0, yy - 0.006, 0.56), (x1, yy + 0.006, 1.05),
                      bev=0.003, seg=1)
        # treads: perforated look from raised ribs on a plate
        for z in (0.60, 0.98):
            cu.box_mm(f"step_tread_{side}", (x0, y0, z - 0.012), (x1, y1, z + 0.012), bev=0.004, seg=1)
            for k in range(4):
                xc = s * (0.99 + k * 0.045)
                cu.box(f"step_rib_{side}", (0.012, y1 - y0 - 0.03, 0.006), (xc, (y0 + y1) / 2, z + 0.014),
                       mat="steel_dark", bev=0.0)
        # inner mounting plate up to the frame / sloped fender
        ix0, ix1 = _sx(s, 0.95, 0.96)
        cu.box_mm(f"step_mount_{side}", (ix0, y0, 0.56), (ix1, y1, 1.05), bev=0.003, seg=1)
        bx0, bx1 = _sx(s, X_WEB, 0.95)
        cu.box_mm(f"step_arm_{side}", (bx0, (y0 + y1) / 2 - 0.03, RZ0 - 0.10), (bx1, (y0 + y1) / 2 + 0.03, RZ0 - 0.04),
                  bev=0.004, seg=1)
        cu.rod(f"step_brace_{side}", (s * X_WEB, (y0 + y1) / 2, RZ0 - 0.05), (s * 0.95, (y0 + y1) / 2, 0.70),
               0.014, verts=10)
        for z in (0.62, 0.95):
            cu.bolt_x(f"step_bolt_{side}", s * 0.964, y0 + 0.05, z)
            cu.bolt_x(f"step_bolt_{side}", s * 0.964, y1 - 0.05, z)


def _stowage_box(s, side):
    y0, y1 = BOX_Y
    xi, xo = SIDE_X
    z0, z_out, z_in = 0.66, 1.20, 1.27
    prof = [(s * xi, z0), (s * xo, z0), (s * xo, z_out), (s * xi, z_in)]
    if s < 0:
        prof.reverse()
    cu.prism(f"stow_box_{side}", prof, y0, y1, bev=0.008, seg=2)
    # lid: slightly larger sloped plate with a hinge on the inboard edge
    lid = [(s * (xi - 0.005), z_in - 0.004), (s * (xo + 0.012), z_out - 0.006),
           (s * (xo + 0.012), z_out + 0.014), (s * (xi - 0.005), z_in + 0.016)]
    if s < 0:
        lid.reverse()
    cu.prism(f"stow_lid_{side}", lid, y0 - 0.01, y1 + 0.01, bev=0.004, seg=2)
    cu.cyl_y(f"stow_hinge_{side}", 0.012, y0 + 0.02, y1 - 0.02, s * (xi + 0.01), z_in + 0.02, verts=10)
    # three hasps on the lid's outboard edge
    for k in range(3):
        y = y0 + (y1 - y0) * (0.2 + 0.3 * k)
        cu.box(f"stow_hasp_{side}", (0.012, 0.06, 0.08), (s * (xo + 0.016), y, z_out - 0.02), mat="steel",
               bev=0.003, seg=1)
        cu.box(f"stow_hasp_loop_{side}", (0.02, 0.03, 0.02), (s * (xo + 0.026), y, z_out - 0.05), mat="steel",
               bev=0.003, seg=1)
    # round port near the rear end of the outer face
    cu.cyl_x(f"stow_port_ring_{side}", 0.07, s * xo, s * (xo + 0.012), y0 + 0.20, 0.93, verts=32, bev=0.003)
    cu.cyl_x(f"stow_port_{side}", 0.050, s * xo, s * (xo + 0.016), y0 + 0.20, 0.93, verts=32,
             mat="steel_dark")
    # stiffening beads and bottom rivets
    for z in (0.78, 1.06):
        cu.box_mm(f"stow_bead_{side}", (*_sx(s, xo, xo + 0.006)[:1], y0 + 0.35, z - 0.008),
                  (_sx(s, xo, xo + 0.006)[1], y1 - 0.05, z + 0.008), bev=0.003, seg=1)
    cu.rivet_row(f"stow_rivet_{side}", "x", (s * (xo + 0.003), y0 + 0.03, z0 + 0.025),
                 (s * (xo + 0.003), y1 - 0.03, z0 + 0.025), 12)
    # hangers from the rail web
    for y in (y0 + 0.12, y1 - 0.12):
        bx0, bx1 = _sx(s, X_WEB, xi)
        cu.box_mm(f"stow_hanger_{side}", (bx0, y - 0.04, z0 + 0.10), (bx1, y + 0.04, RZ1 - 0.02), bev=0.003,
                  seg=1)
        cu.box_mm(f"stow_support_{side}", (*_sx(s, X_WEB, xo + 0.01)[:1], y - 0.03, z0 - 0.04),
                  (_sx(s, X_WEB, xo + 0.01)[1], y + 0.03, z0), mat="steel", bev=0.003, seg=1)
        cu.rod(f"stow_strut_{side}", (s * X_WEB, y, RZ0), (s * (X_WEB + 0.02), y, z0 - 0.02), 0.014, verts=8)


def _tank(s, side, fuel):
    y0, y1 = TANK_Y
    xi, xo = SIDE_X
    w, h = xo - xi + 0.0, 0.47
    xc, zc = s * (xi + xo) / 2, 0.63 + h / 2
    prof = cu.rounded_rect(w, h, 0.075, cx=xc, cz=zc, n=4)
    cu.prism(f"tank_{side}", prof, y0, y1, bev=0.010, seg=2, smooth=40.0)
    # straps and their brackets
    for y in (y0 + 0.22, y1 - 0.22):
        strap = cu.rounded_rect(w + 0.016, h + 0.016, 0.083, cx=xc, cz=zc, n=4)
        cu.prism(f"tank_strap_{side}", strap, y - 0.022, y + 0.022, mat="steel_dark", bev=0.003, seg=1)
        cu.box_mm(f"tank_cradle_{side}", (*_sx(s, X_WEB, xo + 0.02)[:1], y - 0.04, 0.60),
                  (_sx(s, X_WEB, xo + 0.02)[1], y + 0.04, 0.63), mat="steel", bev=0.004, seg=1)
        cu.box_mm(f"tank_hanger_{side}", (*_sx(s, X_WEB, xi)[:1], y - 0.04, 0.60),
                  (_sx(s, X_WEB, xi)[1], y + 0.04, RZ1 - 0.02), bev=0.004, seg=1)
        cu.bolt_z(f"tank_strap_bolt_{side}", s * (xo + 0.01), y, 0.63 + h + 0.012, r=0.012, h=0.01)
    # filler neck and cap on top towards the front, drain plug, sender plate
    fy = y1 - 0.12
    fx = s * (xo - 0.12)
    cu.cyl_z(f"tank_neck_{side}", 0.045, 0.63 + h - 0.01, 0.63 + h + 0.05, fx, fy, verts=24, bev=0.004)
    cu.cyl_z(f"tank_cap_{side}", 0.055 if fuel else 0.045, 0.63 + h + 0.05, 0.63 + h + 0.08, fx, fy,
             verts=24, mat="steel_dark", bev=0.005)
    for k in range(4):
        a = k * HALF_PI
        cu.box(f"tank_cap_lug_{side}", (0.03, 0.012, 0.02), (fx + 0.06 * math.cos(a), fy + 0.06 * math.sin(a),
               0.63 + h + 0.065), mat="steel_dark", rot=(0, 0, a), bev=0.0)
    cu.cyl_z(f"tank_sender_{side}", 0.06, 0.63 + h - 0.005, 0.63 + h + 0.008, s * (xi + 0.12), y0 + 0.40,
             verts=20, mat="steel", bev=0.002)
    for k in range(6):
        a = k * math.pi / 3
        cu.bolt_z(f"sender_bolt_{side}", s * (xi + 0.12) + 0.05 * math.cos(a), y0 + 0.40 + 0.05 * math.sin(a),
                  0.63 + h + 0.01, r=0.006, h=0.005)
    cu.cyl_z(f"tank_drain_{side}", 0.016, 0.615, 0.635, s * (xo - 0.15), y0 + 0.30, verts=6)
    # fuel feed and return lines to the engine (left only)
    if fuel:
        cu.hose("fuel_feed", [(s * (xi + 0.12), y0 + 0.40, 0.63 + h + 0.01), (s * (xi + 0.05), y0 + 0.45, 1.16),
                              (s * 0.30, 0.95, 1.05), (s * 0.27, 1.05, 0.98)], 0.009, segs=8)
        cu.hose("fuel_return", [(s * (xi + 0.16), y0 + 0.40, 0.63 + h + 0.01), (s * (xi + 0.08), y0 + 0.52, 1.14),
                                (s * 0.30, 1.10, 1.06), (s * 0.27, 1.20, 1.00)], 0.008, segs=8)


def _battery_box(s, side):
    y0, y1 = TANK_Y[1] - 0.34, TANK_Y[1]
    x0, x1 = _sx(s, 0.66, SIDE_X[1])
    cu.box_mm(f"battery_box_{side}", (x0, y0, 1.135), (x1, y1, 1.28), bev=0.008, seg=2)
    cu.box_mm(f"battery_lid_{side}", (x0 - 0.006, y0 - 0.006, 1.27), (x1 + 0.006, y1 + 0.006, 1.285),
              bev=0.004, seg=1)
    xf = s * (SIDE_X[1] + 0.003)
    cu.box(f"battery_label_{side}", (0.004, 0.10, 0.06), (xf + s * 0.002, (y0 + y1) / 2 - 0.05, 1.20), mat="decal_white",
           bev=0.0)
    for y in (y0 + 0.05, y1 - 0.05):
        cu.box(f"battery_latch_{side}", (0.014, 0.04, 0.05), (xf + s * 0.004, y, 1.24), mat="steel",
               bev=0.003, seg=1)
    # standoff to the tank top and the battery cable to the starter
    cu.box_mm(f"battery_stand_{side}", (x0 + 0.03, y0 + 0.03, 1.10), (x1 - 0.03, y1 - 0.03, 1.135),
              mat="steel", bev=0.003, seg=1)
    if s < 0:
        cu.hose("battery_cable_pos", [(s * 0.68, y0 + 0.05, 1.20), (s * 0.52, y0 + 0.0, 1.08),
                                      (s * 0.36, 0.95, 0.90), (s * 0.30, 0.86, 0.82)], 0.012, segs=8)
        cu.hose("battery_cable_neg", [(s * 0.68, y0 + 0.10, 1.18), (s * 0.53, y0 + 0.06, 1.06),
                                      (s * 0.45, 1.05, 1.05)], 0.011, segs=8)


def _intake_box():
    ib = L.INTAKE_BOX
    (x0, x1), (y0, y1), (z0, z1) = ib["x"], ib["y"], ib["z"]
    ym = y0 + 0.62 * (y1 - y0)          # front of the lower louvred section / tall section starts
    zl = z0 + 0.85                      # top of the lower section (side photo)
    # platform on the rails and outrigger brackets
    cu.box_mm("intake_platform", (x0 - 0.05, y0 - 0.02, z0 - 0.012), (x1, y1, z0), mat="steel_dark",
              bev=0.003, seg=1)
    for y in (y0 + 0.08, y1 - 0.08):
        cu.box_mm("intake_outrigger", (X_WEB, y - 0.03, RZ0 + 0.02), (x1 - 0.04, y + 0.03, z0 - 0.012),
                  bev=0.003, seg=1)
    cu.box_mm("intake_lower", (x0, y0, z0), (x1, ym, zl), bev=0.012, seg=2)
    cu.box_mm("intake_tall", (x0, ym, z0), (x1, y1 - 0.03, z1), bev=0.012, seg=2)
    # outboard face: tall louvre at the rear end, access door with hinges and latch
    cu.louvre_x("intake_louvre", x1, 1, y0 + 0.10, y0 + 0.24, z0 + 0.14, zl - 0.10, 14)
    cu.box_mm("intake_door", (x1 - 0.002, y0 + 0.30, z0 + 0.06), (x1 + 0.008, ym - 0.04, zl - 0.06),
              bev=0.004, seg=1)
    for z in (z0 + 0.14, zl - 0.14):
        cu.cyl_z("intake_door_hinge", 0.010, z - 0.04, z + 0.04, x1 + 0.012, ym - 0.05, verts=10)
    cu.box("intake_latch", (0.014, 0.05, 0.03), (x1 + 0.014, y0 + 0.34, (z0 + zl) / 2), mat="steel",
           bev=0.003, seg=1)
    cu.box_mm("tall_door", (x1 - 0.002, ym + 0.04, z0 + 0.20), (x1 + 0.008, y1 - 0.08, z1 - 0.06),
              bev=0.004, seg=1)
    cu.box("tall_latch", (0.014, 0.04, 0.05), (x1 + 0.014, ym + 0.07, z1 - 0.30), mat="steel",
           bev=0.003, seg=1)
    for z in (z0 + 0.30, z1 - 0.16):
        cu.cyl_z("tall_door_hinge", 0.010, z - 0.04, z + 0.04, x1 + 0.012, y1 - 0.09, verts=10)
    cu.rivet_row("intake_rivet_a", "x", (x1 + 0.003, y0 + 0.03, zl - 0.02), (x1 + 0.003, ym - 0.03, zl - 0.02), 10)
    cu.rivet_row("intake_rivet_b", "x", (x1 + 0.003, y0 + 0.03, z0 + 0.025), (x1 + 0.003, y1 - 0.06, z0 + 0.025), 16)
    cu.rivet_row("intake_rivet_c", "x", (x1 + 0.003, ym + 0.02, z1 - 0.025), (x1 + 0.003, y1 - 0.06, z1 - 0.025), 6)
    # rear face louvre (faces the pod) and a small stencil plate
    cu.louvre_y("intake_rear_louvre", y0, -1, x0 + 0.40, x0 + 0.80, z0 + 0.15, zl - 0.12, 10, mounted=True)
    cu.box("intake_plate", (0.004, 0.16, 0.08), (x1 + 0.011, ym + 0.20, z1 - 0.45), mat="decal_white", bev=0.0)
    # top cap of the lower section with lift rings
    for x in (x0 + 0.10, x1 - 0.10):
        cu.torus("intake_lift_ring", 0.03, 0.007, (x, y0 + 0.10, zl + 0.03), rot=(HALF_PI, 0, 0),
                 major_seg=16, minor_seg=6)
    # the black air-intake stack on top of the lower section, with the precleaner head
    sx, sy = 0.55, y0 + 0.22
    cu.cyl_z("stack_flange", 0.11, zl, zl + 0.02, sx, sy, verts=32, mat="steel_dark", bev=0.003)
    for k in range(8):
        a = k * math.pi / 4
        cu.bolt_z("stack_flange_bolt", sx + 0.095 * math.cos(a), sy + 0.095 * math.sin(a), zl + 0.022,
                  r=0.008, h=0.006)
    top = L.CAB_ROOF_Z - 0.10
    prof = [(0.0, 0.0), (0.078, 0.0), (0.078, top - zl - 0.20), (0.090, top - zl - 0.18),
            (0.125, top - zl - 0.14), (0.130, top - zl - 0.03), (0.110, top - zl), (0.0, top - zl + 0.01)]
    cu.lathe("intake_stack", prof, (sx, sy, zl + 0.02), segments=40, mat="steel_dark")
    for z in (zl + 0.12, top - 0.26):
        cu.torus("stack_clamp", 0.080, 0.007, (sx, sy, z), major_seg=32, minor_seg=6)
    # precleaner slots around the head
    for k in range(16):
        a = k * 2 * math.pi / 16
        cu.box("stack_slot", (0.008, 0.03, 0.07), (sx + 0.131 * math.cos(a), sy + 0.131 * math.sin(a), top - 0.08),
               mat="hose", rot=(0, 0, a), bev=0.0)


def _left_stowage():
    x0, x1 = -1.08, -0.45
    y0, y1 = 1.12, L.INTAKE_BOX["y"][1] - 0.03
    z0, z1 = L.INTAKE_BOX["z"][0], 2.22
    cu.box_mm("left_platform", (x0, y0 - 0.02, z0 - 0.012), (-0.15, y1, z0), mat="steel_dark", bev=0.003, seg=1)
    cu.box_mm("left_stow", (x0, y0, z0), (x1, y1, z1), bev=0.012, seg=2)
    cu.box_mm("left_stow_door", (x0 - 0.008, y0 + 0.05, z0 + 0.10), (x0 + 0.002, y1 - 0.05, z1 - 0.08),
              bev=0.004, seg=1)
    cu.box("left_stow_latch", (0.014, 0.05, 0.03), (x0 - 0.012, y0 + 0.10, (z0 + z1) / 2 + 0.2), mat="steel",
           bev=0.003, seg=1)
    for z in (z0 + 0.25, z1 - 0.20):
        cu.cyl_z("left_stow_hinge", 0.010, z - 0.04, z + 0.04, x0 - 0.012, y1 - 0.06, verts=10)
    cu.rivet_row("left_stow_rivet", "x", (x0 - 0.003, y0 + 0.03, z0 + 0.03), (x0 - 0.003, y1 - 0.03, z0 + 0.03), 8)
    for y in (y0 + 0.06, y1 - 0.06):
        cu.box_mm("left_outrigger", (x0 + 0.04, y - 0.03, RZ0 + 0.02), (-X_WEB, y + 0.03, z0 - 0.012),
                  bev=0.003, seg=1)


def _air_tanks():
    for k, y in enumerate((-0.20, -0.66)):
        x = -0.23
        cu.cyl_y(f"air_tank_{k}", 0.11, y - 0.20, y + 0.20, x, 0.94, verts=28, mat="paint_od", bev=0.03, seg=3)
        for dy in (-0.12, 0.12):
            cu.torus("air_tank_strap", 0.114, 0.007, (x, y + dy, 0.94), rot=(HALF_PI, 0, 0), major_seg=28,
                     minor_seg=6)
            cu.box_mm("air_tank_hanger", (x - 0.02, y + dy - 0.015, 1.04), (x + 0.02, y + dy + 0.015, RZ0),
                      mat="steel", bev=0.002, seg=1)
        cu.cyl_y("air_tank_valve", 0.012, y - 0.24, y - 0.20, x, 0.86, verts=8)


def _lines():
    y0, y1 = L.REAR_Y + 0.25, L.FRONT_Y - 0.40
    for s, side in cu.SIDES:
        # air and brake lines under the top flange inside the rail
        for k, (dx, dz) in enumerate(((0.0, 0.0), (0.016, 0.0), (0.032, 0.002))):
            x = s * (RX - 0.020 - dx)
            cu.hose(f"air_line_{side}_{k}", [(x, y0, RZ1 - 0.03 - dz), (x, y1, RZ1 - 0.03 - dz)], 0.0055,
                    segs=6, per=1, mat="hose" if k else "steel")
        n = int((y1 - y0) / 0.6)
        for j in range(n + 1):
            yc = y0 + (y1 - y0) * j / n
            cu.box(f"line_clip_{side}", (0.05, 0.02, 0.016), (s * (RX - 0.04), yc, RZ1 - 0.03), mat="steel",
                   bev=0.0)
        # wiring loom along the outer web to the rear lamps, clipped every 0.5 m
        xo = s * (X_WEB + 0.012)
        zl = RZ0 + 0.035
        pts = [(s * 0.30, y1, 1.05), (xo, y1 - 0.30, zl), (xo, y1 - 0.60, zl), (xo, L.REAR_Y + 0.70, zl),
               (xo, L.REAR_Y + 0.40, zl), (s * 0.62, L.REAR_Y + 0.22, 1.10),
               (s * 0.80, L.REAR_Y + 0.16, L.REAR_BUMPER_Z[1] - 0.08)]
        cu.hose(f"loom_{side}", pts, 0.011, segs=8, per=8)
        n = int((y1 - 0.30 - L.REAR_Y - 0.40) / 0.5)
        for j in range(n + 1):
            yc = L.REAR_Y + 0.40 + (y1 - 0.30 - L.REAR_Y - 0.40) * j / n
            cu.box(f"loom_clip_{side}", (0.012, 0.025, 0.04), (s * (X_WEB + 0.004), yc, RZ0 + 0.035), mat="steel",
                   bev=0.0)


def build():
    _fenders()
    _steps()
    for s, side in cu.SIDES:
        _stowage_box(s, side)
        _tank(s, side, fuel=(s < 0))
        _battery_box(s, side)
    _intake_box()
    _left_stowage()
    _air_tanks()
    _lines()
