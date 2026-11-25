# Rebuilding two Rocketbox avatars as editable adults

Two dressed avatars from the Microsoft Rocketbox Avatar Library served as outside goals for the adult human. Each was rebuilt as an ordinary saved form: the workshop's own body, face controls, hair and clothing, with nothing taken from the avatar. This page records what was matched, what was not, the numbers, and the one tool the attempt added.

The avatars, the recipes fitted to them and every picture that shows an avatar stay on the machine that made them. [Local reference material](local-references.md) explains that rule. This page gives sources, method and measurements in text.

## Sources and licence

| Target | Files used, at one pinned commit |
| --- | --- |
| Female_Adult_04 | [Female_Adult_04.fbx](https://github.com/microsoft/Microsoft-Rocketbox/blob/0943055db6ec570bcef9f2c8b41c9e5467c808f9/Assets/Avatars/Adults/Female_Adult_04/Export/Female_Adult_04.fbx) and the three colour textures in [its Textures folder](https://github.com/microsoft/Microsoft-Rocketbox/tree/0943055db6ec570bcef9f2c8b41c9e5467c808f9/Assets/Avatars/Adults/Female_Adult_04/Textures) |
| Gardener_Male_01 | [Gardener_Male_01.fbx](https://github.com/microsoft/Microsoft-Rocketbox/blob/0943055db6ec570bcef9f2c8b41c9e5467c808f9/Assets/Avatars/Professions/Gardener_Male_01/Export/Gardener_Male_01.fbx) and the three colour textures in [its Textures folder](https://github.com/microsoft/Microsoft-Rocketbox/tree/0943055db6ec570bcef9f2c8b41c9e5467c808f9/Assets/Avatars/Professions/Gardener_Male_01/Textures) |

- Library: [Microsoft Rocketbox Avatar Library](https://github.com/microsoft/Microsoft-Rocketbox), commit `0943055db6ec570bcef9f2c8b41c9e5467c808f9` of 2 October 2022, the head of `master` when the study was made.
- Licence: MIT, Copyright (c) 2020 Microsoft. [LICENSE.md at that commit](https://github.com/microsoft/Microsoft-Rocketbox/blob/0943055db6ec570bcef9f2c8b41c9e5467c808f9/LICENSE.md) has git blob id `9bcfb3ece5301a55d3a41bbd00a029ab27d61d13`. The fetch script checks the licence and all eight asset files against their git blob ids, and keeps a copy of the licence beside the files.
- The library asks users to cite Gonzalez-Franco et al., "The Rocketbox Library and the Utility of Freely Available Rigged Avatars", Frontiers in Virtual Reality, 2020.
- Changes made locally for the comparison: skeleton and skin weights removed in the bind pose, units converted to metres with Y up, colour textures only, resized and stored as WebP. The converted file carries the copyright line.

Why these two: both are whole people in practical dress, and they differ in build, age, hair and every garment. One is a slim young woman in a short hooded leather jacket over a long dark top, cargo trousers and tall heeled boots, hair in a high bun. The other is an older man with a short beard in a collared work jacket over a light shirt, work trousers tucked into rubber boots, and work gloves.

## What counts as a reproduction

The result is a form the editor opens, changes and exports like any other. It uses the adult body and its Adult anatomy measurements, the face measurements, a hairstyle, skin and eye colour, facial detail, and clothing built by the workshop on that body. The avatar itself is only ever shown beside it for comparison.

Each target has two stages, so the tool's effect can be told apart from the rest:

- **presets**: the fitted body with the nearest ready-made clothing choice and one cloth tint. This is what the editor offered before the study.
- **final**: the same body with an outfit tailored piece by piece (see below).

## Method

1. `node scripts/rocketbox-study/fetch.mjs` downloads the eight files and the licence from the pinned commit, checks each git blob id and writes a manifest. `scripts/rocketbox-study/convert-fbx.py` (Blender) writes one static GLB per avatar.
2. Targets were measured with the reference dialog's own pose reader (`scripts/rocketbox-study/measure-targets.mjs`): both stand with arms 49° below horizontal; feet are 0.27 m and 0.28 m apart.
3. Frame, age, stature, hair, colours and face measurements were set by eye from front, three-quarter and side views.
4. The other body and pose measurements came from `scripts/rocketbox-study/outline-fit.mjs`. Starting from neutral, it changes one Adult anatomy measurement at a time and keeps the change when the dressed outline overlaps the target's more, averaged over four views, with a small cost on extreme values. It only ever sets measurements the editor shows.
5. Outfits were composed in the tailored outfit panel's terms: pieces, order, colours, lengths, room and details.
6. Both figures stand on their soles. The adult is placed front to back where its outlines best cover the target's, because the two libraries put the origin in different places (0.07 m apart for the woman, 0.01 m for the man). No other alignment or scaling is applied.

All comparison views use one orthographic camera for both figures, with a ruler marked every 10 cm, so the two share a metric scale.

## Results

Outline overlap is the area both outlines cover divided by the area either covers, per view. It measures silhouette only. Colour, closures and faces are judged from the pictures.

The official readings come from the comparison page itself, read by `scripts/rocketbox-study/capture.py`. Three.js draws both figures on the graphics card, and the ruler is left out of the measured outlines. The renderer here was `ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Ti, Direct3D11)`, the platform's default, with no software fallback.

| | Front and back | Three-quarter | Side | Mean of 8 views | Top of figure, target / adult |
| --- | --- | --- | --- | --- | --- |
| Woman, final | 0.884 | 0.862 | 0.810 | 0.855 | 1.745 m / 1.727 m |
| Woman, presets | 0.836 | 0.793 | 0.682 | 0.776 | 1.745 m / 1.727 m |
| Gardener, final | 0.851 | 0.865 | 0.817 | 0.849 | 1.807 m / 1.797 m |
| Gardener, presets | 0.849 | 0.863 | 0.850 | 0.856 | 1.807 m / 1.797 m |

`scripts/rocketbox-study/compare.mjs` measures the same outlines without a built page. It draws flat masks on the graphics card and counts hair cards as solid, where the page cuts them by their texture. Its means were 0.846 (woman, final), 0.769 (woman, presets), 0.849 (gardener, final) and 0.855 (gardener, presets).

Before the body fit and the tailored outfits, with the first ready-made outfits and only frame, weight and stature set, an early reading on the CPU rasterizer gave about 0.44 to 0.56 for the woman and 0.56 to 0.81 for the gardener. Those figures are a frozen working reading, not a graphics-card measurement.

### What matches

- **Whole-person silhouette and stance.** Stature, shoulder and hip width, arm angle and foot spacing agree to within the overlap above. Arms and legs line up in every view.
- **Woman's outfit.** A short brown leather jacket ending at the waist on a gathered band, zip front, open V neck, long sleeves with cuffs; a longer black top showing below it; olive trousers with cargo and back pockets; trouser legs inside tall dark boots.
- **Gardener's outfit.** A brown hip-length jacket with a fold-down collar, covered front and two chest pockets over a light collared shirt; brown trousers gathered into yellow boots with a top band; green gloves.
- **Head structure.** Hair mass and hairline are right in kind for both: swept back into a bun, and short swept-back hair. Skin tone, eye colour and facial detail are set from the editor's lists.

### What does not match

- **Faces are not likenesses.** Face measurements were set by eye in a few steps. Neither face would be mistaken for the original.
- **No beard.** The adult has no facial hair, so the gardener's grey stubble beard is missing. This changes how old he reads more than any measurement does.
- **Heels.** The woman's boots have high heels and a pitched foot. The adult's foot stays flat; the heel is a block under it. Her side view shows this most.
- **Hood.** The jacket's hood is a plain pouch lying on the upper back. The original's is draped, with folds and a pointed end, and its edge runs down into the lapels.
- **Surface detail.** Clothing is plain cloth or leather in one colour per piece. The originals carry painted seams, wrinkles, wear, a zip with teeth, press studs and pocket stitching.
- **Jewellery.** Hoop earrings and a necklace on the woman have no counterpart.
- **Build under the cloth.** The woman's thighs and seat are fuller than the original's straight trouser legs. The gardener's jacket follows a rounder belly and seat, where the original hangs straight and boxy from the shoulders. Her side view and his are the weakest outlines for these reasons.
- **Fit of loose cloth.** The gardener's trousers bag over his boot tops; the adult's are gathered more closely. On his body the workshop's trousers also form a boxed seat with a fault under it, which lifts the back of the jacket hem. The ready-made work outfit shows the same fault on that body, so it lies in the shared trouser cut, not in the tailored pieces.
- **Hair.** The woman's hair is streaked with darker roots and loose strands; the adult's is one colour with a smooth cap. The gardener's hair is greyer at the temples than one hair colour can show.
- **Outline measure and outfit.** For the gardener the presets stage scores a little higher than the final one (0.856 against 0.849), because a ready-made work jacket has nearly the same outline and no boots or gloves to disagree with. The difference is in colour and parts: the preset has one cloth tint for every piece, laced shoes, no gloves and no boots.

### Not attempted, and why

- Fitting the face to the avatar's head with the reference dialog. Another study owns head fitting, and a fitted face would not have tested the measurements a person uses.
- Painted textures or decals for seams and wear.
- Posing. Both figures stay in the pose the avatars are stored in.

## The tool this study added: outfits tailored piece by piece

The ready-made clothing choices each draw a complete outfit in one cloth tint. Neither target could be approached that way: a leather jacket over a black top over olive trousers inside dark boots needs four colours, two layered tops and a choice of what goes over what.

`character-view/human-tailor.js` builds an outfit from a short list of pieces saved in the form at `humanStyle.tailor`:

```json
{ "layers": [
  { "piece": "trousers", "color": "#3c4656", "length": 2.03, "ease": 9 },
  { "piece": "top", "color": "#6f7f86", "sleeve": 1.42, "collar": "shirt", "front": "buttons" },
  { "piece": "boots", "height": 1.5 }
] }
```

- Pieces: top or jacket, trousers or shorts, boots, shoes, gloves, belt. Each has its own colour and material and a handful of measurements: sleeve and hem length, room over the body, how much the cloth holds its shape, neckline, collar (none, shirt, stand, hood), front (plain, placket, zip, buttons), cuffs, bands, pockets, boot height, sole and heel.
- Order is dressing order. A later piece lies over earlier ones and is kept clear of them. Boots listed after trousers take the legs inside the shaft; trousers listed after boots fall over it. A second top hangs over the first.
- Every piece is cut from the wearer's own surface with the same cloth routines as the ready-made outfits, so one recipe fits any build, follows the same joints and goes through the same export.
- Cloth that lies well inside another piece is not built, and the skin under any piece is left out of the body, as it is under the library clothing. Three centimetres inside every opening stay. A game export reduces each surface on its own, and a hidden surface left in place came through the cloth over it.
- Missing fields take their starting values, and every value is checked against its range when a form is opened.

In the editor it is **Appearance → Tailored outfit** on an adult (`character-view/human-tailor-editor.js`). **Tailor this outfit piece by piece** lays out a shirt, trousers, belt and shoes to change. Each piece opens to its fields and can be worn earlier, worn later or removed. Tailored pieces replace the chosen clothing in ordinary clothes. Choosing a ready-made outfit, or **Try a new outfit and hairstyle**, puts the pieces away and shows the new choice; Undo brings them back. Body, hair and colour changes keep them, and so do the base shape and suit views, which only hide them.

`character-view/human-tailor.test.js` checks validation, sound skinned meshes on a slim and a heavy body, layer order, boot tucking, what is left out under other pieces, and the rules above.

### Through the editor and export

Both forms were opened in the editor from their saved files, exported at every detail choice and played back in the GLB player, all on the graphics card with no page errors.

| | Full export | Game export |
| --- | --- | --- |
| Woman | 137,653 triangles, 11 materials, 11.8 MB | 24,057 triangles, one material, 2.5 MB |
| Gardener | 126,640 triangles, 11 materials, 11.6 MB | 24,022 triangles, one material, 2.3 MB |

Each export carries one skeleton of 69 joints and four clips. In the tailored outfit panel a field change applied, choosing a ready-made outfit left no tailored pieces showing, and Undo brought all four (woman) and five (gardener) pieces back unchanged.

The first game exports showed skin through the trousers on both figures and the gardener's shirt through his jacket shoulders, though the full exports were clean. Leaving out covered skin and cloth, as described above, removed this: front, back and idle-clip frames of the game exports now show no layer coming through. Only the idle clip was looked at; walking and reaching poses were not checked.

## Opening the studies

Everything below needs the local folder `.reference-cache/rocketbox/`. Scripts stop with one line naming what is missing when it is absent.

- **Side-by-side orbit.** `node scripts/rocketbox-study/build.mjs --forms` writes `dist/rocketbox-study.html` and the two saved forms. Open the page in a browser: original on the left, editable adult on the right, one camera, with colour, clay and silhouette views, whole, torso, head and legs framings, and both stages.
- **In the editor.** Forms → Open form, then choose `rocketbox-female-adult-04.form.json` or `rocketbox-gardener-male-01.form.json` from `.reference-cache/rocketbox/forms/`. The tailored pieces are under Appearance → Tailored outfit. Export GLB works at every detail choice.
- **The original in the editor.** Forms → Fit a 3D reference… → Choose a GLB file…, then pick a file from `.reference-cache/rocketbox/targets/`.
- **Pictures and official numbers.** `python scripts/rocketbox-study/capture.py [--stage presets]` writes the matched orbit, head, outfit and outline sheets and `readings.json` from the page to `.reference-cache/rocketbox/media/`. It prints the renderer it found and names a software fallback as one.
- **Outline tool.** `node scripts/rocketbox-study/compare.mjs [--stage presets]` writes outline readings, outline-difference sheets and the front-to-back placement the page uses to `.reference-cache/rocketbox/outline-metrics/`. With `--look torso` it has the page draw a close working sheet instead. The tool records the renderer and falls back to software when hardware is unavailable.
- **Editor and export pass.** `python scripts/rocketbox-study/editor-pass.py --editor <built editor page>` opens both forms in the editor, exports each at every detail choice, exercises the tailored outfit panel and plays the full and game exports in `dist/play-model.html`. It writes `.reference-cache/rocketbox/exports/`.
- **Close looks at the cloth.** `node scripts/rocketbox-study/tailor-check.mjs <study> <out.png> [--frame torso] [--views 0,60,150,180]` draws the adult alone. `node scripts/rocketbox-study/conceal-check.mjs` checks by ray casting that leaving out covered skin and cloth opens no hole.

`outline-fit.mjs` and both outline tools draw on the graphics card when the machine has one and fall back to a CPU rasterizer that names itself. Pose reading and the hole check are geometry only and run on the CPU.

The recipes themselves are in `.reference-cache/rocketbox/studies.js`. They were fitted to the avatars, so they stay local with them; the fetch and conversion steps do not recreate that file.
