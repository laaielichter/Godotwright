"""M142 HIMARS v4 armoured LSAC cab exterior (cab_ext).

build() returns every object it made, each tagged with hr_node:
  cab_body      Body   shell (hollow, openings cut) and all painted / metal detail
  cab_glass     Body   windscreen panes (material glass)
  cab_fittings  Body   parts that stand proud of the body envelope: mirrors, grab rails,
                       hatch ring and cover, antenna bases, lifting eyes
  DoorL, DoorR  DoorL / DoorR, origin on layout.DOOR_HINGE (door skin, window, hinges,
                       handles, inner trim)
Positions come from layout.py (CAB, DOOR_HINGE). Modules: cab_ext_util (kit and derived
planes), cab_ext_shell, cab_ext_parts, cab_ext_doors.
"""
import cab_ext_util as cu
import cab_ext_shell
import cab_ext_parts
import cab_ext_doors


def build():
    cu.reset()
    body = cu.Acc("cab_body", "Body")
    glass = cu.Acc("cab_glass", "Body")
    fit = cu.Acc("cab_fittings", "Body")
    cab_ext_shell.build(body)
    cab_ext_parts.build(body, glass, fit)
    for a in (body, glass, fit):
        a.finish()
    cab_ext_doors.build()
    return list(cu.OUT)
