# Prompt voor de lokale chat (plak alles hieronder in een Claude-sessie op homestation)

---

Je neemt de installatie over van een nieuwe **M142 HIMARS** (raketwerper op 6x6 truck) in mijn
Godot 4.7.2-spel **Response Helicopter**. Het model en een losstaand demo-project zijn in een
cloudsessie gebouwd; jij installeert het in het live spel. Gebruik de skill
**rh-asset-build-install** (router: "Ground vehicles, guards, patrols, props", secties 2, 4d, 7, 8, 9,
11, 12) en voor de raket- en inslageffecten **mech-fx-animator**. Antwoord mij kort, in het Nederlands.

## 1. Bestanden ophalen
- Repo `laaielichter/godotwright`, branch **`himars-v4-assets`** (losse branch, alleen dit pakket):
  `git clone --branch himars-v4-assets --single-branch https://github.com/laaielichter/godotwright.git himars_v4_pkg`
  (of `git pull` als je hem al hebt — de cloudsessie kan nog een update met camera's/effecten pushen).
- Map `himars_v4/`:
  - `godot_project/` — losstaand Godot 4.7.2-demo (luchtbasis tussen bergen, rijden, richten, salvo,
    volg-, cockpit-, raket- en inslagcamera). Alleen als referentie en test; níet 1-op-1 in het spel zetten.
  - `godot_project/models/himars_v4.glb` — het voertuig (≈40 MB, ≈1,7 M driehoeken incl. 6 raketten).
  - `godot_project/models/gmlrs_rocket.glb` — losse GMLRS-raket voor projectielen (127 k driehoeken).
  - `godot_project/textures/` — PBR-sets (albedo/normal/ORM), triplanar gebruikt; binding in
    `godot_project/scripts/vehicle/vehicle_materials.gd` (op GLB-materiaalnaam).
  - `blender_src/` — Blender-bronnen (bpy 5.2): `layout.py` is de enige bron van maten/pivots,
    `assemble.py` bouwt de GLB, `modules/` per onderdeel. `assembly_report.json` = laatste controles.
  - `ref/REF_SHEET.md` — maten gemeten op publiek-domein DVIDS-foto's, met bronnen.
  - `renders/` — beelden en silhouet-IoU (voor 0,88; zij 0,74 voorste helft, foto met launcher omhoog).

## 2. Feiten over het model
- Eenheden 1 m, +Y omhoog, **−Z = voorkant**. Grond op y=0. Lengte 6,96 m, breedte 2,44 m over de
  banden (3,18 m over de uitgeklapte spiegels), cabinedak 2,81 m (luikring/antennevoeten tot 3,10).
- Node-boom: `HIMARS` > `Body`, `Wheels` > `FrontL FrontR MiddleL MiddleR RearL RearR` (oorsprong =
  naaf, as langs X, straal 0,59), `DoorL/DoorR` (oorsprong = scharnier; mesh heet `DoorL.001`),
  `Interior`, `DriverEye` en `FccView` (camera-markers, −Z = kijkrichting),
  `LauncherYaw` (draaiplateau) > `LauncherPitch` (kantelt voorkant omhoog, scharnier achteraan,
  0–60°) > `PodSix` / `PodSingle` / `PodDual` (één tegelijk zichtbaar) en `DummyRockets` > `Rocket1..6`.
- Afzonderlijke objecten voor het spel: `pod_cap_rear_1..6` / `pod_cap_front_1..6` (verbergen bij
  afvuren), `fcc_screen_1/2` (quads met UV 0..1 voor live schermen), elevatiecilinders
  `launcher_elev_barrel_L/R` + `launcher_elev_rod_L/R` (look_at-piston).
- Materialen op naam: paint_od (→ effen CARC Green 383-texture), steel, steel_dark, rubber, canvas,
  interior_grey/dark, glass (doorzichtig gemaakt in vehicle_materials.gd), lens_*, screen, enz.
- **Geen LOD** in de GLB. Voor AI-verkeer/afstand is een LOD1 (~25 %) en LOD2 (~5 %) nodig — maak
  die (Blender Decimate op `blender_src/assemble.py`-uitvoer, zelfde nodenamen) of vraag mij eerst.

## 3. Wat ik wil (in kleine stappen, wacht op mijn "go" per stap tenzij ik "autonoom" zeg)
1. Inventaris volgens de skill: bestaat er al een HIMARS/raketwerper of vergelijkbare truck in de
   PCK? Welke voertuig-pipeline past (grondvoertuig rijdbaar door speler, zoals de patrol-auto's,
   met de gedeelde systemen)? Stel mij de vraag over gedrag (alleen rijdbaar, of ook AI) vóór je bouwt.
2. Integratie in de **spelsystemen**, niet de demo-scripts: rijden en camera zoals de andere
   voertuigen, Esc = gedeeld pauzemenu, RHMinimap, wegengraaf voor wegen, toetsen klein onder Tab,
   raketten via de gedeelde `naval_rocket.gd` + `naval_fx_director.gd` (zoals AH-64), inslagcamera
   als bij de andere wapens; spawnen op een luchtbasis tussen bergen (zoek of er al een is;
   anders vraag mij). De demo-scripts in `godot_project/scripts/` zijn alleen voorbeeld.
3. Kill-switch `rh_himars_uit.txt`, menuknoppen, `profiles.json`/`aircraft.json`-achtige registratie
   zoals de skill voor een nieuw voertuig voorschrijft.
4. QA (sectie 8) op echte speldata, daarna drift-check → `APPLY_OK` → `VERIFY_PASS` → QA op de
   geïnstalleerde PCK. Sluit het spel vóór schrijven. Claim eerst op WORKBOARD.
5. Logboek, CHANGELOG, WORKBOARD, rollback-hint; rapport met wat níet getest is.

## 4. Bekende risico's
- 40 MB GLB + ~150 MB texturen ongecomprimeerd → VRAM en laadtijd; comprimeer (VRAM-compressie) en
  maak LOD's. 1,7 M driehoeken is zwaar voor zwakkere GPU's.
- Forward+ is in de cloud niet getest (geen Vulkan); alles is in Compatibility gerenderd.
- Maten deels geschat (draaiplateau ±0,5 m, spiegelreikwijdte); zie `ref/REF_SHEET.md`.
- Geen stencils/teksten/insignes op het model (bewust).
