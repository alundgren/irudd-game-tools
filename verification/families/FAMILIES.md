# Porting a character family

This is the handoff contract for anyone adding a family to G4a. A family is
typed document data in `@irudd/document`, a builder in `@irudd/character` and
a preparation rule in `verification/families`. The corpus is G0's 60 forms ×
4 presets (245 frozen exports with the extras G0 recorded).

## The pieces

1. **Feature.** Add a schema in `packages/document/src/families/<family>.ts`
   with `family({id, version, scope, schema, toJson})` and list its
   `definition` in `familyFeatures`. Bound every number by the legacy
   editor's own limits. Builders read payloads only through `family.read`,
   never as raw JSON. Bump the version with an upgrade codec when a payload's
   meaning changes after it has been committed.
2. **Preparation.** In `src/prepare.ts`, move the legacy field out of
   `unsupported` by adding it to `handledPartFields` or `handledFormFields`
   and writing the typed payload. Resolve legacy inference (roles from
   names, defaults) once here so the document stores explicit values.
3. **Builder.** Decode the payload into `BuildView` (`packages/character/src/view.ts`)
   and build from the typed view. Name and order nodes as the legacy builder
   does, since the comparison is structural.
4. **Fixture.** `node --import ../../packages/document/test/support/register.ts src/prepare.ts NAME`
   then `node node_modules/vite-plus/bin/vp fmt verification/families/fixtures`.
   A form that prepares without a checked-in fixture fails the gate.

## Geometry rules every family follows

- A part's position and rotation are in its parent's **child basis**.
  The core basis is a rigid metric frame. `figure.assembly` declares the
  legacy scaled basis: `size`, or `size / frameSize`. Another feature that
  changes how children attach declares `childBasis(value, size)`; at most one
  per part.
- `partPlacements(doc, registry)` is the one placement. A builder's
  `matrixWorld` for every part's node and mount must equal it
  (`test/frames.test.ts`, tolerance 1e-12). Use it, `worldDeltaInParent` and
  `reattachInPlace` for picks, drags and re-parenting instead of composing
  frames by hand. Nested rotation under a non-uniform basis shears, as G0 does.
- Placements are the rest placement. A document-level deformation applied
  after it, such as the `figure.build` warp, moves each pivot to the warped
  rest pivot and leaves rotation and scale alone; the builder exposes it as
  `BuiltCharacter.warp`. Picks and drags on a warped body resolve against the
  rest placement, so a drag of `d` moves the built pivot by about `d`, exactly
  only where the warp is locally a translation.
- A joined part (`figure.join`) is seated after the build warp: its root
  patch (listed cage faces, a sweep end or its whole path, or a scute base)
  moves `depth` metres inside the parent's surface and takes the parent's
  joint ownership, blending out over the rest of the part and its children.
  The view refuses a join that names a patch the part's geometry lacks.
  Cage faces are matched through the subdivided cage geometry; a warp that
  rebuilds the geometry drops them, exactly as G0's does.
- A face (`figure.anatomy` face) is a denser sweep sculpted against the
  portrait landmarks of its paint binding (`portrait` on `figure.paint`). It
  bakes from a sculpted rest, gains eyelids and Blink, Smile and BrowLift
  targets when skinned, and exports as its own skinned mesh with a blink in
  Idle. Landmarks on any other part are refused, except a source hair layer.
- A portrait depth (`figure.portrait-depth`) refines a painted sweep's traced
  front by up to 24 paired depth pins, and a traced face spanning most of its
  binding by a fitted 144 × 160 grayscale depth field blended in by `mix`.
  The bake's rest takes the same depth, so the texture stays registered.
- A hair cap (`figure.hair-cap`) separates the hair painted on a traced face
  by its 128 × 96 mask and relief: the head recedes beneath a removable
  "Source hairstyle" shell, whose scalp the textured presets paint in the
  cap's `scalp` colour under the hairline. A groomed face sheds the shell. A
  `sourceOnly` cap sits on a swept hair layer of the same trace instead: that
  part keeps only the lined hair, seated on the head sweep it lies over.
  Capped parts grow no fibres.
- A plate field (`figure.plate-field`) on a carrier sweep records how its horn
  plates were grown, and the carrier's rest shape at the time. Each plate is a
  cage under the carrier at its own site (`figure.plate-site`); the view
  refuses a site outside the field or shared with another plate. A horn cage
  with the grown plate layout takes its `figure.horn-swatch` tile of the
  horn sheet at the textured presets, its UVs following the plate's ridges
  and its tone by vertex, darker underneath. On a tail or axial spine carrier
  a game build keeps every ring of the carrier and each plate's socket.
- A classic figure's seams (`figure.seam`) join its sweeps layer by layer:
  the skin (`figure`), its `top` and `bottom` garments and each bare foot
  with its toes, at most 48 regions a group. Each group is joined before the
  blended skin and keeps its parts' own materials; its parts own their
  patches, so joint weights blend across them. A seamed sweep builds with 64
  sides, level sections when drawn straight up, and its joined legs follow
  their knee and ankle pivots; the seat binds the joined torso, both thighs
  and the bottom garments on them across three bones. A pressure suit leaves
  the skin unjoined. A foot section (`figure.foot`) flattens a sweep
  underneath (`bare`, `upper`) or all round (`sole`); a bare foot of four or
  more knots ends at the ball where a toe of its group shows and no refit
  applies. Surface pulls (`figure.pulls`, up to 64) move the meshes a part
  owns in its own frame, before it is placed, and recompute their normals.
  A build warp measures built-in pieces and hands by G0's rest boxes.
- A held part (`motion.hold`) keeps its authored rest pose under the
  generated movements: a held upper arm gets no shoulder or elbow motion, and
  the hand it carries keeps its fingers through Reach.
- A fitted garment (`outfit.fit`) is eased outside its parent and any garment
  fitted on it before, after building and before skins join.
- A mantle (`figure.mantle`) replaces its part's primitive with one sewn,
  two-sided panel of its cut (cape, poncho or tabard). Fitted, its sides take
  movement from the arms it covers; open sides and armholes leave the arms
  through. Clay drops the trim and lining colours. A skirt cut follows its
  outline from the waist to the hem with folds, pleats, tiers and a train; its
  fit keeps the fold relief, sews the waist and clears the legs, and it hangs
  from a 13 × 12 grid of cloth joints whose motion each clip bakes from the
  legs, so a game needs no cloth runtime.
- A groom (`figure.groom`) grows a cap from the scalp's own bounds and three
  strand layers in its pattern (locks, side part, coils, braids or locs) from
  a seeded sequence, so the same groom always gives the same strands. The cap
  and strands take the `scalp` and `strands` finishes at the textured presets.
- A built-in piece (`figure.piece`) is one of the legacy library's six
  regions (torso, head, arms, legs), built mesh by mesh from the document's
  appearance or the piece's own `look`; the core shape is a `box` fallback.
  A head carries its neck (dropped under a `neck` anatomy parent), ears,
  face and hair. Its face takes the bundled faces sheet at the textured
  presets, tinted to the skin in linear light, and exports with
  expressions like a painted face. An adult `cranialProfile` sets the ears
  and hair back, lengthens the skull and shades the nape into a joined neck.
  A sculpt (`figure.sculpt`) reshapes a head's face over the appearance's,
  or a face sweep's. The wardrobe does not refit pieces.
- A fibre guide (`figure.fibres`) is an unpainted sweep, outside a joined
  skin, garment, hand or face, replaced by seeded strands that follow its
  fitted rings, wave, trail past its end and grey a share of strands. Rooted
  strands start on the parent's surface. A guide, and its children, seat
  their joins after the face fits, as rigid face hardware does. Strands are
  shaded by vertex at the textured presets; a game build spends at most 40 %
  of its triangle target on them and keeps their geometry through
  simplification. Rooted guides on a fur coat are pelt locks: a game build
  spends their strands' triangles on fewer, wider clumps (60 %) and on short
  tufts rooted over the upper undercoat between them, leaning with the
  nearest locks.
- Garment layers (`outfit.layers`) style each fitted garment and what it
  carries: `show` overrides its outfit visibility, `dye` multiplies its
  textured colours, `order` decides which garment is fitted over which.
  Saved outfits (`outfit.looks`) are worn with `wearLook`, which changes only
  those features, and `exportCharacter({wardrobe: true})` writes each as its
  own scene, rig and clips, as G0's `-game-outfits` export. Hosts ask for it
  with `review.export {wardrobe: true}` (the desktop's All outfits box,
  `irudd export --wardrobe`, MCP `export_character` with `wardrobe`); it is
  its own artifact, stamped `provenance.wardrobe.looks` and saved as
  `…-<preset>-outfits.glb`, while the as-worn export stays one scene.
- A base layer or pressure suit refits every region with a clothing role (`regionFit`): it eases the region radially, recolours
  it from the palette and tones, bares forearms and shins in a base layer,
  keeps the head, tail and base-layer hands as they are and leaves skirts and
  accessories off. A suit cuts each region from the bundled expedition sheet
  and adds its chest and helmet kit; only kept or bare skin takes markings.
- A creature plan (`creature.plan`, the body plan G0 kept in `origin.plan`)
  is read by the textured presets; its parts carry what G0 read from their
  names as `creature.organ` (hide role, atlas rank, relief, bill half) and,
  on a limb's first part, `creature.limb-chain` (the chain, its plan limb and
  the parts its pigment tints). Preparing a form resolves each name once;
  builders never read a label. One organ at most is the `spine`.
- A wing surface (`figure.wing`) replaces a part's primitive with G0's bat,
  feather or insect wing: `structure`, `side`, the `span` and `back` vectors,
  `bone`, `bend`, `notch`, `point`, a rib `count`, a `pattern` and its `seed`,
  and the `dark`, `pale` and `limb` colours. It is the only surface on its
  part. It bends with the joints of a parent whose role is `wing`. Its
  colours are per vertex at the textured presets, on one shared material, or
  one per feathered wing in a game build; clay drops them.
- A courier's offer (`motion.offer`) names a pose and the part it presents,
  held by a part whose role is `hand`. The rig adds a 2.31 s clip
  "Offer dispatch" after the generated ones that eases from rest into the
  pose and back; the pose stays its own clip. G0 found both by name
  ("Present dispatch", "gear dispatch tube"); preparation states them.
- Hand-made parts are never rewritten by a generator merge. Under a rigid
  parent they keep their metric offset; under a figure-assembled parent they
  follow its shape. A generator may reseat them on a socket of its output
  (`reseat` on its definition), and only then.
- A native adult (G0's `human surface` form) is an `irudd.human-adult`
  document: its measurements, posture, skin, style, outfit and eye colour are
  the generator's parameters and its 52 regions are slots carrying the form's
  own transforms and colours. A form without a posture stands in the fitting
  pose with the generated clips, as G0 builds it. Parts added by hand, such
  as wings, build as usual and hang from their region. A limb root seated on
  a shoulder blade of the chest (`figure.scapula-mount`, `side` 1 left, -1
  right) moves with that blade when a steer changes the measurements, as
  G0's `reseatCreatureLimbs` does. G0's cached region bounds feed only its
  graft tool, so preparation drops them.

## Paint and textured presets

- **Sheets are content.** A painted part names its turnaround sheet in core
  `paint.atlas`, a digest declared in `assets` with role `paint-atlas`;
  `figure.paint` holds the traced rest binding the texture is baked from.
  `figure.occluders` keeps regions whose parts moved or changed sheet, listed
  once per sheet and region in canonical order (sheet digest, then region).
- **Portrait plates are content too.** A raster of role `portrait-plate` is
  bound by a fit at version 2: a front plate (`plate` on a `figure.front-fit`
  pass) is a paint layer in the face's UV layout, drawn over the face in pass
  order after the fits; a side plate (`side` on a finishing
  `figure.profile-fit`) is a side photograph registered by its brow, ear and
  chin and sampled onto the face's sides and ears after the side contour is
  fitted. The reader refuses a plate bound to an asset of another role or a
  non-raster type, a plate no fit binds, and a plate used as a paint sheet.
  Version 1 fits read unchanged; a build that reads only version 1 refuses
  plated documents as a capability. Hosts load plates as individual images
  (`loadPortraitPlates` over `exportPortraitPlates(doc)`). A native adult's
  head can bind one more (`figure.native-portrait`): G0's bake of a front and
  a profile photograph in the face paint's layout, colour around a neutral
  128 under an alpha mask, added over the painted face in the current skin
  tone at the textured presets. An adult with one wears no cast member.
- **Bytes resolve offline.** `assetResolver({bundled, project})` returns
  SHA-256-verified bytes: files this build ships (`bundledAssets`, each with
  its origin and licence) first, then the project's blob store. A host stages
  a document's bundled sheets into the blob store before commit
  (`bundledDependencies(doc)`), so the document reopens after a later build
  retires a file. Exports stamp `provenance.artwork` and `creditsFor` lists
  credited third-party material; all shipped sheets are project-owned MIT art.
- **Textured presets need a canvas.** `exportCharacter` at `full`, `game` or
  `portrait` takes `textures: {surfaces, paint, assets, plates}` from
  `loadSurfaces`, `loadPaintAtlases` and `loadPortraitPlates` over a `Raster`
  (`domRaster()` in a page). Missing sheets or plates fail the export instead
  of falling back. `provenance.artwork` lists the paint sheets, the bundled
  faces sheet when a built-in head shows, the plates of parts that show and
  each bundled swatch sheet (surfaces, jacket, horn) whose swatch reaches a
  visible exported material (`swatchSheets`, read before a game atlas bake
  and over every saved look); clay lists none. Canvas resampling and PNG
  encoding are the browser's, so parity runs in installed Chrome on the
  hardware GPU (`src/browser/`), under the shared GPU lock (`src/locked.ts`).
- **Repaint is an edit.** `repaintOperations(doc, parts, sheet)` gives
  `asset.add`, `part.set {paint}` and `feature.set figure.occluders`. It
  touches no geometry, binding or manual edit. `test/repaint.test.ts` checks
  it against G0's own `repaintRegions` at 2761eb14. The gate repaints
  harbour-trader's body with the sheet G0 accepted in its recorded workshop
  repaint (`verification/baseline/paint.py`, kept in `.reference-cache/g0-paint`)
  and requires exactly the document preparing G0's saved form gives; a missing
  recording fails it. For that case and feline-worker from the bundled courier
  sheet, Full and Game must keep every structure and position and change only
  the repainted texture. Parts with identical bindings share one baked texture.
- **A creature plan's hide is baked.** The textured presets chart every
  skin organ of a creature plan (`isCreatureHidePart`) into one 1024² hide
  with albedo, roughness and normal maps from a single 3D field: the plan's
  relief family, undercoats, coat (`creature.coat-zone` places it), limb
  pigment, markings, flank and face markings. Coated parts left outside the
  hide take the coat per vertex; a coat swatch outside the hide is refused.
  Compound and iris eyes (`creature.eye-surface`) and bills draw their own
  canvases. All of it is computed pixel by pixel on the host's raster, so a
  finished build of a plan needs one. Livery and plate dress
  (`origin.plan.dress`) are not ported and are refused.
- **Inspection.** `inspectGlb(bytes)` (or `src/inspect.ts FILE.glb`) reports
  an export's provenance, triangles per region and material, texture slots,
  image sizes and hashes, joints with their parts, morph targets and clips.

## Gates

| Command                                                          | What it does                                                                                              | When           |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------- |
| `pnpm --filter @irudd/verification-families check:fast`          | edits, repaint, inspection, placement and round trips in built scenes (about 50–65 s in a clean checkout) | every edit     |
| `pnpm --filter @irudd/verification-families check:participating` | compares every checked-in fixture with G0 at the ported presets; pending forms do not fail it             | while porting  |
| `pnpm --filter @irudd/verification-families gate:g4a-families`   | the same, and fails until all 245 frozen exports verify                                                   | promotion only |
| `pnpm --filter @irudd/verification-families gate:human-adult`    | the eleven seeded adults at clay against G0, whole (7 s); a missing reference fails                       | while porting  |

Both gate commands take the GPU lock and run clay in Node and the textured
presets in one Chrome session (about 90 s). A participating export passes with
no structural difference, equal counts, every accessor within 1e-5 and
pixel-identical embedded images; a preset that produces no GLB fails. Report
coverage as `verified/245`, from the last line of either run.

The gate checks the reference file's SHA-256 against the committed G0 inventory before it credits an export. A rebuilt reference with different binary packing must match G0's scene and accessor digest and the dimensions and RGBA pixels of every texture. For reproducing the texture digest table from the original byte-exact G0 cache, run `node --import ./packages/document/test/support/register.ts ./verification/families/src/reference.ts` at the repository root.

## Out of scope here

Journal code, JSON validation of imported documents, freezing the G0
baseline and the SQLite project service belong to other work items.
