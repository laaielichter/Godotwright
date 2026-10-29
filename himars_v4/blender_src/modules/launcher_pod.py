"""Launch pods (v4): one slab-sided box per variant, sized exactly to layout.POD.

PodSix (GMLRS, 2 x 3 tubes at layout.TUBE_X / TUBE_Z), PodSingle (ATACMS, one 0.61 m canister)
and PodDual (PrSM, two 0.43 m canisters) share the same outer box: skins, corner angles, ribs,
three riveted access panels per side, horizontal rub strips, lifting points, stencil plates and
the end collars. The pod sits centred between the module side housings (launcher_housing).
Only the end openings, bulkheads, tubes and caps differ.

The end caps are separate objects so the game can hide one when its rocket fires:
pod_cap_rear_1..6 / pod_cap_front_1..6 (numbered like layout.ROCKETS: upper row first, then
x = -0.335, 0, +0.335), pod_single_cap_rear_1 / _front_1, pod_dual_cap_rear_1..2 / _front_1..2.
Each cap's origin is its tube axis point on the end face.
"""
import math

import launcher_util as lu
import layout as L

X1 = L.POD["half_width"]                # 0.525
YR, YF = L.POD["y"][1], L.POD["y"][0]   # rear -3.48, front 0.54
Z0, Z1 = L.POD["z"]                     # 1.46, 2.47
ZC = L.POD_CENTER[2]
SKIN_X = 0.515                          # side skin face; ribs, angles and end collars reach X1
TOP_Z, BOT_Z = 2.460, 1.470
REAR_DEPTH = 0.15                       # rear collar depth: drum caps sit in this recess
FRONT_DEPTH = 0.07
Y_RB = YR + REAR_DEPTH                  # rear bulkhead face
Y_FB = YF - FRONT_DEPTH                 # front bulkhead face
PANELS = [(-3.20, -2.22), (-2.12, -1.14), (-1.04, -0.30)]   # access panels along Y
PANEL_Z = (1.66, 2.30)
RIB_Y = [-3.27, -2.17, -1.09, -0.25]
PAINT = "paint_od"


def _rivet_row(node, p0, p1, pitch, axis, r=0.0055, h=0.0035):
    a = [p1[i] - p0[i] for i in range(3)]
    length = math.sqrt(sum(c * c for c in a))
    n = max(1, int(length / pitch))
    for i in range(n + 1):
        f = i / n
        c = tuple(p0[j] + a[j] * f for j in range(3))
        lu.rivet("rivet", c, axis, r, h, PAINT, node, segs=6)


def _both(fn):
    for s in (1, -1):
        fn(s)


# ---------------------------------------------------------------------------- outer box
def _shell(node):
    y0, y1 = Y_RB - 0.01, Y_FB + 0.01
    lu.hollow_y("pod_skin", (-SKIN_X, SKIN_X, BOT_Z, TOP_Z),
                (-SKIN_X + 0.012, SKIN_X - 0.012, BOT_Z + 0.012, TOP_Z - 0.012), y0, y1, PAINT, node)
    ym, ly = (y0 + y1) / 2, y1 - y0
    # long corner angles (L sections) on the four edges: they set the box extents
    for sx in (1, -1):
        for zc, sz in ((Z1, -1), (Z0, 1)):
            lu.box("pod_angle_h", (sx * (X1 - 0.022), ym, zc + sz * 0.0075), (0.044, ly, 0.015),
                   PAINT, node, bev=0.003)
            lu.box("pod_angle_v", (sx * (X1 - 0.0075), ym, zc + sz * 0.024), (0.015, ly, 0.048),
                   PAINT, node, bev=0.003)
    # vertical stiffener ribs (hat sections) between the panels, and matching ribs over the top
    for y in RIB_Y:
        for sx in (1, -1):
            lu.box("pod_rib_side", (sx * (SKIN_X + 0.005), y, ZC), (0.010, 0.07, TOP_Z - BOT_Z - 0.04),
                   PAINT, node, bev=0.003)
            lu.box("pod_rib_flange", (sx * (SKIN_X + 0.002), y, ZC), (0.004, 0.11, TOP_Z - BOT_Z - 0.04),
                   PAINT, node)
            for dy in (-0.045, 0.045):
                _rivet_row(node, (sx * (SKIN_X + 0.004), y + dy, BOT_Z + 0.06),
                           (sx * (SKIN_X + 0.004), y + dy, TOP_Z - 0.06), 0.075, (sx, 0, 0))
        lu.box("pod_rib_top", (0.0, y, TOP_Z + 0.005), (2 * SKIN_X - 0.06, 0.07, 0.010), PAINT, node,
               bev=0.003)
    # horizontal rub strips (the seam lines in the photos) and rivet rows along the skin edges
    for sx in (1, -1):
        for z in (1.585, 2.375):
            lu.box("pod_strip", (sx * (SKIN_X + 0.004), ym, z), (0.008, ly, 0.03), PAINT, node, bev=0.002)
        for z in (BOT_Z + 0.055, TOP_Z - 0.04):
            _rivet_row(node, (sx * (SKIN_X + 0.0), y0 + 0.04, z), (sx * SKIN_X, y1 - 0.04, z), 0.09, (sx, 0, 0))
        _rivet_row(node, (sx * (X1 - 0.06), y0 + 0.04, TOP_Z), (sx * (X1 - 0.06), y1 - 0.04, TOP_Z), 0.09,
                   (0, 0, 1), h=0.0028)


def _panels(node):
    for sx in (1, -1):
        xf = sx * SKIN_X
        for k, (ya, yb) in enumerate(PANELS):
            yc, ly = (ya + yb) / 2, yb - ya
            za, zb = PANEL_Z
            zc, lz = (za + zb) / 2, zb - za
            lu.box("panel", (sx * (SKIN_X + 0.002), yc, zc), (0.004, ly, lz), PAINT, node, bev=0.003)
            # rivets round the panel border
            xr = sx * (SKIN_X + 0.004)
            for p0, p1 in (((xr, ya + 0.025, za + 0.025), (xr, yb - 0.025, za + 0.025)),
                           ((xr, ya + 0.025, zb - 0.045), (xr, yb - 0.025, zb - 0.045)),
                           ((xr, ya + 0.025, za + 0.06), (xr, ya + 0.025, zb - 0.08)),
                           ((xr, yb - 0.025, za + 0.06), (xr, yb - 0.025, zb - 0.08))):
                _rivet_row(node, p0, p1, 0.06, (sx, 0, 0), r=0.005, h=0.003)
            # flush piano hinge along the top edge
            lu.cyl("panel_hinge", (sx * (SKIN_X + 0.005), ya + 0.03, zb - 0.012),
                   (sx * (SKIN_X + 0.005), yb - 0.03, zb - 0.012), 0.0055, PAINT, node, segs=8)
            for j in range(5):
                yy = ya + 0.05 + j * (ly - 0.10) / 4
                lu.box("panel_hinge_leaf", (sx * (SKIN_X + 0.0045), yy, zb - 0.03), (0.002, 0.06, 0.03),
                       PAINT, node)
            # two latches with T-handles near the bottom edge
            for f in (0.22, 0.78):
                yy = ya + ly * f
                lu.box("latch_base", (sx * (SKIN_X + 0.0055), yy, za + 0.07), (0.007, 0.07, 0.05),
                       "steel_dark", node, bev=0.002)
                lu.box("latch_handle", (sx * (SKIN_X + 0.008), yy, za + 0.07), (0.004, 0.05, 0.012),
                       "steel", node, bev=0.001)
            # small padlock hasp on the middle panel only (as on the photo vehicles)
            if k == 1:
                lu.box("hasp", (sx * (SKIN_X + 0.006), yc, za + 0.18), (0.006, 0.03, 0.06), "steel", node)
        # plain stencil plates (no text): front section and rear section of each side
        lu.box("stencil_side_f", (sx * (SKIN_X + 0.0015), -0.02, 2.12), (0.003, 0.36, 0.20),
               "paint_tan", node, bev=0.002)
        lu.box("stencil_side_lift", (sx * (SKIN_X + 0.0015), 0.25, 1.75), (0.003, 0.16, 0.08),
               "paint_tan", node, bev=0.002)
        lu.box("stencil_side_r", (sx * (SKIN_X + 0.0015), -3.31, 1.72), (0.003, 0.05, 0.16),
               "paint_tan", node, bev=0.001)
        # hand-hold pocket and lift lug plate in the rear side section
        lu.box("pocket_rim", (sx * (SKIN_X + 0.004), -3.30, 2.22), (0.008, 0.05, 0.10), PAINT, node, bev=0.002)
        lu.box("pocket", (sx * (SKIN_X + 0.0045), -3.30, 2.22), (0.004, 0.035, 0.075), "steel_dark", node)
        # long hydraulic/cable conduit along the lower side (as seen under the panels)
        lu.cyl("conduit", (sx * (SKIN_X + 0.004), -3.25, 1.535), (sx * (SKIN_X + 0.004), 0.40, 1.535),
               0.006, "steel_dark", node, segs=8)
        for y in (-2.9, -2.2, -1.5, -0.8, -0.1):
            lu.box("conduit_clip", (sx * (SKIN_X + 0.004), y, 1.535), (0.008, 0.025, 0.02), "steel", node)


def _lift_points(node):
    """Four recessed lifting rings on the top corners and corner castings on all eight corners."""
    for sx in (1, -1):
        for y in (YR + 0.32, YF - 0.25):
            lu.box("lift_pad", (sx * 0.40, y, TOP_Z + 0.002), (0.10, 0.10, 0.004), "steel_dark", node)
            lu.torus("lift_ring", (sx * 0.40, y, TOP_Z + 0.0055), (0, 0, 1), 0.032, 0.0055, "steel", node,
                     segs=20, msegs=6)
            lu.box("lift_bar", (sx * 0.40, y + 0.035, TOP_Z + 0.006), (0.04, 0.012, 0.008), "steel", node)
        for y, sy in ((YR, 1), (YF, -1)):
            for z, sz in ((Z0, 1), (Z1, -1)):
                c = (sx * (X1 - 0.04), y + sy * 0.04, z + sz * 0.04)
                lu.box("corner_cast", c, (0.08, 0.08, 0.08), PAINT, node, bev=0.006)
                lu.box("corner_hole", (sx * (X1 - 0.0015), y + sy * 0.04, z + sz * 0.04), (0.004, 0.03, 0.045),
                       "steel_dark", node)


# ---------------------------------------------------------------------------- end collars
def _collar(node, y_out, depth, opening, rear):
    """End frame flush with the box end: two corner posts, a top and a bottom band, framing the
    opening (x half width, z0, z1) where the bulkhead and caps sit."""
    sy = 1 if rear else -1                  # direction into the box
    hx, oz0, oz1 = opening
    yc = y_out + sy * (depth / 2 + 0.01)
    d = depth - 0.02                        # the outer face sits 2 cm in; details reach the end
    for sx in (1, -1):
        lu.box("collar_post", (sx * (hx + X1) / 2, yc, ZC), (X1 - hx, d, Z1 - Z0), PAINT, node, bev=0.006)
    lu.box("collar_top", (0, yc, (oz1 + Z1) / 2), (2 * hx + 0.002, d, Z1 - oz1), PAINT, node, bev=0.006)
    lu.box("collar_bot", (0, yc, (Z0 + oz0) / 2), (2 * hx + 0.002, d, oz0 - Z0), PAINT, node, bev=0.006)
    yf = y_out + sy * 0.02                  # outer face
    # flange lip round the opening
    for z in (oz0, oz1):
        lu.box("collar_lip", (0, yf - sy * 0.003, z), (2 * hx + 0.02, 0.006, 0.02), PAINT, node, bev=0.002)
    for sx in (1, -1):
        lu.box("collar_lip", (sx * hx, yf - sy * 0.003, (oz0 + oz1) / 2), (0.02, 0.006, oz1 - oz0 + 0.02),
               PAINT, node, bev=0.002)
    # rivets round the outer face
    for z in (Z0 + 0.03, Z1 - 0.03):
        _rivet_row(node, (-X1 + 0.03, yf, z), (X1 - 0.03, yf, z), 0.07, (0, -sy, 0), r=0.005, h=0.003)
    for sx in (1, -1):
        _rivet_row(node, (sx * (X1 - 0.03), yf, Z0 + 0.08), (sx * (X1 - 0.03), yf, Z1 - 0.08), 0.07,
                   (0, -sy, 0), r=0.005, h=0.003)
    if rear:
        # stencil plates on the bottom band (left: unit, right: bumper number), plain
        bh = oz0 - Z0
        for sx, w in ((-1, 0.36), (1, 0.30)):
            lu.box("stencil_rear", (sx * 0.27, yf - 0.002, Z0 + bh * 0.42), (w, 0.004, min(0.12, bh * 0.5)),
                   "paint_tan", node, bev=0.002)
        # latch rod with brackets and safety chain under the opening
        zr = oz0 - 0.035
        lu.cyl("latch_rod", (-0.30, yf - 0.010, zr), (0.30, yf - 0.010, zr), 0.009, "steel", node, segs=10)
        for x in (-0.27, -0.06, 0.06, 0.27):
            lu.box("latch_rod_brk", (x, yf - 0.006, zr), (0.03, 0.012, 0.04), PAINT, node, bev=0.002)
        lu.box("latch_handle", (0.15, yf - 0.012, zr), (0.025, 0.012, 0.07), "steel", node)
        for i in range(6):
            lu.torus("chain", (-0.12 + i * 0.022, yf - 0.009, zr - 0.012 - 0.004 * (i % 2)),
                     (0, 0, 1) if i % 2 else (0, 1, 0), 0.008, 0.0022, "steel", node, segs=8, msegs=4)
        # narrow posts (the pod sits between the module's side housings): just a tie-down eye each
        for sx in (1, -1):
            lu.box("post_lift_lug", (sx * (hx + X1) / 2, yf - 0.006, Z1 - 0.075), (0.012, 0.012, 0.05), "steel", node)
        # top bar with end brackets over the opening (as in 8391601 / 1808480)
        zt = oz1 + (Z1 - oz1) * 0.55
        lu.box("top_bar", (0, yf - 0.009, zt), (2 * hx - 0.04, 0.018, 0.03), PAINT, node, bev=0.004)
        for x in (-hx + 0.05, 0.0, hx - 0.05):
            lu.box("top_bar_brk", (x, yf - 0.006, zt), (0.04, 0.012, 0.05), PAINT, node, bev=0.003)
    else:
        lu.box("stencil_front", (0.0, yf + 0.002, Z1 - (Z1 - oz1) * 0.5), (0.30, 0.004, min(0.10, (Z1 - oz1) * 0.6)),
               "paint_tan", node, bev=0.002)
        for sx in (1, -1):
            lu.box("front_hook", (sx * (hx + X1) / 2, yf + 0.006, Z0 + 0.10), (0.03, 0.012, 0.06), "steel", node)


# ---------------------------------------------------------------------- tubes and caps
def _cells(centres, opening, r_hole):
    """Tile the opening with one cell per tube centre: split X at the midpoints between the
    centres' distinct x, and Z likewise."""
    hx, oz0, oz1 = opening
    xs = sorted(set(round(c[0], 5) for c in centres))
    zs = sorted(set(round(c[1], 5) for c in centres))

    def edges(vals, lo, hi):
        e = [lo]
        for a, b in zip(vals, vals[1:]):
            e.append((a + b) / 2)
        e.append(hi)
        return e

    ex, ez = edges(xs, -hx, hx), edges(zs, oz0, oz1)
    cells = []
    for cx, cz in centres:
        i, j = xs.index(round(cx, 5)), zs.index(round(cz, 5))
        cells.append((ex[i], ex[i + 1], ez[j], ez[j + 1], cx, cz, r_hole))
    return cells


def _rear_cap(name, node, cx, cz, R, length):
    """Deep drum cover with a domed face, rim bead and a recessed ring (aft cover)."""
    t0 = 0.0
    # the outer radius never exceeds R, so caps whose rows touch do not intersect
    prof = [(0.0, t0), (R * 0.95, t0), (R * 0.985, t0 + 0.008), (R * 0.985, length - 0.034),
            (R, length - 0.030), (R, length - 0.018), (R * 0.985, length - 0.014),
            (R * 0.96, length - 0.008), (R * 0.88, length - 0.006), (R * 0.86, length - 0.009),
            (R * 0.82, length - 0.009), (R * 0.80, length - 0.005), (R * 0.55, length - 0.002),
            (0.0, length)]
    o = lu.revolve("cap_rear", prof, (cx, Y_RB, cz), (0, -1, 0), "gmlrs_airframe", node, segs=40)
    return lu.keep(o, name, (cx, YR, cz))


def _front_cap(name, node, cx, cz, R):
    """Thin frangible muzzle cover with a rim, slightly domed."""
    L = 0.035
    prof = [(0.0, 0.0), (R, 0.0), (R + 0.006, 0.006), (R + 0.006, 0.020), (R, 0.024),
            (R * 0.92, 0.026), (R * 0.6, 0.032), (0.0, L)]
    o = lu.revolve("cap_front", prof, (cx, Y_FB, cz), (0, 1, 0), "gmlrs_airframe", node, segs=40)
    return lu.keep(o, name, (cx, YF, cz))


def _tubes_and_ends(node, centres, r_out, r_in, cap_r, cap_len, opening, prefix, housing=0.0):
    rear_cells = _cells(centres, opening, r_out)
    lu.holed_plate("bulkhead_rear", Y_RB, Y_RB + 0.012, rear_cells, PAINT, node)
    lu.holed_plate("bulkhead_front", Y_FB - 0.012, Y_FB, rear_cells, PAINT, node)
    for i, (cx, cz) in enumerate(centres, 1):
        # launch tube / canister wall (hollow, open bore)
        lu.revolve("tube", lu.rrect(r_in, r_out, 0.0, Y_FB - Y_RB, 0.002, 1), (cx, Y_RB, cz), (0, 1, 0),
                   "steel_dark", node, segs=40, closed=True)
        # round housing collar on the canister ends (the visible 0.61 / 0.43 m ring)
        if housing > 0:
            for y0, sy in ((Y_RB, -1), (Y_FB, 1)):
                lu.revolve("housing", lu.rrect(r_out, r_out + housing, 0.0, 0.03, 0.004, 1),
                           (cx, y0, cz), (0, sy, 0), PAINT, node, segs=56, closed=True)
                for k in range(12):
                    th = math.tau * k / 12
                    rr = r_out + housing * 0.5
                    lu.bolt("housing_bolt", (cx + math.cos(th) * rr, y0 + sy * 0.03, cz + math.sin(th) * rr),
                            (0, sy, 0), 0.008, 0.006, "steel", node)
        # breech ring and umbilical connector visible inside the bore when the cap is off
        lu.revolve("breech_ring", lu.rrect(r_in - 0.012, r_in, 0.0, 0.02, 0.003, 1),
                   (cx, Y_RB + 0.30, cz), (0, 1, 0), "steel", node, segs=32, closed=True)
        lu.box("umbilical", (cx, Y_RB + 0.33, cz - r_in + 0.02), (0.05, 0.05, 0.03), "steel", node)
        tag = f"{prefix}_rear_{i}"
        _rear_cap(tag, node, cx, cz, cap_r, cap_len)
        _front_cap(f"{prefix}_front_{i}", node, cx, cz, r_out + 0.004)


# ------------------------------------------------------------------------------- variants
def _pod(node, centres, r_out, r_in, cap_r, opening, prefix, housing=0.0):
    _shell(node)
    _panels(node)
    _lift_points(node)
    _collar(node, YR, REAR_DEPTH, opening, rear=True)
    _collar(node, YF, FRONT_DEPTH, opening, rear=False)
    _tubes_and_ends(node, centres, r_out, r_in, cap_r, REAR_DEPTH - 0.003, opening, prefix, housing)


def build_six():
    centres = [(x, z) for z in L.TUBE_Z for x in L.TUBE_X]
    hz = (L.TUBE_Z[0] - L.TUBE_Z[1]) / 2          # 0.155: the cap rows touch (photo)
    hx = max(L.TUBE_X) + L.CAP_R + 0.005           # 0.495: 3 cm posts beside the outer caps
    opening = (hx, ZC - 2 * hz - 0.003, ZC + 2 * hz + 0.003)   # z 1.652..2.278
    _pod("PodSix", centres, L.TUBE_R_OUT, L.TUBE_R_IN, L.CAP_R, opening, "pod_cap")


def build_single():
    # ATACMS: one 0.61 m round housing on the box centre line
    opening = (X1 - 0.06, ZC - 0.34, ZC + 0.34)
    _pod("PodSingle", [(0.0, ZC)], 0.285, 0.272, 0.278, opening, "pod_single_cap", housing=0.02)


def build_dual():
    # PrSM: two 0.43 m canister ends side by side
    opening = (X1 - 0.06, ZC - 0.25, ZC + 0.25)
    _pod("PodDual", [(-0.235, ZC), (0.235, ZC)], 0.195, 0.184, 0.190, opening, "pod_dual_cap",
         housing=0.02)
