# M142 HIMARS: photo-measured reference sheet

All photos are from DVIDS. They are U.S. military photos taken by service members as part
of their official duties, so they are U.S. federal government works in the public domain.
DVIDS asks users to follow https://www.dvidshub.net/about/copyright (credit the photographer
and do not imply endorsement).

Wikimedia Commons could not be used: the proxy got HTTP 429 (rate limited) for both the API
and upload.wikimedia.org.

## 1. Images (`img/`)

| file | source page | credit | view | notes |
|---|---|---|---|---|
| dvids_5619346.jpg | https://www.dvidshub.net/image/5619346/himars-northern-strike-19 | U.S. Army National Guard photo by Cpl. Stephen M. Wright | **right side, nearly square on** (launcher raised and traversed) | Video still (2000x1125, letterboxed). Telephoto. All 6 tyres and the whole cab are clear. **Main side view for the truck.** Launcher not stowed. |
| dvids_8996787.jpg | https://www.dvidshub.net/image/8996787/himars-static-display-with-locals-estonia | U.S. Army photo by Sgt. Austin Steinborn | right side, static display | Wide-angle lens (tyres stretched about 10% sideways near the left edge). Pod slightly elevated. People hide the front bumper. Door open. Used for qualitative detail and the door opening. |
| dvids_8391596.jpg | https://www.dvidshub.net/image/8391596/himars-touch-down-ben-ghilouf-african-lion-2024 | U.S. Army photo by Sgt. Lukas Sparks | right-hand truck: left side, slight front 3/4, **launcher stowed** | Small (tyre about 62 px) and near the image edge (stretched sideways). The only stowed side view, so it is used for pod position and height. Left truck: front 3/4. |
| dvids_7948249.jpg | https://www.dvidshub.net/image/7948249/high-mobility-artillery-rocket-system-himars-summit-held-grafenwohr-germany | U.S. Army Reserve photo by Spc. William Kuang | **front, head-on** | Close-range portrait (2000x2584). Soldiers touch the cab sides. **Main front view.** |
| dvids_5298842.jpg | https://www.dvidshub.net/image/5298842/steel-warrior-bn-soldiers-remain-ready-now-after-conducting-air-land-raid | U.S. Army photo by Sgt. Dustin D. Biven | front, driving (dust) | Second front view, with a gunner and antennas. |
| dvids_1808480.jpg | https://www.dvidshub.net/image/1808480/himars | U.S. Air Force photo by A1C Nathan Clark | **rear, head-on** (stowed) | Close up. Pod top cut off. Shows the bumper, lamps and 2x3 tube caps. |
| dvids_8391601.jpg | https://www.dvidshub.net/image/8391601/himars-touch-down-ben-ghilouf-african-lion-2024 | U.S. Army photo by Sgt. Lukas Sparks | **rear 3/4** (stowed) | Close, high detail: pod end, rear bumper, tandem, mirror. |
| dvids_8391598.jpg | https://www.dvidshub.net/image/8391598/himars-touch-down-ben-ghilouf-african-lion-2024 | U.S. Army photo by Sgt. Lukas Sparks | front 3/4, left side (stowed) | Door open. Pod side panels, cab facets, bumper. |
| dvids_8415796.jpg | https://www.dvidshub.net/image/8415796/himars-training-operation-italy | Sgt. Emely Gonzalez (USMC) | **rear, launcher raised** | Distant. Pod elevated and not traversed. |
| dvids_6534069.jpg | https://www.dvidshub.net/image/6534069/himars-and-moose-joint-training | U.S. Air Force photo by SrA Kristine Legate | close 3/4 of the cab's right side and the pod front (desert tan) | Detail of armour panels, louvres, roof lamps, "NO STEP" plates. |

Images I looked at and dropped: 8412931 (firing, the vehicle is mostly hidden by smoke),
8393103 (people only, no vehicle), 8797313 (raised launcher, too far away to measure).

**No clean side view with the launcher stowed was found.** The best side view (5619346) has
the launcher raised and traversed. The stowed side view (8391596) is small.

## 2. Reference crops and masks

| file | from | crop box in source (x0,y0,x1,y1) | scale |
|---|---|---|---|
| `side_ref.png` (1540x610) | dvids_5619346.jpg | (340, 330, 1880, 940) | 1:1 with the source, no resampling. About **171.8 px/m** at the vehicle's side plane (tyre = 204 px). |
| `side_mask.png` | same crop | same | white = vehicle, black = background |
| `front_ref.png` (1490x1520) | dvids_7948249.jpg | (230, 780, 1720, 2300) | 1:1 with the source. About **568 px/m** at the front-tyre plane (outside of tyres = 2.44 m). The cab face is nearer the camera, so it is drawn about 5-10% larger. |
| `front_mask.png` | same crop | same | white = vehicle, black = background |

How the masks were made: the background was too busy (grass, trees, soldiers) for colour
segmentation, so each mask is a **hand-traced polygon** (55 vertices for the side, 40 for the front).
The vertices were read off gridded zooms of the original pixels and filled with PIL
(`tools/make_refs.py`). The overlays used to check them are `work/side_overlay.png` and
`work/front_overlay.png`.

Accuracy:
- Side mask: outline within about ±5-10 px (±3-6 cm) on the cab, pod and bumpers.
- Tyre bottoms are hidden in grass, so the ground contact is estimated from the hub position (±8 px).
- The far-side wheels showing between the axles are only roughly included.
- Antennas, the loop antenna, the soldier and the open hatch cover are left out.
- The launcher is raised and traversed, so this is **not** a stowed silhouette.
- Front mask: within about ±10 px (±2 cm).
- The roof lamp row is kept, but the grab-rail tubes beside the cab, the soldier on the roof and the soldiers' hands are left out.
- The gap under the body between the tyres is simplified to a block for the axle and differential.

## 3. Measurements

### Method
- Pixel coordinates were read by eye from gridded zooms of the original images
  (`tools/zoom.py`, grid of 10-20 px). The full list of points and the arithmetic are in
  `tools/measure.py`, and the output is in `work/measurements.json`.
- **Side view R** (5619346):
  - Scale comes from the tyres: hub to tread-top radius, doubled, gives 204/200/204 px = 1.18 m, so **171.8 px/m**.
  - Heights are measured from the line through the three tyre bottoms.
  - Lengths are measured from the front axle centre, with + meaning rearward.
  - The rims look round, so yaw is under about 15°. Unknown yaw could shorten lengths by up to about 3%.
  - The rear-bumper lamps face the camera, so the vehicle's rear end is taken at the corner nearest the camera.
  - Check: the overall length then comes out at **6.96 m**. The published figure is 6.94 m (Wikipedia, M142 HIMARS).
- **Stowed side view A** (8391596, right-hand truck):
  - This image is stretched sideways near the edge (tyres 73 px wide but 62 px tall). Horizontal values are therefore rescaled so that front→middle axle equals the value from R.
  - Vertical values are rescaled so that the cab roof equals the height from R. The tyre scale gives a second estimate.
  - Check: the pod length then comes out at **4.09 m**, against the given 4.02 m.
- **Front view F** (7948249): the scale is the outside-of-tyres width = 2.44 m. This shot is close range and low, so heights read from it are distorted by perspective. It is used **only for widths and lateral positions**.

### Numbers (± is an estimate of the total error: reading, scale and perspective)

**Axles and overhangs (side, metres)**

| item | value | ± | source / notes |
|---|---|---|---|
| front axle → middle axle | **3.50** | 0.12 | R. A agrees by construction. |
| middle axle → rear axle | **1.33** (A: 1.45) | 0.10 | R. A is stretched sideways, so R is preferred; best estimate 1.35-1.40. |
| front axle → rear axle | 4.83 | 0.15 | R |
| front overhang (bumper face → front axle) | **1.23** (A: 1.16) | 0.08 | R |
| rear overhang (rear axle → rear bumper/frame end) | **0.90** (A: 1.20) | 0.2 | R: corner nearest the camera. A: far end. The published length implies 0.88. |
| overall length (bumper → rear end, pod stowed) | 6.96 | 0.2 | R. Published figure: 6.94. |

**Cab**

| item | value | ± | source / notes |
|---|---|---|---|
| cab front face (vertical lower part) | 1.14 ahead of the front axle | 0.06 | R |
| cab rear wall | 0.6 behind the front axle (R 0.61, S 0.80, A 0.37) | 0.2 | Partly hidden by the stack and boxes. |
| cab length at the lower body (front face → rear wall) | **1.75** | 0.2 | R |
| cab length at the roof (raked front edge → rear wall) | 1.29 | 0.2 | R |
| cab roof height (body, without hatch ring, lamps or antennas) | **2.81** | 0.08 | R. A gives 2.69 using the tyre scale. |
| windscreen (front upper plate) rake | **35° from vertical** (55° from horizontal) | 4° | R silhouette: from the roof edge at 2.81 m down to the knee at 2.19 m. Plate slant length 0.76 m. |
| windscreen glass height (each pane) | glass from about 2.27 to 2.53 m height; slant height about 0.32 m (driver, vehicle-left) and 0.27 m (vehicle-right) | 0.05 | F vertical fractions mapped onto the raked plate from R. |
| windscreen widths | driver (vehicle-left) **0.58**, vehicle-right **0.46**; gap between panes 0.30 | 0.05 | F |
| door window (side) | 2.38-2.66 m height, about 0.3 m wide, high and small | 0.06 | R |
| door | height **1.17-1.20**; bottom (sill) at **1.53** m; top at about 2.7 m | 0.08 | R and S |
| door position along the truck | from about 0.0-0.15 m ahead of the front axle (rear edge) to 0.7-0.9 m ahead (front edge) | 0.15 | R door lines are faint. S shows the open door opening, 0.91 m wide. |
| front wall shape | narrow roof (1.72 m), chamfered out to the widest point (2.12 m, an upper bound) at about 2.0-2.2 m height, vertical sides down to about 1.65 m, then chamfered in toward the bumper | 0.1 | F and R |
| cab-floor / step plate edge | 1.52 m | 0.06 | R |

**Front end and chassis**

| item | value | ± | source / notes |
|---|---|---|---|
| front bumper | top **1.23**, bottom **0.97** (amber lamp centre 1.13) | 0.08 | R. F (close range, low camera) gives 0.96/0.69, which is distorted by perspective and not used. Bumper is about level with the tyre tops. |
| bumper width | 2.26 | 0.1 | F |
| headlamps | spacing 1.51, diameter about 0.18 | 0.05 | F |
| amber turn lamps | spacing 1.88 | 0.05 | F |
| tow shackles | spacing 0.79 | 0.05 | F |
| chassis frame rail (side member between the tandem axles) | top **1.29**, bottom **1.12** | 0.1 | R |
| rear bumper / lamp unit | top 1.24, bottom 0.89 | 0.1 | R |
| front fender | **flat**: no arch. The cab floor and step overhang the front tyre with 0.34 m gap above the tyre top. A black flat mud flap sits behind the wheel. | 0.06 | R and 8391598 |
| rear fenders | none. The launcher frame sits about 0.1 m above the tandem tyre tops. | | R and 8391601 |

**Launcher pod and base**

| item | value | ± | source / notes |
|---|---|---|---|
| pod bottom height, stowed | **1.46** (cab-roof scale 1.49 / tyre scale 1.43) | 0.08 | A |
| pod top height, stowed (box top, without top rails) | **2.47** (2.52 / 2.41) | 0.1 | A. The pod top is about 0.3 m below the cab roof. |
| pod box height | about 1.0 | 0.1 | A. S gives 0.95. |
| pod front end, stowed | 1.93 behind the front axle (about 1.3 m behind the cab rear wall) | 0.15 | A |
| pod rear end, stowed | 6.0 behind the front axle (flush with the rear bumper to within about 0.15 m) | 0.2 | A |
| pod length | 4.09 (given: 4.02) | 0.15 | A |
| turntable centre | about **4.0** behind the front axle, between the middle and rear axles | **0.5, low confidence** | Estimated from the raised and traversed launcher base in R. It cannot be seen directly in any of these photos. |
| mirror arm reach | **not measured** | | Mirrors are folded or absent in F. In 8391601 and 8391598 they are foreshortened and their depth is unknown. A tubular arm carries the head roughly 0.4-0.7 m outboard (guess, not a measurement). |
| grab-rail tubes beside the cab | 0.05-0.10 outboard of the cab sides | 0.03 | F |

### Known problems
- The three given references do not quite agree in A. A tyre measures 62 px tall, while the pod is 243 px long and the image is stretched 73/62 sideways. Combining the given 1.18 m tyre and 4.02 m pod there would put the scale about 10% off. This is why A is normalised to R rather than used on its own.
- The rear overhang is the least certain length: 0.9 m (R) against 1.2 m (A). The published overall length (6.94 m) supports about 0.9 m.

## 4. Qualitative description

**Cab (armoured "LSAC" cab-over, no hood)**
- Front: a flat-faceted, elongated octagon. The roof is narrow, the upper side corners are chamfered, the widest point is near mid-height, and the lower corners are chamfered in toward the bumper.
- The upper front plate is raked back about 35° and carries **two separate small rectangular armoured windscreens** in bolted frames. They are different sizes: the driver's pane (vehicle-left) is wider. Each has one wiper pivoting at the top centre, parked diagonally.
- **Five amber clearance lamps** run along the roof front edge: one at each corner and three in the middle.
- Rows of hex bolt heads outline every armour panel. There are flat stencil panels for names and markings.
- Below the windscreen band, the vertical plate has a **2x2 block of mesh louvres** (upper grille), and a round bridge/plate disc on the vehicle-left.
- Below that is a recessed lower louvre panel (3 rows of slots), and "NO STEP" plates at the lower corners.
- **Bumper**: a heavy box-section bar. It has two round headlamps inboard, amber turn lamps outboard, small side-marker lamps on the bumper ends, two large D-ring tow shackles at about 0.8 m spacing, and a recessed centre with connectors. A slotted skid plate sits below.
- Sides: one small high door window and a vertical door with grab handles. Tubular hand rails run on the front corners (A-pillars). Step plates sit below the door (sill at about 1.5 m) with lower steps.
- Roof: hatch with a ring mount and clear hatch cover, a loop antenna and whip antennas at the rear corners.

**Between cab and pod**
- A vertical air-intake stack with a mushroom head.
- A tall stowage box against the cab rear wall.
- A large equipment box with a vertical louvred vent panel.
- Along the frame between the front and middle axles: a long fuel tank (round cap) and battery/stowage boxes.

**Pod / launcher-loader module**
- A long slab-sided rectangular box. Each side has three large rectangular access panels with flush hinges and latches, and dense rivet lines along all edges.
- At the rear (breech) end there is an open frame showing **2 rows x 3 round rocket-pod end caps**, flanked by vertical end posts. The end posts carry unit-marking plates, padlocked latch boxes and small lift/tie-down fittings.
- Along the top are longitudinal boom rails. At the rear-top there is a **U-shaped handle/boom frame**: the self-loading hoist, the most recognisable shape when the launcher is raised.
- "LIFT HERE" and "DO NOT PUSH" markings and lifting points are on the pod frame. Hydraulic hoses run from the base up to the pod.
- Stowed: muzzles face forward toward the cab, and the box top sits below the cab roof.
- Raised: the forward end lifts about a pivot near the rear lower corner, and the whole box traverses on a turntable above the rear tandem.

**Launcher base**
- A low, wide cradle and turntable frame over the rear tandem, with a stepped riveted subframe on the chassis rails.
- A heavy rear bumper with lamp clusters at both ends, three red centre lamps, two shackles and a pintle hook.

## 5. Distinctive features a viewer uses to recognise a HIMARS (most important first)
1. **Proportions of a 6x6 cab-over truck**: one front axle under the cab, then a long gap (about 3.5 m) to a **close-spaced rear tandem** (about 1.35 m). Large single tyres (1.18 m) with an open, chunky tread, and no arched fenders.
2. **One big rectangular launcher box** sitting on the rear half. It is about 4 m long, about 1 m tall and nearly full width, with its top **below the cab roof**. The sides are flat and riveted, with three access panels.
3. **Armoured faceted cab**: an octagonal front face with a narrow roof, a raked upper plate with **two small separate rectangular windscreens**, and a flat vertical lower face with mesh louvres. It looks like a "helmet", not a conventional truck cab.
4. **From the rear**: 2x3 round pod end caps above a full-width bumper with lamp clusters.
5. **Raised launcher**: the box tilts up front-first on a turntable over the rear tandem, with the U-shaped hoist frame on top.
6. Roof clutter: five amber clearance lamps, a hatch ring, loop and whip antennas.
7. Between the cab and pod: the air-intake stack and stowage boxes. Along the frame: the fuel tank.
8. Front bumper: two round headlamps plus amber lamps, and two big D-ring shackles.
9. CARC green or desert tan paint, with unit stencils on the cab front and pod ends.

## 6. Files
- `img/`: the 10 source photos listed above. `pages/`: the DVIDS HTML pages, kept for the metadata.
- `side_ref.png`, `side_mask.png`, `front_ref.png`, `front_mask.png`: crops at 1:1 scale and their masks.
- `tools/zoom.py` (gridded crops), `tools/measure.py` (points and metric values), `tools/make_refs.py` (crops, polygon masks, overlays), `tools/contact.py`, `tools/dv.sh`.
- `work/measurements.json`: all computed values. `work/*_overlay.png`: mask check images. `work/*.png`: the zooms used for reading.
