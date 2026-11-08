# Asset library

1000 ready-made base recipes for Godot 4. Every asset is a model spec with parameters: it builds a clean .glb
(UVs, tangents, one node per part, pivots on hinges and hubs) and passes the model lint and the check against its
archetype at its defaults and at the ends of its parameter ranges. Agents start from one instead of from nothing.

```sh
godotwright model library "oak chair"                         # search, English or Dutch ("eiken stoel")
godotwright model library furniture/dining-chair-oak-ladder   # what it is, parameters, parts
godotwright model build furniture/dining-chair-oak-ladder --set seatHeight=0.5 -o chair.glb
godotwright model library furniture/dining-chair-oak-ladder --spec > my-chair.json   # change it, then model build --spec
```

MCP: `godot_model_library` (search, show, `spec: true`) and `godot_model_build` with `kind: <id>`.

This file is generated: `npm run build:library`.

| Category | Assets | Families |
| --- | ---: | --- |
| furniture | 200 | dining-chair (24), armchair (12), stool (16), dining-table (20), coffee-table (12), desk (12), side-table (12), bookcase (16), cupboard (16), drawers (16), bed (14), sofa (14), lamp (16) |
| street | 170 | park-bench (20), street-lamp (20), bin (16), bollard (16), planter (16), traffic-sign (18), fire-hydrant (10), mailbox (10), bike-rack (10), bus-stop (8), traffic-cone (8), road-barrier (8), fence (10) |
| storage | 150 | crate (24), barrel (18), pallet (12), shipping-container (16), gas-cylinder (10), storage-tank (12), rack (12), cable-reel (10), chest (16), jerrycan (8), cart (12) |
| nature | 170 | broadleaf-tree (30), conifer (20), palm (12), bush (24), rock (30), flower (16), grass (12), stump (14), mushroom (12) |
| buildings | 150 | house (40), shed (20), barn (12), apartment (12), watchtower (14), gazebo (14), church (8), market-stall (16), tent (14) |
| vehicles | 100 | car (30), truck (14), bus (8), bicycle (12), motorcycle (12), boat (10), rowing-boat (6), drone (8) |
| props | 60 | terminal (14), statue (10), fountain (10), campfire (10), well (8), ladder (8) |

## furniture

### dining-chair

24 assets, archetype `prop.chair`, parameters: seatHeight, seatWidth, seatDepth, backHeight.

- `furniture/dining-chair-oak-ladder`: Oak ladder-back dining chair
- `furniture/dining-chair-walnut-ladder`: Walnut ladder-back dining chair
- `furniture/dining-chair-pine-ladder`: Pine ladder-back dining chair
- `furniture/dining-chair-cherry-ladder`: Cherry ladder-back dining chair
- `furniture/dining-chair-black-ladder`: Black paint ladder-back dining chair
- `furniture/dining-chair-white-ladder`: White paint ladder-back dining chair
- `furniture/dining-chair-oak-spindle`: Oak spindle-back dining chair
- `furniture/dining-chair-walnut-spindle`: Walnut spindle-back dining chair
- `furniture/dining-chair-pine-spindle`: Pine spindle-back dining chair
- `furniture/dining-chair-cherry-spindle`: Cherry spindle-back dining chair
- `furniture/dining-chair-black-spindle`: Black paint spindle-back dining chair
- `furniture/dining-chair-white-spindle`: White paint spindle-back dining chair
- `furniture/dining-chair-oak-panel`: Oak panel-back dining chair
- `furniture/dining-chair-walnut-panel`: Walnut panel-back dining chair
- `furniture/dining-chair-pine-panel`: Pine panel-back dining chair
- `furniture/dining-chair-cherry-panel`: Cherry panel-back dining chair
- `furniture/dining-chair-black-panel`: Black paint panel-back dining chair
- `furniture/dining-chair-white-panel`: White paint panel-back dining chair
- `furniture/dining-chair-oak-slats`: Oak slat-back dining chair
- `furniture/dining-chair-walnut-slats`: Walnut slat-back dining chair
- `furniture/dining-chair-pine-slats`: Pine slat-back dining chair
- `furniture/dining-chair-cherry-slats`: Cherry slat-back dining chair
- `furniture/dining-chair-black-slats`: Black paint slat-back dining chair
- `furniture/dining-chair-white-slats`: White paint slat-back dining chair

### armchair

12 assets, archetype `prop.chair`, parameters: width, depth, seatHeight, backHeight.

- `furniture/armchair-club-leather-brown-walnut`: Brown leather club armchair
- `furniture/armchair-club-velvet-green-dark-stain`: Green velvet club armchair
- `furniture/armchair-club-wool-grey-light-oak`: Grey wool club armchair
- `furniture/armchair-wingback-velvet-red-mahogany`: Red velvet wingback armchair
- `furniture/armchair-wingback-fabric-cream-walnut`: Cream fabric wingback armchair
- `furniture/armchair-wingback-velvet-blue-cherry`: Blue velvet wingback armchair
- `furniture/armchair-lounge-fabric-mustard-teak`: Mustard fabric lounge armchair
- `furniture/armchair-lounge-wool-charcoal-walnut`: Charcoal wool lounge armchair
- `furniture/armchair-lounge-fabric-teal-light-oak`: Teal fabric lounge armchair
- `furniture/armchair-rocking-linen-oak`: Linen rocking armchair
- `furniture/armchair-rocking-velvet-green-cherry`: Green velvet rocking armchair
- `furniture/armchair-rocking-fabric-terracotta-white`: Terracotta fabric rocking armchair

### stool

16 assets, archetype `prop.stool`, parameters: seatHeight, seatRadius, footprint.

- `furniture/stool-bar-black-steel-walnut`: Black steel bar stool with walnut seat
- `furniture/stool-bar-chrome-leather-black`: Chrome bar stool with black leather seat
- `furniture/stool-bar-brushed-steel-oak`: Brushed steel bar stool with oak seat
- `furniture/stool-bar-red-leather-tan`: Red paint bar stool with tan leather seat
- `furniture/stool-kitchen-oak`: Oak kitchen stool
- `furniture/stool-kitchen-black-light-oak`: Black paint kitchen stool with light oak seat
- `furniture/stool-kitchen-pine`: Pine kitchen stool
- `furniture/stool-kitchen-white-walnut`: White paint kitchen stool with walnut seat
- `furniture/stool-milking-oak`: Oak milking stool
- `furniture/stool-milking-pine`: Pine milking stool
- `furniture/stool-milking-weathered-wood`: Weathered wood milking stool
- `furniture/stool-milking-cherry-walnut`: Cherry milking stool with walnut seat
- `furniture/stool-swivel-chrome-leather-black`: Chrome swivel stool with black leather seat
- `furniture/stool-swivel-chrome-velvet-red`: Chrome swivel stool with red velvet seat
- `furniture/stool-swivel-black-steel-leather-tan`: Black steel swivel stool with tan leather seat
- `furniture/stool-swivel-brushed-steel-wool-grey`: Brushed steel swivel stool with grey wool seat

### dining-table

20 assets, archetype `prop.table`, parameters: length, width, height, thickness.

- `furniture/dining-table-apron-oak`: Oak apron dining table
- `furniture/dining-table-apron-walnut`: Walnut apron dining table
- `furniture/dining-table-apron-cherry`: Cherry apron dining table
- `furniture/dining-table-apron-birch-white`: Birch apron dining table
- `furniture/dining-table-pedestal-walnut`: Walnut pedestal dining table
- `furniture/dining-table-pedestal-marble-brass`: Marble pedestal dining table
- `furniture/dining-table-pedestal-whitewash-wood-cream`: Whitewash wood pedestal dining table
- `furniture/dining-table-pedestal-mahogany`: Mahogany pedestal dining table
- `furniture/dining-table-trestle-rough-timber`: Rough timber trestle dining table
- `furniture/dining-table-trestle-oak-black-steel`: Oak trestle dining table
- `furniture/dining-table-trestle-light-oak`: Light oak trestle dining table
- `furniture/dining-table-trestle-dark-stain`: Dark stain trestle dining table
- `furniture/dining-table-farmhouse-pine-cream`: Pine farmhouse dining table
- `furniture/dining-table-farmhouse-oak-sand`: Oak farmhouse dining table
- `furniture/dining-table-farmhouse-weathered-wood`: Weathered wood farmhouse dining table
- `furniture/dining-table-farmhouse-teak`: Teak farmhouse dining table
- `furniture/dining-table-extending-teak`: Teak extending dining table
- `furniture/dining-table-extending-walnut-black-steel`: Walnut extending dining table
- `furniture/dining-table-extending-light-oak`: Light oak extending dining table
- `furniture/dining-table-extending-white-chrome`: White paint extending dining table

### coffee-table

12 assets, archetype `prop.table`, parameters: width, depth, height, thickness.

- `furniture/coffee-table-shelf-oak`: Oak shelf coffee table
- `furniture/coffee-table-shelf-walnut`: Walnut shelf coffee table
- `furniture/coffee-table-shelf-whitewash-wood-white`: Whitewash wood shelf coffee table
- `furniture/coffee-table-tripod-teak`: Teak tripod coffee table
- `furniture/coffee-table-tripod-marble-walnut`: Marble tripod coffee table
- `furniture/coffee-table-tripod-black-light-oak`: Black paint tripod coffee table
- `furniture/coffee-table-sled-clear-chrome`: Clear glass sled coffee table
- `furniture/coffee-table-sled-frosted-black-steel`: Frosted glass sled coffee table
- `furniture/coffee-table-sled-marble-black-brass`: Marble black sled coffee table
- `furniture/coffee-table-hairpin-rough-timber-black-steel`: Rough timber hairpin coffee table
- `furniture/coffee-table-hairpin-light-oak-black-steel`: Light oak hairpin coffee table
- `furniture/coffee-table-hairpin-dark-stain-copper`: Dark stain hairpin coffee table

### desk

12 assets, archetype `prop.table`, parameters: width, depth, height.

- `furniture/desk-writing-mahogany`: Mahogany writing desk
- `furniture/desk-writing-walnut`: Walnut writing desk
- `furniture/desk-writing-cherry`: Cherry writing desk
- `furniture/desk-pedestal-oak`: Oak pedestal desk
- `furniture/desk-pedestal-white`: White paint pedestal desk
- `furniture/desk-pedestal-dark-stain`: Dark stain pedestal desk
- `furniture/desk-standing-birch-black-steel`: Birch standing desk
- `furniture/desk-standing-walnut-white`: Walnut standing desk
- `furniture/desk-standing-bamboo-aluminium`: Bamboo standing desk
- `furniture/desk-steel-rough-timber-black-steel`: Rough timber steel desk
- `furniture/desk-steel-oak-gunmetal`: Oak steel desk
- `furniture/desk-steel-pine-anthracite`: Pine steel desk

### side-table

12 assets, archetype `prop.table`, parameters: diameter, height.

- `furniture/side-table-tripod-mahogany`: Mahogany tripod side table
- `furniture/side-table-tripod-oak`: Oak tripod side table
- `furniture/side-table-tripod-black`: Black paint tripod side table
- `furniture/side-table-square-walnut`: Walnut square side table
- `furniture/side-table-square-light-oak-white`: Light oak square side table
- `furniture/side-table-square-teak`: Teak square side table
- `furniture/side-table-drum-marble-brass`: Marble drum side table
- `furniture/side-table-drum-walnut`: Walnut drum side table
- `furniture/side-table-drum-terracotta`: Terracotta drum side table
- `furniture/side-table-c-frame-oak-black-steel`: Oak C-frame side table
- `furniture/side-table-c-frame-marble-black-brass`: Marble black C-frame side table
- `furniture/side-table-c-frame-clear-chrome`: Clear glass C-frame side table

### bookcase

16 assets, archetype `prop.bookcase`, parameters: width, height, depth, shelves.

- `furniture/bookcase-open-oak`: Oak open bookcase
- `furniture/bookcase-open-walnut`: Walnut open bookcase
- `furniture/bookcase-open-white`: White paint open bookcase
- `furniture/bookcase-open-cherry`: Cherry open bookcase
- `furniture/bookcase-low-teak`: Teak low bookcase
- `furniture/bookcase-low-light-oak`: Light oak low bookcase
- `furniture/bookcase-low-black-walnut`: Black paint low bookcase
- `furniture/bookcase-low-birch`: Birch low bookcase
- `furniture/bookcase-ladder-bamboo`: Bamboo ladder bookcase
- `furniture/bookcase-ladder-walnut`: Walnut ladder bookcase
- `furniture/bookcase-ladder-whitewash-wood`: Whitewash wood ladder bookcase
- `furniture/bookcase-ladder-pine`: Pine ladder bookcase
- `furniture/bookcase-etagere-oak-black-steel`: Oak étagère bookcase
- `furniture/bookcase-etagere-walnut-brass`: Walnut étagère bookcase
- `furniture/bookcase-etagere-clear-chrome`: Clear glass étagère bookcase
- `furniture/bookcase-etagere-rough-timber-galvanised`: Rough timber étagère bookcase

### cupboard

16 assets, archetype `prop.cupboard`, parameters: width, height, depth, shelves.

- `furniture/cupboard-wardrobe-oak`: Oak wardrobe
- `furniture/cupboard-wardrobe-white`: White paint wardrobe
- `furniture/cupboard-wardrobe-walnut`: Walnut wardrobe
- `furniture/cupboard-wardrobe-pine`: Pine wardrobe
- `furniture/cupboard-kitchen-mint-oak`: Mint paint kitchen cabinet
- `furniture/cupboard-kitchen-navy-marble`: Navy paint kitchen cabinet
- `furniture/cupboard-kitchen-light-oak-concrete`: Light oak kitchen cabinet
- `furniture/cupboard-kitchen-anthracite-granite`: Anthracite paint kitchen cabinet
- `furniture/cupboard-display-mahogany`: Mahogany display cabinet
- `furniture/cupboard-display-oak`: Oak display cabinet
- `furniture/cupboard-display-black`: Black paint display cabinet
- `furniture/cupboard-display-walnut`: Walnut display cabinet
- `furniture/cupboard-sideboard-teak`: Teak sideboard
- `furniture/cupboard-sideboard-walnut`: Walnut sideboard
- `furniture/cupboard-sideboard-white-light-oak`: White paint sideboard
- `furniture/cupboard-sideboard-dark-stain`: Dark stain sideboard

### drawers

16 assets, archetype `prop.drawers`, parameters: width, height, depth, rows.

- `furniture/drawers-dresser-oak`: Oak dresser
- `furniture/drawers-dresser-white`: White paint dresser
- `furniture/drawers-dresser-walnut`: Walnut dresser
- `furniture/drawers-dresser-mint`: Mint paint dresser
- `furniture/drawers-nightstand-walnut`: Walnut nightstand
- `furniture/drawers-nightstand-white-light-oak`: White paint nightstand
- `furniture/drawers-nightstand-teak`: Teak nightstand
- `furniture/drawers-nightstand-navy`: Navy paint nightstand
- `furniture/drawers-filing-grey`: Grey paint filing cabinet
- `furniture/drawers-filing-anthracite`: Anthracite paint filing cabinet
- `furniture/drawers-filing-olive`: Olive paint filing cabinet
- `furniture/drawers-filing-oak`: Oak filing cabinet
- `furniture/drawers-tallboy-mahogany`: Mahogany tallboy chest
- `furniture/drawers-tallboy-pine`: Pine tallboy chest
- `furniture/drawers-tallboy-cherry`: Cherry tallboy chest
- `furniture/drawers-tallboy-dark-stain`: Dark stain tallboy chest

### bed

14 assets, archetype `prop.bed`, parameters: width, length, headboardHeight, mattressThickness.

- `furniture/bed-platform-single-walnut`: Walnut platform single bed
- `furniture/bed-platform-double-walnut`: Walnut platform double bed
- `furniture/bed-platform-double-light-oak`: Light oak platform double bed
- `furniture/bed-panel-single-pine`: Pine panel single bed
- `furniture/bed-panel-double-pine`: Pine panel double bed
- `furniture/bed-panel-single-cherry`: Cherry panel single bed
- `furniture/bed-panel-double-cherry`: Cherry panel double bed
- `furniture/bed-upholstered-single-blue`: Blue velvet upholstered single bed
- `furniture/bed-upholstered-double-blue`: Blue velvet upholstered double bed
- `furniture/bed-upholstered-single-charcoal`: Charcoal wool upholstered single bed
- `furniture/bed-upholstered-double-charcoal`: Charcoal wool upholstered double bed
- `furniture/bed-iron-single-cast-iron`: Cast iron iron single bed
- `furniture/bed-iron-double-cast-iron`: Cast iron iron double bed
- `furniture/bed-iron-single-white`: White paint iron single bed

### sofa

14 assets, archetype `prop.sofa`, parameters: seats, seatWidth, depth, seatHeight, backHeight.

- `furniture/sofa-modern-fabric-cream`: Cream fabric modern sofa
- `furniture/sofa-modern-wool-grey`: Grey wool modern sofa
- `furniture/sofa-modern-velvet-green`: Green velvet modern sofa
- `furniture/sofa-modern-fabric-terracotta`: Terracotta fabric modern sofa
- `furniture/sofa-chesterfield-leather-brown`: Brown leather chesterfield sofa
- `furniture/sofa-chesterfield-leather-black`: Black leather chesterfield sofa
- `furniture/sofa-chesterfield-velvet-green`: Green velvet chesterfield sofa
- `furniture/sofa-chesterfield-leather-tan`: Tan leather chesterfield sofa
- `furniture/sofa-midcentury-fabric-mustard`: Mustard fabric mid-century sofa
- `furniture/sofa-midcentury-fabric-teal`: Teal fabric mid-century sofa
- `furniture/sofa-midcentury-wool-charcoal`: Charcoal wool mid-century sofa
- `furniture/sofa-lawson-linen`: Linen lawson sofa
- `furniture/sofa-lawson-velvet-red`: Red velvet lawson sofa
- `furniture/sofa-lawson-velvet-blue`: Blue velvet lawson sofa

### lamp

16 assets, archetype `prop.lamp`, parameters: height, shadeDiameter, baseDiameter.

- `furniture/lamp-floor-brass-drum`: Brass floor lamp
- `furniture/lamp-floor-black-steel-taper`: Black steel floor lamp
- `furniture/lamp-floor-chrome-dome`: Chrome floor lamp
- `furniture/lamp-floor-bronze-bell`: Bronze floor lamp
- `furniture/lamp-table-blue-taper`: Blue ceramic table lamp
- `furniture/lamp-table-celadon-drum`: Celadon ceramic table lamp
- `furniture/lamp-table-ochre-bell`: Ochre ceramic table lamp
- `furniture/lamp-table-amber-taper`: Amber glass table lamp
- `furniture/lamp-desk-black-dome`: Black paint desk lamp
- `furniture/lamp-desk-red-taper`: Red paint desk lamp
- `furniture/lamp-desk-white-dome`: White paint desk lamp
- `furniture/lamp-desk-brushed-steel-bell`: Brushed steel desk lamp
- `furniture/lamp-lantern-black-steel-drum`: Black steel lantern
- `furniture/lamp-lantern-brass-drum`: Brass lantern
- `furniture/lamp-lantern-aged-copper-drum-frosted`: Aged copper lantern
- `furniture/lamp-lantern-galvanised-drum`: Galvanised lantern

## street

### park-bench

20 assets, archetype `prop.bench`, parameters: length, seatHeight, boards, backHeight.

- `street/park-bench-victorian-teak-cast-iron`: Victorian park bench, teak and cast iron
- `street/park-bench-victorian-oak-forest`: Victorian park bench, oak and forest
- `street/park-bench-victorian-green-black`: Victorian park bench, green and black
- `street/park-bench-victorian-weathered-wood-bronze`: Victorian park bench, weathered wood and bronze
- `street/park-bench-concrete-light-oak-concrete`: Concrete block bench, light oak and concrete
- `street/park-bench-concrete-teak-concrete-dark`: Concrete block bench, teak and concrete dark
- `street/park-bench-concrete-pine-granite`: Concrete block bench, pine and granite
- `street/park-bench-concrete-walnut-limestone`: Concrete block bench, walnut and limestone
- `street/park-bench-modern-light-oak-brushed-steel`: Modern steel park bench, light oak and brushed steel
- `street/park-bench-modern-teak-anthracite`: Modern steel park bench, teak and anthracite
- `street/park-bench-modern-bamboo-galvanised`: Modern steel park bench, bamboo and galvanised
- `street/park-bench-modern-dark-stain-black-steel`: Modern steel park bench, dark stain and black steel
- `street/park-bench-rustic-rough-timber-brown`: Rustic log bench, rough timber and brown
- `street/park-bench-rustic-weathered-wood-grey`: Rustic log bench, weathered wood and grey
- `street/park-bench-rustic-oak-dark`: Rustic log bench, oak and dark
- `street/park-bench-rustic-pine-red`: Rustic log bench, pine and red
- `street/park-bench-tubular-pine-green`: Tubular steel park bench, pine and green
- `street/park-bench-tubular-oak-blue`: Tubular steel park bench, oak and blue
- `street/park-bench-tubular-grey-galvanised`: Tubular steel park bench, grey and galvanised
- `street/park-bench-tubular-teak-chrome`: Tubular steel park bench, teak and chrome

### street-lamp

20 assets, archetype `infrastructure.street-lamp`, parameters: height, lantern.

- `street/street-lamp-lantern-black`: Historic lantern street lamp, black
- `street/street-lamp-lantern-forest`: Historic lantern street lamp, forest
- `street/street-lamp-lantern-cast-iron`: Historic lantern street lamp, cast iron
- `street/street-lamp-lantern-navy`: Historic lantern street lamp, navy
- `street/street-lamp-led-galvanised`: Modern LED street lamp, galvanised
- `street/street-lamp-led-anthracite`: Modern LED street lamp, anthracite
- `street/street-lamp-led-aluminium`: Modern LED street lamp, aluminium
- `street/street-lamp-led-grey`: Modern LED street lamp, grey
- `street/street-lamp-double-galvanised`: Double-arm street lamp, galvanised
- `street/street-lamp-double-anthracite`: Double-arm street lamp, anthracite
- `street/street-lamp-double-steel`: Double-arm street lamp, steel
- `street/street-lamp-double-green`: Double-arm street lamp, green
- `street/street-lamp-globe-black`: Park globe lamp, black
- `street/street-lamp-globe-forest`: Park globe lamp, forest
- `street/street-lamp-globe-brushed-steel`: Park globe lamp, brushed steel
- `street/street-lamp-globe-bronze`: Park globe lamp, bronze
- `street/street-lamp-crook-black`: Shepherd's crook lamp, black
- `street/street-lamp-crook-forest`: Shepherd's crook lamp, forest
- `street/street-lamp-crook-cast-iron`: Shepherd's crook lamp, cast iron
- `street/street-lamp-crook-burgundy`: Shepherd's crook lamp, burgundy

### bin

16 assets, archetype `prop.bin`, parameters: height, r, ribs.

- `street/bin-round-galvanised-black-steel`: Galvanised round street bin with black steel trim
- `street/bin-round-green-galvanised`: Green round street bin with galvanised trim
- `street/bin-round-black-brass`: Black round street bin with brass trim
- `street/bin-round-corten-black-steel`: Corten round street bin with black steel trim
- `street/bin-wheelie-grey-green`: Grey wheelie bin with green trim
- `street/bin-wheelie-black-black`: Black wheelie bin
- `street/bin-wheelie-green-green`: Green wheelie bin
- `street/bin-wheelie-blue-blue`: Blue wheelie bin
- `street/bin-recycling-glass-grey-green`: Grey glass recycling bin with green trim
- `street/bin-recycling-paper-grey-blue`: Grey paper recycling bin with blue trim
- `street/bin-recycling-plastic-anthracite-yellow`: Anthracite plastic recycling bin with yellow trim
- `street/bin-recycling-waste-galvanised-anthracite`: Galvanised waste recycling bin with anthracite trim
- `street/bin-park-oak-cast-iron`: Oak slatted park bin with cast iron trim
- `street/bin-park-teak-black-steel`: Teak slatted park bin with black steel trim
- `street/bin-park-weathered-wood-galvanised`: Weathered wood slatted park bin with galvanised trim
- `street/bin-park-green-cast-iron`: Green slatted park bin with cast iron trim

### bollard

16 assets, archetype `infrastructure.bollard`, parameters: height, r.

- `street/bollard-cast-iron-cast-iron`: Cast iron cast iron cannon bollard
- `street/bollard-cast-iron-black-gold`: Black cast iron cannon bollard with gold bands
- `street/bollard-cast-iron-forest-brass`: Forest cast iron cannon bollard with brass bands
- `street/bollard-cast-iron-navy-white`: Navy cast iron cannon bollard with white bands
- `street/bollard-steel-galvanised-white`: Galvanised steel tube bollard with reflector white bands
- `street/bollard-steel-brushed-steel-red`: Brushed steel steel tube bollard with reflector red bands
- `street/bollard-steel-black-steel-white`: Black steel steel tube bollard with reflector white bands
- `street/bollard-steel-yellow-black`: Yellow steel tube bollard with black bands
- `street/bollard-concrete-concrete-white`: Concrete concrete bollard with reflector white bands
- `street/bollard-concrete-concrete-dark-amber`: Concrete dark concrete bollard with reflector amber bands
- `street/bollard-concrete-granite-white`: Granite concrete bollard with reflector white bands
- `street/bollard-concrete-sandstone-red`: Sandstone concrete bollard with reflector red bands
- `street/bollard-amsterdam-amsterdam-brown`: Amsterdam brown Amsterdam-style bollard
- `street/bollard-amsterdam-burgundy`: Burgundy Amsterdam-style bollard
- `street/bollard-amsterdam-cast-iron`: Cast iron Amsterdam-style bollard
- `street/bollard-amsterdam-black-white`: Black Amsterdam-style bollard with reflector white bands

### planter

16 assets, archetype `prop.planter`, parameters: r, height, plantHeight.

- `street/planter-pot-terracotta-shrub`: Terracotta round planter pot with shrub
- `street/planter-pot-blue-flowers`: Blue round planter pot with yellow flowers
- `street/planter-pot-celadon-grass`: Celadon round planter pot with grass
- `street/planter-pot-black-topiary`: Black round planter pot with topiary
- `street/planter-square-fibreglass-white-flowers`: Fibreglass white square planter box with red flowers
- `street/planter-square-corten-grass`: Corten square planter box with grass
- `street/planter-square-anthracite-topiary`: Anthracite square planter box with topiary
- `street/planter-square-galvanised-shrub`: Galvanised square planter box with shrub
- `street/planter-trough-concrete-grass`: Concrete concrete planter trough with grass
- `street/planter-trough-concrete-dark-topiary`: Concrete dark concrete planter trough with topiary
- `street/planter-trough-granite-shrub`: Granite concrete planter trough with shrub
- `street/planter-trough-limestone-flowers`: Limestone concrete planter trough with purple flowers
- `street/planter-wooden-pine-topiary`: Pine wooden planter with topiary
- `street/planter-wooden-teak-shrub`: Teak wooden planter with shrub
- `street/planter-wooden-weathered-wood-flowers`: Weathered wood wooden planter with pink flowers
- `street/planter-wooden-dark-stain-grass`: Dark stain wooden planter with grass

### traffic-sign

18 assets, archetype `infrastructure.traffic-sign`, parameters: height, size.

- `street/traffic-sign-no-entry`: No entry sign
- `street/traffic-sign-closed-to-vehicles`: Closed to all vehicles sign
- `street/traffic-sign-no-parking`: No parking sign
- `street/traffic-sign-no-stopping`: No stopping sign
- `street/traffic-sign-ahead-only`: Ahead only sign
- `street/traffic-sign-keep-right`: Keep right sign
- `street/traffic-sign-end-of-restrictions`: End of restrictions sign
- `street/traffic-sign-danger`: General danger sign
- `street/traffic-sign-give-way`: Give way sign
- `street/traffic-sign-temporary-warning`: Temporary warning sign
- `street/traffic-sign-priority-road`: Priority road sign
- `street/traffic-sign-stop`: Stop sign
- `street/traffic-sign-parking`: Parking sign
- `street/traffic-sign-pedestrian-crossing`: Pedestrian crossing sign
- `street/traffic-sign-dead-end`: Dead end sign
- `street/traffic-sign-direction-single-white`: White direction sign, one arm
- `street/traffic-sign-direction-double-blue`: Blue direction sign, two arms
- `street/traffic-sign-street-name`: Street name sign

### fire-hydrant

10 assets, archetype `infrastructure.fire-hydrant`, parameters: height, r, out.

- `street/fire-hydrant-american-red`: Red American fire hydrant
- `street/fire-hydrant-american-yellow-chrome-cap`: Yellow American fire hydrant with chrome caps
- `street/fire-hydrant-american-red-white-cap`: Red American fire hydrant with white caps
- `street/fire-hydrant-column-red`: Red European pillar hydrant
- `street/fire-hydrant-column-red-brushed-steel-cap`: Red European pillar hydrant with brushed steel caps
- `street/fire-hydrant-column-yellow-black-cap`: Yellow European pillar hydrant with black caps
- `street/fire-hydrant-post-red-galvanised-cap`: Red slim post hydrant with galvanised caps
- `street/fire-hydrant-post-green`: Green slim post hydrant
- `street/fire-hydrant-standpipe-yellow-red-cap`: Yellow four-way hydrant with red caps
- `street/fire-hydrant-standpipe-galvanised-red-cap`: Galvanised four-way hydrant with red caps

### mailbox

10 assets, archetype `prop.mailbox`, parameters: height, r.

- `street/mailbox-pillar-red`: Red pillar box
- `street/mailbox-pillar-forest`: Forest pillar box
- `street/mailbox-collection-blue`: Blue collection mailbox
- `street/mailbox-collection-olive`: Olive collection mailbox
- `street/mailbox-residential-black`: Black rural mailbox on a post
- `street/mailbox-residential-galvanised`: Galvanised rural mailbox on a post
- `street/mailbox-parcel-anthracite`: Anthracite parcel locker box
- `street/mailbox-parcel-yellow`: Yellow parcel locker box
- `street/mailbox-post-mounted-orange`: Orange post-mounted letter box
- `street/mailbox-post-mounted-yellow`: Yellow post-mounted letter box

### bike-rack

10 assets, archetype `infrastructure.bike-rack`, parameters: stands, height, length.

- `street/bike-rack-sheffield-plain-galvanised`: Galvanised Sheffield stand bike rack
- `street/bike-rack-sheffield-crossbar-black-steel`: Black steel Sheffield stand bike rack with crossbar
- `street/bike-rack-sheffield-rails-green`: Green Sheffield stand bike rack with rails
- `street/bike-rack-wheel-galvanised`: Galvanised wheel slot bike rack
- `street/bike-rack-wheel-anthracite`: Anthracite wheel slot bike rack
- `street/bike-rack-spiral-5-turns-galvanised`: Galvanised spiral bike rack (5 turns)
- `street/bike-rack-spiral-7-turns-blue`: Blue spiral bike rack (7 turns)
- `street/bike-rack-wave-4-waves-galvanised`: Galvanised wave bike rack (4 waves)
- `street/bike-rack-wave-5-waves-brushed-steel`: Brushed steel wave bike rack (5 waves)
- `street/bike-rack-wave-6-waves-yellow`: Yellow wave bike rack (6 waves)

### bus-stop

8 assets, archetype `infrastructure.bus-stop`, parameters: width, depth, height, bays.

- `street/bus-stop-glass-aluminium-red`: Aluminium glass bus shelter with red trim
- `street/bus-stop-glass-anthracite-yellow`: Anthracite glass bus shelter with yellow trim
- `street/bus-stop-cantilever-green-white`: Green cantilever bus shelter with white trim
- `street/bus-stop-cantilever-black-steel-blue`: Black steel cantilever bus shelter with blue trim
- `street/bus-stop-wooden-oak-slate`: Oak wooden bus shelter with slate roof
- `street/bus-stop-wooden-weathered-wood-terracotta`: Weathered wood wooden bus shelter with terracotta roof
- `street/bus-stop-canopy-brushed-steel-yellow`: Brushed steel canopy bus stop with yellow trim
- `street/bus-stop-canopy-anthracite-green`: Anthracite canopy bus stop with green trim

### traffic-cone

8 assets, archetype `prop.traffic-cone`, parameters: height, r.

- `street/traffic-cone-cone-orange`: Orange traffic cone
- `street/traffic-cone-cone-red`: Red traffic cone
- `street/traffic-cone-lamp-cone-orange`: Orange traffic cone with warning lamp
- `street/traffic-cone-lamp-cone-yellow`: Yellow traffic cone with warning lamp
- `street/traffic-cone-delineator-orange`: Orange delineator post
- `street/traffic-cone-delineator-yellow`: Yellow delineator post
- `street/traffic-cone-drum-orange`: Orange traffic drum
- `street/traffic-cone-drum-red`: Red traffic drum

### road-barrier

8 assets, archetype `infrastructure.road-barrier`, parameters: width, height.

- `street/road-barrier-jersey-concrete-amber`: Concrete jersey barrier
- `street/road-barrier-jersey-concrete-dark-white`: Concrete dark jersey barrier
- `street/road-barrier-water-red-white`: Red water-filled barrier
- `street/road-barrier-water-white-red`: White water-filled barrier
- `street/road-barrier-crowd-galvanised`: Galvanised crowd control barrier
- `street/road-barrier-crowd-blue-galvanised`: Blue crowd control barrier
- `street/road-barrier-works-white-red`: White roadworks barrier with red stripes
- `street/road-barrier-works-yellow-black`: Yellow roadworks barrier with black stripes

### fence

10 assets, archetype `infrastructure.fence`, parameters: length, height, gap.

- `street/fence-picket-white`: White picket fence
- `street/fence-picket-cream`: Cream picket fence
- `street/fence-picket-pine`: Pine picket fence
- `street/fence-post-and-rail-rough-timber`: Rough timber post and rail fence
- `street/fence-post-and-rail-weathered-wood`: Weathered wood post and rail fence
- `street/fence-mesh-galvanised`: Galvanised welded mesh fence
- `street/fence-mesh-green`: Green welded mesh fence
- `street/fence-railing-black`: Black iron railing
- `street/fence-railing-cast-iron`: Cast iron iron railing
- `street/fence-railing-forest`: Forest iron railing

## storage

### crate

24 assets, archetype `prop.crate`, parameters: width, depth, height, slats.

- `storage/crate-slatted-pine`: Pine slatted crate
- `storage/crate-slatted-weathered-wood`: Weathered wood slatted crate
- `storage/crate-slatted-whitewash-wood`: Whitewash wood slatted crate
- `storage/crate-slatted-rough-timber`: Rough timber slatted crate
- `storage/crate-shipping-pine`: Pine shipping crate
- `storage/crate-shipping-rough-timber`: Rough timber shipping crate
- `storage/crate-shipping-light-oak`: Light oak shipping crate
- `storage/crate-shipping-weathered-wood`: Weathered wood shipping crate
- `storage/crate-flight-case-birch`: Birch plywood flight case
- `storage/crate-flight-case-black`: Black plywood flight case
- `storage/crate-flight-case-dark-stain`: Dark stain plywood flight case
- `storage/crate-flight-case-grey`: Grey plywood flight case
- `storage/crate-plastic-blue`: Blue plastic stacking crate
- `storage/crate-plastic-grey`: Grey plastic stacking crate
- `storage/crate-plastic-red`: Red plastic stacking crate
- `storage/crate-plastic-green`: Green plastic stacking crate
- `storage/crate-scifi-gunmetal`: Gunmetal sci-fi cargo crate
- `storage/crate-scifi-white`: White sci-fi cargo crate
- `storage/crate-scifi-orange`: Orange sci-fi cargo crate
- `storage/crate-scifi-olive`: Olive sci-fi cargo crate
- `storage/crate-ammo-olive`: Olive steel ammo box
- `storage/crate-ammo-forest`: Forest steel ammo box
- `storage/crate-ammo-sand`: Sand steel ammo box
- `storage/crate-ammo-grey`: Grey steel ammo box

### barrel

18 assets, archetype `prop.barrel`, parameters: height, radius, bulge.

- `storage/barrel-cask-oak`: Oak cask
- `storage/barrel-cask-dark-stain`: Dark stain cask
- `storage/barrel-cask-light-oak`: Light oak cask
- `storage/barrel-water-butt-teak`: Teak water butt
- `storage/barrel-water-butt-weathered-wood`: Weathered wood water butt
- `storage/barrel-water-butt-pine`: Pine water butt
- `storage/barrel-steel-drum-blue`: Blue steel drum
- `storage/barrel-steel-drum-red`: Red steel drum
- `storage/barrel-steel-drum-black`: Black steel drum
- `storage/barrel-open-drum-yellow`: Yellow open-head drum
- `storage/barrel-open-drum-green`: Green open-head drum
- `storage/barrel-open-drum-rust`: Rust open-head drum
- `storage/barrel-plastic-drum-blue`: Blue plastic drum
- `storage/barrel-plastic-drum-white`: White plastic drum
- `storage/barrel-plastic-drum-black`: Black plastic drum
- `storage/barrel-open-plastic-blue`: Blue open-top plastic drum
- `storage/barrel-open-plastic-white`: White open-top plastic drum
- `storage/barrel-open-plastic-green`: Green open-top plastic drum

### pallet

12 assets, archetype `prop.pallet`, parameters: length, width, boards.

- `storage/pallet-eur-pine`: Pine EUR block pallet
- `storage/pallet-eur-weathered-wood`: Weathered wood EUR block pallet
- `storage/pallet-eur-cartons-light-oak`: Light oak EUR block pallet with cartons
- `storage/pallet-eur-cartons-pine`: Pine EUR block pallet with cartons
- `storage/pallet-stringer-rough-timber`: Rough timber stringer pallet
- `storage/pallet-stringer-birch`: Birch stringer pallet
- `storage/pallet-stringer-sacks-rough-timber`: Rough timber stringer pallet with sacks
- `storage/pallet-stringer-sacks-weathered-wood`: Weathered wood stringer pallet with sacks
- `storage/pallet-plastic-blue`: Blue plastic pallet
- `storage/pallet-plastic-black`: Black plastic pallet
- `storage/pallet-plastic-wrapped-grey`: Grey plastic pallet with wrapped cartons
- `storage/pallet-plastic-wrapped-red`: Red plastic pallet with wrapped cartons

### shipping-container

16 assets, archetype `prop.shipping-container`, parameters: length, height, pitch.

- `storage/shipping-container-20ft-red`: Red 20 ft shipping container
- `storage/shipping-container-20ft-blue`: Blue 20 ft shipping container
- `storage/shipping-container-20ft-green`: Green 20 ft shipping container
- `storage/shipping-container-20ft-orange`: Orange 20 ft shipping container
- `storage/shipping-container-40ft-grey`: Grey 40 ft shipping container
- `storage/shipping-container-40ft-teal`: Teal 40 ft shipping container
- `storage/shipping-container-40ft-yellow`: Yellow 40 ft shipping container
- `storage/shipping-container-high-cube-blue`: Blue 40 ft high cube container
- `storage/shipping-container-high-cube-red`: Red 40 ft high cube container
- `storage/shipping-container-high-cube-white`: White 40 ft high cube container
- `storage/shipping-container-open-side-green`: Green 20 ft open side container
- `storage/shipping-container-open-side-orange`: Orange 20 ft open side container
- `storage/shipping-container-open-side-grey`: Grey 20 ft open side container
- `storage/shipping-container-reefer-white`: White 40 ft reefer container
- `storage/shipping-container-reefer-silver`: Silver 40 ft reefer container
- `storage/shipping-container-reefer-grey`: Grey 40 ft reefer container

### gas-cylinder

10 assets, archetype `prop.gas-cylinder`, parameters: height, radius.

- `storage/gas-cylinder-industrial-black`: Black industrial gas cylinder
- `storage/gas-cylinder-industrial-green`: Green industrial gas cylinder
- `storage/gas-cylinder-industrial-grey`: Grey industrial gas cylinder
- `storage/gas-cylinder-guarded-maroon`: Maroon welding gas cylinder
- `storage/gas-cylinder-guarded-blue`: Blue welding gas cylinder
- `storage/gas-cylinder-propane-white`: White propane tank
- `storage/gas-cylinder-propane-orange`: Orange propane tank
- `storage/gas-cylinder-propane-grey`: Grey propane tank
- `storage/gas-cylinder-camping-blue`: Blue camping gas bottle
- `storage/gas-cylinder-camping-red`: Red camping gas bottle

### storage-tank

12 assets, archetype `infrastructure.storage-tank`, parameters: diameter, height, courses.

- `storage/storage-tank-vertical-white`: White vertical storage tank
- `storage/storage-tank-vertical-silver`: Silver vertical storage tank
- `storage/storage-tank-vertical-forest`: Forest vertical storage tank
- `storage/storage-tank-silo-galvanised`: Galvanised hopper silo
- `storage/storage-tank-silo-aluminium`: Aluminium hopper silo
- `storage/storage-tank-silo-white`: White hopper silo
- `storage/storage-tank-sphere-white`: White spherical gas tank
- `storage/storage-tank-sphere-sky`: Sky spherical gas tank
- `storage/storage-tank-sphere-silver`: Silver spherical gas tank
- `storage/storage-tank-water-tower-sky`: Sky elevated water tank
- `storage/storage-tank-water-tower-white`: White elevated water tank
- `storage/storage-tank-water-tower-rust`: Rust elevated water tank

### rack

12 assets, archetype `prop.rack`, parameters: width, depth, height, levels.

- `storage/rack-pallet-blue`: Blue pallet rack
- `storage/rack-pallet-galvanised`: Galvanised pallet rack
- `storage/rack-pallet-grey`: Grey pallet rack
- `storage/rack-boltless-galvanised`: Galvanised boltless shelving unit
- `storage/rack-boltless-black`: Black boltless shelving unit
- `storage/rack-boltless-grey`: Grey boltless shelving unit
- `storage/rack-wine-pine`: Pine wine rack
- `storage/rack-wine-walnut`: Walnut wine rack
- `storage/rack-wine-black`: Black wine rack
- `storage/rack-cantilever-yellow`: Yellow cantilever rack
- `storage/rack-cantilever-blue`: Blue cantilever rack
- `storage/rack-cantilever-red`: Red cantilever rack

### cable-reel

10 assets, archetype `prop.cable-reel`, parameters: diameter, width, fill.

- `storage/cable-reel-wooden-pine-black`: Pine wooden cable drum with black cable
- `storage/cable-reel-wooden-weathered-wood-orange`: Weathered wood wooden cable drum with orange cable
- `storage/cable-reel-wooden-rough-timber-copper-wire`: Rough timber wooden cable drum with copper wire cable
- `storage/cable-reel-wooden-birch-green`: Birch wooden cable drum with green cable
- `storage/cable-reel-flat-pine-blue`: Pine cable spool lying flat with blue cable
- `storage/cable-reel-flat-birch-yellow`: Birch cable spool lying flat with yellow cable
- `storage/cable-reel-flat-whitewash-wood-rope`: Whitewash wood cable spool lying flat with rope
- `storage/cable-reel-hose-red-green`: Red hose reel on a stand with green hose
- `storage/cable-reel-hose-galvanised-yellow`: Galvanised hose reel on a stand with yellow hose
- `storage/cable-reel-hose-blue-black`: Blue hose reel on a stand with black hose

### chest

16 assets, archetype `prop.chest`, parameters: width, depth, height.

- `storage/chest-treasure-oak`: Oak treasure chest
- `storage/chest-treasure-walnut`: Walnut treasure chest
- `storage/chest-treasure-mahogany`: Mahogany treasure chest
- `storage/chest-treasure-weathered-wood`: Weathered wood treasure chest
- `storage/chest-toolbox-red`: Red toolbox
- `storage/chest-toolbox-blue`: Blue toolbox
- `storage/chest-toolbox-black`: Black toolbox
- `storage/chest-toolbox-yellow`: Yellow toolbox
- `storage/chest-trunk-leather-brown`: Leather brown steamer trunk
- `storage/chest-trunk-navy`: Navy steamer trunk
- `storage/chest-trunk-leather-black`: Leather black steamer trunk
- `storage/chest-trunk-canvas-beige`: Canvas beige steamer trunk
- `storage/chest-footlocker-olive`: Olive footlocker
- `storage/chest-footlocker-forest`: Forest footlocker
- `storage/chest-footlocker-navy`: Navy footlocker
- `storage/chest-footlocker-sand`: Sand footlocker

### jerrycan

8 assets, archetype `prop.jerrycan`, parameters: width, depth, height.

- `storage/jerrycan-steel-olive`: Olive steel jerrycan
- `storage/jerrycan-steel-red`: Red steel jerrycan
- `storage/jerrycan-steel-sand`: Sand steel jerrycan
- `storage/jerrycan-fuel-red`: Red plastic fuel can
- `storage/jerrycan-fuel-yellow`: Yellow plastic fuel can
- `storage/jerrycan-fuel-green`: Green plastic fuel can
- `storage/jerrycan-water-blue`: Blue water canister
- `storage/jerrycan-water-white`: White water canister

### cart

12 assets, archetype `vehicle.wheeled.cart`, parameters: length, width, wheel.

- `storage/cart-wheelbarrow-green`: Green wheelbarrow
- `storage/cart-wheelbarrow-galvanised-soil`: Galvanised wheelbarrow with soil
- `storage/cart-wheelbarrow-orange-sand`: Orange wheelbarrow with sand
- `storage/cart-handcart-oak`: Oak wooden handcart
- `storage/cart-handcart-weathered-wood`: Weathered wood wooden handcart
- `storage/cart-handcart-blue`: Blue wooden handcart
- `storage/cart-wagon-red`: Red pull wagon
- `storage/cart-wagon-pine`: Pine pull wagon
- `storage/cart-wagon-green`: Green pull wagon
- `storage/cart-trolley-blue`: Blue platform trolley
- `storage/cart-trolley-birch`: Birch platform trolley
- `storage/cart-trolley-yellow`: Yellow platform trolley

## nature

### broadleaf-tree

30 assets, archetype `plant.tree.broadleaf`, parameters: height, crownRadius, trunkRadius, branches.

- `nature/broadleaf-tree-oak-summer`: Summer oak
- `nature/broadleaf-tree-oak-autumn`: Autumn oak
- `nature/broadleaf-tree-oak-spring`: Spring oak
- `nature/broadleaf-tree-oak-young`: Young oak
- `nature/broadleaf-tree-oak-veteran`: Veteran oak
- `nature/broadleaf-tree-beech-summer`: Summer beech
- `nature/broadleaf-tree-beech-autumn`: Autumn beech
- `nature/broadleaf-tree-beech-spring`: Spring beech
- `nature/broadleaf-tree-beech-young`: Young beech
- `nature/broadleaf-tree-beech-veteran`: Veteran beech
- `nature/broadleaf-tree-birch-summer`: Summer birch
- `nature/broadleaf-tree-birch-autumn`: Autumn birch
- `nature/broadleaf-tree-birch-spring`: Spring birch
- `nature/broadleaf-tree-birch-young`: Young birch
- `nature/broadleaf-tree-birch-veteran`: Veteran birch
- `nature/broadleaf-tree-maple-summer`: Summer maple
- `nature/broadleaf-tree-maple-autumn`: Autumn maple
- `nature/broadleaf-tree-maple-spring`: Spring maple
- `nature/broadleaf-tree-maple-young`: Young maple
- `nature/broadleaf-tree-maple-veteran`: Veteran maple
- `nature/broadleaf-tree-willow-summer`: Summer willow
- `nature/broadleaf-tree-willow-autumn`: Autumn willow
- `nature/broadleaf-tree-willow-spring`: Spring willow
- `nature/broadleaf-tree-willow-young`: Young willow
- `nature/broadleaf-tree-willow-veteran`: Veteran willow
- `nature/broadleaf-tree-fruit-tree-summer`: Summer fruit tree
- `nature/broadleaf-tree-fruit-tree-autumn`: Autumn fruit tree
- `nature/broadleaf-tree-fruit-tree-spring`: Spring fruit tree
- `nature/broadleaf-tree-fruit-tree-young`: Young fruit tree
- `nature/broadleaf-tree-fruit-tree-veteran`: Veteran fruit tree

### conifer

20 assets, archetype `plant.tree.conifer`, parameters: height, crownRadius, trunkRadius, tiers.

- `nature/conifer-spruce-norway`: Norway spruce
- `nature/conifer-spruce-blue`: Blue spruce
- `nature/conifer-spruce-snowy`: Snowy spruce
- `nature/conifer-spruce-young`: Young spruce
- `nature/conifer-fir-nordmann`: Nordmann fir
- `nature/conifer-fir-christmas`: Christmas fir
- `nature/conifer-fir-noble`: Noble fir
- `nature/conifer-fir-snowy`: Snowy fir
- `nature/conifer-pine-scots`: Scots pine
- `nature/conifer-pine-black`: Black pine
- `nature/conifer-pine-stone`: Stone pine
- `nature/conifer-pine-lodgepole`: Lodgepole pine
- `nature/conifer-cypress-italian`: Italian cypress
- `nature/conifer-cypress-leyland`: Leyland cypress
- `nature/conifer-cypress-thuja`: Thuja cypress
- `nature/conifer-cypress-juniper`: Juniper cypress
- `nature/conifer-larch-summer`: Summer larch
- `nature/conifer-larch-autumn`: Autumn larch
- `nature/conifer-larch-turning`: Turning larch
- `nature/conifer-larch-japanese`: Japanese larch

### palm

12 assets, archetype `plant.tree.palm`, parameters: height, trunkRadius, frondLength, fronds, lean.

- `nature/palm-coconut-tropical`: Tropical coconut palm
- `nature/palm-coconut-dry`: Sun-dried coconut palm
- `nature/palm-coconut-young`: Young coconut palm
- `nature/palm-date-tropical`: Tropical date palm
- `nature/palm-date-dry`: Sun-dried date palm
- `nature/palm-date-young`: Young date palm
- `nature/palm-fan-tropical`: Tropical fan palm
- `nature/palm-fan-dry`: Sun-dried fan palm
- `nature/palm-fan-young`: Young fan palm
- `nature/palm-royal-tropical`: Tropical royal palm
- `nature/palm-royal-dry`: Sun-dried royal palm
- `nature/palm-royal-young`: Young royal palm

### bush

24 assets, archetype `plant.bush`, parameters: width, height, masses.

- `nature/bush-green`: Round green shrub
- `nature/bush-dark`: Dark evergreen shrub
- `nature/bush-purple`: Purple-leaf shrub
- `nature/bush-variegated`: Variegated shrub
- `nature/bush-privet`: Privet hedge
- `nature/bush-beech`: Beech hedge in autumn
- `nature/bush-yew`: Yew hedge
- `nature/bush-box-border`: Low box border
- `nature/bush-hydrangea-blue`: Blue hydrangea
- `nature/bush-hydrangea-pink`: Pink hydrangea
- `nature/bush-rhododendron`: Rhododendron
- `nature/bush-spiraea`: White spiraea
- `nature/bush-ball`: Boxwood ball topiary
- `nature/bush-cone`: Boxwood cone topiary
- `nature/bush-tiered`: Tiered boxwood topiary
- `nature/bush-standard`: Standard ball topiary
- `nature/bush-lavender`: Lavender bush
- `nature/bush-salvia`: Blue salvia
- `nature/bush-heather`: Pink heather
- `nature/bush-rosemary`: Rosemary bush
- `nature/bush-holly`: Holly bush with berries
- `nature/bush-blueberry`: Blueberry bush
- `nature/bush-currant`: Redcurrant bush
- `nature/bush-snowberry`: Snowberry bush

### rock

30 assets, archetype `prop.rock`, parameters: size, height.

- `nature/rock-boulder-granite`: Granite boulder
- `nature/rock-boulder-sandstone`: Sandstone boulder
- `nature/rock-boulder-basalt`: Basalt boulder
- `nature/rock-boulder-lichen`: Lichen boulder
- `nature/rock-boulder-mossy`: Mossy boulder
- `nature/rock-pile-granite`: Granite rock pile
- `nature/rock-pile-limestone`: Limestone rock pile
- `nature/rock-pile-slate`: Slate rock pile
- `nature/rock-pile-red`: Red rock pile
- `nature/rock-pile-mossy`: Mossy rock pile
- `nature/rock-slab-slate`: Slate flat rock slab
- `nature/rock-slab-sandstone`: Sandstone flat rock slab
- `nature/rock-slab-limestone`: Limestone flat rock slab
- `nature/rock-slab-red`: Red flat rock slab
- `nature/rock-slab-mossy`: Mossy flat rock slab
- `nature/rock-cliff-granite`: Granite cliff chunk
- `nature/rock-cliff-basalt`: Basalt cliff chunk
- `nature/rock-cliff-red`: Red cliff chunk
- `nature/rock-cliff-chalk`: Chalk cliff chunk
- `nature/rock-cliff-mossy`: Mossy cliff chunk
- `nature/rock-pebbles-river`: River pebble cluster
- `nature/rock-pebbles-quartz`: Quartz pebble cluster
- `nature/rock-pebbles-slate`: Slate pebble cluster
- `nature/rock-pebbles-sandstone`: Sandstone pebble cluster
- `nature/rock-pebbles-mossy`: Mossy pebble cluster
- `nature/rock-split-granite`: Granite split boulder
- `nature/rock-split-limestone`: Limestone split boulder
- `nature/rock-split-basalt`: Basalt split boulder
- `nature/rock-split-lichen`: Lichen split boulder
- `nature/rock-split-mossy`: Mossy split boulder

### flower

16 assets, archetype `plant.flower`, parameters: height, headRadius.

- `nature/flower-tulip-red`: Red tulip
- `nature/flower-tulip-yellow`: Yellow tulip
- `nature/flower-tulip-bunch`: Bunch of pink tulips
- `nature/flower-sunflower-tall`: Tall sunflower
- `nature/flower-sunflower-dwarf`: Dwarf sunflower
- `nature/flower-daisy-white`: White daisy
- `nature/flower-daisy-echinacea`: Purple coneflower
- `nature/flower-daisy-patch`: Daisy patch
- `nature/flower-rose-red`: Red rose
- `nature/flower-rose-pink`: Pink rose
- `nature/flower-rose-white`: White rose
- `nature/flower-lily-white`: White lily
- `nature/flower-lily-tiger`: Orange tiger lily
- `nature/flower-tulip-purple`: Purple tulip
- `nature/flower-rose-bunch`: Bunch of red roses
- `nature/flower-daisy-blue-aster`: Blue aster

### grass

12 assets, archetype `plant.grass`, parameters: height, radius, blades.

- `nature/grass-tuft-lawn`: Lawn grass tuft
- `nature/grass-tuft-spring`: Fresh grass tuft
- `nature/grass-tuft-dry`: Dry grass tuft
- `nature/grass-meadow-green`: Meadow grass with seed heads
- `nature/grass-meadow-hay`: Dry meadow grass
- `nature/grass-meadow-red`: Red fountain grass
- `nature/grass-reeds-common`: Reed clump
- `nature/grass-reeds-cattail`: Cattails
- `nature/grass-reeds-rush`: Soft rush
- `nature/grass-clump-fern`: Fern clump
- `nature/grass-clump-fescue`: Blue fescue
- `nature/grass-clump-sedge`: Sedge clump

### stump

14 assets, archetype `plant.stump`, parameters: radius, height, roots, rings.

- `nature/stump-cut-oak`: Oak tree stump
- `nature/stump-cut-birch`: Birch tree stump
- `nature/stump-cut-pine`: Pine tree stump
- `nature/stump-cut-mossy`: Mossy tree stump
- `nature/stump-broken-oak`: Broken oak stump
- `nature/stump-broken-dead`: Dead grey snag
- `nature/stump-log-oak`: Fallen oak log
- `nature/stump-log-birch`: Fallen birch log
- `nature/stump-log-mossy`: Mossy fallen log
- `nature/stump-hollow-oak`: Hollow log
- `nature/stump-hollow-rotten`: Rotten hollow log
- `nature/stump-hollow-mossy`: Mossy hollow log
- `nature/stump-pile-pine`: Pine log pile
- `nature/stump-pile-birch`: Birch log pile

### mushroom

12 assets, archetype `plant.mushroom`, parameters: height, capRadius.

- `nature/mushroom-fly-agaric`: Fly agaric
- `nature/mushroom-fly-agaric-young`: Young fly agaric
- `nature/mushroom-porcini`: Porcini
- `nature/mushroom-porcini-pair`: Porcini pair
- `nature/mushroom-honey-cluster`: Honey fungus cluster
- `nature/mushroom-chanterelle`: Chanterelle cluster
- `nature/mushroom-ink-cap`: Shaggy ink caps
- `nature/mushroom-parasol`: Parasol mushroom
- `nature/mushroom-button-cluster`: Button mushrooms
- `nature/mushroom-giant-red`: Giant fantasy toadstool
- `nature/mushroom-giant-glow-blue`: Glowing blue giant mushroom
- `nature/mushroom-giant-purple`: Giant purple fantasy mushroom

## buildings

### house

40 assets, archetype `building.house`, parameters: width, depth, storey, rise, bays.

- `buildings/house-terraced-red-brick`: Red brick terraced house
- `buildings/house-terraced-yellow-brick`: Yellow brick terraced house
- `buildings/house-terraced-brown-brick`: Brown brick terraced house
- `buildings/house-terraced-white-render`: White render terraced house
- `buildings/house-terraced-pink-render`: Pink render terraced house
- `buildings/house-detached-red-brick`: Red brick detached
- `buildings/house-detached-cream-render`: Cream render detached
- `buildings/house-detached-white-render`: White render detached
- `buildings/house-detached-brown-brick`: Brown brick detached
- `buildings/house-detached-black-timber`: Black timber cladding detached
- `buildings/house-bungalow-cream-render`: Cream render bungalow
- `buildings/house-bungalow-red-brick`: Red brick bungalow
- `buildings/house-bungalow-pink-render`: Pink render bungalow
- `buildings/house-bungalow-white-render`: White render bungalow
- `buildings/house-bungalow-yellow-brick`: Yellow brick bungalow
- `buildings/house-cottage-white-render`: White render cottage
- `buildings/house-cottage-cream-render`: Cream render cottage
- `buildings/house-cottage-pink-render`: Pink render cottage
- `buildings/house-cottage-red-brick`: Red brick cottage
- `buildings/house-cottage-blue-boarded`: Blue weatherboard cottage
- `buildings/house-townhouse-yellow-brick`: Yellow brick townhouse
- `buildings/house-townhouse-brown-brick`: Brown brick townhouse
- `buildings/house-townhouse-red-brick`: Red brick townhouse
- `buildings/house-townhouse-white-render`: White render townhouse
- `buildings/house-townhouse-blue-boarded`: Blue weatherboard townhouse
- `buildings/house-modern-white-render`: White render modern house
- `buildings/house-modern-black-timber`: Black timber cladding modern house
- `buildings/house-modern-brown-brick`: Brown brick modern house
- `buildings/house-modern-cream-render`: Cream render modern house
- `buildings/house-modern-yellow-brick`: Yellow brick modern house
- `buildings/house-villa-white-render`: White render villa
- `buildings/house-villa-cream-render`: Cream render villa
- `buildings/house-villa-pink-render`: Pink render villa
- `buildings/house-villa-yellow-brick`: Yellow brick villa
- `buildings/house-villa-red-brick`: Red brick villa
- `buildings/house-farmhouse-blue-boarded`: Blue weatherboard farmhouse
- `buildings/house-farmhouse-white-render`: White render farmhouse
- `buildings/house-farmhouse-cream-render`: Cream render farmhouse
- `buildings/house-farmhouse-black-timber`: Black timber cladding farmhouse
- `buildings/house-farmhouse-red-brick`: Red brick farmhouse

### shed

20 assets, archetype `building.shed`, parameters: width, depth, wallHeight, rise.

- `buildings/shed-apex-sage`: Sage green apex garden shed
- `buildings/shed-apex-natural`: Natural pine apex garden shed
- `buildings/shed-apex-grey`: Grey apex garden shed
- `buildings/shed-apex-red`: Red apex garden shed
- `buildings/shed-apex-cream`: Cream apex garden shed
- `buildings/shed-pent-black`: Black pent shed
- `buildings/shed-pent-pine`: Pine pent shed
- `buildings/shed-pent-blue`: Blue pent shed
- `buildings/shed-pent-weathered`: Weathered pent shed
- `buildings/shed-garage-brick`: Red brick garage
- `buildings/shed-garage-concrete`: Concrete garage
- `buildings/shed-garage-render`: White rendered garage
- `buildings/shed-garage-yellow-brick`: Yellow brick garage
- `buildings/shed-cabin-honey`: Honey log log cabin
- `buildings/shed-cabin-dark`: Dark log log cabin
- `buildings/shed-cabin-grey`: Silver-grey log log cabin
- `buildings/shed-cabin-red`: Swedish red log log cabin
- `buildings/shed-workshop-galvanised`: Galvanised workshop
- `buildings/shed-workshop-green`: Green workshop
- `buildings/shed-workshop-red`: Rust red workshop

### barn

12 assets, archetype `building.barn`, parameters: width, length, wallHeight, rise.

- `buildings/barn-gable-red`: Red gable barn
- `buildings/barn-gable-grey`: Weathered grey gable barn
- `buildings/barn-gable-tarred`: Black tarred gable barn
- `buildings/barn-gambrel-red`: Red gambrel barn
- `buildings/barn-gambrel-white`: Cream gambrel barn
- `buildings/barn-gambrel-brown`: Brown gambrel barn
- `buildings/barn-steel-grey`: Grey steel farm shed
- `buildings/barn-steel-green`: Green steel farm shed
- `buildings/barn-steel-blue`: Blue steel farm shed
- `buildings/barn-hip-thatch`: Thatched red brick Dutch farm barn
- `buildings/barn-hip-tiled`: Tiled brown brick Dutch farm barn
- `buildings/barn-hip-slate`: Slated yellow brick Dutch farm barn

### apartment

12 assets, archetype `building.apartment`, parameters: width, depth, floors, bays, storey.

- `buildings/apartment-slab-red-brick`: Red brick apartment block
- `buildings/apartment-slab-concrete`: Concrete apartment block
- `buildings/apartment-slab-yellow-brick`: Yellow brick apartment block
- `buildings/apartment-tower-white`: White residential tower
- `buildings/apartment-tower-concrete`: Dark concrete residential tower
- `buildings/apartment-tower-brown-brick`: Brown brick residential tower
- `buildings/apartment-mansion-red-brick`: Red brick mansion block
- `buildings/apartment-mansion-yellow-brick`: Yellow stock brick mansion block
- `buildings/apartment-mansion-stucco`: Stucco mansion block
- `buildings/apartment-gallery-concrete`: Concrete and orange gallery flats
- `buildings/apartment-gallery-brick`: Brown brick gallery flats
- `buildings/apartment-gallery-blue`: Blue rendered gallery flats

### watchtower

14 assets, archetype `building.watchtower`, parameters: height, width, slits, merlons.

- `buildings/watchtower-battlement-grey-stone`: Grey stone battlemented watchtower
- `buildings/watchtower-battlement-sandstone`: Sandstone battlemented watchtower
- `buildings/watchtower-battlement-limestone`: Limestone battlemented watchtower
- `buildings/watchtower-battlement-brick`: Brick battlemented watchtower
- `buildings/watchtower-conical-grey-stone`: Grey stone conical-roofed watchtower
- `buildings/watchtower-conical-rendered`: Whitewashed conical-roofed watchtower
- `buildings/watchtower-conical-mossy`: Mossy stone conical-roofed watchtower
- `buildings/watchtower-timber-pine`: Pine timber lookout tower
- `buildings/watchtower-timber-dark`: Dark-stained timber lookout tower
- `buildings/watchtower-timber-weathered`: Weathered timber lookout tower
- `buildings/watchtower-timber-larch`: Larch log timber lookout tower
- `buildings/watchtower-fire-galvanised`: Galvanised fire lookout tower
- `buildings/watchtower-fire-green`: Green fire lookout tower
- `buildings/watchtower-fire-red`: Red and white fire lookout tower

### gazebo

14 assets, archetype `building.gazebo`, parameters: radius, height, rise.

- `buildings/gazebo-hexagonal-white`: White hexagonal gazebo
- `buildings/gazebo-hexagonal-cedar`: Cedar hexagonal gazebo
- `buildings/gazebo-hexagonal-green`: Green hexagonal gazebo
- `buildings/gazebo-hexagonal-thatched`: Thatched hexagonal gazebo
- `buildings/gazebo-bandstand-green`: Green and cream octagonal bandstand
- `buildings/gazebo-bandstand-red`: Burgundy octagonal bandstand
- `buildings/gazebo-bandstand-white`: White and gold octagonal bandstand
- `buildings/gazebo-pergola-oak`: Oak pergola
- `buildings/gazebo-pergola-grey`: Grey painted pergola
- `buildings/gazebo-pergola-pine`: Pine pergola
- `buildings/gazebo-pergola-black-steel`: Black steel and oak pergola
- `buildings/gazebo-carport-timber`: Timber carport
- `buildings/gazebo-carport-steel`: Anthracite steel carport
- `buildings/gazebo-carport-white`: White with a polycarbonate roof carport

### church

8 assets, archetype `building.church`, parameters: length, width, wallHeight, spire.

- `buildings/church-steeple-limestone`: Limestone parish church with spire
- `buildings/church-steeple-brick`: Red brick parish church with spire
- `buildings/church-chapel-white`: Whitewashed chapel
- `buildings/church-chapel-stone`: Granite chapel
- `buildings/church-basilica-sandstone`: Sandstone Romanesque basilica
- `buildings/church-basilica-tuff`: Grey tuff Romanesque basilica
- `buildings/church-modern-concrete`: Concrete and zinc modern church
- `buildings/church-modern-brick`: Brick and copper modern church

### market-stall

16 assets, archetype `prop.market-stall`, parameters: width, depth, height.

- `buildings/market-stall-awning-red`: Red and white striped market stall
- `buildings/market-stall-awning-green`: Green and white striped market stall
- `buildings/market-stall-awning-blue`: Blue and white striped market stall
- `buildings/market-stall-awning-yellow`: Yellow and white striped market stall
- `buildings/market-stall-wooden-pine`: Pine wooden market stall
- `buildings/market-stall-wooden-dark`: Dark-stained wooden market stall
- `buildings/market-stall-wooden-green`: Weathered wooden market stall
- `buildings/market-stall-wooden-red`: Red-roofed wooden market stall
- `buildings/market-stall-kiosk-white`: White food kiosk
- `buildings/market-stall-kiosk-teal`: Teal food kiosk
- `buildings/market-stall-kiosk-black`: Black food kiosk
- `buildings/market-stall-kiosk-wood`: Timber-clad food kiosk
- `buildings/market-stall-tarp-white`: White tarpaulin steel market stall
- `buildings/market-stall-tarp-blue`: Blue tarpaulin steel market stall
- `buildings/market-stall-tarp-green`: Green tarpaulin steel market stall
- `buildings/market-stall-tarp-red`: Red tarpaulin steel market stall

### tent

14 assets, archetype `prop.tent`, parameters: length, width, height.

- `buildings/tent-dome-orange`: Orange dome tent
- `buildings/tent-dome-green`: Green dome tent
- `buildings/tent-dome-blue`: Blue dome tent
- `buildings/tent-dome-red`: Red dome tent
- `buildings/tent-ridge-canvas`: Canvas ridge tent
- `buildings/tent-ridge-olive`: Olive army ridge tent
- `buildings/tent-ridge-orange`: Orange nylon ridge tent
- `buildings/tent-ridge-blue`: Blue nylon ridge tent
- `buildings/tent-tipi-white`: White canvas tipi
- `buildings/tent-tipi-hide`: Hide-coloured tipi
- `buildings/tent-tipi-khaki`: Khaki tipi
- `buildings/tent-bell-natural`: Natural cotton bell tent
- `buildings/tent-bell-white`: White bell tent
- `buildings/tent-bell-olive`: Olive bell tent

## vehicles

### car

30 assets, archetype `vehicle.wheeled.car`, parameters: length, width, height, wheelRadius.

- `vehicles/car-hatchback-red`: Red hatchback
- `vehicles/car-hatchback-white`: White hatchback
- `vehicles/car-hatchback-sky-blue`: Sky blue hatchback
- `vehicles/car-hatchback-yellow`: Yellow hatchback
- `vehicles/car-sedan-silver`: Silver sedan
- `vehicles/car-sedan-black`: Black sedan
- `vehicles/car-sedan-blue`: Blue sedan
- `vehicles/car-sedan-burgundy`: Burgundy sedan
- `vehicles/car-estate-grey`: Grey estate
- `vehicles/car-estate-green`: Green estate
- `vehicles/car-estate-white`: White estate
- `vehicles/car-suv-black`: Black SUV
- `vehicles/car-suv-white`: White SUV
- `vehicles/car-suv-sand`: Sand SUV
- `vehicles/car-suv-blue`: Blue SUV
- `vehicles/car-pickup-red`: Red pickup
- `vehicles/car-pickup-silver`: Silver pickup
- `vehicles/car-pickup-olive`: Olive pickup
- `vehicles/car-coupe-orange`: Orange coupe
- `vehicles/car-coupe-silver`: Silver coupe
- `vehicles/car-coupe-black`: Black coupe
- `vehicles/car-mpv-white`: White MPV
- `vehicles/car-mpv-grey`: Grey MPV
- `vehicles/car-mpv-blue`: Blue MPV
- `vehicles/car-sports-car-red`: Red sports car
- `vehicles/car-sports-car-yellow`: Yellow sports car
- `vehicles/car-sports-car-white`: White sports car
- `vehicles/car-vintage-cream`: Cream vintage
- `vehicles/car-vintage-teal`: Teal vintage
- `vehicles/car-vintage-burgundy`: Burgundy vintage

### truck

14 assets, archetype `vehicle.wheeled.truck`, parameters: length, width, cargoHeight, wheelRadius.

- `vehicles/truck-box-2-axle-white`: White 2-axle box truck
- `vehicles/truck-box-2-axle-red`: Red 2-axle box truck
- `vehicles/truck-box-3-axle-blue`: Blue 3-axle box truck
- `vehicles/truck-box-3-axle-bonneted-black`: Black 3-axle box truck
- `vehicles/truck-flatbed-2-axle-yellow`: Yellow 2-axle flatbed truck
- `vehicles/truck-flatbed-3-axle-green`: Green 3-axle flatbed truck
- `vehicles/truck-flatbed-3-axle-bonneted-red`: Red 3-axle flatbed truck
- `vehicles/truck-tipper-2-axle-orange`: Orange 2-axle tipper truck
- `vehicles/truck-tipper-3-axle-white`: White 3-axle tipper truck
- `vehicles/truck-tipper-4-axle-yellow`: Yellow 4-axle tipper truck
- `vehicles/truck-tipper-3-axle-bonneted-blue`: Blue 3-axle tipper truck
- `vehicles/truck-tanker-2-axle-white`: White 2-axle tanker truck
- `vehicles/truck-tanker-3-axle-red`: Red 3-axle tanker truck
- `vehicles/truck-tanker-3-axle-bonneted-silver`: Silver 3-axle tanker truck

### bus

8 assets, archetype `vehicle.wheeled.bus`, parameters: length, width, height, wheelRadius.

- `vehicles/bus-city-white-and-blue-3-door`: White and blue city bus
- `vehicles/bus-city-yellow-2-door`: Yellow city bus
- `vehicles/bus-coach-white-and-red-2-door`: White and red coach
- `vehicles/bus-coach-navy-1-door`: Navy coach
- `vehicles/bus-school-yellow-1-door`: Yellow school bus
- `vehicles/bus-school-orange-yellow-1-door-short`: Orange-yellow school bus
- `vehicles/bus-midibus-green`: Green midibus
- `vehicles/bus-double-decker-red`: Red double-decker bus

### bicycle

12 assets, archetype `vehicle.wheeled.bicycle`, parameters: wheelRadius, frameSize, wheelbase, saddleHeight.

- `vehicles/bicycle-omafiets-black`: Black Dutch omafiets
- `vehicles/bicycle-omafiets-dark-green`: Dark green Dutch omafiets
- `vehicles/bicycle-omafiets-cream`: Cream Dutch omafiets
- `vehicles/bicycle-road-red`: Red road bike
- `vehicles/bicycle-road-white`: White road bike
- `vehicles/bicycle-road-blue`: Blue road bike
- `vehicles/bicycle-mtb-orange`: Orange mountain bike
- `vehicles/bicycle-mtb-matte-black`: Matte black mountain bike
- `vehicles/bicycle-mtb-lime-green`: Lime green mountain bike
- `vehicles/bicycle-city-grey`: Grey city bike
- `vehicles/bicycle-city-navy`: Navy city bike
- `vehicles/bicycle-city-burgundy`: Burgundy city bike

### motorcycle

12 assets, archetype `vehicle.wheeled.motorcycle`, parameters: wheelbase, wheelRadius, seatHeight.

- `vehicles/motorcycle-cruiser-black`: Black cruiser
- `vehicles/motorcycle-cruiser-burgundy`: Burgundy cruiser
- `vehicles/motorcycle-cruiser-cream`: Cream cruiser
- `vehicles/motorcycle-sport-bike-red`: Red sport bike
- `vehicles/motorcycle-sport-bike-blue`: Blue sport bike
- `vehicles/motorcycle-sport-bike-lime-green`: Lime green sport bike
- `vehicles/motorcycle-scooter-mint`: Mint scooter
- `vehicles/motorcycle-scooter-white`: White scooter
- `vehicles/motorcycle-scooter-yellow`: Yellow scooter
- `vehicles/motorcycle-dirt-bike-orange`: Orange dirt bike
- `vehicles/motorcycle-dirt-bike-white`: White dirt bike
- `vehicles/motorcycle-dirt-bike-green`: Green dirt bike

### boat

10 assets, archetype `vessel.boat`, parameters: length, beam, freeboard.

- `vehicles/boat-runabout-white-and-red`: White and red bowrider runabout
- `vehicles/boat-runabout-navy`: Navy bowrider runabout
- `vehicles/boat-cruiser-white`: White sports cruiser
- `vehicles/boat-cruiser-silver`: Silver sports cruiser
- `vehicles/boat-fishing-blue`: Blue fishing boat
- `vehicles/boat-fishing-green`: Green fishing boat
- `vehicles/boat-center-console-sand`: Sand centre-console boat
- `vehicles/boat-center-console-grey`: Grey centre-console boat
- `vehicles/boat-dinghy-aluminium`: Aluminium aluminium dinghy
- `vehicles/boat-rib-grey-and-orange`: Grey and orange rigid inflatable boat

### rowing-boat

6 assets, archetype `vessel.boat.rowing-boat`, parameters: length, beam, freeboard.

- `vehicles/rowing-boat-skiff-varnished-wood`: Varnished wood skiff
- `vehicles/rowing-boat-skiff-white-and-green`: White and green skiff
- `vehicles/rowing-boat-pram-varnished-wood`: Varnished wood pram dinghy
- `vehicles/rowing-boat-pram-white-and-green`: White and green pram dinghy
- `vehicles/rowing-boat-sloep-varnished-wood`: Varnished wood double-ended sloep
- `vehicles/rowing-boat-sloep-white-and-green`: White and green double-ended sloep

### drone

8 assets, archetype `aircraft.rotorcraft.drone`, parameters: span, propRadius, legHeight.

- `vehicles/drone-camera-quad-light-grey`: Light grey camera quadcopter
- `vehicles/drone-camera-quad-white`: White camera quadcopter
- `vehicles/drone-fpv-racer-red`: Red FPV racing quad
- `vehicles/drone-fpv-racer-lime`: Lime FPV racing quad
- `vehicles/drone-hexacopter-black`: Black hexacopter
- `vehicles/drone-hexacopter-red`: Red hexacopter
- `vehicles/drone-octocopter-carbon`: Carbon heavy-lift octocopter
- `vehicles/drone-octocopter-white`: White heavy-lift octocopter

## props

### terminal

14 assets, archetype `prop.terminal`, parameters: width, height, depth.

- `props/terminal-anthracite-sci-fi-console`: Anthracite sci-fi console
- `props/terminal-white-sci-fi-console`: White sci-fi console
- `props/terminal-red-ticket-machine`: Red ticket machine
- `props/terminal-steel-ticket-machine`: Steel ticket machine
- `props/terminal-steel-atm`: Steel ATM
- `props/terminal-navy-atm`: Navy ATM
- `props/terminal-black-arcade-cabinet`: Black arcade cabinet
- `props/terminal-purple-arcade-cabinet`: Purple arcade cabinet
- `props/terminal-white-information-kiosk`: White information kiosk
- `props/terminal-black-information-kiosk`: Black information kiosk
- `props/terminal-gunmetal-holo-pedestal`: Gunmetal holo pedestal
- `props/terminal-white-holo-pedestal`: White holo pedestal
- `props/terminal-grey-control-podium`: Grey control podium
- `props/terminal-yellow-control-podium`: Yellow control podium

### statue

10 assets, archetype `prop.statue`, parameters: plinthHeight, plinthWidth, figureHeight.

- `props/statue-marble-bust-on-column`: Marble bust on column
- `props/statue-bronze-bust-on-column`: Bronze bust on column
- `props/statue-bronze-standing-figure`: Bronze standing figure
- `props/statue-limestone-standing-figure`: Limestone standing figure
- `props/statue-granite-obelisk`: Granite obelisk
- `props/statue-sandstone-obelisk`: Sandstone obelisk
- `props/statue-steel-abstract-knot`: Steel abstract knot
- `props/statue-copper-abstract-knot`: Copper abstract knot
- `props/statue-corten-hoop-sculpture`: Corten hoop sculpture
- `props/statue-chrome-hoop-sculpture`: Chrome hoop sculpture

### fountain

10 assets, archetype `prop.fountain`, parameters: radius, height, tiers.

- `props/fountain-limestone-tiered-fountain`: Limestone tiered fountain
- `props/fountain-marble-tiered-fountain`: Marble tiered fountain
- `props/fountain-victorian-drinking-fountain`: Victorian drinking fountain
- `props/fountain-modern-drinking-fountain`: Modern drinking fountain
- `props/fountain-granite-octagonal-fountain`: Granite octagonal fountain
- `props/fountain-brick-octagonal-fountain`: Brick octagonal fountain
- `props/fountain-sandstone-pump-trough`: Sandstone pump trough
- `props/fountain-granite-pump-trough`: Granite pump trough
- `props/fountain-granite-plaza-fountain`: Granite plaza fountain
- `props/fountain-concrete-plaza-fountain`: Concrete plaza fountain

### campfire

10 assets, archetype `prop.campfire`, parameters: logs, logLength, stones.

- `props/campfire-burning-brown-teepee-campfire`: Burning teepee campfire
- `props/campfire-burnt-out-birch-teepee-campfire`: Burnt-out teepee campfire
- `props/campfire-burning-grey-log-cabin-fire`: Burning log cabin fire
- `props/campfire-burnt-out-brown-log-cabin-fire`: Burnt-out log cabin fire
- `props/campfire-burning-brown-fire-basket`: Burning fire basket
- `props/campfire-burnt-out-birch-fire-basket`: Burnt-out fire basket
- `props/campfire-burning-dark-star-fire-with-tripod`: Burning star fire with tripod
- `props/campfire-burnt-out-grey-star-fire-with-tripod`: Burnt-out star fire with tripod
- `props/campfire-burning-red-lean-to-fire`: Burning lean-to fire
- `props/campfire-burnt-out-brown-lean-to-fire`: Burnt-out lean-to fire

### well

8 assets, archetype `prop.well`, parameters: radius, wallHeight, roofHeight.

- `props/well-granite-roofed-well`: Granite roofed well
- `props/well-sandstone-roofed-well`: Sandstone roofed well
- `props/well-weathered-wishing-well`: Weathered wishing well
- `props/well-whitewash-wishing-well`: Whitewash wishing well
- `props/well-brick-pump-well`: Brick pump well
- `props/well-limestone-pump-well`: Limestone pump well
- `props/well-fieldstone-well-house`: Fieldstone well house
- `props/well-concrete-well-house`: Concrete well house

### ladder

8 assets, archetype `prop.ladder`, parameters: height, width, spacing.

- `props/ladder-pine-single`: Pine single ladder
- `props/ladder-weathered-single`: Weathered single ladder
- `props/ladder-aluminium-extension`: Aluminium extension ladder
- `props/ladder-fibreglass-extension`: Fibreglass extension ladder
- `props/ladder-aluminium-step`: Aluminium step ladder
- `props/ladder-wooden-step`: Wooden step ladder
- `props/ladder-galvanised-fixed`: Galvanised fixed cage ladder
- `props/ladder-yellow-fixed`: Yellow fixed cage ladder
