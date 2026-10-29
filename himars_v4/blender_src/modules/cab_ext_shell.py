"""LSAC armoured cab shell (node Body, paint_od).

The outer body is the convex hull of the photo-measured outline: narrow roof (half width
0.86), side chamfers down to the widest point at Z 2.12, vertical sides, a vertical lower
front face at layout.CAB front_y with small vertical corner chamfers, and the upper front
plate raked 35 deg from the knee at Z 2.19 to the roof. It is bevelled, made hollow
(30 mm armour) and the windscreen, door and hatch openings are cut. Below the floor pan the
narrower front block (louvre panel, corner blocks, NO STEP side boxes) runs down to
CAB body_bottom_z, ahead of the front tyres. The cab sits on the chassis fenders (Z 1.40,
sloping to Y 2.92, Z 1.02): nothing of the cab is below the floor pan (Z 1.45) over the
wheels, and the lower front stays ahead of the frame rail ends (Y 3.23, Z 1.12-1.29).
"""
import math

import bmesh
import bpy
from mathutils import Vector

import cab_ext_util as cu
from cab_ext_util import (FY, RY, ZB, ZR, XW, XR, ZK, FZ, FXW, RYF, CC, basis, bm_box,
                          bm_cyl, bm_hull, bm_prism, transformed)


def hull_points():
    pts = []
    for sd in (-1, 1):
        pts += [(sd * XW, RY, ZB), (sd * XW, RY, ZK), (sd * XR, RY, ZR),
                (sd * XW, FY - CC, ZB), (sd * XW, FY - CC, ZK),
                (sd * FXW, FY, ZB), (sd * FXW, FY, FZ),
                (sd * XR, RYF, ZR)]
    return pts


def door_poly(grow=0.0):
    """Door outline in (Y, Z), front-top corner clipped along the raked plate."""
    y0, y1 = cu.DY0 - grow, cu.DY1 + grow
    z0, z1 = cu.DZ0 - grow, cu.DZ1 + grow
    zc = cu.DOOR_CLIP_Z + grow
    yt = cu.rake_y(z1) - 0.10 + grow
    return [(y0, z0), (y1, z0), (y1, zc), (yt, z1), (y0, z1)]


def door_cutter(sd):
    poly = door_poly(cu.DOOR_GAP)
    bm = bm_prism(poly, 0.70, 1.25)
    # local x = world Y, local y = world Z, local z = world |X|
    m = basis((0, 0, 0), (0, 1, 0), (0, 0, 1), (sd, 0, 0))
    return transformed(bm, m)


def pane_cutter(u0, u1, grow=0.004):
    s0, s1 = cu.G_S0 - grow, cu.G_S1 + grow
    bm = bm_box(u1 - u0 + 2 * grow, s1 - s0, 0.30)
    return transformed(bm, cu.rk_m((u0 + u1) / 2, (s0 + s1) / 2, 0.0))


def build_shell():
    bm = bm_hull(hull_points(), bev=0.012, seg=3)
    obj = cu.obj_from_bm(bm, "cab_shell_tmp")
    cu.solidify(obj, cu.SHELL_T, -1.0)
    cutters = [door_cutter(-1), door_cutter(1)]
    for u0, u1 in cu.PANES.values():
        cutters.append(pane_cutter(u0, u1))
    hc = bm_cyl(cu.HATCH_R, 0.4, 48)
    cutters.append(transformed(hc, cu.mat_loc((cu.HATCH_C[0], cu.HATCH_C[1], ZR))))
    cu.booleans(obj, cutters)
    return obj


def lower_block(acc):
    """Below the floor pan, ahead of the front tyres: recessed lower front."""
    zb = cu.C["body_bottom_z"]
    # back wall of the recess: a thin grille plate ahead of the frame rail ends (rails reach
    # Y 3.23 at Z 1.12-1.29, shock tops and steering gear sit between them), dark slats on it
    yw = 3.245
    acc.box((1.62, 0.02, 0.46), cu.mat_loc((0, yw, zb + 0.23)), bev=0.005)
    acc.box((1.04, 0.004, 0.40), cu.mat_loc((0, yw + 0.012, 1.22)), mat="rubber", bev=0.0)
    for z in cu.frange(1.04, 1.40, 0.026):
        acc.box((1.0, 0.012, 0.012), cu.mat_loc((0, yw + 0.018, z)), mat="steel_dark", bev=0.002)
    for x in (-0.52, 0.0, 0.52):
        acc.box((0.03, 0.02, 0.40), cu.mat_loc((x, yw + 0.02, 1.22)), mat="steel_dark", bev=0.003)
    # chamfered lip under the main front face
    pts = []
    for sd in (-1, 1):
        pts += [(sd * 0.95, 3.255, 1.452), (sd * 0.95, FY - 0.004, 1.452),
                (sd * 0.95, 3.255, 1.40)]
    acc.put(bm_hull(pts, bev=0.004), None, "paint_od", 20.0)
    for sd in (-1, 1):
        # NO STEP side boxes (outboard of the recess, ahead of the step)
        # (starts at Y 2.95, ahead of the chassis fender that slopes down to Y 2.92, Z 1.02)
        acc.box((0.11, 0.39, 0.43), cu.mat_loc((sd * 0.998, 3.145, zb + 0.235)), bev=0.008)
        acc.box((0.004, 0.30, 0.12), cu.mat_loc((sd * 1.055, 3.15, 1.30)), mat="paint_tan",
                bev=0.0)   # NO STEP stencil plate (plain)
        acc.box((0.30, 0.004, 0.10), cu.mat_loc((sd * 0.80, 3.341, 1.11)), mat="paint_od",
                bev=0.0)
        # protruding corner blocks either side of the lower louvre panel
        acc.box((0.32, 0.11, 0.20), cu.mat_loc((sd * 0.66, 3.31, 1.34)), bev=0.014, seg=3)
        for z in (1.28, 1.40):
            for x in (0.54, 0.78):
                acc.bolt(cu.front_m(sd * x, z, -0.01), r=0.009)
    # sloped lower louvre panel (trapezoid, 3 rows of slots)
    top_y, top_z, bot_y, bot_z = 3.335, 1.43, 3.29, 1.24
    tw, bw = 0.40, 0.28
    pts = []
    for sd in (-1, 1):
        pts += [(sd * tw, top_y, top_z), (sd * bw, bot_y, bot_z),
                (sd * tw, top_y - 0.03, top_z), (sd * bw, bot_y - 0.03, bot_z)]
    acc.put(bm_hull(pts, bev=0.004), None, "paint_od", 20.0)
    d = Vector((0, top_y - bot_y, top_z - bot_z))
    up = d.normalized()
    nrm = Vector((0, up.z, -up.y))
    for row in range(3):
        t = 0.22 + row * 0.28
        p = Vector((0, bot_y, bot_z)) + d * t
        half = (bw + (tw - bw) * t) - 0.05
        for sd in (-1, 1):
            c = p + Vector((sd * (half / 2 + 0.012), 0, 0)) + nrm * 0.002
            m = basis(c, (1, 0, 0), up, nrm)
            acc.box((half - 0.02, 0.026, 0.006), m, mat="steel_dark", bev=0.003)
    # corner bolts of the louvre panel
    for sd in (-1, 1):
        for t in (0.1, 0.9):
            p = Vector((0, bot_y, bot_z)) + d * t
            w = bw + (tw - bw) * t - 0.02
            acc.bolt(basis(p + Vector((sd * w, 0, 0)), (1, 0, 0), up, nrm), r=0.008)


def build(body):
    obj = build_shell()
    body.put(cu.bm_from_obj(obj), None, "paint_od", 12.0)
    me = obj.data
    bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.meshes.remove(me)
    lower_block(body)
