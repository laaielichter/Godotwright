"""M142 HIMARS chassis (M1140 FMTV 6x6 derivative), v4 photo-measured layout.

build() creates every part in world coordinates (front +Y, up +Z, ground Z 0) from the values
in layout.py, tags each object hr_node 'Body' and returns the objects. By default the parts are
merged per material (one mesh per material); build(merge=False) returns the separate parts.
Wheels and tyres are built by wheels.py."""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import chassis_util as cu  # noqa: E402
import chassis_frame  # noqa: E402
import chassis_bumpers  # noqa: E402
import chassis_axles  # noqa: E402
import chassis_drive  # noqa: E402
import chassis_body  # noqa: E402

PARTS = [chassis_frame, chassis_bumpers, chassis_axles, chassis_drive, chassis_body]


def build(merge=True):
    cu.reset()
    for part in PARTS:
        part.build()
    return cu.finish(merge, "chassis")
