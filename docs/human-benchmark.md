# Human body benchmark

Six adult bodies from an independent, licensed body model serve as 3D targets for the editable human. A fitter searches the editor's own recipe axes for each target, and a separate comparison measures how far the generated surface is from the target surface in both directions. The targets, the fitted recipes and the comparison pictures are local reference material. This page gives the numbers and describes in words what the pictures show.

## Results

Measured on 23 November 2026 with generator version `31967327f124` (46 recipe axes). Visibility and outlines for these numbers were computed with the NumPy software rasteriser. All distances are in millimetres. The full numbers are in the local file `docs/media/human-benchmark/results.json`.

In short: the recipe fit brings the editable human to 5 to 7 mm from each target, about a third of the distance to the nearest other target. The surface correction brings it to 2 to 3 mm where it could see the target. It does not help on surface it could not see. Neither stage reproduces the target's face.

### Targets

| Target | Build | Role | Stature m | Chest m | Waist m | Hip m | Shoulders m | Volume l |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mhr-f1 | female-typical | development | 1.746 | 1.045 | 0.859 | 1.166 | 0.376 | 78.1 |
| mhr-f2 | female-typical | held out | 1.639 | 1.252 | 1.088 | 1.327 | 0.407 | 107.8 |
| mhr-f3 | female-typical | held out | 1.899 | 1.075 | 0.873 | 1.091 | 0.389 | 87.5 |
| mhr-m1 | male-typical | development | 1.725 | 1.124 | 0.981 | 1.023 | 0.400 | 79.7 |
| mhr-m2 | male-typical | held out | 1.689 | 1.428 | 1.395 | 1.368 | 0.420 | 127.5 |
| mhr-m3 | male-typical | held out | 1.890 | 1.113 | 0.878 | 1.176 | 0.411 | 90.6 |

The targets differ from each other by 15.8 to 35.7 mm (two-way mean distance, target against target).

### Whole body

Two-way mean distance. *Default figure* is the generator with no recipe. *Stature only* sets the height and nothing else. *Nearest other target* is the smallest distance from this target to one of the other five. A fit that scored no better than that would be no more specific than a different body.

| Target | Role | Default figure | Stature only | Recipe fit | Recipe + correction | Nearest other target |
| --- | --- | --- | --- | --- | --- | --- |
| mhr-f1 | development | 16.19 | 15.11 | 5.13 | 2.16 | 16.62 |
| mhr-f2 | held out | 31.53 | 34.15 | 6.09 | 2.65 | 17.22 |
| mhr-f3 | held out | 27.13 | 20.02 | 6.52 | 2.55 | 15.81 |
| mhr-m1 | development | 19.40 | 19.22 | 5.03 | 2.15 | 16.62 |
| mhr-m2 | held out | 35.45 | 36.87 | 7.23 | 3.10 | 17.22 |
| mhr-m3 | held out | 23.40 | 11.75 | 5.39 | 2.36 | 15.81 |
| **mean, development** |  | 17.80 | 17.16 | 5.08 | 2.16 | 16.62 |
| **mean, held out** |  | 29.38 | 25.70 | 6.31 | 2.66 | 16.52 |

- After the recipe fit, 73 to 89% of surface samples lie within 10 mm and the 95th percentile is 12 to 19 mm. After the correction, 96 to 99% lie within 10 mm and the 95th percentile is 6 to 10 mm.
- The held-out targets score 1.2 mm worse than the two the settings were chosen on. The selection rule put the two heaviest and the two tallest bodies in the held-out set, so this gap mixes two causes: settings tuned on other bodies, and bodies nearer the end of the generator's range.
- The largest single distances, 60 to 71 mm from generated surface to target, remain after both stages. On the two targets checked (`mhr-f1`, `mhr-m2`) they are the inside of the generated mouth, which can be seen between the lips and has no counterpart in the targets. After the correction fewer than 0.2% of samples lie more than 30 mm from the target, and all of them are there.

### Body parts

Mean over the six targets. *Shape alone* is the error left after that part is moved rigidly onto its counterpart.

| Part | Stature only | shape alone | Recipe fit | shape alone | Recipe + correction | shape alone |
| --- | --- | --- | --- | --- | --- | --- |
| head | 9.86 | 6.45 | 3.77 | 3.09 | 1.98 | 2.01 |
| neck | 10.76 | 6.78 | 3.60 | 2.03 | 1.78 | 1.34 |
| torso | 33.02 | 32.02 | 6.15 | 5.92 | 2.46 | 2.45 |
| upper arms | 19.86 | 9.67 | 7.27 | 4.31 | 3.42 | 2.71 |
| forearms | 16.20 | 7.68 | 4.37 | 3.61 | 1.97 | 1.79 |
| hands | 21.23 | 17.50 | 4.55 | 3.88 | 2.54 | 2.38 |
| thighs | 19.61 | 17.77 | 5.82 | 5.44 | 1.86 | 1.73 |
| shins | 17.58 | 14.73 | 6.08 | 4.27 | 2.55 | 2.16 |
| feet | 14.23 | 11.12 | 7.50 | 5.84 | 5.08 | 4.28 |
| face | 8.03 | 3.27 | 3.64 | 2.55 | 2.56 | 2.58 |

- The torso, the feet and the thighs carry the largest shape error after the recipe fit.
- The feet remain the worst part after the correction. The fitted `feet` axis stayed inside its range (−0.42 to +0.29), so the generator could have gone further. The fitter counts feet at half weight because foot posture differs between the two rigs.
- The recipe fit lowers the face's own shape error from 3.27 to 2.55 mm. The correction moves the face into place (3.64 to 2.56 mm as placed) and leaves its shape error where it was (2.58 mm).

### Tape measurements

Generated minus target, mean absolute value over the six targets.

| Candidate | Stature mm | Chest mm | Waist mm | Hip mm | Thigh mm | Calf mm | Shoulders mm | Volume l |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Stature only | 0.0 | 94.2 | 272.9 | 193.6 | 73.1 | 38.5 | 9.2 | 28.5 |
| Recipe fit | 11.6 | 29.7 | 30.4 | 10.2 | 30.2 | 5.0 | 17.5 | 0.8 |
| Recipe + correction | 14.4 | 10.3 | 7.6 | 5.2 | 4.9 | 9.1 | 14.2 | 1.4 |

Several of these errors have the same sign on every target:

- **Too short.** The recipe fit is 5 to 21 mm shorter than its target, and 10 to 25 mm after the correction.
- **Shoulders too broad**, by 3 to 28 mm after the recipe fit and 7 to 26 mm after the correction.
- **Thighs too full** after the recipe fit, by 2 to 68 mm of girth. The largest is `mhr-f3`.
- **Chest girth too small** on five of six recipe fits, by 14 to 57 mm.
- **Waist.** Too wide on the three female-typical targets (14 to 40 mm) and too narrow on the three male-typical ones (10 to 64 mm).
- **The correction shrinks the body slightly.** After it, every target is 0.9 to 1.6 litres short of volume, every calf is 7 to 11 mm too thin and the mean signed offset is −0.55 to −0.85 mm on all six.

### Seen and unseen surface

This control separates copying a surface from guessing one. Both stages are repeated seeing only the target triangles that face forward. The back-facing half is then scored. It was never shown to the fit.

Two-way mean distance on the back-facing half of each target:

| Target | Stature only | Recipe fit, front seen | Recipe + correction, front seen | Recipe fit, all seen | Recipe + correction, all seen |
| --- | --- | --- | --- | --- | --- |
| mhr-f1 | 15.78 | 8.52 | 9.85 | 4.90 | 2.09 |
| mhr-f2 | 35.14 | 7.14 | 9.11 | 5.86 | 2.57 |
| mhr-f3 | 20.10 | 8.89 | 9.10 | 6.03 | 2.35 |
| mhr-m1 | 21.66 | 7.84 | 8.07 | 5.07 | 2.04 |
| mhr-m2 | 42.29 | 10.34 | 8.15 | 7.85 | 3.11 |
| mhr-m3 | 11.31 | 9.74 | 10.25 | 5.30 | 2.19 |
| **mean** | 24.38 | 8.75 | 9.09 | 5.83 | 2.39 |

- **The recipe guesses the back.** With only the front seen it reaches 8.75 mm on the back, against 24.38 mm for stature alone and 5.83 mm when the back is seen too. The generator's knowledge of how bodies are built supplies most of the unseen half.
- **The correction does not guess.** On the back it makes five of six targets worse (9.09 mm against 8.75 mm). On the front, which it saw, it improves 5.60 mm to 3.30 mm. Its gain is direct transfer of the surface it was given.
- **It also thins the body.** The mean signed offset of the front-seen corrected body is −2.7 to −5.0 mm. Pulling the seen front onto the target drags the unseen back inward with it.

### Wrong-identity control

Each row is one recipe fit. Each column is the target it is scored against.

|  | mhr-f1 | mhr-f2 | mhr-f3 | mhr-m1 | mhr-m2 | mhr-m3 |
| --- | --- | --- | --- | --- | --- | --- |
| fit of mhr-f1 | **5.13** | 22.10 | 20.21 | 16.18 | 27.98 | 17.13 |
| fit of mhr-f2 | 21.29 | **6.09** | 25.42 | 20.62 | 17.36 | 26.94 |
| fit of mhr-f3 | 20.41 | 24.52 | **6.52** | 16.49 | 33.86 | 15.00 |
| fit of mhr-m1 | 15.85 | 21.15 | 16.55 | **5.03** | 26.85 | 20.65 |
| fit of mhr-m2 | 27.31 | 16.04 | 33.78 | 26.24 | **7.23** | 29.62 |
| fit of mhr-m3 | 18.62 | 28.65 | 15.50 | 21.70 | 32.09 | **5.39** |

Every target is closest to its own fit. The own fit averages 5.90 mm and the best wrong fit 15.99 mm, with a smallest margin of 8.98 mm. With the correction the own fit averages 2.49 mm, the best wrong fit 16.34 mm and the smallest margin is 12.82 mm. A fit scored against a wrong target lands within 2 mm of the distance between the two targets themselves, so each fit carries the build of its own target.

### Controls on the method

| Known disturbance of one target | Two-way mean | 95th percentile | Signed offset | Recovered turn ° |
| --- | --- | --- | --- | --- |
| Identical surface, new samples | 0.00 | 0.00 | 0.00 | 0.00 |
| Inflated 5 mm along its normals | 4.95 | 7.65 | 4.91 | 0.68 |
| Turned 4° and moved 36 mm | 0.02 | 0.05 | 0.00 | −3.99 |
| Scaled to 103% | 5.30 | 12.65 | 3.73 | 0.08 |

The comparison reports a 5 mm offset as 4.95 mm, removes a pure change of placement and does not hide a change of size.

| Recipe drawn at random, then fitted | Before | After | Mean axis error | Worst axis error |
| --- | --- | --- | --- | --- |
| Seed 5 | 13.59 | 0.33 | 5.7% of range | 21.7% of range, `jaw` |
| Seed 6 | 8.52 | 1.08 | 7.2% of range | 32.3% of range, `muscle` |

When the target is a body the generator made itself, the fit recovers its surface to 0.3 and 1.1 mm. It does not recover every axis value. Different axis values can give nearly the same surface.

### The fitted recipes

| Target | `height` | `frame` | `age` | `weight` | `muscle` | `shoulders` | `chest` | `bust` | `waist` | `hips` | `belly` | `legs` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mhr-f1 | 1.73 | −0.41 | 0.25 | 0.30 | −0.96 | 0.49 | 0.37 | 0.78 | −0.41 | 0.46 | 0.48 | 0.22 |
| mhr-f2 | 1.62 | −0.12 | 0.00 | 0.90 | −1.00 | 0.72 | 0.30 | 1.00 | 0.15 | 0.19 | 0.13 | 0.00 |
| mhr-f3 | 1.87 | −0.75 | 0.21 | 0.52 | −0.88 | 0.62 | 0.45 | 0.54 | −0.42 | −1.00 | 0.03 | 0.07 |
| mhr-m1 | 1.71 | −0.13 | 0.02 | 0.53 | −1.00 | 1.00 | 0.57 | 0.58 | 0.08 | −1.00 | −0.08 | 0.12 |
| mhr-m2 | 1.68 | 0.36 | 0.21 | 1.00 | −1.00 | 0.38 | 1.00 | 0.95 | 1.00 | 0.25 | −0.25 | 0.39 |
| mhr-m3 | 1.89 | −0.21 | 0.00 | 0.67 | −0.58 | 0.43 | −0.39 | −1.00 | −0.69 | 0.20 | −0.25 | 0.31 |

| Target | Axes at the end of their range |
| --- | --- |
| mhr-f1 | `torsoLength` |
| mhr-f2 | `age`, `muscle`, `torsoLength`, `bust` |
| mhr-f3 | `hips`, `shinLength` |
| mhr-m1 | `muscle`, `shoulders`, `hips`, `upperArmLength`, `shinLength` |
| mhr-m2 | `weight`, `muscle`, `waist`, `chest`, `upperArmLength`, `torsoLength`, `neckLength` |
| mhr-m3 | `age`, `bust` |

- **The values do not describe the body.** `muscle` sits at or near its minimum on five targets and at −0.58 on the sixth. `frame` is on the female side for two of the three male-typical builds. The fit uses these axes as general-purpose shape handles. Read a fitted recipe as a set of numbers that makes the right surface, and no more.
- **The heaviest body is out of range.** `mhr-m2` (127.5 litres) needs `weight`, `chest` and `waist` at their maximum and still has the largest torso error of the set, 9.0 mm.

Each recipe fit takes 87 to 122 seconds and 2,500 to 3,700 generator evaluations. The correction takes about a second and moves all 1,045 of its control points.

### Later generator version and the gentler head correction

The generator changed after the fits were made: a different chest response, ten further axes and a head correction that keeps neighbouring control points moving together. The six recipes were not fitted again. `replay.py` scored them once more with generator version `e44758764fef` (56 axes), with the saved correction and with a correction made by the newer tool.

| Target | Recipe fit, as fitted | on the later version | Saved correction, as fitted | on the later version | Correction made by the later tool |
| --- | --- | --- | --- | --- | --- |
| mhr-f1 | 5.13 | 5.32 | 2.16 | 2.38 | 2.23 |
| mhr-f2 | 6.09 | 6.23 | 2.65 | 2.95 | 2.71 |
| mhr-f3 | 6.52 | 6.65 | 2.55 | 2.78 | 2.62 |
| mhr-m1 | 5.03 | 5.22 | 2.15 | 2.41 | 2.16 |
| mhr-m2 | 7.23 | 7.07 | 3.10 | 3.25 | 3.08 |
| mhr-m3 | 5.39 | 5.24 | 2.36 | 2.74 | 2.39 |
| **mean** | 5.90 | 5.96 | 2.49 | 2.75 | 2.53 |

The recipes carry over: no recipe fit moves by more than 0.2 mm, and the torso moves by −0.7 to +0.5 mm. A saved correction is tied to the version it was made on and loses 0.15 to 0.4 mm. Made again, it is back at the recorded level.

The surface correction can turn triangles inside out, which shows as creases and tears. Counted on the later version against the uncorrected surface, among triangles larger than 0.25 mm² (the saved correction turned the same number of head triangles on the version it was made for):

| Target | Head, saved correction | Head, later tool | Rest of body, saved | Rest of body, later tool |
| --- | --- | --- | --- | --- |
| mhr-f1 | 189 of 8,364 | 0 | 3 of 18,572 | 2 |
| mhr-f2 | 217 of 8,393 | 0 | 6 of 18,567 | 5 |
| mhr-f3 | 238 of 8,460 | 0 | 13 of 18,488 | 13 |
| mhr-m1 | 229 of 8,420 | 0 | 7 of 18,512 | 7 |
| mhr-m2 | 174 of 8,378 | 0 | 11 of 18,573 | 12 |
| mhr-m3 | 158 of 8,447 | 0 | 9 of 18,505 | 9 |

When only the front was seen, the saved correction also turned 8 to 90 triangles on the rest of the body.

What the gentler head correction costs, mean over the six targets:

| Measure | Recipe fit | Saved correction | Later tool |
| --- | --- | --- | --- |
| Face, as placed | 3.63 | 2.61 | 2.82 |
| Head, shape alone | 3.07 | 2.01 | 2.17 |
| Face, shape alone | 2.54 | 2.59 | 2.71 |
| Whole body | 5.96 | 2.75 | 2.53 |

The later tool removes every inside-out triangle on the head for 0.2 mm of head and face error, and it is the better of the two on the whole body. A few triangles still turn on the rest of the body (2 to 13 per target). Neither correction lowers the face's own shape error.

### Failures that show

These were read from the local comparison sheets in `docs/media/human-benchmark/`, which are not published.

1. **One face for six people.** Every recipe fit has the same generic face. Head size and proportions follow the target. Nose, mouth, brow and eye sockets do not.
2. **Torn faces with the first correction.** Eyelids crease, lips split and the wings of the nose separate on all six. `mhr-m2` has a loose sliver under the jaw. The later tool removes this.
3. **Heavy builds stay smooth.** On `mhr-f2` and `mhr-m2` the fold under the chest and the overhang of the belly are missing. The generated torso is a smooth barrel, about 20 mm short of the target at the lower chest and belly and too full at the upper chest and shoulders.
4. **Thighs too full** on the tall, slim `mhr-f3`.
5. **Feet.** Smaller than the target on all six, also after the correction.
6. **Unseen backs.** Fitted from the front only, the upper back is too thin and the seat and calves too full. The correction then pulls the back of the legs inward.
7. **A navel.** The generated figure has one and the targets are smooth there, which adds a small local error at the belly.

### What this suggests

- **Use the recipe fit to guess and the correction to copy.** Where a reference shows only part of a body, the recipe fit is the only stage that helps on the rest. Limit the correction to the surface that was seen.
- **Faces need their own stage.** The body axes and the present correction place the head and leave its features generic.
- **Extend the heavy end of the range**, with a shape for the belly overhang and the fold under the chest.
- **Look at the correction's inward bias** of about 0.7 mm and the consistent loss of stature.
- **Do not show fitted `frame` and `muscle` values as a description of a person.**

## What is compared

**Targets.** Six meshes come from the official [Momentum Human Rig v1.0.1](https://github.com/facebookresearch/MHR/releases/tag/v1.0.1) model file, `assets/mhr_model.pt`. Each is one identity of that model: 45 identity coefficients drawn as the release's own `demo.py` draws them, plus eleven skeleton proportion parameters drawn inside 60% of their official limits. They are sampled identities of a body model. They are not scans of individual people. The meshes and their manifest, `examples/human-targets/`, are [local reference material](local-references.md) and are not in the repository.

**Selection.** A fixed seed (20261123) draws 400 identities. The second identity coefficient moves the surface between a male-typical and a female-typical build, so it splits the draw into two pools (41 and 132 candidates). From each pool the script takes the candidate nearest the median stature and mass, then twice the candidate farthest from those already taken. The build writes the chosen coefficients, proportions and poses to `scripts/human-benchmark/target-identities.json`, a local file that later builds reuse, and to the local manifest. The grouping describes body build. The model has no sex or gender label, and head shape was drawn independently of the body.

**Pose.** The model's joints are turned until the limbs point the same way as the editable human's rest pose ([convention](../scripts/human-benchmark/pose-convention.json)). Limb directions end within 2.1° of the convention. Segment lengths, joint positions and the surface stay those of the target identity.

**Candidates.** `evaluateHuman(recipe, humanFit)` in `character-view/human-surface.js` is called through a small Node bridge and treated as a black box. A run first copies the generator's files, so every number in one run belongs to one generator version. That version's hash is written into the results.

## How the distance is measured

The comparison code never sees a recipe. It receives two triangle meshes.

1. **Outside surface only.** Each mesh is rendered from 46 directions. Triangles that never win the depth test, such as the inside of the mouth, are ignored on both sides.
2. **Uniform samples.** 60,000 points are drawn on each outside surface, uniformly by area, with fixed seeds that differ from the seeds the fitter uses.
3. **Placement.** The candidate may turn about the vertical axis and translate until it lies best on the target. It may not scale, lean or bend. A candidate of the wrong size or proportions keeps its error.
4. **Both directions.** Every generated sample is measured to its exact closest point on the target's triangles, and every target sample to the generated triangles. The first direction finds generated surface with nothing behind it. The second finds target surface the generator failed to cover. *Two-way mean distance* is the average of the two means, in millimetres.
5. **Further measures.** 95th percentile and maximum per direction, the share of samples within 5 and 10 mm (F-score), the angle between surface normals, the mean signed offset (positive: the generated body is fuller), outline overlap from the front and the side, and tape-style girths from horizontal slices.
6. **Body parts.** The target's skin weights label nine parts. Each part is scored as placed, and again after that part alone is moved rigidly onto its counterpart. The second number is the part's shape error with pose and joint position taken out. The face is the forward-facing part of the head.

[Unit tests](../scripts/human-benchmark/test_human_benchmark.py) check the distance code against exhaustive search, the visibility test against a nested sphere, and the reported numbers against known offsets.

## How the recipe is fitted

[The fitter](../scripts/human-benchmark/hb_fit.py) changes only values the editor exposes: every recipe axis within its legal range, plus a rigid placement. It estimates the effect of each axis by evaluating the generator slightly below and above the current value. Each round pairs generator vertices with their closest target points and target samples with their closest generator points, solves a bounded least-squares step and keeps it only if the robust two-way distance falls. It starts once from a female and once from a male frame and keeps the better result. Hands, feet and forearms count less because their pose differs between the two rigs. The head counts double.

The second stage is the editor's own bounded surface correction, `fitHumanReference` in `character-view/human-fit.js`. It moves control points along the surface towards the reference and stores the offsets as `humanFit`. The benchmark calls it once on top of each fitted recipe and scores the two stages separately.

The fitter's settings were chosen on `mhr-f1` and `mhr-m1` and then left unchanged. The other four targets were fitted once with those settings.

## Reproduce

1. Run `npm ci`. Install Python 3.12 with `numpy`, `scipy`, `opencv-python`, `pillow`, `moderngl` and CPU `torch`.
2. Build the targets where `examples/human-targets/` is not installed. Run `node scripts/local-references.mjs --fetch`, which downloads the release archive to `.reference-cache/mhr/assets.zip` and checks SHA-256 `e4f4f205cd87c0fa106577ba1de4fc763e4eb197c924461d2ef7e6944e9d6b94`. Then run `python scripts/human-benchmark/build-targets.py .reference-cache/mhr`. The first build runs the seeded selection and keeps the chosen parameters in the local `target-identities.json`. Later builds reuse that file, and `--select` repeats the selection. The manifest it writes records each target's hash. On the machine that made these results, a repeated selection and a rebuild from the kept parameters both gave the same six files, byte for byte. Another `torch` build may round differently.
3. Run `python scripts/human-benchmark/test_human_benchmark.py`.
4. Run `python scripts/human-benchmark/run.py .reference-cache/human-benchmark`. It writes the results to `docs/media/human-benchmark/results.json` and one fitted recipe file per target to `examples/human-targets-fits/`. On 16 cores the six targets take about 20 minutes when run in three processes with `--fits-only --keep-snapshot --targets`. One run without `--fits-only` then adds the wrong-identity matrix and the controls, about 30 minutes more.
5. Run `python scripts/human-benchmark/report.py .reference-cache/human-benchmark` for the pictures and `python scripts/human-benchmark/tables.py` for the tables.
6. After the generator has changed, run `python scripts/human-benchmark/replay.py`. It scores the saved recipes with the current generator and correction tool without fitting again, and `tables.py` then prints both sets side by side.

The scripts draw depth images to decide which triangles are outside surface and to compare outlines. They use the graphics card through `moderngl` when one is available and a NumPy rasteriser when not. Each results file records which one was used, and cached fits are kept apart by renderer. The numbers on this page were measured with the NumPy rasteriser, and the local comparison sheets described above were drawn with it.

## Sources and licenses

| Material | Origin | License |
| --- | --- | --- |
| Target meshes, region labels and joint names in `examples/human-targets/` and `scripts/human-benchmark/mhr-joints.json` | Derived from [MHR v1.0.1](https://github.com/facebookresearch/MHR/releases/tag/v1.0.1) by Meta Platforms, Inc. and affiliates. Changes: one sampled identity per file, posed, converted to metres, exported without rig, blend shapes or textures. | [Apache-2.0](licenses/mhr-apache-2.0.txt). The release has no NOTICE file. Each GLB repeats the attribution in `asset.copyright`. |
| Fitted recipes and surface corrections in `examples/human-targets-fits/` | Measured from those targets with the editable human. | Apache-2.0, as derived measurements. |
| Pose convention | Joint centres of the editable human's rest pose, from MakeHuman assets distributed with [Anny](https://github.com/naver/anny). | [CC0](licenses/makehuman-cc0.md) |
| Benchmark code and pictures | This repository. The pictures show the derived targets and generated bodies. | MIT for the code. The pictures of targets remain Apache-2.0 derived works. |

The MHR model file, the derived targets, their fits and the pictures are not redistributed here. They stay on the machine that built them. The benchmark needs the model file only to rebuild the targets.
