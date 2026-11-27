# Desktop workshop feature parity

This checklist tracks what you can do in the desktop app. A feature is **done** when its controls work in the desktop app and desktop QA exercises them. **Partly** means some of the workflow is available.

In the Workshop's **Display** panel, choose **Studio colour** to see the character's paint, **Clay** to inspect shape or **Silhouette** to check the outline. Choose **Front**, **Side**, **Back** or **Three-quarter** to turn the camera. Select a part and press **F** or click **Focus (F)** to frame it. Clear the selection with **Escape** to frame the whole character on the next focus.

Choose **New random human** to pick an archetype and a Natural, Fantasy or Mixed colour range. A chosen archetype also steers stature, the portrait foundation (weighted by each source's MakeHuman Gender value, 0 as frame −1 and 1 as frame +1) and the hairstyle and outfit choices towards its frame. **Any** keeps the frozen reference draw. The adult starts dressed. In **Anatomy**, choose a region and measurement, then move the slider or reroll the region. **Appearance** controls skin, eyes and facial detail. **Outfit and hairstyle** lets you change one item, roll a complete look in a chosen direction or inspect the base shape. Each edit has its own History entry.

Cast artwork supplies its own hair, face and garments. Choose **Individual styling** to use the separate controls. Individual styling includes two native face families, a family or chosen hairstyle, face planes, facial hair, earrings, waist bags, a folding fan, hats and hat colour. Select **Studio Rain** for the fitted studio head and its ponytail, or choose a separate hairstyle. [Rain artwork credit](licenses/studio-rain-cc-by-4.0.md).

In **Variation**, write one deck per line, such as `mood = calm | wary | fierce`, choose a range and draw. Pin a cue or choice before redrawing. Copy the direction code to replay the same draw, including its pins and decks. Subtle and exploratory draws soften adult region rerolls. When trying a new outfit and hairstyle, an `outfit` deck can choose a look direction such as Everyday or Festive, and a `skin` deck can choose a hex skin colour.

Choose whether each reference guides the face, body silhouette, garment, or colour and surface. Attach the pictures or select a part and choose **Keep shape in AI edits**. Character-specific Steer messages with these settings and Artwork variation briefs carry the active draw, pictures and protected part IDs. The proposal card and preview name any protected shape the reply changes. Under **Properties**, **Small reroll** prepares a size nudge for one axis of the selected part. **Reset** clears the pending nudge and **Apply nudge** records it in History.

In **Wardrobe**, open **Outfits and garments** to choose Anatomy, Base layer, Work clothes or Pressure suit. Under **Tailored pieces**, adults can combine up to twelve layers. Tops support a linked mail finish. Add a cuirass, shoulder plates, arm guards, leg guards, hip plates or a travelling mantle. Select the layer to adjust its coverage, clearance, colour and edging.

Under **Cut and layer garments**, select a body region in the outliner or viewport and cut a cape, poncho, tabard or skirt to fit it. Choose a garment layer to set visibility, overdye and dressing order. Adjust the fabric, drop, flare and folds, the arm access of a shoulder garment, or a skirt's pleats, gather, tiers and train. To trace a skirt, mark the waist centre, waist edge and points along one side down to the hem.

**Saved outfits** remembers the base outfit, fitted layer visibility, dyes, dressing order and palette tones. Wear a named outfit to recall those settings, or update it with the current ones. Garment cuts and tailored pieces belong to the character and are shared across its saved outfits.

Open **Parts and surface details** under Properties. With a part selected, apply a size change in percent, a move in centimetres, or a turn in degrees. **Build parts** attaches a new shape to the selection, or starts a separate part when the selection is empty. Duplicate, mirror and remove act on the entire selected branch.

**Material and roles** sets the colour, finish, clothing region and movement role of a geometric part. In Studio colour, try fur, scales, satin or metal. **Surface markings** paints bands, spots, rosettes, countershading, reticulation or marbling. Adjust their colour, spacing, coverage and angle. Clear the selection to paint eligible body regions together. **Shared skin** blends neighbouring organic parts with a common tint, texture and softness. Select a sweep, cage or plate to seat it on its parent or release it.

**Face marks** adds freckles, beauty marks, scars, makeup and paint to an adult. On a built-in head or traced face, fit movable eyes from the face paint or adjust their colour, proportions and placement. Fit attached accessory pieces to a shared pivot and set their clearance. Style a groom on a head, grow strands along selected sweep guides, or adjust the count, curl and spread of a fitted hand. Open **Motion and poses** to preview gaze and expressions.

Choose **New random creature** for a complete body from one of fourteen families. Leave the seed empty for a new draw, or enter a seed to revisit the same body and colours. Pick a family such as glider or swimmer and a Natural, Fantasy or Mixed colour range. The starting-form menu also offers Figure, Humanoid and Hybrid. Hybrids combine a creature body with a humanoid head.

In **Body plan**, change the spine proportions or choose **Show drag handles** to pull the body thicker or thinner and slide a limb group along the spine. Add a leg, arm, wing, fin or tentacle group and adjust its reach, shape and placement. Tune the jaw, eyes and ears, choose a dorsal growth and fit equipment or a layered garment. **Shuffle** redraws the whole creature or one region, including equipment and worn layers. Variation strength controls the size of measurement changes. The `family`, `coat` and `skin` decks steer compatible draws. Each applied edit, shuffle or completed drag records one History entry.

**Colours and coat** can generate a coat from the anatomy or apply your choice of plumage, pelt, scutes or wet skin. Adjust the palette, density, contrast and markings. On an imported creature with a saved plan, choose **Start editable copy from this plan** to rebuild the anatomy as a new character. On an adult, open **Adult wings** to fit or replace a matching pair at the shoulders.

Open **Motion and poses** to choose a clip, play or pause it, scrub time and inspect the joints. The rig determines which motions are available. A winged character can fly, a swimmer can undulate and an adult can walk in a posture you choose. Fitted eyes support gaze playback and manual aiming. Faces with expression targets can blink, smile or raise their brows.

To make a pose, pause on a frame or start from rest, select a joint and rotate it in degrees or move it in metres. **Show joints** lets you pick a joint in the viewport and drag its rotation or translation handles. Set a name and choose **Save pose**. Reopen a named pose to adjust it. On a segmented arm, bend or open the elbow, hold the arm in a carry pose during motion, or recut a pair of swept sleeves. Close the panel to return to part editing.

Posture, arm edits and named poses have History entries and travel with the character file. GLBs contain the character's locomotion clips, named poses and supported facial morph targets. Gaze playback and facial controls preview those morph targets in the editor.

| Phase | Scope |
| --- | --- |
| 1 | Viewport display, focus and panel structure |
| 2 | Random humans |
| 3 | Your random choices and variations |
| 4 | Wardrobe |
| 5 | Parts and surface details |
| 6 | Creatures |
| 7 | Motion |
| 8a | Shape tools, individual styling and armour |
| 8b | Portraits, references, artwork and files |
| 9-1 | Surface sculpting and branch placement |

| # | Feature | Desktop status | Phase |
| --- | --- | --- | --- |
| 1 | Resize, move or turn a part and apply the change | done | 5 |
| 2 | Switch between Face, Build, Cloth and Spine modes and edit spine points | done | 8a |
| 3 | Make a small reroll or reset the shape | done | 3 |
| 4 | Adjust an adult body measurement by region | done | 2 |
| 5 | Reroll the body, face, limbs or portrait | done | 2 |
| 6 | Fit a character to a 3D reference | partly (upright OBJ and embedded GLB body fit) | 8b |
| 7 | Sculpt on the model by pulling its surface | done | 9-1 |
| 8 | Draw an appendage or place a branch | done | 9-1 |
| 9 | Protect selected parts during AI edits | done | 3 |
| 10 | Frame the selected part or the whole character | done | 1 |
| 11 | Switch between the current outfit and the base shape | done | 2 |
| 12 | Try a new outfit and hairstyle and set a preference for new looks | done | 2 |
| 13 | Adjust skin tone, eye colour and facial detail | done | 2 |
| 14 | Style hair, fringe, brows, makeup, arm ink, eyewear, necklace, clothing, colours, designs and cast looks | partly (nine styling controls, native face families and a smaller accessory catalogue) | 2, 8a |
| 15 | Choose a face family or studio head | partly (Studio Rain with expressions and hair, plus native families) | 8a, 8b |
| 16 | Adjust an adult's posture | done | 7 |
| 17 | Tailor layers of clothing | partly (individual armour, mantle and mail available) | 4, 8a |
| 18 | Add freckles, scars or moles | done | 5 |
| 19 | Apply a portrait to an adult's own head | done | 8b |
| 20 | Mount a pair of wings on an adult | done | 6 |
| 21 | Edit a creature's body plan with drag handles | done | 6, 7 |
| 22 | Shuffle a chosen part of a creature's plan | done | 6 |
| 23 | Choose a creature's coat and markings | done | 5, 6 |
| 24 | Match a face to portrait landmarks | done | 8b |
| 25 | Attach rigid accessories | done | 5 |
| 26 | Shape a face from a side portrait | done | 8b |
| 27 | Adjust a portrait's depth | done | 8b |
| 28 | Fit movable eyes | done | 5 |
| 29 | Style hair with the groom tools | done | 5 |
| 30 | Grow strands along guide curves | done | 5 |
| 31 | Join organic surfaces | done | 5 |
| 32 | Paint markings on a surface | done | 5 |
| 33 | Add, duplicate, mirror or remove parts | done | 5 |
| 34 | Reshape a part with a control cage | done | 8a |
| 35 | Bend an elbow, recut sleeves or set a carry pose | done | 7 |
| 36 | Adjust a hand's finger count, curl and spread | done | 5 |
| 37 | Seat a surface on its parent or release it | done | 5 |
| 38 | Grow a field of plates | partly (adjustable fields of editable cage plates) | 8a |
| 39 | Repeat plates along a spine | done | 8a |
| 40 | Set a part's clothing region, movement role, finish and colour | done | 5 |
| 41 | Choose an outfit in the wardrobe | done | 4 |
| 42 | Cut a cape, poncho, tabard or skirt | done | 4 |
| 43 | Show, hide, overdye or reorder garment layers | done | 4 |
| 44 | Adjust the cut of a garment | done | 4 |
| 45 | Save, wear or update an outfit | done | 4 |
| 46 | Choose a pose or clip, scrub time, play motion and inspect joints | done | 7 |
| 47 | Adjust gaze and facial expression | done | 7 |
| 48 | Pose individual joints | done | 7 |
| 49 | Switch between Studio colour, Clay and Silhouette and choose a camera angle | done | 1 |
| 50 | Set world scale and compare character sizes | done | 8a |
| 51 | Write a brief for an AI variation | done | 3 |
| 52 | Set a variation range, give direction cues and pin choices | done | 3 |
| 53 | Build decks of your own random choices | done | 3 |
| 54 | Replay a direction from its code | done | 3 |
| 55 | Mark a location on the model | done | 8a |
| 56 | Add visual references | done | 3 |
| 57 | Request and apply painted edits | partly (painted regions and branches, trace and depth replies) | 8b |
| 58 | Refine a proposal, compare it or keep an alternate | done | 8b |
| 59 | Inspect a game export | partly (renders and metrics for the current game export) | 8b |
| 60 | Generate a starting form by archetype, colouring and family | done | 2, 6 |
| 61 | Trace artwork manually to build a character | partly (manual lofts, hulls and membranes from two traced outlines) | 8b |
| 62 | Reuse a turnaround on other regions | done | 8b |
| 63 | Save and open form files and choose export options | done | 8b |
| 64 | Graft a part from a saved form | partly (independent part branches) | 8a |
| 65 | Save and revisit variations and alternates | done | 8b |
| 66 | Open reference studies | partly (shipped editable studies) | 8b |

### Checking surface edits

Run `qa:character` in `apps/desktop` against the packaged app when changing surface controls, rendering or character save files. It drives each of the twelve edits, captures the viewport before and after, and reopens the saved characters in a fresh project. On an RTX 5070 Ti the surface-edit sequence took about 2 minutes 34 seconds on first launch and on repeat. Reopening and checking the two studies added about 12 seconds. The screenshots and contact sheet are in `.reference-cache/phase5/`.

The same run checks paired adult wings, creature starting families, drag handles, limb editing, scoped shuffles and coat generation. It reopens the saved winged adult and creature in a fresh project. The before and after images and the contact sheet in `.reference-cache/phase6/` include eight consecutive full-creature draws at default settings (seeds 0 through 7). On an RTX 5070 Ti the creature sequence takes about three minutes.

### Checking motion

Run the packaged `qa:character` check after changing the rig, animation tracks or motion controls. It compares three paused frames from a walking adult and a flying creature, checks gaze and expression changes on a fitted portrait, and exercises arm edits and joint posing. It reopens the saved poses in a fresh project and inspects the animation channels in both exported GLBs. The motion editing sequence took 2 minutes 2 seconds on the first run and 2 minutes 4 seconds on repeat on an RTX 5070 Ti. Screenshots and the contact sheet are in `.reference-cache/phase7/`.

### Shape tools and remaining styling

Open **Properties** and expand **Shape tools**. Face and Build change figure proportions. Cloth adjusts the folds and opening of a sweep or the cut of a garment. Select a swept part or control cage to drag its points. Cage faces support inset, extrusion, crease and tunnel operations.

Use **Pull** to shape one part, or **Sculpt skin** to brush across connected regions of an adult. Adjust the reach in centimetres and choose whether to mirror the stroke. Drag in the screen plane or use **Normal** and drag up to raise or down to indent. **Soften corrections** reduces earlier skin edits under the brush. **Remove surface corrections** restores the measured adult surface.

In **Draw**, choose a horn, tail, fin or walking limb, set its radius and colour, then drag outward from the model. Mirroring adds its twin on the opposite side. In **Place branch**, pick an anchor on the selected branch or one of its children, then click its destination. With the selection cleared, the first click chooses the source. Choose **Copy branch** or **Move branch** and adjust size, turn axis, angle and seating depth before the second click.

In Mark mode, click to place a named location. Enter the same name on the same part to move it. Under **Spine plates**, set the run, coverage, spacing and colour to grow editable cage plates or repeat scutes.

**World scale** measures the visible character in metres. Pin a height, switch characters or set a new height to see both figures at the same scale. To graft a branch, open the saved source and destination in one project, select the destination part and choose the source character and part.

Plate fields support placement, crest height and overlap. Individual random tip variants remain open. Adjusting a field preserves edits on its surviving plates. Armour layers support fit and finish controls. The browser's embossed devices, asymmetric armour variants and specialised cuts remain open. Grafting supports independent part hierarchies. Native adult rig regions depend on their original body generator.

The packaged `qa:character` check uses real pointer strokes and control-point drags, compares the rendered results, undoes and redoes a plate arrangement, and reopens the saved studies in a fresh project. The shape sequence took 3 minutes 19 seconds on the first run and 3 minutes 11 seconds on repeat on an RTX 5070 Ti. Its before and after images and contact sheet are in `.reference-cache/phase8a/`.

Build the browser workshop with `pnpm build`, then build the desktop app with `pnpm --filter @irudd/desktop build`. Run `pnpm --filter @irudd/desktop qa:shape-parity` after changing surface pulls, connected adult skin, appendages or branch placement. It uses hardware WebGL in Chrome and Electron, exercises matched pointer gestures on the same character and checks one-step undo, redo and character-file reopening. Its before-and-after comparisons use fixed cameras and magnify the most changed area in each render. Find the comparisons and contact sheet in `.reference-cache/phase9-1/`. On the conductor, changing the jaw moved vertices by 15.6 mm, changing body mass moved them by 57.3 mm and dragging a cape corner moved them by 120 mm in both workshops. Repeating four rows of three plates added twelve visible scutes to the forearm. The repeated plate width is adjustable in centimetres. Plates mounted on a painted sweep refit to the carrier and pick up its paint when moved.

For a focused GPU check, append a group name such as `mirroredAttachments` to the QA command. This group catches a mirrored appendage attaching to the wrong forearm. On an RTX 5070 Ti the exercise took 46 seconds cold and 45 seconds warm (59 and 65 seconds including startup and reopening). [Behavior checklist and screenshot filenames](shape-parity-checklist.md)

### Portraits, artwork and files

Open **Portraits and references** on an editable adult to fit the build to an upright OBJ or embedded GLB. Use individual styling for native portrait paint. Mark the eyes and lip seam on a front picture, then optionally mark the eye, nose and lips on a right-facing profile. On a figure or traced head, mark matching points on the model and the photograph to reshape the face. Trace a profile from forehead to chin to set its silhouette. A painted head can also take a grayscale depth map with adjustable strength.

Choose **Trace a new character** to draw front and profile outlines on a four-view sheet. Select a painted region to add a rounded loft, solid hull or thin membrane, or reuse a turnaround on that region. In **Artwork**, request a painted edit for the selected regions. Preview a reply, compare it with the current character, ask its author for a refinement, or keep the preview as a separate alternate. Named variations and alternates appear in the project's character selector and can be saved as character files. [Artwork requests and replies](artwork.md).

Open **Reference studies** to start an editable copy of a shipped form. Under **Game export**, inspect rendered body and portrait views and the game's mesh, texture and rig counts. Clear **Include skeleton and motion** to export static geometry. The Workshop's save and open buttons transfer a character and its referenced project assets between projects.

Run `qa:portraits` and `qa:art` in `apps/desktop` after changing these workflows. They drive the desktop controls, use a local paired client for artwork, and open the saved character files in fresh projects. On an RTX 5070 Ti, the portrait and file sequence took 3 minutes 45 seconds on the first run and 3 minutes 47 seconds on repeat. The 14 before-and-after pairs and their contact sheet are in `.reference-cache/phase8b/`.

### Remaining parity gaps

- **6 and 15**. Body fitting adjusts stature and build from an upright reference. Registered neutral meshes, per-vertex head transfer and imported head families still require the browser.
- **14 and 17**. Individual styling has a smaller accessory catalogue. Embossed devices, asymmetric armour and specialised garment cuts remain open.
- **38 and 64**. Plate fields lack individual random tip variants. Grafting handles independent branches, while native adult rig regions depend on the source generator.
- **57 and 59**. Scalp-only and isolated wearable artwork requests lack dedicated desktop actions. The game inspection shows the current revision. Cross-proposal export and coverage comparisons remain open.
- **61 and 66**. Hand tracing supports lofts, hulls and membranes. Tracing a path from paired centreline points and opening the browser's locally prepared scan studies remain open.
