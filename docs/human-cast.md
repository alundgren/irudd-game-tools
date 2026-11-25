# Editable Rocketbox characters

The adult wardrobe's **Character artwork** selector keeps an authored face, hair and clothes together. Eight characters are available. An ordinary adult draw can use the cast in everyday, outdoor and work looks. Seed, frame and age determine the choice. Fantasy armour and the original four costume studies use their individual styling controls.

The gardener can wear three different tops with any of three bottoms. The cropped-jacket and pink-shirt characters can exchange their outfits. The wardrobe shows fitted choices for the selected character.

Skin tone, eye colour, body measurements, posture, three facial expressions and four gaze directions apply to the cast. The gardener, cropped-jacket character and tunic wearer also have two controls for blending the shape and photographed colour of a second Rocketbox face. The artist's UVs keep features registered through the expressions. Select **None** under Character artwork to restore the native wardrobe choices saved on the form. Anatomy view shows the underlying editable body. Partial body transfers use the native regions.

The shipped meshes use the normal character skeleton. A weighted displacement field lets neighbouring eyelid, eye, teeth and clothing vertices follow the same body edit. Fine jaw, cheek and nose edits are correspondingly subtle. The long tunic's front and back ride the native skirt joints. The hem is fairly stiff in a crouch.

The cast uses the original Rocketbox normal maps for surface relief. Its original specular-intensity maps control roughness on skin, fabric and trim. Borrowing a top or trousers also brings that garment?s relief and roughness. To rebuild these maps, run `python scripts/pack-human-cast-surface.py PATH_TO_ROCKETBOX` against the source revision linked below.

## Source artwork

The original rigged avatars are Gardener_Male_01 in Professions and Female_Adult_01, Female_Adult_04, Female_Adult_08, Female_Adult_13, Male_Adult_01, Male_Adult_08 and Male_Adult_15 in Adults. The source geometry, images and authored facial poses are adapted from the Microsoft Rocketbox Avatar Library, Copyright (c) 2020 Microsoft, under the MIT License. Each exported character records its source avatar and any blended donor in `asset.extras.rocketbox.avatars`, alongside the license text. [Library and license](https://github.com/microsoft/Microsoft-Rocketbox/tree/0943055db6ec570bcef9f2c8b41c9e5467c808f9)

## Skin

Each character's picture carries a mask of its photographed skin and that source's own face colour. The skin tone control recolours the masked skin only: face, neck, hands, arms, legs and feet, with lips and the rims of the eyelids following for the most part. Hair, brows, lashes, eyes, teeth, the mouth and all cloth stay as photographed. A form whose skin colour equals the character's own colour (`castSkin(label)` in `human-cast-wardrobe.js`) shows the picture untouched.

When an outfit comes from another character, its bare skin is first brought to the wearer's colour, so the gardener in the polo has his own arms and legs, and the skin tone control then moves face and limbs together. `drawCastSkin(label, skin, seed)` gives a drawn character a colour from the seed: most keep the photographed skin, the rest take the form's drawn colour held within the range where the photographed ears and brows still belong to the face.

The upper eyelids are repainted when a character is drawn (`human-cast-lids.js`). In the photographed pictures the skin of an upper lid is a strip about six texels tall, painted as the dark red-brown shade under the brow, and a blink stretched it over the whole eye. The strip is found from the mesh as the texels under the triangles the Blink pose moves, filled with the skin measured beside that eye a little in shade, and joined to the photographed dark at the lid's edge where the lashes sit. It is marked as skin, so the skin tone control carries it with the face. An open eye shows about a third of the same strip, so the thin dark line above an open eye is lighter than in the photograph; the lash cards still draw the edge.

The masks are found from the pictures by colour (`.reference-cache/cast-skin16/pack-skin.py`, run after the cast and wardrobe data are packed). Limits: the hollows of the ears and beard stubble keep their photographed colour; a very dark source cannot be made as pale as the palest choice, because the renderer holds each channel's gain to six; very dark choices read darker in the scene than the swatch, as the picture's own shading stays in it.
