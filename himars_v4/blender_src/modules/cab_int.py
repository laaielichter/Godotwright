"""M142 HIMARS v4 LSAC cab interior (cab_int). Every object has hr_node "Interior".

Sized to the armoured cab of cab_ext (layout.CAB): floor at CAB floor_z, inner walls 30 mm
inside the shell. Objects:
  cab_int_shell    floor plate, mats, wall and rear padding, quilted headliner, window trims
  cab_int_dash     dashboard, driver binnacle with gauges, switch panels, vents, pedals,
                   steering column and wheel, gear keypad console
  cab_int_seats    driver seat (left, at layout.DRIVER_EYE), commander seat (right), third
                   seat (centre, at layout.FCC_VIEW), fabric with stitching seams, belts
  cab_int_fcc      fire control console right of the driver, its panel facing from
                   layout.FCC_TARGET toward layout.FCC_VIEW: housing, bezels, soft keys,
                   keypad grid, toggles, joystick, plain label plates, cables
  cab_int_equip    radios on the rear wall, fire extinguisher, grab handles, dome lamp
  fcc_screen_1/2   the two display quads (material "screen", UVs 0..1, u right, v up) so the
                   game can put live content on them
"""
import math

import bmesh
import bpy
from mathutils import Vector

import cab_ext_util as cu
from cab_ext_util import (FY, RY, ZR, XW, XR, ZK, FZ, RK_LEN, basis, bm_box, bm_cyl, bm_hull,
                          bm_lathe, bm_sphere, bm_sweep, bm_torus, frange, look, mat_loc, rk,
                          rk_m, side_x)
import layout as L

NODE = "Interior"
C = L.CAB
FLOOR = C["floor_z"]
T_SH = cu.SHELL_T
XI = XW - T_SH                 # inner side wall
YF = FY - T_SH                 # inner front wall
YR = RY + T_SH                 # inner rear wall
ZRI = ZR - T_SH                # inner roof
ZBI = cu.ZB + T_SH             # inner floor pan

EYE = Vector(L.DRIVER_EYE)
FCC_T = Vector(L.FCC_TARGET)
FCC_V = Vector(L.FCC_VIEW)


def side_xi(z):
    return side_x(z) - T_SH


# ------------------------------------------------------------------ shell lining
def lining(a):
    # floor plate and ribbed rubber mats
    a.box((2 * XI - 0.01, YF - YR - 0.01, FLOOR - ZBI), mat_loc((0, (YF + YR) / 2,
          (FLOOR + ZBI) / 2)), mat="interior_dark", bev=0.003)
    for xc, w, y0, y1 in ((-0.45, 0.62, 2.40, 3.30), (0.05, 0.40, 1.90, 2.70),
                          (0.55, 0.50, 2.05, 2.90)):
        a.box((w, y1 - y0, 0.008), mat_loc((xc, (y0 + y1) / 2, FLOOR + 0.004)), mat="rubber",
              bev=0.003)
        for y in frange(y0 + 0.04, y1 - 0.04, 0.035):
            a.box((w - 0.06, 0.008, 0.005), mat_loc((xc, y, FLOOR + 0.0105)), mat="rubber",
                  bev=0.0)
    # tread-plate rails along the door sills
    for sd in (-1, 1):
        a.box((0.10, cu.DY1 - cu.DY0, 0.03), mat_loc((sd * (XI - 0.05), (cu.DY0 + cu.DY1) / 2,
              FLOOR + 0.015)), mat="steel", bev=0.004)
    # rear wall padding: quilted panels
    for x in frange(-0.84, 0.84, 0.21):
        for z in frange(1.62, 2.62, 0.20):
            a.box((0.20, 0.025, 0.19), mat_loc((x, YR + 0.0125, z)), mat="interior_grey",
                  bev=0.010, seg=2)
    # side walls behind the doors and the side chamfers: padded panels
    for sd in (-1, 1):
        for y in frange(YR + 0.12, cu.DY0 - 0.12, 0.2):
            for z in frange(1.62, 2.02, 0.2):
                a.box((0.025, 0.19, 0.19), mat_loc((sd * (XI - 0.0125), y, z)),
                      mat="interior_grey", bev=0.010)
            for z in (2.26, 2.52):
                xs = side_xi(z) - 0.0125
                m = basis((sd * xs, y, z), (0, 1, 0), (sd * -cu.SIDE_K, 0, 1), (sd, 0, cu.SIDE_K))
                a.box((0.19, 0.24, 0.025), m, mat="interior_grey", bev=0.010)
        # front corner pillar trim ahead of the doors
        for z in (1.75, 2.05):
            a.box((0.025, YF - cu.DY1 - 0.03, 0.28), mat_loc((sd * (XI - 0.0125),
                  (YF + cu.DY1) / 2, z)), mat="interior_grey", bev=0.008)
    # quilted headliner (skips the hatch opening)
    hx, hy = cu.HATCH_C
    for x in frange(-XR + 0.10, XR - 0.10, 0.13):
        for y in frange(YR + 0.08, cu.RYF - 0.10, 0.13):
            if math.hypot(x - hx, y - hy) < cu.HATCH_R + 0.12:
                continue
            a.box((0.125, 0.125, 0.035), mat_loc((x, y, ZRI - 0.0175)), mat="interior_grey",
                  bev=0.016, seg=3)
            a.cyl(0.006, 0.004, mat_loc((x + 0.0625, y + 0.0625, ZRI - 0.033)),
                  mat="interior_dark", verts=8)
    # hatch inner ring lining
    a.put(bm_lathe([(cu.HATCH_R, ZRI - 0.06), (cu.HATCH_R + 0.08, ZRI - 0.05),
                    (cu.HATCH_R + 0.08, ZRI), (cu.HATCH_R, ZRI + 0.03)], 48),
          mat_loc((hx, hy, 0)), "interior_dark", 40.0)
    # windscreen inner trims (raked plate inside surface)
    for u0, u1 in cu.PANES.values():
        s0, s1 = cu.G_S0, cu.G_S1
        for (cu_, cs, su, ss) in (((u0 + u1) / 2, s1 + 0.03, u1 - u0 + 0.12, 0.06),
                                  ((u0 + u1) / 2, s0 - 0.03, u1 - u0 + 0.12, 0.06),
                                  (u0 - 0.03, (s0 + s1) / 2, 0.06, s1 - s0),
                                  (u1 + 0.03, (s0 + s1) / 2, 0.06, s1 - s0)):
            a.box((su, ss, 0.014), rk_m(cu_, cs, -T_SH - 0.007), mat="interior_dark",
                  bev=0.004)
    # raked plate inner lining around the panes (padded strip below the roof)
    a.box((2 * XR - 0.10, 0.12, 0.03), rk_m(0, RK_LEN - 0.12, -T_SH - 0.015),
          mat="interior_grey", bev=0.01)


# ------------------------------------------------------------------ dashboard
def dashboard(a):
    xh = XI - 0.01
    pts = []
    for sd in (-1, 1):
        pts += [(sd * xh, YF, 2.14), (sd * xh, YF, 1.66), (sd * xh, 3.14, 1.66),
                (sd * xh, 3.04, 1.86), (sd * xh, 3.06, 2.00), (sd * xh, 3.16, 2.09)]
    a.put(bm_hull(pts, bev=0.015, seg=2), None, "interior_grey", 30.0)
    # soft top pad
    a.box((2 * xh - 0.02, 0.18, 0.025), basis((0, 3.25, 2.12), (1, 0, 0), (0, 1, 0.35),
          (0, -0.35, 1)), mat="interior_dark", bev=0.01)
    # driver binnacle facing the eye
    bc = Vector((EYE.x, 3.02, 1.98))
    nrm = (EYE - bc).normalized()
    ux = Vector((1, 0, 0))
    vy = nrm.cross(ux).normalized()
    ux = vy.cross(nrm).normalized()
    m = lambda u, v, n=0.0: basis(bc + ux * u + vy * v + nrm * n, ux, vy, nrm)  # noqa: E731
    a.box((0.50, 0.22, 0.12), m(0, 0, -0.06), mat="interior_grey", bev=0.02, seg=3)
    a.box((0.52, 0.06, 0.16), m(0, 0.12, -0.04), mat="interior_dark", bev=0.02, seg=3)  # hood
    a.box((0.46, 0.18, 0.004), m(0, 0, 0.002), mat="interior_dark", bev=0.0)
    gauges = [(-0.10, 0.0, 0.065), (0.10, 0.0, 0.065), (-0.205, 0.04, 0.030),
              (-0.205, -0.04, 0.030), (0.205, 0.04, 0.030), (0.205, -0.04, 0.030)]
    for gu, gv, r in gauges:
        a.put(bm_torus(r, 0.006, 40, 8), m(gu, gv, 0.006), "chrome", 40.0)
        a.cyl(r, 0.004, m(gu, gv, 0.002), mat="interior_dark", verts=40, z0=0.0)
        for k in range(9 if r > 0.05 else 5):
            ang = math.radians(225 - k * (270 / (8 if r > 0.05 else 4)))
            p = Vector((gu + 0.82 * r * math.cos(ang), gv + 0.82 * r * math.sin(ang)))
            mm = basis(m(p.x, p.y, 0.007).translation, ux * math.cos(ang) + vy * math.sin(ang),
                       -ux * math.sin(ang) + vy * math.cos(ang), nrm)
            a.box((0.18 * r, 0.04 * r, 0.002), mm, mat="decal_white", bev=0.0)
        ang = math.radians(150)
        mm = basis(m(gu + 0.3 * r * math.cos(ang), gv + 0.3 * r * math.sin(ang), 0.009).translation,
                   ux * math.cos(ang) + vy * math.sin(ang), -ux * math.sin(ang) + vy * math.cos(ang),
                   nrm)
        a.box((0.7 * r, 0.006, 0.002), mm, mat="lens_red", bev=0.0)
        a.cyl(0.008, 0.006, m(gu, gv, 0.008), mat="steel_dark", verts=12, z0=0.0)
    for k in range(8):   # warning lamp row
        a.box((0.018, 0.012, 0.004), m(-0.14 + k * 0.04, -0.08, 0.004),
              mat=("lens_red" if k % 3 == 0 else "lens_amber" if k % 3 == 1 else "screen"),
              bev=0.0)
    # centre switch panel and vents on the dash face
    sp = basis((-0.05, 3.065, 1.86), (1, 0, 0), (0, 0.45, 0.89), (0, -0.89, 0.45))
    a.box((0.30, 0.20, 0.012), sp, mat="interior_dark", bev=0.004)
    for i in range(5):
        for j in range(2):
            p = sp @ Vector((-0.11 + i * 0.055, -0.045 + j * 0.09, 0.006))
            mm = sp.copy()
            mm.translation = p
            a.cyl(0.008, 0.008, mm, mat="steel", verts=6, z0=0.0)
            a.rod(p, p + sp.to_3x3() @ Vector((0, 0.008, 0.025)), 0.003, mat="chrome", verts=6)
            a.box((0.03, 0.012, 0.002), _at(sp, (-0.11 + i * 0.055, -0.072 + j * 0.09, 0.007)),
                  mat="decal_white", bev=0.0)
    for x in (-0.86, -0.28, 0.08, 0.86):
        vm = basis((x, 3.08, 1.99), (1, 0, 0), (0, 0, 1), (0, -1, 0.15))
        a.cyl(0.04, 0.03, vm, mat="interior_dark", verts=24, z0=-0.02, bev=0.004)
        for k in range(4):
            a.box((0.07, 0.006, 0.02), _at(vm, (0, -0.024 + k * 0.016, 0.012)),
                  mat="steel_dark", bev=0.0)
    # glove box / stowage on the right of the dash under the console
    a.box((0.30, 0.012, 0.18), mat_loc((0.80, 3.135, 1.78)), mat="interior_dark", bev=0.004)
    a.box((0.10, 0.01, 0.02), mat_loc((0.80, 3.127, 1.85)), mat="steel", bev=0.004)
    # pedals
    for x, w, h in ((-0.56, 0.10, 0.09), (-0.33, 0.07, 0.17)):
        piv = Vector((x, 3.30, 1.84))
        pad = Vector((x, 3.17, FLOOR + 0.12))
        a.rod(piv, pad, 0.008, mat="steel_dark")
        pm = basis(pad, (1, 0, 0), (0, 0.5, 0.866), (0, -0.866, 0.5))
        a.box((w, h, 0.015), pm, mat="steel_dark", bev=0.004)
        for k in range(4):
            a.box((w - 0.015, 0.006, 0.004), _at(pm, (0, -h / 2 + 0.02 + k * (h - 0.04) / 3,
                  0.009)), mat="rubber", bev=0.0)
    a.box((0.32, 0.20, 0.03), basis((-0.45, 3.25, FLOOR + 0.06), (1, 0, 0), (0, 0.6, 0.8),
          (0, -0.8, 0.6)), mat="rubber", bev=0.005)     # footrest plate
    # steering column and wheel (tilted bus-style)
    wc = Vector((EYE.x, 2.94, 1.96))
    wn = Vector((0, -0.62, 0.78)).normalized()
    wx = Vector((1, 0, 0))
    wy = wn.cross(wx)
    wm = basis(wc, wx, wy, wn)
    col_end = wc - wn * 0.42
    a.rod(wc - wn * 0.05, col_end, 0.032, mat="interior_dark", verts=20)
    a.cyl(0.05, 0.16, look(col_end + wn * 0.12, col_end), mat="interior_dark", verts=24, bev=0.01)
    a.put(bm_torus(0.20, 0.016, 64, 12), wm.copy(), "rubber", 40.0)
    a.cyl(0.05, 0.05, wm.copy(), mat="interior_dark", verts=32, bev=0.012, seg=2)
    a.cyl(0.035, 0.006, _at(wm, (0, 0, 0.026)), mat="steel_dark", verts=24)
    for ang in (-90, 30, 150):
        r = math.radians(ang)
        d = wx * math.cos(r) + wy * math.sin(r)
        a.bar(wc + d * 0.04, wc + d * 0.19 - wn * 0.004, 0.028, 0.010, mat="steel_dark",
              up=wn, bev=0.003)
    # stalks
    for sx in (-1, 1):
        p = col_end + wn * 0.33 + wx * sx * 0.05
        a.rod(p, p + wx * sx * 0.12 + wn * 0.01, 0.006, mat="interior_dark", verts=8)
    # gear selector keypad console (between the driver and the fire control console)
    a.box((0.20, 0.36, 0.36), mat_loc((-0.08, 3.12, FLOOR + 0.18)), mat="interior_grey",
          bev=0.015)
    km = basis((-0.08, 3.06, FLOOR + 0.38), (1, 0, 0), (0, 0.6, 0.8), (0, -0.8, 0.6))
    a.box((0.16, 0.20, 0.03), km, mat="interior_dark", bev=0.006)
    a.box((0.08, 0.03, 0.004), _at(km, (0, 0.07, 0.016)), mat="screen", bev=0.0)
    for i in range(2):
        for j in range(3):
            a.box((0.045, 0.03, 0.012), _at(km, (-0.03 + i * 0.06, 0.02 - j * 0.042, 0.018)),
                  mat="interior_grey", bev=0.004)


def _at(m, local):
    """Copy of frame m moved to a point given in its own local coordinates."""
    mm = m.copy()
    mm.translation = m @ Vector(local)
    return mm


# ------------------------------------------------------------------ seats
def seat(a, x, y_front, width, depth, cz, back_h, tilt_deg=12, name="seat"):
    """Fabric seat: cushion top at cz, backrest from the cushion rear edge."""
    y_back = y_front - depth
    yc = (y_front + y_back) / 2
    # pedestal with suspension bellows and slide rails
    a.box((width - 0.10, depth - 0.14, cz - 0.10 - FLOOR - 0.06),
          mat_loc((x, yc, (FLOOR + 0.06 + cz - 0.10) / 2)), mat="steel_dark", bev=0.01)
    for k in range(5):
        a.box((width - 0.06, depth - 0.10, 0.012),
              mat_loc((x, yc, FLOOR + 0.10 + k * (cz - FLOOR - 0.24) / 4)), mat="rubber",
              bev=0.004)
    for sx in (-1, 1):
        a.box((0.03, depth + 0.06, 0.02), mat_loc((x + sx * (width / 2 - 0.08), yc, FLOOR + 0.02)),
              mat="steel", bev=0.004)
    a.box((width - 0.02, depth - 0.04, 0.03), mat_loc((x, yc, cz - 0.095)), mat="steel_dark",
          bev=0.006)
    # cushion: rounded block plus side bolsters
    a.box((width - 0.10, depth, 0.10), mat_loc((x, yc, cz - 0.05)), mat="fabric", bev=0.035,
          seg=4)
    for sx in (-1, 1):
        a.box((0.07, depth, 0.12), mat_loc((x + sx * (width / 2 - 0.035), yc, cz - 0.045)),
              mat="fabric", bev=0.03, seg=4)
        # stitching seam between bolster and centre
        a.box((0.004, depth - 0.05, 0.004), mat_loc((x + sx * (width / 2 - 0.07), yc, cz + 0.003)),
              mat="interior_dark", bev=0.0)
    for y in (y_back + 0.12, y_front - 0.10):
        a.box((width - 0.16, 0.004, 0.004), mat_loc((x, y, cz + 0.002)), mat="interior_dark",
              bev=0.0)
    # backrest: tilted rounded block, bolsters, seams and headrest
    t = math.radians(tilt_deg)
    up = Vector((0, -math.sin(t), math.cos(t)))
    fwd = Vector((0, math.cos(t), math.sin(t)))
    base = Vector((x, y_back + 0.05, cz - 0.02))
    bm = lambda u, v, n=0.0: basis(base + Vector((u, 0, 0)) + up * v + fwd * n,  # noqa: E731
                                   (1, 0, 0), up, fwd)
    a.box((width - 0.10, back_h, 0.09), bm(0, back_h / 2, 0), mat="fabric", bev=0.035, seg=4)
    for sx in (-1, 1):
        a.box((0.07, back_h - 0.04, 0.13), bm(sx * (width / 2 - 0.035), back_h / 2 - 0.02, 0.015),
              mat="fabric", bev=0.03, seg=4)
        a.box((0.004, back_h - 0.10, 0.004), bm(sx * (width / 2 - 0.07), back_h / 2, 0.047),
              mat="interior_dark", bev=0.0)
    for v in (0.16, 0.32):
        a.box((width - 0.16, 0.004, 0.004), bm(0, v, 0.046), mat="interior_dark", bev=0.0)
    a.box((width - 0.06, back_h + 0.02, 0.03), bm(0, back_h / 2, -0.06), mat="interior_dark",
          bev=0.01)                                        # back shell
    a.box((0.26, 0.15, 0.09), bm(0, back_h + 0.10, 0.0), mat="fabric", bev=0.035, seg=4)
    for sx in (-1, 1):
        a.rod(bm(sx * 0.08, back_h - 0.01, 0.0).translation, bm(sx * 0.08, back_h + 0.04, 0.0)
              .translation, 0.006, mat="chrome", verts=8)
    # three-point belt: shoulder strap over the left or right shoulder, lap belt, buckle
    sgn = -1 if x < 0 else 1
    sh = bm(sgn * (width / 2 - 0.05), back_h - 0.04, 0.06).translation
    mid = bm(-sgn * 0.02, back_h * 0.45, 0.075).translation
    hip = Vector((x - sgn * (width / 2 - 0.06), y_back + 0.14, cz + 0.06))
    hip2 = Vector((x + sgn * (width / 2 - 0.04), y_back + 0.14, cz + 0.05))
    for p, q in ((sh, mid), (mid, hip), (hip, hip2)):
        a.bar(p, q, 0.046, 0.004, mat="canvas", bev=0.0, up=fwd)
    a.box((0.05, 0.03, 0.07), mat_loc(hip + Vector((0, 0.0, -0.01))), mat="steel", bev=0.006)
    a.box((0.06, 0.05, 0.08), bm(sgn * (width / 2 - 0.03), back_h + 0.02, -0.07),
          mat="interior_dark", bev=0.01)              # retractor
    a.box((0.03, 0.03, 0.06), mat_loc(hip2 + Vector((0, 0, -0.02))), mat="steel_dark",
          bev=0.006)


def seats(a):
    # driver: eye at layout.DRIVER_EYE, backrest about 0.2 behind it
    seat(a, EYE.x, 2.80, 0.50, 0.46, 1.76, 0.58, 12)
    # third seat in the centre (its occupant's eye is layout.FCC_VIEW)
    seat(a, FCC_V.x, FCC_V.y + 0.20, 0.40, 0.40, 1.74, 0.54, 10)
    # commander seat, right, set back from the console
    seat(a, 0.56, 2.58, 0.46, 0.44, 1.76, 0.58, 12)


# ------------------------------------------------------------------ fire control console
def fcc(a, screens):
    n = (FCC_V - FCC_T).normalized()
    u = Vector((0, 0, 1)).cross(n).normalized()
    v = n.cross(u).normalized()
    fm = lambda pu, pv, pn=0.0: basis(FCC_T + u * pu + v * pv + n * pn, u, v, n)  # noqa: E731
    W, H = 0.54, 0.42
    # housing (sloped panel face at n = 0) and a deeper body behind it
    a.box((W + 0.04, H + 0.04, 0.10), fm(0, 0, -0.05), mat="interior_dark", bev=0.012, seg=2)
    a.box((W - 0.06, H - 0.08, 0.14), fm(0, -0.02, -0.15), mat="steel_dark", bev=0.01)
    a.box((W, H, 0.006), fm(0, 0, 0.003), mat="interior_grey", bev=0.003)
    # mounting pedestal down to the floor
    foot = Vector((FCC_T.x - 0.02, FCC_T.y + 0.10, FLOOR))
    top = (fm(0, -H / 2 + 0.05, -0.10)).translation
    a.box((0.10, 0.10, top.z - FLOOR), mat_loc((foot.x, foot.y, (top.z + FLOOR) / 2)),
          mat="steel_dark", bev=0.008)
    a.box((0.24, 0.24, 0.012), mat_loc((foot.x, foot.y, FLOOR + 0.006)), mat="steel_dark",
          bev=0.003)
    for sx in (-1, 1):
        for sy in (-1, 1):
            a.bolt(mat_loc((foot.x + sx * 0.10, foot.y + sy * 0.10, FLOOR + 0.012)), r=0.008,
                   mat="steel")
    a.rod(top, (foot.x, foot.y, top.z - 0.02), 0.03, mat="steel_dark")
    # two recessed displays with bezels and soft keys
    sw, sh = 0.21, 0.155
    for i, cu_ in enumerate((-0.125, 0.125), 1):
        cv = 0.085
        # bezel frame (4 bars) standing 16 mm proud; the screen sits 12 mm below its face
        bw = 0.025
        for (pu, pv, su, sv) in ((cu_, cv + sh / 2 + bw / 2, sw + 2 * bw, bw),
                                 (cu_, cv - sh / 2 - bw / 2, sw + 2 * bw, bw),
                                 (cu_ - sw / 2 - bw / 2, cv, bw, sh),
                                 (cu_ + sw / 2 + bw / 2, cv, bw, sh)):
            a.box((su, sv, 0.016), fm(pu, pv, 0.014), mat="interior_dark", bev=0.004)
        a.box((sw + 0.004, sh + 0.004, 0.003), fm(cu_, cv, 0.0075), mat="steel_dark", bev=0.0)
        for k in range(5):
            for sx in (-1, 1):
                a.box((0.014, 0.018, 0.006), fm(cu_ + sx * (sw / 2 + 0.013), cv - 0.06 + k * 0.03,
                      0.023), mat="interior_grey", bev=0.002)
        for k in range(4):
            a.box((0.022, 0.012, 0.006), fm(cu_ - 0.075 + k * 0.05, cv - sh / 2 - 0.013, 0.023),
                  mat="interior_grey", bev=0.002)
        a.box((0.06, 0.012, 0.002), fm(cu_, cv + sh / 2 + 0.035, 0.007), mat="decal_white",
              bev=0.0)   # plain label plate
        screens.append(_screen(f"fcc_screen_{i}", fm(cu_, cv, 0.010), sw, sh))
    # keypad grid 4 x 4 below the left display, with a label plate
    for r in range(4):
        for c in range(4):
            p = fm(-0.205 + c * 0.04, -0.045 - r * 0.036, 0.006)
            a.box((0.032, 0.028, 0.012), p, mat="interior_grey" if (r, c) != (3, 3) else
                  "steel_dark", bev=0.004, center=(0, 0, 0.006))
            a.box((0.012, 0.004, 0.0015), _at(p, (0, 0.006, 0.0125)), mat="decal_white",
                  bev=0.0)
    a.box((0.15, 0.012, 0.002), fm(-0.145, -0.195, 0.007), mat="decal_white", bev=0.0)
    # guarded toggles row below the right display, label plates above each
    for k in range(5):
        cu_ = 0.05 + k * 0.042
        p = fm(cu_, -0.07, 0.006)
        a.cyl(0.009, 0.008, p, mat="steel", verts=6, z0=0.0)
        tip = (fm(cu_, -0.06, 0.042)).translation
        a.rod(p.translation, tip, 0.0032, mat="chrome", verts=8)
        a.put(bm_sphere(0.005, 10, 6), mat_loc(tip), "chrome", 50.0)
        for sx in (-1, 1):
            a.box((0.003, 0.03, 0.03), fm(cu_ + sx * 0.016, -0.07, 0.021), mat="steel_dark",
                  bev=0.0)
        a.box((0.03, 0.01, 0.0015), fm(cu_, -0.035, 0.007), mat="decal_white", bev=0.0)
        a.box((0.008, 0.008, 0.004), fm(cu_, -0.105, 0.007),
              mat="lens_red" if k == 0 else "screen", bev=0.0)
    # rotary knobs and a key switch
    for k, cu_ in enumerate((0.07, 0.14, 0.21)):
        p = fm(cu_, -0.16, 0.006)
        a.cyl(0.016, 0.018, p, mat="interior_dark", verts=20, z0=0.0, bev=0.003)
        a.box((0.003, 0.02, 0.003), _at(p, (0, 0.004, 0.0195)), mat="decal_white", bev=0.0)
    a.cyl(0.012, 0.01, fm(-0.01, -0.16, 0.006), mat="chrome", verts=16, z0=0.0)
    # panel corner screws
    for sx in (-1, 1):
        for sy in (-1, 1):
            a.cyl(0.006, 0.003, fm(sx * (W / 2 - 0.015), sy * (H / 2 - 0.015), 0.006),
                  mat="steel", verts=10, z0=0.0)
    # side handles of the console
    for sx in (-1, 1):
        p0 = fm(sx * (W / 2 + 0.02), 0.10, -0.03).translation
        p1 = fm(sx * (W / 2 + 0.02), -0.10, -0.03).translation
        o = u * sx * 0.04
        a.tube([p0, p0 + o, p1 + o, p1], 0.008, mat="steel")
    # joystick on a tray below the left of the panel (gunner side)
    tray = FCC_T + u * (-0.16) + v * (-0.29) + n * 0.10
    yaw = math.atan2(u.y, u.x)
    tm = basis(tray, (math.cos(yaw), math.sin(yaw), 0), (-math.sin(yaw), math.cos(yaw), 0),
               (0, 0, 1))
    a.box((0.20, 0.18, 0.035), tm, mat="interior_dark", bev=0.008)
    a.box((0.04, 0.06, 0.12), _at(tm, (0, 0.07, -0.06)), mat="steel_dark", bev=0.006)
    base = tm @ Vector((0.02, -0.01, 0.0175))
    a.put(bm_lathe([(0.0, 0.0), (0.045, 0.0), (0.04, 0.012), (0.03, 0.03), (0.016, 0.05),
                    (0.0, 0.052)], 24), mat_loc(base), "rubber", 40.0)
    stick_top = base + Vector((0, 0, 0.10))
    a.rod(base + Vector((0, 0, 0.04)), stick_top, 0.009, mat="steel_dark")
    a.put(bm_sphere(0.026, 20, 10, (0.85, 1.0, 1.7)), mat_loc(stick_top + Vector((0, 0, 0.03))),
          "interior_dark", 40.0)
    a.box((0.012, 0.016, 0.03), mat_loc(stick_top + Vector((0, 0.022, 0.02))), mat="steel",
          bev=0.003)   # trigger
    for k in range(3):
        a.cyl(0.005, 0.006, mat_loc(stick_top + Vector((-0.01 + k * 0.01, 0.0, 0.074))),
              mat="lens_red" if k == 1 else "steel", verts=10, z0=0.0)
    a.box((0.06, 0.012, 0.002), _at(tm, (-0.05, -0.07, 0.018)), mat="decal_white", bev=0.0)
    # cable loom from the console to the floor
    c0 = fm(0.2, -H / 2, -0.12).translation
    a.tube([c0, c0 + Vector((0.02, 0.05, -0.12)), Vector((c0.x + 0.06, c0.y + 0.10, FLOOR + 0.03)),
            Vector((c0.x + 0.08, c0.y + 0.30, FLOOR + 0.03))], 0.012, mat="hose", segs=10)


def _screen(name, m, w, h):
    me = bpy.data.meshes.new(name)
    corners = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
    verts = [tuple(m @ Vector((x, y, 0))) for x, y in corners]
    me.from_pydata(verts, [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name="UVMap")
    for li, (uu, vv) in zip(range(4), ((0, 0), (1, 0), (1, 1), (0, 1))):
        uv.data[li].uv = (uu, vv)
    me.materials.append(cu.hr.mat("screen"))
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o["hr_node"] = NODE
    return o


# ------------------------------------------------------------------ equipment
def equipment(a):
    # radio rack on the rear wall, vehicle left behind the driver
    for k, (x, z) in enumerate(((-0.55, 2.02), (-0.55, 2.30))):
        a.box((0.40, 0.20, 0.24), mat_loc((x, YR + 0.13, z)), mat="interior_dark", bev=0.01)
        fm = basis((x, YR + 0.23, z), (1, 0, 0), (0, 0, 1), (0, 1, 0))
        a.box((0.38, 0.22, 0.008), fm, mat="steel_dark", bev=0.003)
        for i in range(4):
            a.cyl(0.014, 0.02, _at(fm, (-0.14 + i * 0.05, 0.06, 0.004)), mat="interior_dark",
                  verts=16, z0=0.0, bev=0.003)
        for i in range(3):
            for j in range(4):
                a.box((0.022, 0.016, 0.008), _at(fm, (0.05 + i * 0.03, 0.05 - j * 0.028, 0.006)),
                      mat="interior_grey", bev=0.002)
        a.box((0.08, 0.04, 0.004), _at(fm, (-0.10, -0.03, 0.006)), mat="screen", bev=0.0)
        for sx in (-1, 1):
            p = fm @ Vector((sx * 0.17, 0, 0.004))
            a.tube([p + Vector((0, 0, 0.08)), p + Vector((0, 0.04, 0.07)),
                    p + Vector((0, 0.04, -0.07)), p + Vector((0, 0, -0.08))], 0.007,
                   mat="steel")
        a.tube([(x + 0.12, YR + 0.24, z - 0.1), (x + 0.20, YR + 0.30, z - 0.2),
                (x + 0.25, YR + 0.05, 1.7)], 0.008, mat="hose", segs=8)
    a.box((0.46, 0.24, 0.03), mat_loc((-0.55, YR + 0.13, 1.885)), mat="steel_dark", bev=0.004)
    # fire extinguisher on the rear wall, right
    fx, fy, fz = 0.70, YR + 0.09, 1.80
    a.put(bm_lathe([(0, 0), (0.06, 0.0), (0.065, 0.02), (0.065, 0.30), (0.05, 0.34),
                    (0.02, 0.36), (0, 0.36)], 24), mat_loc((fx, fy, fz)), "lens_red", 40.0)
    a.box((0.04, 0.03, 0.06), mat_loc((fx, fy, fz + 0.38)), mat="steel_dark", bev=0.005)
    a.rod((fx, fy, fz + 0.40), (fx + 0.06, fy + 0.02, fz + 0.43), 0.005, mat="steel", verts=8)
    for z in (fz + 0.08, fz + 0.24):
        a.put(bm_torus(0.068, 0.006, 24, 6), mat_loc((fx, fy, z)), "steel_dark", 40.0)
    # roof grab handles above each door and the dome lamp
    for sd in (-1, 1):
        z = ZRI - 0.06
        xs = side_xi(z) - 0.06
        a.tube([(sd * (xs + 0.04), 2.55, z + 0.04), (sd * xs, 2.57, z - 0.02),
                (sd * xs, 2.85, z - 0.02), (sd * (xs + 0.04), 2.87, z + 0.04)], 0.012,
               mat="interior_dark")
    a.box((0.20, 0.10, 0.03), mat_loc((-0.25, 2.75, ZRI - 0.05)), mat="interior_dark", bev=0.01)
    a.box((0.16, 0.07, 0.006), mat_loc((-0.25, 2.75, ZRI - 0.067)), mat="lens_white", bev=0.002)
    # document pocket on the driver side wall behind the door
    a.box((0.03, 0.30, 0.22), mat_loc((-(XI - 0.04), 2.05, 1.85)), mat="canvas", bev=0.01)
    # map light gooseneck at the console
    p = Vector((0.80, 3.10, 2.12))
    a.tube([p, p + Vector((-0.02, -0.05, 0.08)), p + Vector((-0.08, -0.12, 0.12))], 0.006,
           mat="interior_dark", segs=8)
    a.cyl(0.02, 0.05, look(p + Vector((-0.08, -0.12, 0.12)), p + Vector((-0.12, -0.18, 0.08))),
          mat="interior_dark", verts=16)


def extras(a):
    """Crew equipment that makes the cab read as used: intercom boxes with coiled cords and
    headset hooks, canvas stowage bags, water bottles, defroster strip, parking brake knob,
    circuit breaker panel, cab-side seat-to-wall harness anchors."""
    # defroster outlet strip along the top of the dash under each windscreen
    for u0, u1 in cu.PANES.values():
        y, z = 3.31, 2.145
        a.box((u1 - u0, 0.05, 0.012), mat_loc(((u0 + u1) / 2, y, z)), mat="interior_dark",
              bev=0.003)
        for x in frange(u0 + 0.02, u1 - 0.02, 0.025):
            a.box((0.006, 0.04, 0.004), mat_loc((x, y, z + 0.007)), mat="steel_dark", bev=0.0)
    # intercom control boxes (one per crew station) with a coiled cord and headset hook
    for (x, y, z, face) in ((-0.95, 2.20, 2.18, (1, 0, 0)), (0.95, 2.05, 2.18, (-1, 0, 0)),
                            (0.05, YR + 0.07, 2.32, (0, 1, 0))):
        f = Vector(face)
        up = Vector((0, 0, 1))
        side = up.cross(f)
        m = basis((x, y, z), side, up, f)
        a.box((0.14, 0.11, 0.07), m, mat="interior_dark", bev=0.008, center=(0, 0, -0.03))
        a.box((0.12, 0.09, 0.004), _at(m, (0, 0, 0.006)), mat="steel_dark", bev=0.0)
        for k in range(2):
            p = _at(m, (-0.035 + k * 0.07, 0.015, 0.008))
            a.cyl(0.014, 0.016, p, mat="interior_dark", verts=18, z0=0.0, bev=0.003)
            a.box((0.003, 0.012, 0.003), _at(p, (0, 0.005, 0.0165)), mat="decal_white", bev=0.0)
        a.box((0.06, 0.01, 0.0015), _at(m, (0, -0.03, 0.008)), mat="decal_white", bev=0.0)
        a.cyl(0.011, 0.02, _at(m, (0, -0.06, -0.03)), mat="steel", verts=12)
        cord_top = m @ Vector((0, -0.07, -0.03))
        a.put(cu.bm_helix(0.016, 0.004, 0.0, 0.22, 11, 10, 5), basis(cord_top - Vector((0, 0, 0.24)),
              (1, 0, 0), (0, 1, 0), (0, 0, 1)), "rubber", 60.0)
        hook = m @ Vector((0.11, 0.0, 0.0))
        a.tube([hook, hook + f * 0.05, hook + f * 0.05 + up * 0.03], 0.006, mat="steel_dark",
               segs=8)
    # canvas stowage bags on the rear wall (vehicle right) with straps and buckles
    for k, (x, z, w, h) in enumerate(((0.30, 2.12, 0.32, 0.30), (0.62, 2.20, 0.22, 0.24))):
        a.box((w, 0.12, h), mat_loc((x, YR + 0.07, z)), mat="canvas", bev=0.04, seg=3)
        a.box((w * 0.9, 0.03, h * 0.35), mat_loc((x, YR + 0.135, z + h * 0.25)), mat="canvas",
              bev=0.012, seg=2)
        for sx in (-0.3, 0.3):
            a.box((0.03, 0.004, h + 0.02), mat_loc((x + sx * w, YR + 0.133, z)), mat="interior_dark",
                  bev=0.0)
            a.box((0.035, 0.008, 0.025), mat_loc((x + sx * w, YR + 0.137, z - 0.04)),
                  mat="steel_dark", bev=0.002)
    # water bottles in wire holders on the dash sides
    for x in (-0.92, 0.92):
        p = Vector((x, 3.00, 1.62))
        a.put(bm_lathe([(0, 0), (0.038, 0), (0.04, 0.01), (0.04, 0.2), (0.03, 0.23),
                        (0.016, 0.25), (0.016, 0.27), (0, 0.27)], 24), mat_loc(p), "hose", 40.0)
        a.cyl(0.018, 0.02, mat_loc(p + Vector((0, 0, 0.27))), mat="interior_grey", verts=16,
              z0=0.0)
        for z in (0.05, 0.16):
            a.put(bm_torus(0.043, 0.003, 24, 6), mat_loc(p + Vector((0, 0, z))), "steel", 40.0)
    # parking brake knob (yellow), and the circuit breaker panel low on the dash, left
    a.rod((-0.80, 3.08, 1.86), (-0.80, 3.02, 1.88), 0.006, mat="steel")
    a.put(bm_sphere(0.022, 16, 8, (1, 1, 0.8)), mat_loc((-0.80, 3.01, 1.88)), "lens_amber", 40.0)
    bp = basis((-0.72, 3.07, 1.74), (1, 0, 0), (0, 0.3, 0.95), (0, -0.95, 0.3))
    a.box((0.22, 0.12, 0.01), bp, mat="steel_dark", bev=0.003)
    for i in range(6):
        for j in range(2):
            a.box((0.018, 0.026, 0.012), _at(bp, (-0.09 + i * 0.036, -0.025 + j * 0.05, 0.008)),
                  mat="interior_dark", bev=0.002)
            a.box((0.006, 0.01, 0.006), _at(bp, (-0.09 + i * 0.036, -0.025 + j * 0.05, 0.016)),
                  mat="decal_white", bev=0.0)
    # harness anchors and a vertical grab bar beside each door opening (inside)
    for sd in (-1, 1):
        x = sd * (XI - 0.03)
        a.tube([(x, cu.DY0 - 0.06, 1.70), (x - sd * 0.04, cu.DY0 - 0.06, 1.72),
                (x - sd * 0.04, cu.DY0 - 0.06, 2.14), (x, cu.DY0 - 0.06, 2.16)], 0.013,
               mat="interior_dark")


def build():
    out = []
    groups = (("cab_int_shell", lining), ("cab_int_dash", dashboard), ("cab_int_seats", seats),
              ("cab_int_equip", lambda a: (equipment(a), extras(a))))
    for name, fn in groups:
        a = cu.Acc(name, NODE)
        fn(a)
        out.append(a.finish())
    screens = []
    a = cu.Acc("cab_int_fcc", NODE)
    fcc(a, screens)
    out.append(a.finish())
    out += screens
    for o in out:
        if o in cu.OUT:
            cu.OUT.remove(o)
    return out
