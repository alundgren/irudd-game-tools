# Visual targets for the 3D workshop

The [quality handoff](creator-quality-handoff.md) continues this record through the round 15 freeze, with independent scores, controlled experiments and an editable build to test.

The six studies use the same generator to test portrait shape, creature anatomy and clothing. Private comparisons used community-made characters in commercial games. The results below describe the workshop models. Open **Forms → Reference studies** to inspect their editable parts.

| Workshop study | What to inspect |
| --- | --- |
| Scarred ranger | A long, angular face, asymmetric scar, silver hair drawn back from the face, and worn equipment that follows a tall frame. Check the brow and nose projection from the side. |
| Dock surveyor | A shorter, broader adult with a projecting belly, soft jaw, receding hair and glasses. Check whether the body still differs after hiding the glasses and hair. |
| Marsh trader | Four individually editable arms, distinct hands, a long face and trader’s garb. Both pairs of hands should be readable around the outfit in three-quarter view. |
| Ridgeback porter | Heavy forward-set head, plated back, repeated shoulder armor and weight-bearing limbs. Count distinct plates in the rear view and inspect their overlap. |
| Estuary elder | Broad adult, lilac skin, swept silver hair and a long dark garment with visible drape and a flared hem. Inspect the difference between the garment’s volume and the body inside it. |
| Relay runner | A compact dark bob, lean athletic frame, fitted dark top, pale trousers and warm-colored shoes. Test the balance of body shape, fabric and recognizable color blocks at gameplay distance. |

[Inspect the original 3D results in color, clay and silhouette](workshop-results.html).

The reef cartographer tests whether a hooked tail and thin fins remain distinct during an orbit. [3D result and first-fit comparison](workshop-results.html).

Free body plans have their own record. [Creature body plans](creature-body-plans.md) covers the spine-and-limb-group editor, multi-limb posing, a held-out community design with its failures, and an estimate of the gap to the reference creator.

The [festival conductor trial](workshop-results.html#festival-conductor) combines these three challenges in one exported character. [Editable form](../examples/festival-conductor.form.json) · [Game model](../examples/festival-conductor.glb).

## Independent visual review, 23 November 2026

A reviewer examined six consecutive adult draws (body seeds 8710–8715), creature draws, curated studies and original game screenshots. The best private comparison models anchor 95. The reviewer gave consecutive draws roughly 60% weight and curated work 40%. These are judgments of what came out of the editor on that build.

| Reference group | Visual quality | Visible diversity | Biggest observed gap |
| --- | ---: | ---: | --- |
| Realistic adults | 27 | 40 | Faces share a resting mouth shape. Hairlines and eyelids break down in close-up and game export. |
| Stylized adults | 34 | 42 | Outfit silhouettes differ. Rounded collars, smooth cloth and similar facial expressions recur. |
| Creatures | 52 | 58 | The eleven body plans span very different animals. Wings, leg spacing and layered detailing limit the finish. |
| Equal-weight mean | **37.7** | **46.7** | Target for each column is 80. |

The reviewer estimated roughly eight points of uncertainty per cell. The creature reference images were thumbnails. The review used still frames. The table predates the subsequent work on face fitting, grooms, cloth and wings. A fresh blind review on the same draws and unseen seeds is needed to measure a change.

For the six adult draws, open the editor with `#adult=SEED&look=LOOK`. The look seed in this test is the unsigned integer result of `SEED ^ 0x1e18ae83`. [Open the first draw in a built workshop](../dist/character-view.html#adult=8710&look=504925317).

### Follow-up review

The same reviewer compared ten newer sheets with the same originals and weighting. The sheets included editor portraits, reloaded game exports and twelve consecutive creature draws. The sheets came from several builds. Iris colour was missing on one sheet, the suit was absent from the clothing comparison, and several export profiles were poorly framed. The reviewer discounted these views.

| Reference group | Visual quality | Visible diversity | What changed in the pictures |
| --- | ---: | ---: | --- |
| Realistic adults | 30 | 44 | The fringe cleared the eyes and the beard read at mid distance. Two profiles still had projecting lips and several hairlines had hard edges. |
| Stylized adults | 38 | 46 | Knit patterns, trim and colour blocks survived export. Collars still looked tubular and the parka broke up at the hands and boots. |
| Creatures | 54 | 66 | Wings, gills and overlapping plates made more body plans readable. Several random animals had crowded legs, and the winners' equipment remained out of reach. |
| Equal-weight mean | **40.7** | **52.0** | The combined score moved from 42 to 46, within the reviewer’s estimated uncertainty of six points. |

The scores use the strongest private comparison models as 95. Geometry distance, test counts and the number of available controls do not enter these ratings.

### Frozen editor and game exports

A third assessment used the same editor and player build for seeds 8710–8715 and six previously unseen draws, 8734–8739. Every adult was saved from the editor, exported at game detail and reopened in the standalone player. The reviewer also inspected twelve unselected creature silhouettes and a separate curated equipment sheet. The weighting and reference creations stayed the same.

| Benchmark | Visual quality | Visible diversity |
| --- | ---: | ---: |
| Realistic adults | 32 | 49 |
| Stylized adults | 41 | 49 |
| Creatures | 56 | 68 |
| Equal-weight mean | **43.0** | **55.3** |

The reviewer judged eleven resting mouths neutral or pleasant. Smile and Blink worked on all twelve exported heads. Five adult exports showed broken hair outlines or stray cards. At gameplay distance the reviewer could read clothing cuts and patterns, including the unseen plaid dress, but saw repeating suits and two ragged collars. Packs, instruments and dispatch bags added visible creature roles. Several silhouettes still had crowded limbs. Overall the reviewer estimated 49 ± 5 points, up from 46 on mixed-build evidence. Eyewear and later fitting changes postdate this assessment.

### Eighteen exported adults and twelve creature draws

A fourth reviewer compared eighteen adult game exports with the private references, including the fresh seeds 8806–8811. The reviewer also saw the twelve creature draws, equipment and coat sheets, and curated armour and portrait examples. The strongest reference models remained the 95-point anchors. Unpicked draws contributed 60% and curated examples 40%.

| Benchmark | Visual quality | Visible diversity |
| --- | ---: | ---: |
| Realistic adults | 32 | 50 |
| Stylized adults | 42 | 51 |
| Creatures | 58 | 70 |
| Equal-weight mean | **44** | **57** |

All eighteen resting mouths, smiles and blinks read correctly. Hair remained the most frequent visible defect. Even where the reduced mesh preserved the full-detail silhouette, temple edges, dark patches and floating strands were visible in the player. The reviewer also identified smooth skin, similar expressions and ragged collars. Creature silhouettes were readable at thumbnail size, with repeated decorative parts limiting variety. The reviewer saw the earlier scores, assessed stills and estimated about five points of uncertainty overall. The differences from the previous assessment fall inside that uncertainty.

### Two joined export reviews

Both reviews used a 100-point scale with the private comparison models at 95. Unselected draws
contributed 60% and curated work 40%. The two averages below give each game equal weight.

| Benchmark | First joined quality | Second joined quality | First joined diversity | Second joined diversity |
| --- | ---: | ---: | ---: | ---: |
| Realistic adults | 39.2 | 47.2 | 63.6 | 67.2 |
| Stylized adults | 46.8 | 51.8 | 67.6 | 68.2 |
| Creatures | 68.4 | 58.6 | 81.6 | 78.4 |
| Mean | 51.5 | **52.5** | 70.9 | **71.3** |

The first build combined a new signed complexion image with an older decoder. All 28 adult
faces had a visible boundary at the jaw. The second build carried the skin colour through to
the neck. Its reviewer inspected 28 adults and 40 creatures, including 12 fresh random draws
of each. The second reviewer scored creature finish lower, citing smooth hide, straight legs
and stiff clothing. Hair collapse, the narrow strip of teeth in smiles, and 12 consecutive
long-trouser looks limited the adult scores. Each round used a different reviewer.

### Third joined export review

A fresh reviewer scored 28 adult and 40 creature game exports against the same originals.
The unselected sets include fixed seeds 14110 to 14121 for both generators, fresh adults
42710 to 42721 and fresh creatures 47210 to 47221. Four costume studies and all 16 creature
presets make up the curated sets.

| Benchmark | Quality | Visible diversity |
| --- | ---: | ---: |
| Realistic adults | 56.0 | 74.8 |
| Stylized adults | 66.4 | 79.4 |
| Creatures | 70.2 | 84.0 |
| Equal-weight mean | **64.2** | **79.4** |

The reviewer recognised the dock assessor and tidal contralto across angles. Four ordinary
adults shared a fringe and three creatures shared a strider silhouette. One trouser pocket
on 42719 followed the hand during Reach. The reviewer inspected the player sheets, including
sampled poses, and estimated uncertainty of about four points on the means. The source
snapshot and both player bundles were verified before and after capture.

### Fourth and fifth joined export reviews

Each round used the same anchors and weighting, 12 fixed and 12 newly drawn adults and creatures each,
four curated adults, and 16 creature presets. A different reviewer scored each round.

| Benchmark | Round 4 quality | Round 5 quality | Round 4 diversity | Round 5 diversity |
| --- | ---: | ---: | ---: | ---: |
| Realistic adults | 63.2 | 32.6 | 81.3 | 64.8 |
| Stylized adults | 73.7 | 42.8 | 84.3 | 65.4 |
| Creatures | 79.8 | 64.7 | 89.4 | 75.7 |
| Mean | 72.2 | 46.7 | 85.0 | 68.6 |

The fifth reviewer then compared the two builds directly. The fixed characters and curated adults
were paired at the same camera angle, with the presentation order randomized per character.
Seven favoured round 4, seven favoured round 5, and 14 tied. Stepped long hair lost all three
comparisons where it replaced wavy hair cards. Stronger brows helped individual faces and trim
helped three dressed creatures. The reviewer had already seen the round 5 exports. The absolute
scores also include different fresh draws, so the table alone cannot measure the effect of a code change.

## Sixth frozen build

Two reviewers independently scored the same 68 game exports. Each saw 24 unselected adults, four
designed adults, 24 unselected creatures and all 16 creature presets. The actor and creature seeds,
camera positions and weighting were fixed before capture. Scores in each cell are quality / diversity.

| Reviewer | Realistic adults | Stylized adults | Creatures | Equal mean |
| --- | ---: | ---: | ---: | ---: |
| First | 56.65 / 76.30 | 61.60 / 78.95 | 80.05 / 88.85 | 66.10 / 81.37 |
| Second | 54.25 / 78.10 | 58.50 / 80.10 | 74.97 / 86.90 | 62.57 / 81.70 |

Both reviewers found the silhouettes and clothing combinations varied. Each saw hard hairlines,
patches in beards, waxy skin and too little distinction between creature hide, shell and metal.
They judged from stills. Their stated uncertainty was about four to five points, and the small
reference images made creature scores particularly uncertain.

## Seventh frozen build

Two independent reviewers judged 68 game exports using the same weights and reference games.
Each cell gives visual quality / visible diversity on the 100-point scale.

| Reviewer | Realistic adults | Stylized adults | Creatures | Equal mean |
| --- | ---: | ---: | ---: | ---: |
| First | 49.70 / 83.70 | 63.80 / 83.50 | 80.35 / 90.00 | 64.62 / 85.73 |
| Second | 53.60 / 82.40 | 60.40 / 83.40 | 78.90 / 90.30 | 64.30 / 85.40 |

Both reviewers singled out hair and beards. They saw leaf-shaped curls, gaps in long hair and
hard beard edges at portrait distance. Both identified the collapsed cheeks on adult 239410.
They found the creature silhouettes varied and the coats often limited to two visible tones.
The reviewers estimated uncertainty of roughly three to five points on the overall results.
The body sheets fit each figure to its frame, limiting stature comparisons. The sampled poses
also give little evidence about the timing of a walk.

## How to judge a build

1. Orbit each original study in color and silhouette. Keep a world-scale lineup for comparisons of stature. Use matched screen height separately when comparing facial structure and outfit shape.
2. Change one local feature on each study and save the form. Reopen it and verify the accepted geometry and material choices.
3. Ask for one structural change that crosses the starting anatomy. Inspect the new parts in a rear and side view. Accept it, nudge the new part and undo the nudge.
4. Export a GLB, open it in a separate Three.js scene, and check geometry, materials, orientations and real dimensions.

These six examples test selected capabilities. An indistinguishable likeness, deforming outfits in motion and independent human recognition are separate claims that require their own evidence.
