"""Single source of truth for the M142 HIMARS v4 layout.

Blender coords: front +Y, up +Z, right +X, metres, ground Z = 0, vehicle centred on Y = 0.
Values are photo-measured (v4/ref/REF_SHEET.md, DVIDS public-domain photos, scaled on the
1.18 m tyre) unless marked otherwise. Every module and the assembler import these values.
"""

# --- overall (photo 6.96 m, published 6.94 m; Lockheed 7.8 m was the wrong figure for this)
LENGTH = 6.96
FRONT_Y = 3.48
REAR_Y = -3.48
WIDTH_HALF = 1.22          # 2.44 m over the tyres
CAB_ROOF_Z = 2.81

# --- axles (photo: front->middle 3.50, middle->rear 1.33, front overhang 1.23, rear 0.90)
AXLE_Y = {"F": 2.25, "M": -1.25, "R": -2.58}
AXLE_Z = 0.59
TYRE_R = 0.59              # 395/85R20, OD 1.18 m
TYRE_W = 0.395
TRACK_HALF = 1.02
WHEELS = {
    "FrontL": (-TRACK_HALF, AXLE_Y["F"], AXLE_Z), "FrontR": (TRACK_HALF, AXLE_Y["F"], AXLE_Z),
    "MiddleL": (-TRACK_HALF, AXLE_Y["M"], AXLE_Z), "MiddleR": (TRACK_HALF, AXLE_Y["M"], AXLE_Z),
    "RearL": (-TRACK_HALF, AXLE_Y["R"], AXLE_Z), "RearR": (TRACK_HALF, AXLE_Y["R"], AXLE_Z),
}

# --- chassis (photo: rail 1.12..1.29; flat fenders, none at the rear tandem)
RAIL_Z = (1.12, 1.29)
RAIL_X = 0.43              # rail centre |X| (FMTV frame ~0.86 m wide; estimate)
FRONT_BUMPER = {"y_front": FRONT_Y, "z": (0.97, 1.23), "width": 2.26,
                "headlamp_x": 0.755, "headlamp_d": 0.18, "headlamp_z": 1.13,
                "turn_x": 0.94, "shackle_x": 0.395}
REAR_BUMPER_Z = (0.89, 1.24)

# --- armoured cab (LSAC), photo-measured
CAB = {
    "front_y": 3.39,          # lower front face, 1.14 ahead of the front axle
    "rear_y": 1.65,           # rear wall
    "roof_front_y": 2.95,     # top of the 35 deg windscreen plate
    "floor_z": 1.52,          # 0.34 above the front tyre tops
    "body_bottom_z": 1.00,
    "roof_z": CAB_ROOF_Z,
    "half_width_low": 1.06,   # 2.12 m max
    "half_width_roof": 0.86,  # 1.72 m
    "windscreen_plate_z": (2.19, 2.81),
    "windscreen_rake_deg": 35.0,
    "glass_z": (2.27, 2.53),
    "pane_driver_w": 0.58, "pane_other_w": 0.46, "pane_gap": 0.30,
    "door_y": (2.35, 3.05),   # door rear .. front edge (hinge at the front edge)
    "door_z": (1.53, 2.70),
    "door_window_z": (2.38, 2.66), "door_window_w": 0.30,
}
DOOR_HINGE = {"DoorL": (-CAB["half_width_low"], CAB["door_y"][1], 2.10),
              "DoorR": (CAB["half_width_low"], CAB["door_y"][1], 2.10)}
DRIVER_EYE = (-0.45, 2.55, 2.35)     # driver sits left
FCC_VIEW = (0.05, 2.20, 2.25)        # looks at the fire-control console right of the driver
FCC_TARGET = (0.45, 2.95, 1.95)

# --- between cab and pod: air intake / stowage box (right side), fuel tank (left)
INTAKE_BOX = {"y": (0.60, 1.60), "z": (1.29, 2.55), "x": (0.15, 1.10)}  # top raised to the side photo (silhouette check)

# --- launcher (photo: pod 1.46..2.47 high, from 1.93 behind the front axle to the rear bumper)
POD = {"y": (REAR_Y + 4.02, REAR_Y), "z": (1.46, 2.47), "half_width": 0.525,
       "length": 4.02}
POD_CENTER = (0.0, (POD["y"][0] + POD["y"][1]) / 2, (POD["z"][0] + POD["z"][1]) / 2)
TUBE_X = (-0.335, 0.0, 0.335)
TUBE_Z = (POD_CENTER[2] + 0.155, POD_CENTER[2] - 0.155)   # photo: cap rows touch, pitch ~0.31
CAP_R = 0.155
TUBE_R_OUT, TUBE_R_IN = 0.12, 0.1135
TURNTABLE = {"y": AXLE_Y["F"] - 4.0, "z": RAIL_Z[1], "radius": 0.95}   # low confidence (±0.5)
YAW_ORIGIN = (0.0, TURNTABLE["y"], TURNTABLE["z"])
PITCH_ORIGIN = (0.0, REAR_Y + 0.08, POD["z"][0])   # moved aft so the raised box clears the rails
# Launcher-loader module: the pod sits centred between two full-height side housings,
# so the whole module is nearly truck-wide (photos 8391601, 1808480: ~2.3 m).
MODULE = {"half_width": 1.15, "y": POD["y"], "z": POD["z"],
          "housing_x": (POD["half_width"] + 0.03, 1.15)}
ROCKETS = [(x, POD_CENTER[1], z) for z in TUBE_Z for x in TUBE_X]

TRANSPORT_TOP_Z = CAB_ROOF_Z
