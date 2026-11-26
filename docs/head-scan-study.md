# Head scan study

Two independent 3D scans of real heads serve as practice targets for the head of the editable adult human. The study places each scan on the editable head, searches the head's recipe axes, runs the editor's own surface correction, and measures what is left. It is a practice exercise on two heads, both of adult men with closed eyes. It says where the head generator is weak. It does not rank the generator.

All reference material stays on the machine that ran the study. The scans, the meshes derived from them, the fitted recipes and every picture that shows a scan are written to a folder git ignores. This page holds sources, method and measurements.

## Results

Everything in this section was measured on 23 November 2026. The generator changed while the study ran, so two versions were scored: a copy frozen early in the session (`2e9ffe0db6f7`) and a copy taken after the head correction gained spatial smoothing in `character-view/human-fit-head.js` (`c5e705fb08dd`). The same 29 recipe axes were found in both. A second result under a version is a new run of the whole study, with its own samples, so small differences between the two default rows are noise of the method.

Distances are two-way means in millimetres on a 1.72 m editable human. Lower is closer.

### Lee Perry-Smith

| Stage | Face, frozen | Face, updated | Head, frozen | Head, updated | Midline, frozen | Midline, updated |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Default head | 2.20 | 2.19 | 1.85 | 1.85 | 3.70 | 3.71 |
| Editor recipe fit | 1.95 | 1.95 | 1.77 | 1.79 | 3.10 | 3.21 |
| Head recipe fit | 1.53 | 1.51 | 1.47 | 1.46 | 1.60 | 1.61 |
| Recipe + correction | 0.99 | 1.29 | 1.05 | 1.23 | 1.18 | 1.41 |
| Recipe + correction, three runs | 0.98 | 1.25 | 1.04 | 1.21 | 1.10 | 1.27 |

On the updated generator the share of face samples within 1 mm rises from 27% (default) to 43% (recipe) to 50% (corrected). The 95th percentile falls from 5.1 to 3.8 to 3.1 mm. On the frozen generator the corrected face reaches 63% and 2.5 mm.

Per region, updated generator, with the mean signed offset in brackets (positive: the editable head is fuller than the scan):

| Region | Default | Head recipe fit | Recipe + correction | Frozen correction |
| --- | ---: | ---: | ---: | ---: |
| Brow and forehead | 2.08 (-1.43) | 1.35 (-0.45) | 0.97 (-0.42) | 0.79 |
| Eyes | 2.18 (+1.60) | 1.48 (+0.06) | 1.52 (+0.18) | 1.47 |
| Nose | 2.09 (-0.17) | 1.04 (+0.05) | 1.34 (+0.72) | 0.93 |
| Mouth | 1.53 (+0.29) | 1.04 (-0.18) | 0.99 (+0.06) | 1.43 |
| Cheeks | 2.21 (+1.26) | 1.49 (+0.64) | 1.28 (+0.53) | 0.82 |
| Chin and jaw | 2.55 (-1.64) | 2.04 (-0.01) | 1.77 (-0.49) | 1.20 |
| Ears | 1.97 (+0.90) | 1.78 (+0.62) | 1.60 (+0.36) | 1.52 |
| Cranium | 1.42 (-0.44) | 1.33 (-0.78) | 1.08 (-1.00) | 1.02 |
| Neck | 3.96 (-3.61) | 2.72 (-0.34) | 1.97 (+0.43) | 1.94 |

The mouth differs between the two versions already on the default head (2.05 mm frozen, 1.53 mm updated). The cause was not looked for, so the mouth row says nothing about the smoothing.

The midline after the recipe fit is within 1.1 mm on the forehead, 0.8 mm on the nose and 1.2 mm on the lips. The chin stays 3.1 mm off, and 2.8 mm after correction.

The fitted recipe moves 28 axes. `cheeks` and `lipFullness` end at their limit and `brow`, `faceB` and `neck` beyond 0.7. The fit settles on the female side of `frame` (-0.42) for a male head, and does the same for the cast (-0.60).

### Lincoln life mask

The cast is 12.5% larger than the default head (placement scale 0.889). On a body with the default proportions that head belongs to a stature of 1.93 m, which is Lincoln's recorded height. Distances on the cast itself are the values below divided by 0.889.

| Stage | Face, frozen | Face, updated | Head, frozen | Head, updated |
| --- | ---: | ---: | ---: | ---: |
| Default head | 3.91 | 4.06 | 3.78 | 3.91 |
| Editor recipe fit | 3.78 | 4.07 | 3.74 | 3.90 |
| Head recipe fit | 3.35 | 3.38 | 3.27 | 3.31 |
| Recipe + correction | 2.78 | 3.26 | 2.75 | 3.19 |
| Recipe + correction, three runs | 2.81 | 3.19 | 2.75 | 3.10 |

*Face* here is brow, eyes, nose, mouth and cheeks, and *head* adds the ears. Beard and cap are left out. What remains is 37% of the editable head's surface and 57% of the cast's.

| Region | Default | Head recipe fit | Recipe + correction | Frozen correction |
| --- | ---: | ---: | ---: | ---: |
| Brow and forehead | 3.16 (-0.27) | 2.93 (+0.25) | 2.45 (-0.34) | 2.13 |
| Eyes | 4.25 (+0.44) | 3.95 (-0.74) | 3.94 (-0.74) | 4.06 |
| Nose | 5.39 (-2.77) | 3.38 (-0.65) | 3.26 (-0.85) | 2.87 |
| Mouth | 4.60 (-0.41) | 4.33 (-0.21) | 4.43 (-1.46) | 4.03 |
| Cheeks | 4.56 (+1.36) | 3.42 (-0.58) | 3.76 (+0.39) | 2.66 |
| Ears | 3.20 (+0.15) | 2.92 (-0.14) | 2.76 (-0.34) | 2.53 |
| Chin and jaw (beard, not skin) | 12.14 | 9.31 | 9.30 | 8.97 |
| Cranium (casting cap, not skin) | 4.20 | 3.76 | 3.67 | 3.92 |

The 95th percentile of the face stays near 20 mm at every stage: beard that the region rules file under mouth and cheeks, and ears that stand much further from the head than the editable ears can. The midline is 5.3 mm off on the forehead, 8.7 mm on the nose and 6.0 mm on the lips after correction. The fitted recipe ends with six axes at their limit (`chin`, `lipFullness`, `neck`, `noseBridge`, `noseLength`, `temples`) and three more beyond 0.7 (`cheekFullness`, `eyeTilt`, `lips`).

### The correction, before and after spatial smoothing

| | Lee Perry-Smith, frozen | Lee Perry-Smith, updated | Lincoln, frozen | Lincoln, updated |
| --- | ---: | ---: | ---: | ---: |
| Face gain from one correction | 1.53 → 0.99 | 1.51 → 1.29 | 3.35 → 2.78 | 3.38 → 3.26 |
| Triangles turned past perpendicular | 1 of 6,302 | 0 of 6,236 | 2 of 6,280 | 4 of 6,223 |
| Mean control offset | 3.02 mm | 2.27 mm | 3.99 mm | 2.98 mm |
| Largest control offset | 23.5 mm | 16.4 mm | 49.8 mm | 52.8 mm |
| Added surface roughness | 0.039 mm | 0.019 mm | 0.045 mm | 0.022 mm |

The smoothing halves the roughness the correction adds and removes the one fold on the first head. On the cast the count goes from 2 to 4. The smoothing gives up 0.30 mm of face accuracy on the first head and 0.48 mm on the cast: the correction's gain shrinks from 0.54 to 0.22 mm and from 0.57 to 0.12 mm. On the cast, mouth and cheeks end worse than the recipe alone. On the first head the nose gets worse than the recipe alone (1.04 → 1.34 mm, 0.72 mm too full). The likely reason is that the smoothing radius of 48 mm is wider than the nose, so the nose inherits the movement of the cheeks. That was not tested with a smaller radius. Folds were already rare before the smoothing in this study, because the study removes the eyelid controls, where one side of a rim is most easily pulled through the other. The fold count of the study covers every outside head triangle; the editor's own count reports 0 for both heads on the updated generator.

On the cast one control travels about 50 mm in both versions and shows as a spike beside the neck. `fitHumanReference` looks for a partner within 100 mm. The likely cause is a control under the jaw, where the cast ends, that pairs with the cast's far edge.

### The editor's own recipe fit

`optimizeHumanMeasurements` on the head improves the face from 2.19 to 1.95 mm on the first head and not at all on the cast (4.06 to 4.07 mm). The head fitter of this study reaches 1.51 and 3.38 mm from the same axes. The editor's fit keeps the scan where it is, matches along normals from generated vertices only, and searches a fixed list of head axes.

### What the generator cannot express

Measured on the axes:

- `weight` and `muscle` move no skin above the neck (0.00 mm at the 99th percentile). A heavier or leaner face cannot be asked for.
- `age` ends at 0.03 for the first head and at 0.20 for a gaunt man in his mid-fifties. The fits found little use for it.

Seen in the comparison sheets (`CACHE/pictures/` and `CACHE/pictures-updated/`), with the regional numbers that agree:

- **Lower face.** The first scan has a heavy lower face with soft fullness under the chin. The editable head keeps a clean jaw line and a sharp angle between jaw and neck. The chin is the worst part of the midline (3.1 mm).
- **Eyes.** Both scans have deep-set eyes under a strong brow. The editable orbit is shallow and the closed lid bulges. The eye region does not improve beyond 1.5 mm and 3.9 mm, and the correction is not allowed to touch it.
- **Nose.** The recipe matches the first nose well in profile (0.8 mm). It has no control for the width of the nostril wings, which stay narrow from the front. On the cast, nose length and bridge are at their limits and the nose is still too small.
- **Lips.** The editable mouth is full, with a defined bow. Both scans have thin, pressed lips, and `lipFullness` ends at its limit both times. On the cast the correction pinches the mouth into creases.
- **Ears.** Both scans have larger ears that stand further out. The outline shows the editable ear ending well inside the scan's.
- **Likeness.** After the fit the editable head reads as a generic, smooth, younger man in both cases. The outline, the profile and the proportions are close. The person is not there.

The sheets are orthographic clay renders from the benchmark's raster helper, which reported a hardware renderer (NVIDIA GeForce RTX 5070 Ti) when they were made. They are diagnostics of the geometry. No screenshot of the fitted head in the editor was taken, because browser runs were on hold for other work.

### Limits of this study

- Two heads, both adult men with closed eyes. One has no known scale. On the other, beard and casting cap leave 37% of the editable head with skin to compare.
- The fitter's settings were chosen while looking at these two heads. No head was held back.
- Regions are simple rules on the default head. Beard beside the mouth counts as mouth or cheek.
- The benchmark's raster helper, which this study imports to decide which triangles are outside, switched from software to hardware rasterisation during the session. Which of the two filtered the placed scans was not recorded, and the difference was not measured.
- One run per scan and version. The spread between repeated runs was not measured; the two default rows suggest a few hundredths of a millimetre on the first head and 0.15 mm on the cast.

## Recommendations

These are proposals. None is measured.

1. Give the correction a mask and an expression, and reject partners on the open edge of a reference. That removes the need to delete eyelid controls afterwards and would have prevented the 50 mm spike.
2. Shrink the head smoothing radius well below the width of a nose, or apply it only where rims meet (eyelids, lips, nostrils). The 48 mm radius costs more than half of the correction's gain on the first head and four fifths on the cast.
3. Add what the two fits ran out of: facial fullness tied to `weight` or a separate axis, fullness under the chin, orbit depth, nostril width, and more range for ear size and lip thinness.
4. Use placement with scale and both-direction pairing in the editor's recipe fit.
5. Treat the fitted recipe as the understated result and the correction as optional. The recipe alone removes about a third of the face error on the first head and keeps a clean surface.

## Sources and licences

| Scan | Origin | Terms | Checked |
| --- | --- | --- | --- |
| Lee Perry-Smith head | [three.js r187, `examples/models/gltf/LeePerrySmith/`](https://github.com/mrdoob/three.js/tree/r187/examples/models/gltf/LeePerrySmith). File `LeePerrySmith.glb`, SHA-256 `402b8a8a…dc9c576`. 17,684 triangles, no stated unit. | [CC BY 3.0 Unported](https://creativecommons.org/licenses/by/3.0/). The folder's `LeePerrySmith_License.txt` reads: "Infinite, 3D Head Scan by Lee Perry-Smith is licensed under a Creative Commons Attribution 3.0 Unported License. Based on a work at www.triplegangers.com." | Licence file read from the r187 tag on 23 November 2026. The terms allow redistribution with attribution. |
| Abraham Lincoln life mask, Clark Mills 1865, cast c. 1917 | [National Portrait Gallery, object NPG.71.26](https://npg.si.edu/object/npg_NPG.71.26), Smithsonian 3D package `c02c239d-5ebf-4a7a-a368-e2288bbf4b31`. File `abraham-lincoln-mills-life-mask-150k-4096-high.glb`, SHA-256 `0df0969c…ab28bac`. 150,000 triangles, millimetres. | The [Smithsonian Open Access](https://www.si.edu/openaccess) API lists the object's 3D model as CC0. The package's own `document.json` says "(c) Smithsonian Institution. All rights reserved." | The same sentence is in the package of the Smithsonian's CC0 *Triceratops horridus* model, so it is the viewer's default text. The object record embedded in the package still says "Usage conditions apply", which is older than the API's answer. The terms are probably CC0 and were treated as unsettled. |

The full hashes and URLs are in `scripts/head-study/hs_targets.py`. Neither scan, nor anything made from one, is part of this repository.

Lee Perry-Smith released a scan of his own head. The Lincoln cast is a museum object. Both are real, recognisable people, which is a second reason to keep fitted likenesses local.

## What the scans are

**Lee Perry-Smith.** A cleaned head-and-shoulders scan of a shaved adult man, eyes closed, mouth closed. The file has no unit, so its size is unknown. The mesh carries a modelled mouth cavity and other surfaces that cannot be seen from outside: 3,574 of its 17,684 triangles. They are removed before any comparison. The placement puts one file unit at 0.0478 m, which is an estimate from the default head and not a measurement of the sitter.

**Lincoln life mask.** A plaster cast of a face mould taken from life, scanned as an object. It is a hollow shell with an outer face, an inner face and a flat rim. The rim and the inner face are removed: 56,409 triangles, which leaves 87,940. The beard covers chin and jaw, the cranium is the smooth cap of the casting process, and the cast ends under the jaw. Chin and jaw, cranium and neck are therefore marked as not skin: the fit ignores them, the correction leaves their controls alone and the headline numbers leave them out. Its unit is known, so its size is real.

Both heads have closed eyes. The editable head has open eyes and separate eyeballs.

## Method

**Generator version.** A run first copies the generator's modules into the cache, so every number of a run belongs to one version. Other work changed the generator while this study ran. Its version hash is printed with the tables.

**Outside surface.** Both sides are compared on skin that can be seen from outside. The editable head's mouth lining and eye sockets are left out, as are the scans' cavities.

**Closed eyes.** The generator's own `Blink` expression is added to the editable head before every comparison, with the scaling `human-mesh.js` uses for its morph targets. `evaluateHuman` has no expression argument, so the study's bridge adds the displacement itself.

**Placement.** A scan is turned, moved and scaled as a whole until it lies best on the editable head. The scan moves and the recipe keeps its default 1.72 m stature, because a head scan carries no stature and its head sits freely on its neck, while the editable human has no head-size axis and no head pose. Several starting sizes and forward tilts are tried, and iterated closest points in both directions settle each one.

**Head axes.** The fitter may change the recipe axes that reshape skin above the neck. They are found by trying every axis: one counts if moving it half way to its limit moves some head skin by more than 0.3 mm after the best turn, shift and scale is removed. Stature, limb and trunk axes drop out, so a head cannot be explained by changing the body.

**Recipe fit.** Each round pairs generated head vertices with their closest scan points and scan samples with their closest generated points, estimates the effect of each axis by evaluating the generator slightly below and above its current value, solves a bounded least-squares step and re-settles the scan. A step is kept only if the robust two-way distance falls. The search starts once from a female and once from a male frame and keeps the better result. Ears count half, eyes 0.6, the neck a quarter. `earTip` is held to the range `randomHuman` uses for people, because beyond it the ear becomes a pointed fantasy ear that a fit would use to reach a tall human ear.

**Editor recipe fit.** For comparison, the editor's own `optimizeHumanMeasurements` with region `head` is run once from the default recipe.

**Correction.** `fitHumanReference` with region `head` is called on top of the fitted recipe. It evaluates the open-eyed head and cannot be told to skip a patch, so the study removes the corrections of controls in the eye region, and in regions marked as not skin, from its answer. It is scored after one run and after three.

**Distances.** 40,000 points are drawn on the rendered (subdivided) editable head and 40,000 on the scan's head, uniformly by area and with seeds the fitter does not use. Every point is measured to its exact closest point on the other surface. *Two-way mean* is the average of the two means. All distances are millimetres on a 1.72 m editable human: the Lee Perry-Smith scan was scaled to that head, so they are not millimetres on the sitter.

**Regions.** Nine regions are fixed vertex sets of the editable head, defined once on the default head by simple rules measured in eye-to-mouth distances. Scan points take the region of the closest generated point of the final stage. *Face* is brow and forehead, eyes, nose, mouth, cheeks, chin and jaw. *Head* adds ears and cranium. The neck is reported but left out of both, since neck pose cannot be matched. `docs/media/head-study/region-map.png` shows the regions on the default head.

**Midline.** Both heads are cut along the plane of symmetry. The front curve from under the chin to the top of the forehead is compared curve to curve.

**Folds.** A correction that pulls one side of an eyelid or lip through the other turns triangles over. Head triangles above 0.25 mm² whose normal turns past perpendicular between the fitted recipe and its corrected version are counted on the open-eyed cage.

[Unit tests](../scripts/head-study/test_head_study.py) check the placement solver, the section code, the fold count, and the removal of cavities and of a hollow cast's inner face on shapes with known answers.

## Hooks this study had to work around

These are requests to whoever owns the generator modules. The study's own code changes none of them.

1. **Expressions in `evaluateHuman`.** A closed-eye reference needs the head evaluated with `Blink`. The bridge adds the displacement outside the generator.
2. **A mask or expression for `fitHumanReference`.** It fits the open-eyed head and every control of a region. A scan with closed eyes, a beard or hair needs those patches left alone. The study deletes control rows afterwards, which cannot stop their neighbours from being smoothed towards them.
3. **Placement with scale.** `fitHumanReference` expects the reference in the generator's frame. `find_placement` and `settle` in `scripts/head-study/hs_fit.py` do that for heads of unknown size and pose and could serve the reference dialog.
4. **Named facial regions.** `HeadTopology` in `scripts/head-study/hs_generator.py` defines them from landmarks of the default head. If the generator shipped region labels, diagnostics and masks would agree on them.

## Four additional mouth controls

A second run with upper lip height, Cupid's bow, mouth corner height and forward projection found 33 active head measurements. In the recipe-only fit, the average two-way mouth distance moved from 1.04 to 1.02 mm on Lee Perry-Smith and from 4.33 to 4.25 mm on the Lincoln cast. After one surface correction it moved from 0.99 to 0.93 mm on Lee and from 4.43 to 4.49 mm on Lincoln. These small changes leave the cast's mouth visibly unresolved. Other generator code changed between the two snapshots, so these runs do not isolate the four controls. Run with `--label mouth-controls` to keep the new measurements alongside the earlier ones.

## Does the fitted face retain its identity?

A blind reviewer saw six three-quarter clay renders and six fitted profiles of the MHR identities. The reviewer assigned two profiles correctly. In a separate shuffled before-and-after trial, another reviewer assigned 6/6 earlier profiles and 4/6 revised profiles. The second reviewer preferred the nose and brow variation in the revised set and pointed out parted lips on two people. Both tests showed some neck and shoulder. These counts describe the individual trials. They give no reliable estimate of how often a player will recognise a face.

The camera-depth solver was also replayed on two independent head scans. With the editor’s measurement controls alone, mean two-way face error on Lee Perry-Smith fell from 1.93 to 1.79 mm, and nose error fell from 1.94 to 1.56 mm. On the Lincoln life cast the face went from 4.09 to 3.52 mm and the nose from 4.93 to 3.88 mm. Lincoln’s mouth worsened from 4.84 to 5.07 mm. These compare the frozen `mouth-controls` and `view-depth` runs.

A second diagnostic measures face identity with the shoulders, hair, scalp and absolute size removed. Mark both outer eye corners and the front of the chin on each topology. For every candidate and reference, use these points to orient the head and normalise its outer-eye span to 92 mm. Measure the front and both 35° views in an elliptical face crop. Every pairing uses identical pixel support. Subtract the median depth offset in each view and cap individual errors at 15 mm. Read the rank of the true subject alongside all wrong-subject distances and the optimal one-to-one assignment. The result depends on landmark placement and tests the geometry in the crop. [Run the local identity grid](../scripts/head-study/identity_grid.py)

On the six practice identities, the closest face in the grid was the correct person for 1/6 earlier fits and 1/6 revised fits. Requiring every reference to be used once gave 0/6 and 1/6 respectively. The common crop covered 100% of the front ellipse and 85% at the oblique angles. Landmarks were placed once per topology and propagated to its six identities. A second annotator has not repeated this placement. In the ordinary world-coordinate camera comparison, the revised fits improved all six central three-quarter face crops, from 3.02–4.00 mm to 1.84–2.48 mm mean depth error. A smaller absolute error has yet to translate into reliable identity recovery across these related people. [Wrong-subject distances and ranks](media/face-identity-grid.json)

Across the 15 possible pairs of people, the revised fits reproduced a median 78% of the measured difference in facial depth, up from 65%. The direction of the difference matters too. For each pair, subtract the two depth images, remove the median offset per view, and compare the resulting reference and fitted differences by cosine similarity. This gives 1 for identical directions, 0 for unrelated directions and −1 for opposite directions. Median agreement rose from 0.41 to 0.47, but the F1/F2 pair went from 0.12 to −0.28. On that pair the two fits vary in the wrong direction even though both got closer to their references in absolute millimetres.

For a cropped head scan the editor now detects open edges after joining coincident triangle corners. A closest point on a cut edge supplies no evidence for pulling skin toward the cut. Unsupported anchors keep their existing surface edits during smoothing. A regression cuts the top off a synthetic head scan and checks the crown controls. A second test starts with an existing large manual edit and checks the second Fit pass stays inside the saved correction range.

When the fitter also excluded the invisible oral lining, a separate run on a placed scan of the Nefertiti bust improved on the slider-only result. With the same starting recipe and placement, the two-way facial surface error fell from 0.98 to 0.87 mm after one pass. With the unsupported eye openings excluded from both depth images, mean camera-depth error across three unused orbit views fell from 1.57 to 1.33 mm. The earlier fitter had moved a crown control 58.7 mm toward the cut around the headdress. The revised first pass moved it at most 0.6 mm. Eye sockets still moved toward the solid carved eyeballs. Holding that area in a separate two-pass experiment yielded 0.80 mm on the surface and 1.27 mm in the unused views. This is a single sculpture with a fixed registration. [Berlin Egyptian Museum collection](https://www.smb.museum/en/museums-institutions/aegyptisches-museum-und-papyrussammlung/collection-research/bust-of-nefertiti/)

On the six related practice heads, the later fit with oral lining excluded and a revised lip landmark reached 0.53 median directional agreement and 80% median amplitude in the paired diagnostic. Independent nearest-reference identification remained 1/6. Requiring each reference to be used exactly once assigned 4/6 correctly. The gap between those counts is a reason to report both.

## Compare fine contours

In the fit dialog, **Wipe** puts the reference and editable skin in the same frame, under the same clay material and light. Move **Reference coverage** between the two ends to inspect the same lip, ear or shoulder on each surface. Drag to orbit and scroll to zoom. A locally installed benchmark study opens its own source when you choose **Fit a 3D reference**. On the workshop server, `/#study=mhr-f1&compare=3d` opens the F1 pair directly.

**Refine facial contours** fits both the distance to the reference and the local slope of the skin. It is optional. Across six related heads and three fixed camera views per head, average surface-normal disagreement dropped from 7.36° to 6.18°. The analysis also measures where a fit smooths away real relief or adds excess texture, using two spatial scales on each depth image. This measure depends on camera and landmark placement. Independent nearest-person identification stayed at three of six on the registered landmark grid. [Surface relief measurement](../scripts/head-study/surface_relief.py)

On two independent scans with eye openings held, refinement reduced the two-pass depth error over three unused camera views from 1.27 to 1.01 mm on Nefertiti and from 1.59 to 1.17 mm on Lee Perry-Smith. The saved head had zero newly turned triangles in either trial. The bust's chipped ear still moved the editable ear by up to 5.9 mm. Hide damaged areas before fitting if you want the original anatomy there. [Independent scan trial and regional readings](head-transfer.md)

**Measure this camera view** also reports the mean difference in surface-normal angle when the view resolves at least one pixel per millimetre. It compares local relief with the average depth about 2.5 mm to either side in both screen directions. The displayed relief error is the 95th percentile in millimetres. The original and current readings use the same continuous pixels across all three surfaces, excluding background and open edges.

In the live workshop, all six MHR studies opened, fitted and saved with facial contour refinement enabled. Across the six, mean head-view depth error fell from 27.48 to 2.13 mm at three-quarter view and from 29.33 to 2.81 mm in profile, starting with the same neutral 1.72 m adult. These gains include stature, pose, measurement and surface fitting. Four of the six heads met the fine-detail sampling threshold at the default framing. The wipe check also compared both halves of its midpoint image against the two full-frame endpoints.

## Reproduce

1. Run `pnpm install --frozen-lockfile`. Install Python 3.12 with `numpy`, `scipy`, `opencv-python` and `pillow`.
2. Download the two files named above into `CACHE/lee-perry-smith/` and `CACHE/lincoln-mills/`, and the Smithsonian package's `document.json` beside the Lincoln file. `CACHE` is any ignored folder, for example `.reference-cache/head-study`. The loader refuses a file whose hash differs.
3. `python scripts/head-study/test_head_study.py`
4. `python scripts/head-study/prepare-targets.py CACHE` places both scans (about eight minutes).
5. `python scripts/head-study/run.py CACHE` fits and scores them (a few minutes). `--label NAME` keeps a second run beside the first. `--install` copies the fits to `examples/head-targets-fits/`, where the editor's local study list finds them.
6. `python scripts/head-study/report.py CACHE` writes the comparison sheets to `CACHE/pictures/`, and `python scripts/head-study/tables.py CACHE` prints the tables on this page.

The distance and raster helpers are imported unchanged from `scripts/human-benchmark/`.
