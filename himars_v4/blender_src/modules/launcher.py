"""M142 HIMARS v4 launcher: fixed base on the rails, turntable and rotating platform, cradle,
hoist frame, pods. build() returns the launcher objects, each tagged with hr_node.

Node tags: 'Body' (fixed base on the rails), 'LauncherYaw' (turntable, platform, pivot clevises,
elevation-cylinder barrels; pivots about layout.YAW_ORIGIN), 'LauncherPitch' (the launcher-loader
module: side housings per layout.MODULE, cradle, hinge lugs, hoist frame, elevation rods; pivots about
layout.PITCH_ORIGIN), 'PodSix' (six-tube GMLRS
pod), 'PodSingle' (ATACMS) and 'PodDual' (PrSM). All positions come from layout.py
(front +Y, up +Z, vehicle centred on Y 0, Z 0 on the ground).
By default the parts are merged per (hr_node, material); pod caps and elevation-cylinder parts
stay separate objects (see launcher_pod / launcher_turret).
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
for _p in (_HERE, os.path.dirname(_HERE)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import launcher_util as lu  # noqa: E402
import launcher_base  # noqa: E402
import launcher_turret  # noqa: E402
import launcher_pod  # noqa: E402
import launcher_housing  # noqa: E402


def build(merge=True):
    lu.reset()
    launcher_base.build()
    launcher_turret.build_yaw()
    launcher_turret.build_pitch()
    launcher_housing.build()
    launcher_pod.build_six()
    launcher_pod.build_single()
    launcher_pod.build_dual()
    parts = list(lu.OUT)
    if not merge:
        return parts
    merged = lu.merge(parts, "launcher")
    lu.OUT[:] = merged
    return merged
