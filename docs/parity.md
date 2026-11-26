# Desktop workshop feature parity

This checklist tracks what you can do in the desktop app. A feature is **done** when its controls work in the desktop app and desktop QA exercises them. **Partly** means some of the workflow is available.

In the Workshop's **Display** panel, choose **Studio colour** to see the character's paint, **Clay** to inspect shape or **Silhouette** to check the outline. Choose **Front**, **Side**, **Back** or **Three-quarter** to turn the camera. Select a part and press **F** or click **Focus (F)** to frame it. Clear the selection with **Escape** to frame the whole character on the next focus.

Choose **New random human** to pick an archetype and a Natural, Fantasy or Mixed colour range. The adult starts dressed. In **Anatomy**, choose a region and measurement, then move the slider or reroll the region. **Appearance** controls skin, eyes and facial detail. **Outfit and hairstyle** lets you change one item, roll a complete look in a chosen direction or inspect the base shape. Each edit has its own History entry.

Cast artwork supplies its own hair, face and garments. Choose **Individual styling** to use the separate controls. The nine remaining styling keys are scheduled for phase 8 (`faceFamily`, `faceFamilyHair`, `facePlanes`, `facialHair`, `earrings`, `waistBag`, `handProp`, `hat`, `hatColor`).

In **Variation**, write one deck per line, such as `mood = calm | wary | fierce`, choose a range and draw. Pin a cue or choice before redrawing. Copy the direction code to replay the same draw, including its pins and decks. Subtle and exploratory draws soften adult region rerolls. When trying a new outfit and hairstyle, an `outfit` deck can choose a look direction such as Everyday or Festive, and a `skin` deck can choose a hex skin colour.

Choose whether each reference guides the face, body silhouette, garment, or colour and surface. Attach the pictures or select a part and choose **Keep shape in AI edits**. Character-specific Steer messages with these settings and Artwork variation briefs carry the active draw, pictures and protected part IDs. The proposal card and preview name any protected shape the reply changes. Under **Properties**, **Small reroll** prepares a size nudge for one axis of the selected part. **Reset** clears the pending nudge and **Apply nudge** records it in History.

In **Wardrobe**, open **Outfits and garments** to choose Anatomy, Base layer, Work clothes or Pressure suit. Under **Tailored pieces**, adults can wear up to twelve tops, trousers, boots, shoes, gloves and belts in dressing order. Choose a piece to change its dimensions, material and details. Individual armour plates, travelling mantles, armour variations and mail finishes still need their surface builders.

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
| 8 | Advanced editing and export |

| # | Feature | Desktop status | Phase |
| --- | --- | --- | --- |
| 1 | Resize, move or turn a part and apply the change | done | 5 |
| 2 | Switch between Face, Build, Cloth and Spine modes and edit spine points | missing | 8 |
| 3 | Make a small reroll or reset the shape | done | 3 |
| 4 | Adjust an adult body measurement by region | done | 2 |
| 5 | Reroll the body, face, limbs or portrait | done | 2 |
| 6 | Fit a character to a 3D reference | missing | 8 |
| 7 | Sculpt on the model by pulling its surface | missing | 8 |
| 8 | Draw an appendage or place a branch | missing | 8 |
| 9 | Protect selected parts during AI edits | done | 3 |
| 10 | Frame the selected part or the whole character | done | 1 |
| 11 | Switch between the current outfit and the base shape | done | 2 |
| 12 | Try a new outfit and hairstyle and set a preference for new looks | done | 2 |
| 13 | Adjust skin tone, eye colour and facial detail | done | 2 |
| 14 | Style hair, fringe, brows, makeup, arm ink, eyewear, necklace, clothing, colours, designs and cast looks | partly (phase 2 controls done) | 2, 8 |
| 15 | Choose a face family or studio head | missing | 8 |
| 16 | Adjust an adult's posture | done | 7 |
| 17 | Tailor layers of clothing | partly (six piece types done, armour surfaces pending) | 4, 5 |
| 18 | Add freckles, scars or moles | done | 5 |
| 19 | Apply a portrait to an adult's own head | missing | 8 |
| 20 | Mount a pair of wings on an adult | done | 6 |
| 21 | Edit a creature's body plan with drag handles | done | 6, 7 |
| 22 | Shuffle a chosen part of a creature's plan | done | 6 |
| 23 | Choose a creature's coat and markings | done | 5, 6 |
| 24 | Match a face to portrait landmarks | partly | 8 |
| 25 | Attach rigid accessories | done | 5 |
| 26 | Shape a face from a side portrait | missing | 8 |
| 27 | Adjust a portrait's depth | partly | 8 |
| 28 | Fit movable eyes | done | 5 |
| 29 | Style hair with the groom tools | done | 5 |
| 30 | Grow strands along guide curves | done | 5 |
| 31 | Join organic surfaces | done | 5 |
| 32 | Paint markings on a surface | done | 5 |
| 33 | Add, duplicate, mirror or remove parts | done | 5 |
| 34 | Reshape a part with a control cage | missing | 8 |
| 35 | Bend an elbow, recut sleeves or set a carry pose | done | 7 |
| 36 | Adjust a hand's finger count, curl and spread | done | 5 |
| 37 | Seat a surface on its parent or release it | done | 5 |
| 38 | Grow a field of plates | missing | 8 |
| 39 | Repeat plates along a spine | missing | 8 |
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
| 50 | Set world scale and compare character sizes | missing | 8 |
| 51 | Write a brief for an AI variation | done | 3 |
| 52 | Set a variation range, give direction cues and pin choices | done | 3 |
| 53 | Build decks of your own random choices | done | 3 |
| 54 | Replay a direction from its code | done | 3 |
| 55 | Mark a location on the model | missing | 8 |
| 56 | Add visual references | done | 3 |
| 57 | Request and apply painted edits | partly | 8 |
| 58 | Refine a proposal, compare it or keep an alternate | partly | 8 |
| 59 | Inspect a game export | partly | 8 |
| 60 | Generate a starting form by archetype, colouring and family | done | 2, 6 |
| 61 | Trace artwork manually to build a character | partly | 8 |
| 62 | Reuse a turnaround on other regions | partly | 8 |
| 63 | Save and open form files and choose export options | partly | 8 |
| 64 | Graft a part from a saved form | missing | 8 |
| 65 | Save and revisit variations and alternates | partly | 8 |
| 66 | Open reference studies | partly | 8 |

### Checking surface edits

Run `qa:character` in `apps/desktop` against the packaged app when changing surface controls, rendering or character save files. It drives each of the twelve edits, captures the viewport before and after, and reopens the saved characters in a fresh project. On an RTX 5070 Ti the surface-edit sequence took about 2 minutes 34 seconds on first launch and on repeat. Reopening and checking the two studies added about 12 seconds. The screenshots and contact sheet are in `.reference-cache/phase5/`.

The same run checks paired adult wings, creature starting families, drag handles, limb editing, scoped shuffles and coat generation. It reopens the saved winged adult and creature in a fresh project. The before and after images and the contact sheet in `.reference-cache/phase6/` include eight consecutive full-creature draws at default settings (seeds 0 through 7). On an RTX 5070 Ti the creature sequence takes about three minutes.

### Checking motion

Run the packaged `qa:character` check after changing the rig, animation tracks or motion controls. It compares three paused frames from a walking adult and a flying creature, checks gaze and expression changes on a fitted portrait, and exercises arm edits and joint posing. It reopens the saved poses in a fresh project and inspects the animation channels in both exported GLBs. The motion editing sequence took 2 minutes 2 seconds on the first run and 2 minutes 4 seconds on repeat on an RTX 5070 Ti. Screenshots and the contact sheet are in `.reference-cache/phase7/`.
