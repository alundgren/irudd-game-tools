# Likeness test on an independent female portrait

The six practice heads of [the benchmark](human-benchmark.md) are related to one another, and the two scanned heads of [the head scan study](head-scan-study.md) are both men. This test fits the editable head to one more face that shares nothing with them: the bust of Nefertiti, from the owning museum's own scan. It asks whether the editable face can carry an identity, and how much a few slider changes by hand add to what the fitter finds.

All distances are millimetres on a 1.72 m human. Every run is a single run. Measured on 23 November 2026.

## Findings

- **The fit is specific to this face.** The fitted head is closer to the bust than any of 33 other editable heads on every surface measure: 0.98 mm two-way facial distance against 1.94 mm for the best other head, and 1.57 mm against 2.73 mm in views that no fit used.
- **Surface distance did not find the proportions.** The same fit put the eye and mouth proportions further from the bust than the default head has them (3.50 mm mean difference over eleven facial proportions, default head 2.72 mm). It closed the eyes to cover the sculpted eyeballs and narrowed the mouth to its limit.
- **Six sliders set by hand fixed the proportions.** Mean difference 0.69 mm, for 0.11 mm more surface distance. With the correction on top the head is at 0.91 mm on the surface and 0.83 mm on the proportions.
- **The likeness is partial.** Outline, profile and the placing of the features are right. The crisp lip edges, the heavy upper lids and the defined nostril wings that make the bust recognisable are absent. The head reads as a smooth, generic woman with this face's proportions.
- **The test exposed four fitter faults**, all on skin the scan cannot show. Three were fixed during the test by the fitter's maintainer and one here. Details are under [What the test changed in the fitter](#what-the-test-changed-in-the-fitter).

## Source and terms

| | |
| --- | --- |
| Object | Bust of Queen Nefertiti, Ägyptisches Museum und Papyrussammlung, Staatliche Museen zu Berlin, Ident. Nr. ÄM 21300 |
| Scan | Structured-light scan of 2008, 3D model by Trigon Art, Berlin. File `aem_aem21300_3dsl01_mo08-03_p.obj`: 3,210,620 vertices, 6,421,238 triangles, millimetres, Z up |
| Page | [Bust of Nefertiti, collection and research](https://www.smb.museum/en/museums-institutions/aegyptisches-museum-und-papyrussammlung/collection-research/bust-of-nefertiti/) |
| Download | [`Nofretete_3D_Modell.zip`](https://www.smb.museum/fileadmin/website/Museen_und_Sammlungen/Aegyptisches_Museum_Papyrussammlung/02_Sammeln_Forschen/Sammlung/Nofretete/Scan/Nofretete_3D_Modell.zip), 233,990,666 bytes, SHA-256 `8e447c7eb9f88ef50e7f9e2bd2fe91be7fdea902693b49a6f2dc11c87174d73d` |
| Terms | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |

The museum's page says: "we are now making it available for free download (ZIP with an OBJ file and accompanying information, 832 MB) under a CC-NC-BY-SA licence." The archive served on the day was 234 MB. The information sheet inside it reads:

> Bust of Queen Nefertiti, Ägyptisches Museum und Papyrussammlung, Ident. Nr. ÄM 21300 … 3D-Model by Trigon Art, Berlin 2008 | Structured-light 3D scan, 2008. © 3D Model: Ägyptisches Museum und Papyrussammlung, Staatliche Museen zu Berlin – Preußischer Kulturbesitz … Copyright restrictions apply. licensed under a Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License. Digital Permissions Services for Commercial Users contact: contact@bpk-bildagentur.de

The terms allow non-commercial use and adaptation with attribution, and require anything adapted from the model to carry the same licence when it is shared. This test shares nothing made from it. The archive, the prepared meshes, every fitted head and every picture stay in the ignored folder `.reference-cache/female-head/` on the machine that ran the test. This page holds the source, the terms, the method and measured numbers only.

## What the scan is

A painted limestone and stucco sculpture, not a living face. The crown covers the cranium, both ears are chipped, the neck is elongated and thrust forward, and the eyes are open with a sculpted eyeball in each socket. The score covers facial skin: brow and forehead below the crown, eyes, nose, mouth, cheeks, chin and jaw. Cranium, ears and neck are measured but excluded from the facial figure.

## Method

**Preparation.** The mesh is converted to metres with Y up, facing +Z, and its vertices are clustered at 0.6 mm (1,149,333 vertices). The skin is cut out along the crown's edge, traced by hand in profile with a 3 mm margin, and above a floor on the neck (199,909 vertices, 398,371 triangles).

**Registration.** The editor's own `fitLandmarks` places the scan from three hand-picked pairs: right outer eye corner, left outer eye corner, centre of the chin. Scale 1.0036, RMS 3.00 mm. Each stage then gets a settled placement of the scan (pose and one scale) as in the head scan study, and is scored in the settled frame of the recipe fit. The recipe fit's placement scale is 1.043.

**Fits.** The recipe search and the correction call are the head scan study's (`scripts/head-study/hs_fit.py`), which calls the editor's `optimizeHumanMeasurements` and `fitHumanReference` with region `head` on a frozen copy of `character-view/`. Forty-five head axes are free.

**Measures.**

- Two-way mean distance between the facial skin of the head and of the scan, by region, with the 95th percentile, the share within 1 mm, and the mean angle between normals.
- Midline profile distance.
- Held-out views. The scan and each stage are drawn by the hardware rasteriser of the benchmark (`scripts/human-benchmark/hb_raster.py`, OpenGL on the machine's GPU) from one orthographic camera per view. Three orbit views are used by no fit: 35° right and 10° up, 55° left and 10° down, 20° right and 25° up. On pixels where both show facial skin: mean camera depth difference, mean normal angle, and the mean horizontal distance between the two occluding outlines of the face. The eye region is left out of the pixel measures because the head's socket is open where the scan has an eyeball.
- Eleven facial proportions from seventeen landmarks picked by hand on the scan (good to about 1 mm) and tracked as vertices on the head: eye corner spans, eye length and opening height, outer corner height, nose width, eye line to nose base, nose base to lip line, lip line to chin, mouth width, lip height.
- A gallery of 33 other editable heads, each given its own best placement of the scan: the default head, the recipes fitted to the two scanned men and to the six practice bodies, and twelve female and twelve male seeded draws of the editor's random adult.

## Results

Frozen generator `11fca6dfbf10`. "Masked" corrections hand the fitter the scan plus the head's own surface wherever the scan has no skin, so unsupported anchors find themselves at zero distance.

| Stage | Face | Within 1 mm | Normal | Held-out depth | Held-out normal | Held-out outline | Proportions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Default head at the three landmarks | 5.52 | 14% | 14.5° | 6.47 | 14.0° | 5.62 | |
| Default head, scan settled | 1.94 | 33% | 12.7° | 3.07 | 11.3° | 2.41 | 2.72 |
| Editor's measurement fit | 1.40 | 42% | 12.0° | 2.15 | 9.7° | 1.64 | |
| Recipe fit | 0.98 | 60% | 10.3° | 1.57 | 8.5° | 1.17 | 3.50 |
| Recipe fit + correction, masked | 0.84 | 67% | 9.8° | 1.33 | 8.0° | 1.15 | 3.56 |
| Recipe fit + correction, scan alone | 1.56 | 34% | 10.3° | 2.35 | 8.5° | 1.60 | |
| Six sliders by hand | 1.09 | 54% | 10.5° | 1.80 | 9.4° | 1.30 | 0.69 |
| Six sliders by hand + correction, masked | 0.91 | 63% | 9.8° | 1.47 | 8.5° | 1.22 | 0.83 |
| Hand sliders pinned, others refitted | 1.08 | 55% | 10.7° | 1.73 | 9.3° | 1.29 | 1.13 |

Regions of the recipe fit: brow and forehead 1.39, eyes 1.47, nose 0.77, mouth 0.68, cheeks 0.68, chin and jaw 1.03. The masked correction brings brow to 1.02, cheeks to 0.55 and chin and jaw to 0.88, moving 120 anchors by 0.4 mm on average and 1.9 mm at most, with no folded triangle.

The recipe fit ends six axes at or near a limit: `frame` −1.00, `lips` −1.00, `noseBridge` +0.98, `eyeSize` −0.98, `noseLength` +0.94, `chin` +0.93.

Per view, depth in mm for default head, recipe fit and masked correction: orbit 35/10 3.10, 1.50, 1.27. Orbit −55/−10 2.68, 1.36, 1.11. Orbit 20/25 3.44, 1.84, 1.61. Profile 2.04, 1.15, 1.00.

### Proportions and steering by hand

| Proportion, mm | Bust | Default head | Recipe fit | Six sliders by hand |
| --- | ---: | ---: | ---: | ---: |
| Outer eye corners apart | 93.0 | 87.6 | 87.9 | 92.7 |
| Inner eye corners apart | 35.5 | 34.1 | 40.8 | 35.5 |
| Eye length | 29.2 | 26.9 | 23.9 | 29.1 |
| Eye opening height | 8.8 | 9.4 | 8.4 | 10.4 |
| Outer corner above inner | 5.2 | 3.1 | 4.1 | 5.3 |
| Nose width | 37.0 | 34.7 | 37.1 | 38.3 |
| Eye line to nose base | 48.1 | 43.9 | 47.3 | 46.7 |
| Nose base to lip line | 16.5 | 19.8 | 18.4 | 16.9 |
| Lip line to chin | 40.5 | 42.1 | 37.5 | 38.9 |
| Mouth width | 53.0 | 46.8 | 38.7 | 52.9 |
| Lip height | 17.0 | 17.4 | 18.1 | 17.6 |
| Mean absolute difference | | 2.72 | 3.50 | 0.69 |

The six sliders, set on top of the recipe fit by looking at the comparison pictures and this table: Eye size 0.3, Mouth width 0.65, Outer eye angle −0.8, `upperLipHeight` −0.3, Mouth height on face −0.4, `mouthProjection` −0.4. Two of them alone (Eye size 0.6, Mouth width 0.5) already reach 1.33 mm.

Widening the mouth by hand costs surface distance at the mouth (0.68 to 1.65 mm, 1.21 mm after the correction), because the head's wide mouth has a different lip shape from the bust's. Pinning the hand-set sliders and refitting every other axis recovers 0.01 mm of face and drives `mouthCorners` to its limit, which reads as a grin. The hand-set version without refit is the better head.

### Match proportions

**Fit a 3D reference… → Match proportions** does the steering above with marks in place of looking. It works on any aligned reference head.

1. Pick a proportion: mouth width, nose width, eye length, eye opening height, the span between the inner or the outer eye corners, outer corner above the inner, nose length, nose to mouth line, upper or lower lip height, mouth line to chin.
2. Click its two ends on the reference in the left pane. Dots on the editable head in the right pane show the two places of its own skin where the same proportion is read, so the same kind of point is marked.
3. The table lists each marked proportion: reference, the editable head, and the difference, in mm. Readings are taken as the face is seen from the front, so the depth of a click and the curve of the face do not count.
4. The ordinary sliders suggested for the marked proportions are ticked. Untick any to keep it, or tick one of the wider ones offered. The five heights down the middle of the face (nose length, nose to mouth line, the two lip heights, mouth line to chin) are readings: they are listed, followed through every fit and set by hand.
5. **Fit controls to the marks** moves the ticked sliders together. The step lists the readings before and after, every slider with its old and new value, any at its limit, and every other named proportion that changed by 0.3 mm or more. **Undo step** takes it back, **Apply** keeps it, and the saved recipe measures the same after reopening.

The fit moves ordinary sliders only, so the result stays editable. A slider is suggested for a proportion when it changes the reading by moving the measured feature itself: Mouth width for the mouth, `nose` and `nostrilWidth` for nose width, Eye size and `eyeSpacing` for the eyes, `chinHeight` and Mouth height on face for mouth to chin. Sliders that reshape the whole head (`headWidth`, `faceHeight`, `forehead`) are offered and never ticked for the artist. Sliders whose movement lies mostly on kept eye openings or on skin hidden on the reference are left alone and named with the reason. A sculpt and settings made by hand ride along. The code is [`human-proportions.js`](../character-view/human-proportions.js) and [`human-proportion-match.js`](../character-view/human-proportion-match.js), with [solver tests](../character-view/human-proportions.test.js) and a [panel test](../character-view/human-proportion-match.test.js). It is separate from **Match a feature**, which sculpts a brushed patch of surface.

**Test.** Fits of plain heads to generated heads recover twelve proportions to 0.4 mm at worst. The solver was then frozen after work on the bust and run once on two scans it had not seen, Lee Perry-Smith and the Lincoln life mask ([sources](head-scan-study.md)), with marks made by eye on gridded close-ups before any fit. One placement and the plain default head start every row. Rows: the dialog's measurement fit and surface correction with eye openings kept, and the same with the marked proportions fitted in between. Proportion figures are the mean absolute difference from the marks.

| Scan | Row | Matched set | Other marked proportions | Face | Held-out depth | Mouth region |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Bust (solver developed on it) | Surface fit alone | 3.40 | 3.61 | 1.11 | 1.83 | 0.66 |
| | Six proportions matched | 1.20 | 3.46 | 1.18 | 1.92 | 1.05 |
| | Widths only | 1.58 | 3.36 | 1.17 | 1.91 | 1.02 |
| | All twelve matched | 1.33 | 1.96 | 1.23 | 2.03 | 1.09 |
| Lee Perry-Smith (unseen) | Surface fit alone | 3.71 | 3.91 | 1.23 | 1.85 | 0.86 |
| | Five proportions matched | 0.28 | 4.28 | 1.32 | 2.04 | 1.47 |
| | Widths only | 2.02 | 3.85 | 1.25 | 1.88 | 1.01 |
| | All eleven matched | 1.51 | 2.38 | 1.23 | 1.82 | 0.80 |
| Lincoln life mask (unseen) | Surface fit alone | 4.61 | 6.11 | 3.30 | 2.25 | 3.91 |
| | Three proportions matched | 0.55 | 7.54 | 3.40 | 2.40 | 4.62 |
| | Widths only | 2.02 | 6.12 | 3.32 | 2.28 | 4.13 |
| | All six matched | 1.71 | 5.85 | 3.38 | 2.41 | 4.30 |

The matched set is mouth width, nose width, eye length, eye opening height, nose to mouth line and mouth line to chin, as far as each scan shows them. Both proportion columns keep their sets in every row. The other marked proportions are handed to the fit only in the "All" rows. Generator `3fe1e75bdc7f`, solver `5bb2702ec50e`. Both unseen scans have closed eyes, and the mask's eye corners and bearded chin could not be marked. "Widths only" fits mouth width, nose width, eye length and eye opening height. It was added after the frozen runs, with the same solver, and is a choice of marks.

- **Widths are matched and cost little.** Mouth width, reference / surface fit alone / widths only: bust 52.9 / 43.5 / 50.8 mm, Lee Perry-Smith 41.4 / 47.2 / 42.2, Lincoln 54.1 / 46.8 / 54.4. Face and held-out depth move by 0.02 to 0.08 mm, the mouth region by 0.15 to 0.36 mm, and the heights down the middle of the face stay where they were. Eye size takes the eye corner spans with it (bust inner corners 36.1 to 32.9 mm against 35.6 on the bust). In paired close-ups with the reference between two heads in random order, the matched head read closer at the mouth on all three scans. That is one reader, who could tell the two apart by the width.
- **Nose to mouth line made both unseen heads worse to look at, so the heights are readings in the dialog.** The rows of the table that match them come from the solver, which still accepts them. A distance does not say which end is wrong. On the Lincoln mask the mouth already sat at the reference's height and the head's nose base was too low. The fit met the 22.7 mm reading by moving the mouth down, with three sliders at their limits and 3.0 mm rms of skin moved. On Lee Perry-Smith it met the reading by thickening the upper lip, because `upperLipHeight` raises the lip's top edge as much as it lengthens the stretch above it: the upper lip went from 9.0 to 11.2 mm against 6.1 on the scan. With the lip heights and the nose length marked as well, the mouth stays in place and the surface figures return to the surface fit's on Lee Perry-Smith. The nose to mouth line then stays 2.5 and 4.3 mm short and the upper lip stays thick (10.8 against 6.1 mm), because the sliders that thin the upper lip also shorten the stretch above it.
- **Marked ends keep the right end in place, and the heights are still not good enough to fit.** `fitProportions` takes the marked points as `ends`. For a height it then brings each end to the height of its mark on the aligned reference, and the reading follows. On generated heads this moves the end that is out of place where the distance alone moved the other one. On the three scans, none unseen any more, the six, five and three matched proportions with ends give face 1.17, 1.25 and 3.36 mm and a mouth region of 1.01, 0.92 and 4.12 mm, each as good as or better than the distance fit, and the mask's mouth stays at the reference's height. The upper lip is still thickened to bring the nose base up (11.1 against 6.1 mm on Lee Perry-Smith), and both heads still read worse than with widths only. The dialog does not use `ends` yet.
- **Surface distance and proportions are separate.** The surface fit alone leaves the proportions as far off as the default head. Matching proportions never lowered the face figure and raised it by up to 0.12 mm, mostly at the mouth, where the head's wider or narrower mouth has a different lip shape from the scan's.
- **Proportions that are not marked do not follow.** Their difference stays within 0.4 mm of the surface fit's on the bust and Lee Perry-Smith. On the mask it grows by 1.4 mm, where sliders at their limits took the lip heights and the nose length along.
- **Order.** Proportions before the surface correction. The other order gives the same readings and a face figure within 0.06 mm, and on the mask it turned two triangles. The correction afterwards moves a matched mouth width by 0.4 to 2.2 mm. Fitting the same marks once more restores it, as far as Mouth width reaches (51.8 of 52.9 mm on the bust, at its limit).
- **Eyes.** Eye size scales length and opening height together and no other slider moves the lid edges. On the bust, Eye size at its limit gives 27.6 of 30.5 mm length and a 9.3 mm opening against 8.3 mm. A long, narrow eye is out of reach.
- **In the dialog.** Checked in Chrome on the hardware renderer with the Lee Perry-Smith file placed by three landmarks: eight clicks marked three widths and one height, the fit moved four sliders (Eye size to its limit), **Undo step** restored every reading, **Keep my eye openings** took Eye size off the list and named it, **Apply** closed the dialog, and the saved form opened again with the same four readings to 0.1 mm. No page error.
- **Marking.** Eye corners are good to about 1.5 mm, a nose root on a straight profile to several mm, and lip edges on an uncoloured scan are a judgement. With **Keep my eye openings** on, the eye sliders are left alone; turn it off while matching an eye proportion.

### Is it this face?

| Measure | Best of 33 other heads | Median | Recipe fit | By hand + correction |
| --- | --- | ---: | --- | --- |
| Face, mm | 1.94 (default head) | 2.65 | 0.98, rank 1 | 0.91, rank 1 |
| Held-out depth, mm | 2.73 (a random female draw) | 4.22 | 1.57, rank 1 | 1.47, rank 1 |
| Held-out normal | 10.6° | 14.3° | 8.5°, rank 1 | 8.5°, rank 1 |
| Held-out outline, mm | 2.23 | 3.74 | 1.17, rank 1 | 1.22, rank 1 |
| Proportions, mm | 2.28 (a random male draw) | 3.52 | 3.50, rank 17 of 34 | 0.83, rank 1 |

The recipe fit differs from the other 33 heads by 1.68 to 4.26 mm head to head (median 2.62 mm), so 0.98 mm to the bust is well inside the spread between editable faces. On proportions alone the fitter's head is an average member of the gallery. The hand-steered head is first on both.

### Reading the pictures

Front, profile and held-out views of the bust beside each stage were compared by eye on the local machine. The fitted profile follows the bust from brow to chin within about a millimetre and the jaw outline is right. After steering, the mouth is as wide as the bust's and the eyes are as long and as far apart. What remains different is local form the generator has no control for: the sharp vermilion border and the flat, clearly edged upper lip, the heavy upper lid with a crisp crease over a large almond opening, the defined nostril wing, and the flat plane under the cheekbone. A viewer who knows the bust would call the result similar in type, not a portrait.

## What the test changed in the fitter

Each fault concerns skin an outside scan cannot show. Numbers are from matched runs: one starting recipe and one scan placement for every row, correction step only, scan alone, one pass / two passes.

1. **Offsets past the legal range after smoothing.** A second or third correction pass was rejected with "Invalid human surface correction." The offset was clamped before the spatial smoothing, and the smoothing wrote a longer one (66.3 mm against a limit of 64.9 mm). Fixed in the fitter: every second pass in this test is now accepted.
2. **Skin beside a cut.** With the crown cut away, all 140 crown anchors moved toward the cut edge, by up to 58.7 mm. Fixed in the fitter by rejecting closest points on open edges and holding anchors that have no observed skin: 4 of 140 move, by at most 0.6 mm.
3. **The lining of the mouth.** Forty anchors inside the mouth moved by up to 17 mm. Fixed in the fitter by excluding the lining's own island of the skin layout.
4. **The lining of the eye sockets.** Each socket is lined by its own island of the skin layout (308 vertices and 7 anchors per eye), joined to the face along the lid margin. Its back wall faces forward, so the fit drew it onto the scan's lids or eyeball and took the eyeball with it, even on a scan with holes where the eyes were. Fixed during this test: `exteriorSkin` excludes the socket lining and keeps the lid margins.

| Scan | Fitter | Face | Eye region | Socket anchors, mean / max | Eyeball shift / change of shape |
| --- | --- | --- | --- | --- | --- |
| Bust (open eyes, eyeball) | Recipe, no correction | 0.98 | 1.47 | | |
| | Before 4 | 0.87 / 0.86 | 1.92 / 2.05 | 6.3 / 9.1 | 5.0 / 2.4 |
| | After 4 | 0.81 / 0.77 | 1.33 / 1.28 | 0 / 0 | 0.2 / 0.3 |
| | After 4, eye openings kept | 0.83 / 0.80 | 1.47 / 1.47 | 0 / 0 | 0.0 / 0.0 |
| Bust with the eyes cut out | Before 4 | 0.82 / 0.79 | 1.48 / 1.47 | 4.2 / 6.6 | 3.2 / 2.2 |
| | After 4 | 0.82 / 0.77 | 1.37 / 1.33 | 0 / 0 | 0.0 / 0.2 |
| Lee Perry-Smith (closed eyes) | Recipe, no correction | 1.49 | 1.32 | | |
| | Before 4 | 1.08 / 1.01 | 1.16 / 1.10 | 2.0 / 6.7 | 3.1 / 2.7 |
| | After 4 | 1.07 / 1.00 | 1.07 / 1.04 | 0 / 0 | 0.6 / 0.4 |
| | After 4, eye openings kept | 1.10 / 1.04 | 1.29 / 1.31 | 0 / 0 | 0.5 / 0.1 |
| Lincoln life mask (closed eyes) | Before 4 | 3.02 / 2.96 | 4.07 / 4.21 | 0.5 / 2.1 | 1.3 / 0.8 |
| | After 4 | 3.00 / 2.94 | 3.93 / 3.97 | 0 / 0 | 1.0 / 0.5 |
| | After 4, eye openings kept | 3.01 / 2.95 | 3.99 / 4.06 | 0 / 0 | 0.8 / 0.1 |

Eyeball figures are the first pass, from `eyeIntegrity` in `human-family-transfer.js`. No row has a folded triangle. The half millimetre of eyeball shift that remains with the openings kept is the crown-height compensation in `applyHumanControls` moving the upper head as one piece.

### Keeping the eye openings

**Fit a 3D reference…**, with **Isolated head or bust**, has a checkbox **Keep my eye openings**. It is off by default, so lids are fitted wherever the scan shows them. Turn it on when the scan's eyes are not lid skin: open eyes with an eyeball, sculpted or painted eyes, lashes.

The option is `keepEyeOpenings` on `fitHumanReference` and `optimizeHumanMeasurements`. [`human-fit-eyes.js`](../character-view/human-fit-eyes.js) reads the openings from the head's own build: the socket linings, and the fit anchors that carry an eyeball (seven on the lining and seven on the lids of each eye). Those 28 anchors are held like anchors under a hidden part of the reference, their skin gives no sample to the measurement fit, and the measurement fit leaves alone every slider whose movement lies mostly on that skin. That rule selects Eye size, Outer eye angle, Lid fold, `eyeSpacing` and `underEye`, each with all of its movement there. The next slider, `malarHeight`, has a third.

With the option on, the bust reaches 0.83 / 0.80 mm with the eye region exactly where the recipe left it, the same as the masked correction of the Results table to 0.01 mm. On the closed-eye scans it costs 0.02 to 0.04 mm of face, all in the eye region. One click with **Fit measurements first** leaves the five eye sliders unchanged on all three scans. Without the option they move by up to 0.11 on the bust and Lee Perry-Smith and 0.27 on the Lincoln mask. [Regression tests](../character-view/human-fit-eyes.test.js)

### Refine facial contours

The opt-in `denseHead` refinement (**Refine facial contours** in the dialog) was compared off against on, on the same matched runs: one recipe and placement per scan, correction step only, scan alone, applied once / twice. It rematches twice per pass. The table is the final fitter, which also checks folds against the head as it was before any correction.

| Scan | Row | Face | Within 1 mm, two passes | Held-out depth | Held-out normal, two passes | Turned triangles | Largest offset, two passes | Largest ear offset, two passes |
| --- | --- | --- | ---: | --- | ---: | --- | ---: | ---: |
| Bust, eye openings kept | Off | 0.83 / 0.80 | 70% | 1.34 / 1.27 | 7.9° | 0 / 0 | 2.3 | 1.3 |
| | On | 0.71 / 0.68 | 77% | 1.07 / 1.01 | 7.3° | 0 / 0 | 5.9 | 5.9 |
| Bust, lids fitted | Off | 0.81 / 0.77 | 72% | 1.31 / 1.23 | 7.7° | 0 / 0 | 2.3 | 1.3 |
| | On | 0.67 / 0.64 | 80% | 1.04 / 0.98 | 7.1° | 0 / 0 | 5.9 | 5.9 |
| Lee Perry-Smith, eye openings kept | Off | 1.10 / 1.04 | 60% | 1.71 / 1.59 | 7.3° | 0 / 0 | 4.3 | 1.7 |
| | On | 0.91 / 0.86 | 70% | 1.28 / 1.17 | 6.1° | 0 / 0 | 5.5 | 3.5 |
| Lee Perry-Smith, lids fitted | Off | 1.07 / 1.00 | 62% | 1.69 / 1.58 | 7.2° | 0 / 0 | 4.3 | 1.7 |
| | On | 0.86 / 0.81 | 72% | 1.27 / 1.17 | 6.0° | 0 / 0 | 5.5 | 3.5 |

Turned triangles are counted against the uncorrected head over both passes.

Every held-out view improves on both scans, on both passes, with the eye openings kept or fitted. On the bust after two passes with the openings kept, depth and outline per view, off to on: orbit 35/10 1.22 to 1.01 mm and 1.24 to 0.80 mm, orbit −55/−10 1.04 to 0.85 mm and 0.86 to 0.88 mm, orbit 20/25 1.55 to 1.18 mm and 1.38 to 1.24 mm, profile 0.94 to 0.80 mm and 1.63 to 1.41 mm. By region: brow and forehead 0.95 to 0.69, chin and jaw 0.83 to 0.68, nose 0.76 to 0.64, mouth 0.68 to 0.60, cheeks 0.51 to 0.47, eyes 1.47 to 1.48.

Kept eye openings, socket linings and the mouth lining stay at exactly zero movement with the refinement on. Beside the crown's cut the same 4 of 140 anchors move as without it, by up to 2.2 mm in place of 0.9 mm. With the lids fitted, the refinement moves lid anchors further (bust 0.54 to 1.30 mm mean on the first pass, Lee Perry-Smith 0.73 to 1.56 mm) and changes the eyeball's shape by 1.6 mm on Lee Perry-Smith's first pass, against 0.4 mm without it.

**Before the cumulative fold check.** The first version tested checked each pass against its own start. Two passes then added up to turned triangles that the editor's reading did not show: 5 and 6 on the bust and 2 on Lee Perry-Smith, all in the ears, mirrored left and right, each under 1.5 mm². Ear anchors moved by up to 7.0 mm on the bust and 4.6 mm on Lee Perry-Smith. The face and held-out figures of that version equal the table above to 0.01 mm.

**What remains.** The fold count is zero, and the ear still follows what the scan shows. In an enlarged profile render the bust's chipped ears give the head a kink at the antitragus and a flattened antihelix, the same with and without the fold check. Hide broken or hair-covered ears with **Hide parts that are not skin** before refining. The second pass adds 0.03 mm of face on the bust for larger offsets (mean 1.13 to 1.44 mm), and the surface is rougher than without the refinement (mean change of the Laplacian 0.008 to 0.023 mm), which reads as real structure at the brow and cheek with slight faceting at the temple and beside the mouth corner.

## Limits

- One sculpture, one registration, one run per row. The landmarks and the crown's edge were picked by hand.
- A statue idealises a face. Its surface is smoother and more symmetric than a living head, which favours a smooth generator.
- The eyes are open with a sculpted eyeball, and the head's are open sockets, so the eye region's surface figure mixes lid and eyeball. The proportions carry the eye comparison.
- Cranium, ears and neck were not tested.
- The likeness judgement is one reader's, from local pictures. No recognition trial was run.
- Results tables use the frozen generator named above. The fitter tables use later snapshots of a fitter that was changing during the test.

## Reproduce

The tools of this test live with the scan in the ignored folder and are not part of the repository, because several hold values picked on the scan. To repeat it: download the archive named above into an ignored folder and check its hash, convert and cut the skin as described under Method, place it with `fitLandmarks`, then use `scripts/head-study/hs_fit.py` and `hs_metrics.py` for the fits and the surface measures and `scripts/human-benchmark/hb_raster.py` for the views. Python 3.12 needs `numpy`, `scipy`, `moderngl`, `opencv-python` and `pillow`.
