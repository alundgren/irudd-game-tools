# Community costumes for the adult human

Two outfits are worn from garments that MakeHuman community authors released under CC0. They are ordinary library outfits: fitted to the body through the garment's own anchors on the hm08 skin, skinned to the same joints, dyed by the tones of the style, listed in the editor's Clothing control and drawn by the game exporter into the single atlas material.

| Outfit | Garments | Author | Licence | Page |
| --- | --- | --- | --- | --- |
| Mail tunic and boots | Viking tunic | RehmanPolanski | CC0 | <http://www.makehumancommunity.org/node/2617> |
| | Viking trousers | RehmanPolanski | CC0 | <http://www.makehumancommunity.org/node/2618> |
| | Viking boots | RehmanPolanski | CC0 | <http://www.makehumancommunity.org/node/2619> |
| Rope-belted robe | Monk's robe | Donitz | CC0 | <http://www.makehumancommunity.org/node/3238> |

The robe is worn over the low leather shoes of the system library. All four community garments come from the official `suits02` CC0 asset pack (`asset_packs/suits02/suits02_cc0.zip` on files.makehumancommunity.org). Each garment's `.mhclo` names its author and CC0, and so does the pack's own index; the packer refuses a garment that does not. The [CC0 text](licenses/makehuman-cc0.md) applies. The pack also holds costumes of named comic, film and anime characters; none of those is used.

## Packing

```
python scripts/pack-human-attire.py PACK_FOLDER [PACK_FOLDER ...] character-view/human-attire-data.json
```

Each `PACK_FOLDER` holds unpacked archives (suits02, dress01, skirts01, shirts01) with their `packs/*.json` index, kept outside the repository. The packer needs Python with NumPy, SciPy and Pillow, and Node for its finishing step. The same sources give the same file byte for byte. Beyond the authored mesh, fit and paint it adds:

- colour carried past every UV seam, so a smaller map does not bleed the page into the cloth;
- a dye chart: each texel names the tone that dyes it (cloth, second cloth, leather, sole) or none, so mail, rope and stitching keep their paint;
- relief from the painted surface where the author supplied no normal map, and a map of occlusion, roughness and metal so mail reads as steel;
- a fit to the skin for the few boot points their author tied to joint markers this body does not carry;
- the skin each garment covers, left out of the body so it cannot show through a reduced game mesh. Hands and head always stay.

## Looks

`completeLook` draws a costume in about three of ten Adventure looks and six of a hundred undirected ones, from a random stream of its own, so every other look of a seed is unchanged. Other directions never draw one. The palette of the look dyes the cloth; hide and soles stay brown.

## Measured

Eight adults whose Adventure look drew a costume (seeds 31003 to 31026; slight to heavy frames, ages from young to old) were opened in the built editor, exported with its game setting and replayed in the player on hardware Direct3D 11: 23,999 to 24,001 triangles, one material and three images each, with Idle, Walk, Crouch and Reach clips and no page errors. `character-view/human-attire.test.js` covers credits, fit and skinning on a slight and a broad adult, covered skin, dye charts and the share of looks.

Known limits: the robe's skirt follows each leg, so a long stride parts it like split cloth rather than swinging as one bell; a very pale dye shows the dark worn edges painted into the tunic's hem.

## Everyday ensembles

Two outfits for ordinary looks are packed the same way, from the official `dress01`, `skirts01` and `shirts01` CC0 packs. All three garments are by MargaretToigo, and each names CC0 in its own `.mhclo` and in its pack index.

| Outfit | Garments | Dye |
| --- | --- | --- |
| Shift dress | `toigo_shift_dress`, low shoes | cloth; the neck and armhole bindings take the second cloth |
| Rib knit and full skirt | `toigo_fisherman_sweater`, `toigo_long_full_skirt`, low shoes | knit takes the cloth; the skirt print takes the second cloth for its ground and the pale cloth for its flowers |

The dress and the skirt are bound to the skirt helper of the hm08 body, which this body carries, so they hang and swing as one piece over both legs. The sweater's hem is drawn in close to the body where the skirt's waist lies over it (`under` in the packer). They are listed as `everydayClothes` in `character-view/human-attire.js`, apart from the costumes. `completeLook` draws one in about one of ten Any, Everyday, Smart and Festive looks, from a random stream of its own, and never in the Workwear, Adventure or Outdoors directions.

The packer reads the licence from the `.mhclo` header and refuses a garment whose header names GPL or CC-BY, whatever the pack index says. Several hats of the `hats01` and `hats02` packs are of that kind, so none of them is used.

## Hats

`character-view/human-hats.js` builds three hats of its own geometry on the measured head: a bucket hat with a soft brim, a beret and a flat cap. Each is fitted from the head frame of the hair module with the ears left out, so it sits on small and large heads alike. Hair under the crown is pressed beneath it on a copy of its geometry, and hair below the band keeps its length. A hat is a style choice with its own colour (`hat`, `hatColor`), kept through other choices, saved with the form and exported rigid on the head.

A new look wears a hat about one time in nine: a flat cap with work and country clothes, a beret with dresses and smart clothes, a bucket hat with casual and outdoor ones. Armour, hooded clothes, the pressure suit and hair piled on the head never take one.

Known limits: the skirt's print loses its flowers at game texture size and reads as a mottled cloth; on a broad frame the shift dress reads as a plain tank dress; white socks of a look show above the low shoes under both outfits.

## Painted folding fan

Choose **Painted folding fan** in the adult's Hand prop control. The pleated leaf takes the outfit's secondary cloth and lining colours, and the guards and pivot take its metal colour. The fan follows the right hand through the exported clips. Adults with a posture present it at chest height while standing. It can appear with an evening gown or a festive look. The Tidal contralto study pairs it with scallop brocade. Anatomy and Pressure suit hide the fan and release its grip.

## Ribbed watch cap

The folded wool cap fits the edited skull and takes its dye from Hat colour. Work and casual looks can draw it. The shape, knitted yarn and wear come from the cap in Einar Rig (CC-BY) Blender Foundation | studio.blender.org. The workshop refits the silhouette, repacks the UV islands and bakes the original material into a dyeable colour map and a tangent-space normal map. The game export includes the credit. [Original Einar rig](https://studio.blender.org/characters/einar/v1/) ? [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

## Flying cap and goggles

The A-11 leather flying cap, earphones, buckles and raised goggles are adapted from the CC0 Flight Helmet model. The leather takes the hat dye. Its fitted shape and ear cups follow the edited skull and tuck the hair underneath. Rebuild the mesh and its colour, normal and material maps with `python scripts/pack-human-flight.py <FlightHelmet directory> character-view/human-aviator-data.json`. [Flight Helmet credits and original model](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/FlightHelmet)

## Weathered field coat

Choose **Weathered field coat** in the adult's Outfit control for a patched canvas coat with a standing collar and a knitted neck inside it, toggle fastenings, strapped and pocketed field trousers, and laced boots. Journey and outdoor looks can draw it, always in worn, drab tones. Cloth colour dyes the canvas, Second cloth the collar, the rim and the trouser cloth, Pale cloth the knit, Accent piece the patches, and Leather and Sole the straps, pocket leather and boots. Stains, rust and fading stay under every dye; buckles, studs, the zip and the tape keep their own paint.

The coat, trousers and boots come from Einar Rig (CC-BY) Blender Foundation | studio.blender.org. The source coat has one sleeve; the workshop mirrors it onto the other arm, carries the cloth from Einar's skeleton to the edited adult, binds it to the skin, repacks the UV islands and bakes the original materials into dyeable colour, normal and surface maps. The game export includes the credit. Rebuild with `python scripts/pack-human-einar-attire.py <einar_release_v1.blend> <textures directory> <blender>`. [Original Einar rig](https://studio.blender.org/characters/einar/v1/) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

Known limits: the game export thins the collar and the toggles to coarse folds; on very broad shoulders the lapel tips stand a little proud of the collar.

## Field and street clothes

Survey vest layers a pocketed vest over a long-sleeved shirt with trousers and boots. Hoodie and denim shorts pairs a zip-front graphic hoodie with knee-length shorts and trainers. Either outfit fits any adult. The clothing controls dye distinct panels, retaining the authored fabric wear. Each sleeve follows the corresponding arm even where it crosses the waist during Reach.

Both ensembles derive from Microsoft Rocketbox, Male Adult 05 and Female Adult 12, under the MIT license. Game exports using them carry the full notice. To reproduce the packed assets, extract these two FBX files with `scripts/rocketbox-extract.py` and run `python scripts/pack-human-field-outfits.py WORK TEXTURES character-view/human-field-outfits-data.json`. The texture directory contains one subdirectory per original character, with the body colour, normal, and specular maps. [Microsoft Rocketbox source](https://github.com/microsoft/Microsoft-Rocketbox/tree/0943055db6ec570bcef9f2c8b41c9e5467c808f9)

## Scanned knitwear

Crew sweatshirt and Cable V-neck are tops taken from photogrammetry scans of real clothed people, so their folds, rib, cable knit and seams are measured cloth. Each joins the existing trousers or cargo trousers and shoes as an ordinary everyday outfit that fits any adult. The clothing controls dye the top while retaining the scanned folds and knit; the trousers and shoes take their own tones.

A top is wrapped, not cut out of the scan. The editable adult's own trunk and arm surface is posed and scaled to the scanned person, and along each surface normal the distance to the scanned cloth is measured. That distance, with the donor's build smoothed out and the folds retained, lifts the same surface on the neutral adult. The garment therefore has the body's topology, binds to the native skeleton like fitted clothing, follows every build and movement clip, and ends at the scan's own hem, cuffs and neckline. Colour and tangent-space relief are sampled from the scan's 8K photograph at the matching place; places the scan could not see, such as an arm held against the trunk, take the colour of the cloth round them. Skin hidden by the top is removed.

Both tops derive from HSRD-100 by Digital Reality Lab, scans HSR0023-Body-017 and HSR0112-Body-018, under CC BY 4.0. Game exports using them carry the credit. The fitting tools read the scans from the ignored reference cache. [Licence note](licenses/hsrd-100-cc-by-4.0.md)

Skin hidden by Hoodie and denim shorts and Survey vest ends one ring of skin inside each collar and two inside each bare-leg hem, so no gap opens between a cuff or collar and the skin beside it.
