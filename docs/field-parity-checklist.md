# Plate fields, grafts and creature spine handles

Comparisons show the browser workshop on the left and the desktop workshop on the right, before and after the same edit. Each screenshot filename is relative to `.reference-cache/phase9-2/`. The desktop exercises check History, undo, redo and character-file reopening. Browser source paths are relative to `character-view/`.

## Grow a plate field

- [x] F1. Grow fitted, individually editable horn cages on a sweep. Choose one of five faces, tip direction, 2–12 rows, 1/3/5/7 columns and colour. Preserve the curved and mirrored frame, ridges, base joins, swatch variation and shaded undersides. plate-growth-editor.js / plateGrowthEditor and plate-growth.js / surfaceChart, makePlate, finishPlateSurface. Comparison `F1.png`.
- [x] F2. Edit row and column counts, wrap, overlap, crest and relief from the carrier or a selected child. Show current settings and limits. Preserve surviving IDs, manual transforms, colour, topology, joins and vertex edits. plate-growth-editor.js / plateGrowthEditor and plate-growth.js / growPlateField, updatePlate. Comparison `F2.png`.
- [x] F3. Reroll layout or all unpinned tips independently. Refit automatically when dragging a spine point and refit a saved field to an edited carrier, keeping the rest chart for colour and tip changes. plate-growth-editor.js / plateGrowthEditor and plate-growth.js / drawing, plateGrowthRest, growPlateField and spine-edit.js / reshapeSpine. Comparisons `F3.png` and `F3-refit.png`.
- [x] F4. Reroll a single tip, keep its override through field changes, then release it. Disable release without an override and reject custom topology. plate-growth.js / changeOneTip and plate-growth-editor.js / plateGrowthEditor. Comparison `F4.png`.
- [x] F5. Shrink a field, deleting untouched surplus plates, retaining customized ones as independent parts and respecting manually deleted sites. Reject duplicate sites, surplus children with attachments, short carriers and over-capacity fields atomically. plate-growth.js / growPlateField, surfaceChart. Comparison `F5.png`.

## Repeat plates

- [x] R1. Choose any face, 1–16 rows, 1–7 columns and width 1–100 cm. Follow the curve, taper and tilt each editable scute, centre a single row, assign unique names, enforce capacity and select the first plate. app.js / #repeat onclick and scutes.js / repeatOnSpine. Comparison `R1.png`.
- [x] R2. Fit ordinary scutes to a painted carrier, storing the mount and projecting carrier UVs. scutes.js / repeatOnSpine, fittedScute. Comparison `R2.png`.
- [x] R3. Equip plates only in the active outfit, with chosen colour, rigid motion, plain finish and base joins. app.js / #repeat onclick and scutes.js / equipPlateRows. Comparison `R3.png`.

## Graft a part from a saved form

- [x] G1. Open a validated saved donor and choose any branch, including native adult bones. Preserve children, donor body/skin, sculpt detail, appearance, artwork and rig across saves and subsequent grafts. Keep shelf sources available. app.js / #donor-file onchange, #donor-component onchange and graft.js / extractComponent. Comparison `G1.png`. Component shelf `G1-shelf.png`.
- [x] G2. Replace one part, preserve existing children in world space, match destination height by default or keep donor scale. Select new root and show sculpt view at three-quarter angle. app.js / #graft onclick and graft.js / placeComponent. Comparison `G2.png`.
- [x] G3. Replace the destination branch, measuring visible source and destination bounds when fitting saved branches. Reject empty bounds, ensure unique names, reject over-capacity results. app.js / graftBounds and graft.js / placeComponent. Comparison `G3.png`.
- [x] G4. Attach above with optional height matching, respecting adult shoulder-blade mounts where applicable. graft.js / placeComponent and human-sockets.js / scapulaSocket. Comparison `G4.png`. Shoulder-blade socket `G4-shoulder.png`.
- [x] G5. Wear the source on the destination for the current outfit, optionally fitting with per-axis ease. graft.js / placeComponent. Comparison `G5.png`.
- [x] G6. Recut a garment pattern with donor ease, cut, surface, colour and dye. Hide fit control for this mode and reject non-garments. graft.js / extractComponent, garmentBlock, cutGarment, placeComponent. Comparison `G6.png`.

## Creature spine handles

- [x] H1. Drag the hips, loin, belly, chest and shoulder diamonds on the camera-facing contour. Show section ring, initial outline, live thickness and body preview. Clamp to 0.4–2.2 and edit one station. creature-handles.js / girthDirection, girthPoint, pullGirth and creature-handle-overlay.js / draw, move, push, end. Comparison `H1.png`. Live drag `H1-live.png`.
- [x] H2. Drag a round limb handle along the nearer side of the spine. Show the rail, sockets and readout, preserve group spacing and bounds, give end-on view guidance. creature-handles.js / limbRail, nearestAlong, moveLimbs and creature-handle-overlay.js / begin, draw, end. Comparison `H2.png`.
- [x] H3. Orbit off handles, zoom over them, highlight on hover/focus and use arrow keys for 1.05x girth or 0.02 limb increments. Escape, pointer cancellation, lost capture and insignificant movement leave the body and History intact. creature-handle-overlay.js / button, keys, abort, end. Comparison `H3.png`.
