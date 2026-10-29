"""LSAC cab doors: one object per door, "DoorL" / "DoorR" (hr_node DoorL / DoorR), origin on
layout.DOOR_HINGE (front edge, the door swings about a vertical axis there).

Each door is a 55 mm armour slab bent like the body side: vertical up to the side knee
(Z 2.12), then following the upper side chamfer; its front-top corner is clipped along the
raked windscreen plate. It carries the small armoured window (layout CAB door_window_z,
width door_window_w) with a bolted frame and glass, two heavy hinges, an outside pull handle
and latch, perimeter bolts, and the inner trim panel, handle and armrest.
"""
import math

import bmesh
from mathutils import Vector

import cab_ext_util as cu
import hr
import layout as L
from cab_ext_util import (XW, ZK, basis, bm_box, bm_prism, mat_loc, look, sc_m, side_m,
                          side_x, frange, transformed)


def _slab(sd):
    pr, T = cu.DOOR_PROUD, cu.DOOR_T
    z0, z1 = cu.DZ0, cu.DZ1
    xo_top = side_x(z1) + pr
    t_up = T / math.cos(math.atan(cu.SIDE_K))
    poly = [(XW + pr, z0), (XW + pr, ZK), (xo_top, z1), (xo_top - t_up, z1),
            (XW + pr - T, ZK - 0.01), (XW + pr - T, z0)]
    poly = [(sd * x, z) for x, z in poly]
    bm = bm_prism(poly, cu.DY0, cu.DY1)
    # local x = world X, local y = world Z, local z = world Y
    transformed(bm, basis((0, 0, 0), (1, 0, 0), (0, 0, 1), (0, 1, 0)))
    # clip the front-top corner along the raked plate
    yt = cu.rake_y(z1) - 0.10
    p0 = Vector((0, cu.DY1, cu.DOOR_CLIP_Z))
    d = Vector((0, yt - cu.DY1, z1 - cu.DOOR_CLIP_Z))
    nrm = Vector((0, d.z, -d.y)).normalized()
    res = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:],
                                 plane_co=p0, plane_no=nrm, clear_outer=True)
    edges = [e for e in bm.edges if e.is_boundary]
    bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=0.007, segments=2, affect="EDGES",
                    profile=0.5, clamp_overlap=True)
    obj = cu.obj_from_bm(bm, f"door_slab_tmp_{sd}")
    # window opening, straight through
    win = bm_box(0.40, cu.WIN_W, cu.WIN_Z1 - cu.WIN_Z0,
                 center=(sd * 1.0, (cu.WIN_Y0 + cu.WIN_Y1) / 2, (cu.WIN_Z0 + cu.WIN_Z1) / 2))
    cu.boolean(obj, win)
    return obj


def _door(sd):
    name = "DoorL" if sd < 0 else "DoorR"
    acc = cu.Acc(name, name)
    slab = _slab(sd)
    acc.put(cu.bm_from_obj(slab), None, "paint_od", 12.0)
    me = slab.data
    hr_obj = slab
    import bpy
    bpy.data.objects.remove(hr_obj, do_unlink=True)
    bpy.data.meshes.remove(me)

    pr, T = cu.DOOR_PROUD, cu.DOOR_T
    ya, yb = cu.WIN_Y0, cu.WIN_Y1
    za, zb = cu.WIN_Z0, cu.WIN_Z1
    yc, zc = (ya + yb) / 2, (za + zb) / 2
    slant = 1.0 / math.cos(math.atan(cu.SIDE_K))
    # window glass (thick, set inside the slab) and rubber setting strip
    acc.box((cu.WIN_W + 0.008, (zb - za) * slant + 0.008, 0.024), sc_m(sd, yc, zc, pr - 0.03),
            mat="glass", bev=0.002)
    # bolted armour frame around the window (on the chamfered upper door)
    mf = lambda a, b: sc_m(sd, a, b, pr)  # noqa: E731
    w, t = 0.055, 0.022
    for (ca, cb, sa, sb) in ((yc, zb + w / 2 / slant, cu.WIN_W + 2 * w, w),
                             (yc, za - w / 2 / slant, cu.WIN_W + 2 * w, w),
                             (ya - w / 2, zc, w, (zb - za) * slant),
                             (yb + w / 2, zc, w, (zb - za) * slant)):
        acc.box((sa, sb, t), mf(ca, cb), bev=0.005, center=(0, 0, t / 2))
    for a in (ya - w / 2, yb + w / 2):
        for b in (za - w / 2 / slant, zc, zb + w / 2 / slant):
            acc.bolt(sc_m(sd, a, b, pr + t), r=0.009)
    for a in (yc - 0.08, yc + 0.08):
        for b in (za - w / 2 / slant, zb + w / 2 / slant):
            acc.bolt(sc_m(sd, a, b, pr + t), r=0.009)
    # perimeter bolts on the lower (vertical) door skin
    for y in frange(cu.DY0 + 0.04, cu.DY1 - 0.10, 0.11):
        acc.bolt(side_m(sd, y, cu.DZ0 + 0.04, pr), r=0.010)
        acc.bolt(side_m(sd, y, ZK - 0.03, pr), r=0.010)
    for z in frange(cu.DZ0 + 0.04, ZK - 0.03, 0.11)[1:-1]:
        acc.bolt(side_m(sd, cu.DY0 + 0.04, z, pr), r=0.010)
    # upper skin bolts along the rear edge and the top
    for z in (2.24, 2.40, 2.56):
        acc.bolt(sc_m(sd, cu.DY0 + 0.04, z, pr), r=0.010)
    for y in frange(cu.DY0 + 0.04, ya - 0.10, 0.10):
        acc.bolt(sc_m(sd, y, cu.DZ1 - 0.035, pr), r=0.010)
    # horizontal stiffening rib at the knee
    acc.box((cu.DY1 - cu.DY0 - 0.06, 0.03, 0.012),
            side_m(sd, (cu.DY0 + cu.DY1) / 2 - 0.0, ZK - 0.075, pr), bev=0.004,
            center=(0, 0, 0.006))
    # plain stencil plate on the door
    acc.box((0.24, 0.07, 0.003), side_m(sd, cu.DY0 + 0.22, 1.72, pr), mat="interior_grey",
            bev=0.0, center=(0, 0, 0.0015))
    # hinges: door leaves, knuckles on the axis line, pin caps
    hx = L.DOOR_HINGE[name][0] - sd * 0.02
    hy = cu.DY1 + 0.008
    for zc_h in (1.72, 2.02):
        acc.box((0.010, 0.16, 0.13), mat_loc((sd * (XW + pr + 0.005), cu.DY1 - 0.075, zc_h)),
                bev=0.003)
        for y in (cu.DY1 - 0.13, cu.DY1 - 0.07):
            for dz in (-0.04, 0.04):
                acc.bolt(side_m(sd, y, zc_h + dz, pr + 0.010), r=0.009, h=0.004)
        acc.cyl(0.020, 0.15, mat_loc((hx, hy, zc_h)), mat="paint_od", verts=24, bev=0.004)
        acc.cyl(0.010, 0.17, mat_loc((hx, hy, zc_h)), mat="steel", verts=12)
    # outside pull handle (U bar) and latch paddle near the rear edge
    hy0, hy1, hz = cu.DY0 + 0.07, cu.DY0 + 0.25, 1.93
    xo = sd * (XW + pr)
    # low-profile pull bar (the envelope is layout CAB half_width_low)
    acc.tube([(xo, hy0, hz), (xo + sd * 0.009, hy0 + 0.015, hz), (xo + sd * 0.009, hy1 - 0.015, hz),
              (xo, hy1, hz)], 0.009, mat="steel")
    for y in (hy0, hy1):
        acc.cyl(0.02, 0.008, side_m(sd, y, hz, pr), mat="paint_od", verts=16, z0=0.0)
    acc.box((0.10, 0.06, 0.011), side_m(sd, cu.DY0 + 0.13, 1.80, pr), mat="steel_dark",
            bev=0.004, center=(0, 0, 0.0055))
    acc.box((0.10, 0.025, 0.007), side_m(sd, cu.DY0 + 0.14, 1.80, pr + 0.011), mat="steel",
            bev=0.003, center=(0, 0, 0.0035))
    acc.cyl(0.012, 0.006, side_m(sd, cu.DY0 + 0.06, 1.80, pr), mat="steel", verts=16,
            z0=0.0)   # lock cylinder
    # inner trim: padded panel, armrest, inner lever and pull strap
    xi = XW + pr - T
    acc.box((0.016, cu.DY1 - cu.DY0 - 0.12, 0.46),
            mat_loc((sd * (xi - 0.008), (cu.DY0 + cu.DY1) / 2, 1.82)), mat="interior_grey",
            bev=0.006)
    for z in (1.70, 1.82, 1.94):
        acc.box((0.004, cu.DY1 - cu.DY0 - 0.16, 0.004), mat_loc((sd * (xi - 0.017),
                (cu.DY0 + cu.DY1) / 2, z)), mat="interior_dark", bev=0.0)
    acc.box((0.07, 0.30, 0.05), mat_loc((sd * (xi - 0.05), cu.DY0 + 0.30, 1.98)),
            mat="interior_dark", bev=0.012, seg=3)
    acc.box((0.03, 0.12, 0.025), mat_loc((sd * (xi - 0.035), cu.DY0 + 0.12, 1.88)),
            mat="steel", bev=0.006)
    acc.box((0.018, 0.05, 0.10), mat_loc((sd * (xi - 0.025), cu.DY0 + 0.06, 1.88)),
            mat="steel_dark", bev=0.004)
    acc.tube([(sd * (xi - 0.016), cu.DY0 + 0.40, 2.08), (sd * (xi - 0.06), cu.DY0 + 0.48, 2.06),
              (sd * (xi - 0.016), cu.DY0 + 0.56, 2.08)], 0.008, mat="canvas", segs=8)
    # inner window surround
    xin = side_x(zc) - T * slant
    for (ca, cb, sa, sb) in ((yc, zb + 0.02, cu.WIN_W + 0.08, 0.04),
                             (yc, za - 0.02, cu.WIN_W + 0.08, 0.04),
                             (ya - 0.02, zc, 0.04, (zb - za) * slant),
                             (yb + 0.02, zc, 0.04, (zb - za) * slant)):
        acc.box((sa, sb, 0.012), sc_m(sd, ca, cb, pr - T - 0.012 * slant), mat="interior_grey",
                bev=0.003, center=(0, 0, 0.006))
    obj = acc.finish()
    hr.set_origin(obj, L.DOOR_HINGE[name])
    return obj


def build():
    return [_door(-1), _door(1)]
