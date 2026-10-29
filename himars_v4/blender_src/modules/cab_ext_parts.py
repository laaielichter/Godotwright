"""LSAC cab exterior parts.

body (cab_body): windscreen armour frames and gaskets, wipers, the 2x2 mesh louvre panel and
round plate on the lower front face, stencil plates (plain, no text), five amber roof lamps,
bolt rows on every panel, side applique panels and seams, sill step and the hanging step,
body-side hinge leaves, rear wall plates.
glass (cab_glass): the two windscreen panes.
fit (cab_fittings, proud of the body envelope): rear-view mirrors with arms, grab rails,
hatch ring and closed cover, loop and whip antenna bases, roof lifting eyes.
"""
import math

from mathutils import Vector

import cab_ext_util as cu
from cab_ext_util import (FY, RY, ZB, ZR, XW, XR, ZK, FZ, FXW, RYF, RK_LEN, basis, bm_box,
                          bm_cyl, bm_hull, bm_lathe, bm_prism, bm_sweep, bm_helix, bm_torus,
                          bm_sphere, frange, look, mat_loc, rk, rk_m, front_m, rear_m, roof_m,
                          side_m, sc_m, side_x, rake_y)

PLATE = "interior_grey"     # lighter grey stencil plates (photo), plain without text


def bolt_line(acc, mfun, a0, b0, a1, b1, step, r=0.011, mat="paint_od"):
    for t in frange(0.0, 1.0, step / max(1e-6, math.hypot(a1 - a0, b1 - b0))):
        acc.bolt(mfun(a0 + (a1 - a0) * t, b0 + (b1 - b0) * t), r=r, mat=mat)


def bolt_rect(acc, mfun, a0, b0, a1, b1, step, r=0.010):
    """Bolts around a rectangle in a surface frame (a, b in the frame's own units)."""
    pts = []
    for a in frange(a0, a1, step):
        pts += [(a, b0), (a, b1)]
    for b in frange(b0, b1, step)[1:-1]:
        pts += [(a0, b), (a1, b)]
    for a, b in pts:
        acc.bolt(mfun(a, b), r=r)


def frame4(acc, mfun, a0, b0, a1, b1, w, t, mat="paint_od", bev=0.005, n0=0.0):
    """Raised rectangular frame (4 bars, width w, thickness t) around a0..a1 x b0..b1."""
    for (ca, cb, sa, sb) in (((a0 + a1) / 2, b1 + w / 2, a1 - a0 + 2 * w, w),
                             ((a0 + a1) / 2, b0 - w / 2, a1 - a0 + 2 * w, w),
                             (a0 - w / 2, (b0 + b1) / 2, w, b1 - b0),
                             (a1 + w / 2, (b0 + b1) / 2, w, b1 - b0)):
        acc.box((sa, sb, t), mfun(ca, cb), mat=mat, bev=bev, center=(0, 0, n0 + t / 2))


def diag_mesh(acc, mfun, a0, b0, a1, b1, pitch=0.016, w=0.0035, t=0.003, n=0.006,
              mat="steel_dark"):
    """Expanded-metal look: two sets of diagonal strands clipped to the rectangle."""
    for slope in (1.0, -1.0):
        cmin = (b0 - slope * a1) if slope > 0 else (b0 - slope * a0)
        cmax = (b1 - slope * a0) if slope > 0 else (b1 - slope * a1)
        c = cmin + pitch / 2
        while c < cmax:
            pts = []
            for a in (a0, a1):
                b = slope * a + c
                if b0 - 1e-9 <= b <= b1 + 1e-9:
                    pts.append((a, b))
            for b in (b0, b1):
                a = (b - c) / slope
                if a0 - 1e-9 <= a <= a1 + 1e-9:
                    pts.append((a, b))
            pts = sorted(set((round(p[0], 6), round(p[1], 6)) for p in pts))
            if len(pts) >= 2:
                p0 = mfun(*pts[0]).translation
                p1 = mfun(*pts[-1]).translation
                if (p1 - p0).length > 0.004:
                    nrm = mfun(*pts[0]).col[2].to_3d()
                    acc.bar(p0 + nrm * n, p1 + nrm * n, w, t, mat=mat, bev=0.0, up=nrm)
            c += pitch


# ------------------------------------------------------------------ windscreens
def windscreens(body, glass):
    mf = lambda u, s: rk_m(u, s)  # noqa: E731
    s0, s1 = cu.G_S0, cu.G_S1
    for key, (u0, u1) in cu.PANES.items():
        uc, sc = (u0 + u1) / 2, (s0 + s1) / 2
        w, h = u1 - u0, s1 - s0
        # armoured glass block sitting in the cut opening (thick laminated pane)
        glass.box((w + 0.006, h + 0.006, 0.026), rk_m(uc, sc, -0.018), mat="glass", bev=0.002)
        # black rubber setting strip just inside the opening
        frame4(body, mf, u0, s0, u1, s1, 0.012, 0.012, mat="rubber", bev=0.002, n0=-0.008)
        # thick bolted armour frame plate around the pane
        mu, ms = 0.085, 0.082
        frame4(body, mf, u0 - 0.004, s0 - 0.004, u1 + 0.004, s1 + 0.004, mu, 0.026, bev=0.007)
        # inner chamfer lip of the frame (gives the deep set look)
        frame4(body, mf, u0 - 0.002, s0 - 0.002, u1 + 0.002, s1 + 0.002, 0.014, 0.034,
               mat="paint_od", bev=0.004)
        # frame bolts on the frame mid line
        a0, a1 = u0 - 0.004 - mu / 2, u1 + 0.004 + mu / 2
        b0, b1 = s0 - 0.004 - ms / 2, s1 + 0.004 + ms / 2
        for a in frange(a0, a1, 0.11):
            for b in (b0, b1):
                body.bolt(rk_m(a, b, 0.026), r=0.010)
        for b in frange(b0, b1, 0.11)[1:-1]:
            for a in (a0, a1):
                body.bolt(rk_m(a, b, 0.026), r=0.010)
        # wiper: pivot above the pane, arm parked down toward vehicle right
        piv = (uc - 0.11, s1 + 0.20)
        tip = (uc + 0.13, s1 - 0.03)
        body.cyl(0.026, 0.016, rk_m(*piv, 0.0), mat="paint_od", verts=20, z0=0.0, bev=0.003)
        body.cyl(0.012, 0.03, rk_m(*piv, 0.0), mat="steel_dark", verts=16, z0=0.0, bev=0.002)
        p0 = rk(piv[0], piv[1], 0.034)
        p1 = rk(tip[0], tip[1], 0.042)
        pm = p0.lerp(p1, 0.45)
        body.bar(p0, pm, 0.020, 0.010, mat="steel_dark", up=cu.RK_N, bev=0.002)
        body.bar(pm, p1, 0.011, 0.006, mat="steel_dark", up=cu.RK_N, bev=0.0015)
        # blade parked along the top of the glass, slightly tilted
        ang = math.radians(16)
        half = 0.20
        da = (math.cos(ang) * half, -math.sin(ang) * half)
        b0p = rk(tip[0] - da[0], tip[1] - da[1], 0.046)
        b1p = rk(tip[0] + da[0], tip[1] + da[1], 0.046)
        body.bar(b0p, b1p, 0.014, 0.008, mat="steel_dark", up=cu.RK_N, bev=0.002)
        body.bar(b0p - cu.RK_N * 0.007, b1p - cu.RK_N * 0.007, 0.004, 0.008, mat="rubber",
                 up=cu.RK_N, bev=0.0)
        body.cyl(0.006, 0.014, look(p1, p1 - cu.RK_N), mat="steel", verts=10)


def raked_plate(body):
    top = RK_LEN
    # plain name plate high in the middle (between the wiper pivots)
    body.box((0.52, 0.07, 0.003), rk_m(0.0, top - 0.10, 0.0015), mat=PLATE, bev=0.0)
    # bolts along the plate side edges, the knee and below the roof edge
    for sd in (-1, 1):
        for s in frange(0.05, top - 0.06, 0.11):
            body.bolt(rk_m(sd * (cu.rk_half(s) - 0.045), s), r=0.011)
    for u in frange(-0.80, 0.80, 0.16):
        body.bolt(rk_m(u, top - 0.04), r=0.010)
    # roof-edge lamp brow and the five amber clearance lamps (on the plate top band)
    zt = ZR - 0.006
    body.bar((-XR + 0.03, rake_y(zt) + 0.012, zt), (XR - 0.03, rake_y(zt) + 0.012, zt), 0.02,
             0.012, mat="paint_od")
    for x in (0.60, 0.16, 0.0, -0.14, -0.57):
        z = ZR - 0.016
        y = rake_y(z)
        body.box((0.115, 0.07, 0.048), mat_loc((x, y - 0.006, z)), mat="steel_dark", bev=0.006)
        body.box((0.096, 0.012, 0.032), mat_loc((x, y + 0.030, z)), mat="lens_amber", bev=0.004)
        for sx in (-1, 1):
            body.cyl(0.004, 0.006, look((x + sx * 0.052, y + 0.03, z), (x + sx * 0.052, y + 1, z)),
                     mat="steel", verts=6)
        # wiring stub
        body.rod((x - 0.03, y - 0.04, z - 0.02), (x - 0.04, y - 0.06, z - 0.05), 0.004,
                 mat="rubber", verts=6)


# ------------------------------------------------------------------ lower front face
def front_face(body):
    mf = lambda x, z: front_m(x, z)  # noqa: E731
    # 2x2 mesh louvre panel, raised frame (photo: centred, at the bottom of the face)
    X, z0, z1 = 0.39, 1.48, 1.745
    ops = [((-0.345, -0.025), (1.505, 1.585)), ((0.025, 0.345), (1.505, 1.585)),
           ((-0.345, -0.025), (1.625, 1.705)), ((0.025, 0.345), (1.625, 1.705))]
    t = 0.012
    for (xa, xb), (za, zb) in (((-X, X), (1.705, z1)), ((-X, X), (z0, 1.505)),
                               ((-X, X), (1.585, 1.625)), ((-X, -0.345), (1.505, 1.705)),
                               ((0.345, X), (1.505, 1.705)), ((-0.025, 0.025), (1.505, 1.705))):
        body.box((xb - xa, zb - za, t), front_m((xa + xb) / 2, (za + zb) / 2),
                 bev=0.003, center=(0, 0, t / 2))
    for (xa, xb), (za, zb) in ops:
        body.box((xb - xa, zb - za, 0.004), front_m((xa + xb) / 2, (za + zb) / 2),
                 mat="steel_dark", bev=0.0, center=(0, 0, 0.002))
        diag_mesh(body, mf, xa, za, xb, zb, pitch=0.014, n=0.008, mat="paint_od")
    for x in (-0.37, 0.37):
        for z in (1.492, 1.725):
            body.bolt(front_m(x, z, t), r=0.008, h=0.006)
    # round bridge / number disc on the vehicle left (photo)
    dx, dz = -0.62, 1.63
    body.cyl(0.112, 0.012, front_m(dx, dz), mat="paint_od", verts=48, z0=0.0, bev=0.003)
    body.put(bm_torus(0.106, 0.006, 48, 8), front_m(dx, dz, 0.012), "paint_od", 40.0)
    for k, xo in enumerate((-0.04, 0.04)):
        body.box((0.06, 0.09, 0.004), front_m(dx + xo, dz - 0.015, 0.012), mat=PLATE,
                 bev=0.0, center=(0, 0, 0.002))
    body.box((0.04, 0.035, 0.004), front_m(dx, dz + 0.065, 0.012), mat=PLATE, bev=0.0,
             center=(0, 0, 0.002))
    for a in range(4):
        ang = math.pi / 4 + a * math.pi / 2
        body.bolt(front_m(dx + 0.085 * math.cos(ang), dz + 0.085 * math.sin(ang), 0.012), r=0.007)
    # plain stencil plates (no text): unit plate vehicle left, crew name plates under panes
    body.box((0.36, 0.18, 0.003), front_m(-0.61, 1.93), mat=PLATE, bev=0.0,
             center=(0, 0, 0.0015))
    for xa, xb in ((-0.72, -0.22), (0.13, 0.60)):
        body.box((xb - xa, 0.075, 0.003), front_m((xa + xb) / 2, 2.105), mat=PLATE, bev=0.0,
                 center=(0, 0, 0.0015))
    # bolt rows (photo: perimeter and two scattered rows)
    for x in frange(-FXW + 0.05, FXW - 0.05, 0.30):
        body.bolt(front_m(x, FZ - 0.035), r=0.011)
    for sd in (-1, 1):
        for z in frange(1.50, 2.12, 0.21):
            body.bolt(front_m(sd * (FXW - 0.05), z), r=0.011)
    for x in (-0.86, -0.30, 0.30, 0.86):
        body.bolt(front_m(x, 1.97), r=0.012)
    for x in (-0.86, 0.60, -0.45, 0.45):
        body.bolt(front_m(x, 1.68), r=0.012)
    # front-corner chamfer facets: vertical bolt rows
    for sd in (-1, 1):
        p = Vector((sd * (FXW + XW) / 2, FY - cu.CC / 2, 0))
        nrm = Vector((sd, 1, 0)).normalized()
        for z in frange(1.52, 2.10, 0.145):
            body.bolt(basis((p.x, p.y, z), Vector((-nrm.y, nrm.x, 0)), (0, 0, 1), nrm),
                      r=0.009)


# ------------------------------------------------------------------ roof
def roof(body, fit):
    mf = lambda x, y: roof_m(x, y)  # noqa: E731
    # roof perimeter bolts and a cross seam with bolt strip in front of the hatch
    for y in frange(RY + 0.05, RYF - 0.05, 0.16):
        for sd in (-1, 1):
            body.bolt(roof_m(sd * (XR - 0.04), y), r=0.010)
    for x in frange(-XR + 0.06, XR - 0.06, 0.17):
        body.bolt(roof_m(x, RY + 0.04), r=0.010)
    body.box((2 * XR - 0.06, 0.006, 0.003), roof_m(0, 1.86), mat="rubber", bev=0.0)
    for x in frange(-XR + 0.08, XR - 0.08, 0.12):
        body.bolt(roof_m(x, 1.89), r=0.009)
    # non-slip walkway plate behind the hatch, vehicle left
    body.box((0.40, 0.30, 0.006), roof_m(-0.40, 2.05), mat="steel_dark", bev=0.002,
             center=(0, 0, 0.003))
    for x in frange(-0.57, -0.23, 0.034):
        body.box((0.006, 0.26, 0.004), roof_m(x, 2.05, 0.006), mat="steel_dark", bev=0.0)
    # hatch ring mount (lathe) and closed armoured cover
    hx, hy = cu.HATCH_C
    R = cu.HATCH_R
    prof = [(R - 0.005, -0.03), (R + 0.12, -0.03), (R + 0.12, 0.004), (R + 0.11, 0.014),
            (R + 0.065, 0.016), (R + 0.06, 0.07), (R + 0.045, 0.085), (R + 0.0, 0.085),
            (R - 0.005, 0.07), (R - 0.005, -0.03)]
    fit.put(bm_lathe(prof, 64), mat_loc((hx, hy, ZR)), "paint_od", 35.0)
    for k in range(16):
        a = 2 * math.pi * (k + 0.5) / 16
        fit.bolt(roof_m(hx + (R + 0.092) * math.cos(a), hy + (R + 0.092) * math.sin(a), 0.004),
                 r=0.009)
    # cover: domed disc resting on the ring, hinge at the rear, handle and latch
    cprof = [(0.0, 0.085), (R + 0.03, 0.085), (R + 0.035, 0.095), (R + 0.03, 0.11),
             (R - 0.05, 0.122), (R - 0.15, 0.128), (0.0, 0.13)]
    fit.put(bm_lathe(cprof, 64), mat_loc((hx, hy, ZR)), "paint_od", 35.0)
    fit.cyl(0.03, 0.22, look((hx - 0.11, hy - R - 0.07, ZR + 0.10),
                              (hx + 0.11, hy - R - 0.07, ZR + 0.10)), mat="paint_od", verts=20,
            bev=0.004)
    for sx in (-0.13, 0.13):
        fit.box((0.05, 0.12, 0.03), mat_loc((hx + sx, hy - R - 0.03, ZR + 0.10)), bev=0.006)
    fit.tube([(hx - 0.09, hy + 0.08, ZR + 0.128), (hx - 0.09, hy + 0.08, ZR + 0.17),
              (hx + 0.09, hy + 0.08, ZR + 0.17), (hx + 0.09, hy + 0.08, ZR + 0.128)], 0.009,
             mat="steel")
    fit.box((0.07, 0.05, 0.03), mat_loc((hx, hy + R - 0.01, ZR + 0.115)), mat="steel_dark",
            bev=0.005)
    # lifting eyes on the four roof corners
    for sx in (-1, 1):
        for y in (RY + 0.12, RYF - 0.16):
            x = sx * (XR - 0.12)
            fit.box((0.07, 0.05, 0.02), mat_loc((x, y, ZR + 0.01)), bev=0.004)
            fit.put(bm_torus(0.03, 0.009, 24, 8), basis((x, y, ZR + 0.045), (0, 1, 0),
                                                         (0, 0, 1), (1, 0, 0)), "steel", 40.0)
    # loop antenna base (rear left of the roof)
    ax, ay = -0.52, RY + 0.22
    fit.box((0.16, 0.16, 0.012), mat_loc((ax, ay, ZR + 0.006)), mat="paint_od", bev=0.003)
    for cx in (-0.06, 0.06):
        for cy in (-0.06, 0.06):
            fit.bolt(roof_m(ax + cx, ay + cy, 0.012), r=0.007)
    fit.cyl(0.05, 0.08, mat_loc((ax, ay, ZR + 0.012)), mat="steel_dark", verts=24, z0=0.0,
            bev=0.004)
    fit.cyl(0.03, 0.03, mat_loc((ax, ay, ZR + 0.092)), mat="steel_dark", verts=20, z0=0.0)
    fit.put(bm_helix(0.022, 0.0045, 0.0, 0.10, 7, 12, 6), mat_loc((ax, ay, ZR + 0.12)),
            "steel_dark", 60.0)
    fit.cyl(0.012, 0.08, mat_loc((ax, ay, ZR + 0.22)), mat="steel_dark", verts=12, z0=0.0)
    fit.rod((ax, ay, ZR + 0.06), (ax + 0.10, ay - 0.06, ZR + 0.02), 0.008, mat="rubber")


def whip_bases(fit):
    for sd in (-1, 1):
        y, z = RY + 0.16, 2.47
        xs = side_x(z)
        # bracket off the side chamfer
        p_in = Vector((sd * (xs - 0.01), y, z))
        fit.box((0.10, 0.12, 0.016), mat_loc((sd * (xs - 0.0), y, z)), mat="paint_od",
                bev=0.003)
        bx = sd * (xs + 0.02)
        bx = sd * min(abs(bx), XW - 0.02)
        fit.cyl(0.045, 0.10, mat_loc((bx, y, z + 0.008)), mat="steel_dark", verts=24, z0=0.0,
                bev=0.004)
        fit.cyl(0.028, 0.03, mat_loc((bx, y, z + 0.108)), mat="steel_dark", verts=20, z0=0.0)
        fit.put(bm_helix(0.02, 0.004, 0.0, 0.09, 6, 12, 6), mat_loc((bx, y, z + 0.138)),
                "steel_dark", 60.0)
        fit.cyl(0.012, 0.12, mat_loc((bx, y, z + 0.228)), mat="steel_dark", verts=12, z0=0.0)
        fit.rod((bx, y + 0.03, z + 0.03), (bx, y + 0.12, z - 0.10), 0.007, mat="rubber")


# ------------------------------------------------------------------ sides and rear
def sides(body, fit):
    for sd in (-1, 1):
        sm = lambda a, b: side_m(sd, a if sd > 0 else -a, b)  # noqa: E731
        # applique panel on the side behind the door, bolted all round, seam to the door
        ya, yb = RY + 0.05, cu.DY0 - 0.06
        body.box((0.012, yb - ya, 0.54), mat_loc((sd * (XW + 0.006), (ya + yb) / 2, 1.80)),
                 bev=0.004)
        for y in frange(ya + 0.03, yb - 0.03, 0.12):
            for z in (1.56, 2.04):
                body.bolt(side_m(sd, y, z, 0.012), r=0.010)
        for z in frange(1.56, 2.04, 0.12)[1:-1]:
            for y in (ya + 0.03, yb - 0.03):
                body.bolt(side_m(sd, y, z, 0.012), r=0.010)
        body.box((0.003, 0.30, 0.10), mat_loc((sd * (XW + 0.0135), (ya + yb) / 2, 1.90)),
                 mat=PLATE, bev=0.0)
        # bolts along the side knee and roof edge of the chamfer
        for y in frange(RY + 0.05, FY - 0.12, 0.15):
            if cu.DY0 - 0.03 < y < cu.DY1 + 0.03:
                continue
            body.bolt(sc_m(sd, y, ZK + 0.035), r=0.010)
        for y in frange(RY + 0.05, RYF - 0.08, 0.15):
            if cu.DY0 - 0.03 < y < cu.DY1 + 0.03:
                continue
            body.bolt(sc_m(sd, y, ZR - 0.04), r=0.010)
        # chamfer area ahead of the door: small triangle panel bolts
        for z in (2.20, 2.35):
            body.bolt(sc_m(sd, cu.DY1 + 0.07, z), r=0.009)
        # body-side hinge leaves at the front edge of the door opening
        for zc in (1.72, 2.02):
            body.box((0.014, 0.07, 0.15), mat_loc((sd * (XW + 0.007), cu.DY1 + 0.05, zc)),
                     bev=0.004)
            for dz in (-0.05, 0.05):
                body.bolt(side_m(sd, cu.DY1 + 0.065, zc + dz, 0.014), r=0.008)
        # vertical grab handle behind the door
        yh = cu.DY0 - 0.035
        pts = [(sd * XW, yh, 1.66), (sd * (XW + 0.045), yh, 1.68), (sd * (XW + 0.045), yh, 2.02),
               (sd * XW, yh, 2.04)]
        fit.tube(pts, 0.011, mat="steel")
        for z in (1.66, 2.04):
            fit.cyl(0.02, 0.008, side_m(sd, yh, z), mat="paint_od", verts=16, z0=0.0)
        # sill lip under the door (the cab sits on the chassis fender, Z 1.40: nothing below
        # the floor pan at Z 1.45 over the wheel)
        xo, xi = XW + 0.018, XW - 0.01
        body.box((xo - xi, cu.DY1 - cu.DY0 - 0.04, 0.03),
                 mat_loc((sd * (xo + xi) / 2, (cu.DY0 + cu.DY1) / 2, ZB + 0.015)),
                 mat="paint_od", bev=0.004)
        for y in frange(cu.DY0 + 0.05, cu.DY1 - 0.05, 0.12):
            body.bolt(side_m(sd, y, ZB + 0.015, 0.018), r=0.007, h=0.004)
        # (no hanging step here: the chassis fender slopes through Y 2.6-2.92 below Z 1.40)
        # grab rail along the front corner (raked plate edge, then down the corner facet)
        e_top = Vector((sd * XR, RYF, ZR))
        e_bot = Vector((sd * FXW, FY, FZ))
        out = (Vector((sd, 0, 0.29)).normalized() + cu.RK_N).normalized() * 0.075
        out.x = sd * abs(out.x)
        a = e_top.lerp(e_bot, 0.08) + out
        b = e_top.lerp(e_bot, 0.92) + out
        c = Vector((sd * (XW + 0.045), FY - 0.06, 1.95))
        d = Vector((sd * (XW + 0.045), FY - 0.06, 1.70))
        rail = [e_top.lerp(e_bot, 0.08), a, b, c, d, Vector((sd * XW, FY - 0.06, 1.68))]
        fit.tube(rail, 0.0135, mat="paint_od", segs=14)
        for p, q in ((e_top.lerp(e_bot, 0.5), e_top.lerp(e_bot, 0.5) + out),
                     (Vector((sd * XW, FY - 0.06, 1.95)), c)):
            fit.rod(p, q, 0.009, mat="paint_od")
            fit.cyl(0.022, 0.008, look(p, p + (q - p).normalized()), mat="paint_od", verts=14)


def mirrors(fit):
    for sd in (-1, 1):
        # bracket on the front corner facet
        base = Vector((sd * (XW - 0.03), FY - 0.05, 2.06))
        fit.box((0.06, 0.08, 0.22), mat_loc(base), bev=0.006)
        for z in (1.98, 2.14):
            fit.bolt(basis((base.x, base.y + 0.04, z), (1, 0, 0), (0, 0, 1), (0, 1, 0)), r=0.008)
        reach = 0.45
        hx = sd * (XW + reach)
        hy = FY - 0.045
        arm_lo = [(sd * (XW + 0.0), FY - 0.05, 2.00), (sd * (XW + 0.18), FY - 0.03, 2.00),
                  (hx, hy, 2.04), (hx, hy, 2.16)]
        arm_hi = [(sd * (XW + 0.0), FY - 0.05, 2.12), (sd * (XW + 0.16), FY - 0.03, 2.20),
                  (hx - sd * 0.08, hy, 2.56)]
        fit.tube(arm_lo, 0.014, mat="steel", segs=12)
        fit.tube(arm_hi, 0.012, mat="steel", segs=12)
        # main head: tall rectangle facing rear
        hz = 2.37
        fit.box((0.21, 0.06, 0.40), mat_loc((hx, hy + 0.01, hz)), mat="steel_dark", bev=0.012,
                seg=3)
        fit.box((0.18, 0.006, 0.37), mat_loc((hx, hy - 0.021, hz)), mat="chrome", bev=0.0)
        fit.box((0.03, 0.04, 0.05), mat_loc((hx, hy + 0.03, 2.18)), mat="steel_dark",
                bev=0.006)
        fit.box((0.03, 0.04, 0.05), mat_loc((hx - sd * 0.08, hy + 0.03, 2.55)),
                mat="steel_dark", bev=0.006)
        # round convex spot mirror under the head
        sp = Vector((hx - sd * 0.02, hy - 0.01, 2.08))
        fit.put(bm_sphere(0.075, 24, 10, (1, 0.35, 1)), mat_loc(sp), "steel_dark", 40.0)
        fit.put(bm_sphere(0.068, 24, 10, (1, 0.25, 1)), mat_loc(sp - Vector((0, 0.014, 0))),
                "chrome", 40.0)
        fit.rod(sp + Vector((0, 0.02, 0.05)), (hx, hy + 0.01, 2.16), 0.007, mat="steel")


def rear(body):
    rm = lambda x, z: rear_m(x, z)  # noqa: E731
    body.box((1.70, 0.54, 0.012), rear_m(0, 1.86), bev=0.004, center=(0, 0, 0.006))
    for x in frange(-0.82, 0.82, 0.15):
        for z in (1.62, 2.10):
            body.bolt(rear_m(x, z, 0.012), r=0.010)
    for z in frange(1.62, 2.10, 0.12)[1:-1]:
        for x in (-0.82, 0.82):
            body.bolt(rear_m(x, z, 0.012), r=0.010)
    body.box((0.34, 0.12, 0.003), rear_m(0.40, 1.95, 0.012), mat=PLATE, bev=0.0,
             center=(0, 0, 0.0015))
    for x in frange(-XR + 0.06, XR - 0.06, 0.18):
        body.bolt(rear_m(x, ZR - 0.04), r=0.010)


def build(body, glass, fit):
    windscreens(body, glass)
    raked_plate(body)
    front_face(body)
    roof(body, fit)
    whip_bases(fit)
    sides(body, fit)
    mirrors(fit)
    rear(body)
