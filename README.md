# irudd-game-tools

MIT-licensed tools for making games. The first tool is a 3D character workshop built with Three.js. Start with one form and keep changing it. A human, a four-armed trader and a low gliding animal use the same editable parts.

![Six original characters from the workshop on a shared floor at the same world scale](docs/media/standing-scale.webp)

[Browse the six benchmark creations and their authors](docs/creator-benchmarks.md) · [3D results and comparisons](docs/workshop-results.html) · [Experiment plan, including the later 2D character sheet](docs/character-creator.html)

## Run it

With Node.js 22 or later, run `npm ci` and `npm start`. Open the localhost URL in the terminal. **Generate variation** asks for a geometry edit. **Generate painted variation** creates new four-view artwork and fits it as editable 3D. Both use the installed, signed-in Codex CLI. Painted generation also requires its image generation tool. The browser submits the current geometry, two rendered views, any pending nudges, a random design direction and your instructions. Inspect the result from several angles before accepting it.

For offline use, run `npm run build` and open `dist/character-view.html` in a WebGL 2 browser. **Export AI request** and **Load proposal** let an external agent perform the same exchange through JSON. The separate `dist/play-model.html` player opens exported GLBs and measures their animation in a clean Three.js scene.

## Make a character

1. Choose **Forms → New form** or inspect a reference study. Choose a body plan, then regenerate from a new random seed. Graft components between forms, including your own saved JSON donors.
2. Use **Sculpt** for relative nudges. A change applies to the current shape, then the slider returns to neutral. Select a head for facial controls and **Style hair** for strand length, sweep, curls and a gathered tail, use **Edit on model** for direct manipulation, or **Pull surface** to drag any point with a soft radius. Mirror is optional. **Draw appendage** grows a tapered horn, fin, tail or walking limb from the surface in the direction you drag. Use **Join organic surfaces** to blend connected body volumes and keep their joints. On a sweep, **Cloth** nudges the hem opening, slit height and folds.
3. Use **AI direction** for structural changes. Type what matters, keep selected shapes and pin either cue, and redraw the other. In **Your random choices**, enter a line such as `Locomotion = wade | glide | burrow`. The software draws among your options before calling the agent. **Replay a direction** restores the cues, choice groups, pins and magnitude. Save the accepted form to reproduce its exact geometry. The agent can add limbs, change the spine, graft painted components or reshape existing regions. For a protected body, select a region and choose **Fit a garment to this part** to generate a wearable for its current outfit.
4. Switch between a practical base layer, work clothes and a pressure suit. Test the silhouette, check stature with **World scale**, and preview Idle, Walk, Crouch and Reach. Human portrait heads can blink, smile and raise their brows in both the editor and the exported GLB.
5. Save editable JSON or export a GLB with materials, skin and embedded animations. Choose **Game** for a shared texture atlas and a mesh target of 24,000 triangles. Browser storage retains a working copy. Saving a form explicitly gives you a portable revision with its imported artwork.

**Forms → Trace a volume** accepts a square two-by-two turnaround on magenta or transparency. Place front and profile-left views on the top row, back and profile-right on the bottom row. Enter the standing height in metres. For a hooked tail, mark matching root-to-tip points using **Curved centreline**. For a thin fin, use the membrane option matching its direction in the two views. Draw corresponding regions in front and profile, or try **Fit whole biped** with a separated, upright A-pose.

## How the comparisons work

Six praised community creations from Dragon’s Dogma 2, Spore and The Sims 4 supplied design goals. Each has a procedural and a painted study. The two live AI anatomy trials are also editable in the workshop. Two held-out painted trials can be opened with **Forms → Open form**: a [four-legged lantern grazer](examples/lantern-grazer.form.json) and a [feline harbour worker](examples/feline-worker.form.json). An [aquatic reef cartographer](examples/reef-cartographer.form.json) shows editable fin membranes and a tail built from paired landmarks. A third outfit trial contains an independently fitted [rescue vest](examples/rescue-vest.form.json). The [benchmark gallery](docs/workshop-results.html) distinguishes authored studies, live proposals, shape recognition and game playback.

Run `npm test` for local checks. To regenerate the benchmark screenshots, build the pages and run `python scripts/capture-studies.py` with Chrome, Playwright, Pillow and NumPy installed. The capture script drives the editor’s public controls.

## Artwork and license

The source models, surface patterns, garments, head portraits and four-view artwork are original to this project. The raster artwork was created with OpenAI’s image generation tool. It is distributed here under the [MIT license](LICENSE). Community artwork remains at the linked sources. Three.js provides rendering and glTF import/export under MIT. The standalone builds embed license notices for Three.js and meshoptimizer.
