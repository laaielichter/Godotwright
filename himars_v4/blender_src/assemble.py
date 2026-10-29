"""Assemble the full M142 HIMARS v3 vehicle in one Blender session.

Run: PYTHONPATH=/tmp/claude-0/bpy_pkg python3 assemble.py

Steps: reset the scene; create the node empties (SPEC_V3.md and the assembly brief); run the
module build() functions in order (chassis, wheels, cab_ext, cab_int, launcher, rocket); parent
each object to the empty named by its hr_node (world transform kept); set the pod visibility
flags; export out/himars_v3.glb (meshes plus the node empties, so the hierarchy survives) and
out/gmlrs_v3.glb (rocket master only, node "gmlrs"); run the checks, print CHECK lines, write
out/assembly_report.json and print the node tree.
"""
import importlib
import json
import math
import os
import struct
import sys
import time
import traceback

BUILD = os.path.dirname(os.path.abspath(__file__))
MODS = os.path.join(BUILD, "modules")
OUT = os.path.join(BUILD, "out")
for _p in (MODS, BUILD):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import hr  # noqa: E402

T0 = time.time()
MODULE_ORDER = ["chassis", "wheels", "cab_ext", "cab_int", "launcher", "rocket"]

# ------------------------------------------------------------------ node layout
# (name, parent, world origin). Origins are world coordinates (vehicle origin at X 0, Y 0 at the
# middle axle, Z 0 on the ground), as the brief asks.
import layout  # noqa: E402

L = layout
EMPTIES = [
    ("HIMARS", None, (0.0, 0.0, 0.0)),
    ("Body", "HIMARS", (0.0, 0.0, 0.0)),
    ("Wheels", "HIMARS", (0.0, 0.0, 0.0)),
]
EMPTIES += [(n, "Wheels", p) for n, p in L.WHEELS.items()]
EMPTIES += [(n, "HIMARS", p) for n, p in L.DOOR_HINGE.items()]
EMPTIES += [
    ("Interior", "HIMARS", (0.0, 0.0, 0.0)),
    ("DriverEye", "HIMARS", L.DRIVER_EYE),   # camera markers: -Z of the node (Godot) = look dir
    ("FccView", "HIMARS", L.FCC_VIEW),
    ("LauncherYaw", "HIMARS", L.YAW_ORIGIN),
    ("LauncherPitch", "LauncherYaw", L.PITCH_ORIGIN),
    ("PodSix", "LauncherPitch", L.PITCH_ORIGIN),
    ("PodSingle", "LauncherPitch", L.PITCH_ORIGIN),
    ("PodDual", "LauncherPitch", L.PITCH_ORIGIN),
    ("DummyRockets", "LauncherPitch", L.PITCH_ORIGIN),
]
# Rockets numbered row by row (upper row first), x = -0.335, 0, +0.335 within each row.
ROCKET_POS = list(L.ROCKETS)
for _i, _pos in enumerate(ROCKET_POS, 1):
    EMPTIES.append((f"Rocket{_i}", "DummyRockets", _pos))
WHEEL_NODES = ("FrontL", "FrontR", "MiddleL", "MiddleR", "RearL", "RearR")
POD_NODES = ("PodSingle", "PodDual")

CHECKS = []


def log(msg):
    print(f"{time.time() - T0:8.1f} {msg}", flush=True)


def check(name, status, detail):
    CHECKS.append({"name": name, "status": status, "detail": detail})
    print(f"CHECK {name} {status} {detail}", flush=True)


def keep_parent(child, parent):
    """Parent with the world transform kept. The depsgraph is updated first so the child's
    matrix_world is current (a freshly created object reports a stale one until then)."""
    bpy.context.view_layer.update()
    return hr.parent_keep(child, parent)


def children_of(obj):
    return [c for c in bpy.context.scene.objects if c.parent == obj]


def world_verts(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    mw = ev.matrix_world.copy()
    verts = [mw @ v.co for v in me.vertices]
    ev.to_mesh_clear()
    return verts


def glb_nodes(path):
    with open(path, "rb") as f:
        f.read(12)  # magic, version, length
        clen, _ctype = struct.unpack("<II", f.read(8))
        js = json.loads(f.read(clen).decode("utf-8"))
    return js


def main():
    hr.reset_scene()
    log("RESET_DONE")

    # 2. node empties
    E = {}
    for name, _parent, loc in EMPTIES:
        E[name] = hr.make_empty(name, loc=loc, size=0.2)
    # FccView looks at the console: Blender +Y becomes Godot -Z (the camera's look axis).
    look = Vector(L.FCC_TARGET) - Vector(L.FCC_VIEW)
    E["FccView"].rotation_mode = "QUATERNION"
    E["FccView"].rotation_quaternion = look.to_track_quat("Y", "Z")
    for name, parent, _loc in EMPTIES:
        if parent:
            keep_parent(E[name], E[parent])
    log(f"EMPTIES {len(E)}")

    # 3. module builds, in order, in this one session
    built = {}
    for mname in MODULE_ORDER:
        t = time.time()
        try:
            mod = importlib.import_module(mname)
            objs = list(mod.build())
        except Exception:
            traceback.print_exc()
            raise SystemExit(f"MODULE_FAILED {mname}")
        built[mname] = objs
        log(f"BUILT {mname} objects={len(objs)} secs={time.time() - t:.1f}")

    # parenting by hr_node (rockets are handled after this loop)
    problems = []
    for mname in MODULE_ORDER:
        if mname == "rocket":
            continue
        for o in built[mname]:
            node = o.get("hr_node")
            if not node or node not in E:
                problems.append(f"{o.name} hr_node={node!r}")
                continue
            keep_parent(o, E[node])
    log(f"PARENTED modules except rocket; problems={len(problems)}")

    # rocket master and linked duplicates. Copies share the mesh data. Created before any
    # parenting so the copies carry no parent.
    master = built["rocket"][0]
    rockets = [master]
    master["hr_node"] = "Rocket1"
    for i in range(2, 7):
        dup = master.copy()  # Object.copy shares the mesh data
        dup.name = f"gmlrs_master_{i}"
        bpy.context.scene.collection.objects.link(dup)
        dup["hr_node"] = f"Rocket{i}"
        rockets.append(dup)
    for i, obj in enumerate(rockets, 1):
        obj.location = ROCKET_POS[i - 1]  # the mesh is centred on its origin, so this places it
        keep_parent(obj, E[f"Rocket{i}"])
    log(f"ROCKETS placed {len(rockets)} master={master.name}")

    # 4. pods: kept visible in the file, Godot decides which pod shows
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and o.get("hr_node") in POD_NODES:
            o.hide_viewport = False
            o.hide_render = False

    all_meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    listed = set()
    for mname in MODULE_ORDER:
        if mname != "rocket":
            listed.update(o.name for o in built[mname])
    listed.update(o.name for o in rockets)
    unlisted = [o.name for o in all_meshes if o.name not in listed]
    if unlisted:
        problems.append("unlisted mesh objects: " + ", ".join(unlisted))
    if problems:
        for p in problems:
            print("PROBLEM", p, flush=True)

    # 5. exports
    empties = [E[n] for n, _p, _l in EMPTIES]
    himars_path = os.path.join(OUT, "himars_v4.glb")
    hr.export_glb(himars_path, objects=all_meshes + empties)
    log(f"EXPORTED {himars_path}")

    gm = bpy.data.objects.new("gmlrs", master.data)  # identity transform, shared mesh data
    bpy.context.scene.collection.objects.link(gm)
    gmlrs_path = os.path.join(OUT, "gmlrs_v3.glb")
    hr.export_glb(gmlrs_path, objects=[gm])
    bpy.data.objects.remove(gm, do_unlink=True)
    log(f"EXPORTED {gmlrs_path}")

    # 6. checks
    tris = {o.name: hr.tri_count(o) for o in all_meshes}
    total = sum(tris.values())
    uniq = {}
    for o in all_meshes:
        uniq[o.data.name] = tris[o.name]
    total_unique = sum(uniq.values())
    print(f"TOTAL_TRIS {total}", flush=True)
    print(f"TOTAL_TRIS_UNIQUE_MESH {total_unique}", flush=True)

    node_tris = {}
    for o in all_meshes:
        n = o.get("hr_node", "")
        node_tris[n] = node_tris.get(n, 0) + tris[o.name]
    for n in sorted(node_tris):
        print(f"NODE_TRIS {n} {node_tris[n]}", flush=True)

    print("TOP_OBJECTS", flush=True)
    for name, n in sorted(tris.items(), key=lambda kv: -kv[1])[:15]:
        print(f"  TOP {name} {n}", flush=True)

    # world bbox versus SPEC (report, never fail)
    lo, hi = hr.world_bbox(all_meshes)
    length = hi[1] - lo[1]
    width = hi[0] - lo[0]
    top = hi[2]
    print(f"BBOX_LO {[round(v, 4) for v in lo]} BBOX_HI {[round(v, 4) for v in hi]}", flush=True)
    for label, got, want in (("length_Y", length, L.LENGTH), ("width_X", width, 2 * L.WIDTH_HALF), ("height_top_Z", top, L.TRANSPORT_TOP_Z)):
        dev = (got - want) / want * 100.0
        status = "OK" if abs(dev) <= 3.0 else "MISS"
        check(f"bbox_{label}", status, f"got={got:.3f} spec={want:.2f} dev={dev:+.1f}%")

    # wheel tyre outer radius from the hub axis (X axis of the tyre)
    for W in WHEEL_NODES:
        tyre = bpy.data.objects.get(f"tyre_{W}")
        hub = E[W].matrix_world.translation
        if tyre is None:
            check(f"wheel_radius_{W}", "MISS", "no tyre object")
            continue
        verts = world_verts(tyre)
        r = max(math.hypot(v.y - hub.y, v.z - hub.z) for v in verts)
        status = "OK" if abs(r - 0.59) <= 0.01 else "MISS"
        check(f"wheel_radius_{W}", status, f"outer_r={r:.4f} spec=0.59 hub=({hub.x:.2f},{hub.y:.2f},{hub.z:.2f})")

    # doors: origin at the hinge
    door_info = {}
    for node, want in tuple(L.DOOR_HINGE.items()):
        p = E[node].matrix_world.translation
        dev = (p - Vector(want)).length
        dobjs = [o for o in all_meshes if o.get("hr_node") == node]
        dlo, dhi = hr.world_bbox(dobjs)
        y_edge = min(abs(dhi[1] - p.y), abs(p.y - dlo[1]))
        status = "OK" if dev < 0.001 and y_edge <= 0.03 else "MISS"
        door_info[node] = {"origin": [round(c, 4) for c in p], "bbox_lo": [round(c, 4) for c in dlo],
                           "bbox_hi": [round(c, 4) for c in dhi], "origin_to_door_end_Y": round(y_edge, 4)}
        check(f"door_origin_{node}", status,
              f"origin=({p.x:.3f},{p.y:.3f},{p.z:.3f}) spec={want} door_Y=({dlo[1]:.3f},{dhi[1]:.3f}) "
              f"door_X=({dlo[0]:.3f},{dhi[0]:.3f}) door_Z=({dlo[2]:.3f},{dhi[2]:.3f})")

    # every object has an hr_node that matches an empty
    empty_names = set(E)
    bad_node = [o.name for o in all_meshes if (o.get("hr_node") or "") not in empty_names]
    check("hr_node_matches_empty", "OK" if not bad_node else "MISS",
          f"objects={len(all_meshes)} bad={bad_node[:10]}")

    # no object outside the bbox limits |X| > 1.3
    outside = []
    for o in all_meshes:
        olo, ohi = hr.world_bbox([o])
        if max(abs(olo[0]), abs(ohi[0])) > 1.3:
            outside.append(o.name)
    check("bbox_limit_abs_X_1p3", "OK" if not outside else "MISS", f"outside={outside[:10]}")

    # names unique
    names = [o.name for o in bpy.data.objects]
    suffixed = [n for n in names if len(n) > 4 and n[-4] == "." and n[-3:].isdigit()]
    check("names_unique", "OK" if len(names) == len(set(names)) and not suffixed else "MISS",
          f"count={len(names)} suffixed={suffixed[:10]}")

    # GLB content: node names present in the files
    js_h = glb_nodes(himars_path)
    h_nodes = [n.get("name") for n in js_h["nodes"]]
    missing = [n for n in [e[0] for e in EMPTIES] if n not in h_nodes]
    check("glb_himars_nodes", "OK" if not missing else "MISS",
          f"nodes={len(h_nodes)} meshes={len(js_h.get('meshes', []))} missing_empties={missing}")
    js_g = glb_nodes(gmlrs_path)
    g_nodes = [n.get("name") for n in js_g["nodes"]]
    check("glb_gmlrs_node", "OK" if g_nodes == ["gmlrs"] else "MISS",
          f"nodes={g_nodes} meshes={len(js_g.get('meshes', []))}")

    # 7. node tree
    def subtree(obj):
        s = 0
        for c in children_of(obj):
            s += tris[c.name] if c.type == "MESH" else subtree(c)
        return s

    def tree(obj, depth):
        kids = children_of(obj)
        direct = [c for c in kids if c.type == "MESH"]
        print(f"TREE {'  ' * depth}{obj.name} meshes={len(direct)} "
              f"direct_tris={sum(tris[c.name] for c in direct)} subtree_tris={subtree(obj)}", flush=True)
        for c in sorted(kids, key=lambda c: c.name):
            if c.type == "EMPTY":
                tree(c, depth + 1)

    tree(E["HIMARS"], 0)

    # report
    report = {
        "engine": f"bpy {bpy.app.version_string}",
        "total_tris_instanced": total,
        "total_tris_unique_mesh": total_unique,
        "node_tris": node_tris,
        "bbox_lo": lo, "bbox_hi": hi,
        "length_Y": length, "width_X": width, "top_Z": top,
        "objects": len(all_meshes),
        "tris": tris,
        "doors": door_info,
        "problems": problems,
        "checks": CHECKS,
        "exports": {"himars": himars_path, "gmlrs": gmlrs_path},
        "rocket_positions": ROCKET_POS,
        "elapsed_s": round(time.time() - T0, 1),
    }
    rp = os.path.join(OUT, "assembly_report.json")
    with open(rp, "w") as f:
        json.dump(report, f, indent=1, default=lambda v: float(v) if hasattr(v, "__float__") else str(v))
    log(f"REPORT {rp}")


if __name__ == "__main__":
    main()
