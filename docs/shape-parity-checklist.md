# Surface sculpting and branches

The checked items have a desktop pointer exercise, the matching browser exercise on the same character, and side-by-side image evidence (browser on the left). Desktop edits were checked for one History entry, undo, redo and save/reopen. Source paths below are relative to `character-view/`. Screenshot filenames are relative to the local `.reference-cache/phase9-1/` directory.

## Pull a part

- [x] P1. Pull the first visible part in the view plane. Preview the deformed model during the drag. Release applies, cancel or negligible movement discards it. Accumulate up to 64 pulls per part. Sources: pull-tool.js / pullTool, surface-pull.js / pullSurface, app.js / pullTool finish callback. Comparison `P1.png` · Live drag `P1-live.png`
- [x] P2. In Normal mode drag upward to raise or downward to indent along the hit face normal, including when the part is rotated or scaled. Source: pull-tool.js / pullTool. Comparison `P2.png`
- [x] P3. Set world reach from 1 to 150 cm (7 cm default). Quadratic falloff ends at the radius and excludes attached child parts. Sources: pull-tool.js / pullTool, surface-pull.js / pullPoint and ownedMeshes. Comparison `P3.png`
- [x] P4. Optionally mirror about the midpoint of the part's owned geometry; opposite lateral offsets blend in the overlap. Sources: pull-tool.js / pullTool, surface-pull.js / pullPoint. Comparison `P4.png`

## Sculpt connected adult skin

- [x] S1. On native adult skin, drag in the view plane across a body-region boundary with continuous falloff. Nearby disconnected surfaces are excluded. Attached pieces follow the corrected body and cannot initiate a skin stroke through clothes or hair. Sources: human-brush.js / humanBrush.pick, brushBody, skinDistances and brushStroke. Comparison `S1.png`
- [x] S2. Choose reach from 2 to 16 cm (6 cm default). Hover ring follows valid hits, vanishes on exit and expands during a drag where the control mesh is sparse. Falloff and displacement are bounded by reach and stature. Sources: human-brush.js / humanBrush.mark, brushWeights and brushStroke.vectors. Comparison `S2.png` · Brush ring `S2-ring.png`
- [x] S3. Mirror left and right by default, using the counterpart in neutral topology even on a posed body; disable to sculpt one side. Source: human-brush.js / twinVertex and brushStroke. Comparison `S3.png` · Posed counterpart `S3-posed.png`
- [x] S4. Raise and sink along the hit surface normal with vertical strokes. Preview across regions while dragging; cancelling restores the mesh. Source: human-brush.js / humanBrush.drag, preview and end. Comparison `S4.png`
- [x] S5. Soften existing corrections locally according to drag length, brush weight and symmetry. Uncorrected areas and imperceptible strokes add no History entry. Source: human-brush.js / brushStroke.vectors, changes and humanBrush.end. Comparison `S5.png`
- [x] S6. Remove all surface corrections in one edit while retaining measurements. An already clear body gives feedback without an edit. Tools are exclusive with placement and other pulls. Source: human-brush.js / humanBrush. Comparison `S6.png`

## Draw an appendage

- [x] D1. Start a primary stroke on a visible surface, seat its root 0.35 radii into the parent, and draw along the view plane with outward lift and a live line. Filter/decimate long strokes, cancel or reject a stroke under 2.5 cm. Sources: draw-tool.js / drawTool, branch-stroke.js / drawBranch. Comparison `D1.png` · Stroke preview `D1-live.png`
- [x] D2. Draw a tapering rigid horn, animated tail, thin fin or walking limb. Preserve per-kind width, depth, movement role, editable knots, chosen colour and 0.5–60 cm radius (6 cm default). Select the new branch. Sources: branch-stroke.js / drawBranch, graft.js / attachAt, app.js / drawTool settings and finish. Comparison `D2.png` · Fin `D2-fin.png` · Walking limb `D2-limb.png`
- [x] D3. Mirror a stroke across the character, attaching the twin to the opposite named region where available and otherwise the same parent. Inherit blended skin from the source, use unique labels, honour the 128-part limit. Source: branch-stroke.js / drawBranch and oppositeRegion. Comparison `D3.png` · Opposite parent `D3-opposite.png`

## Place an existing branch

- [x] B1. Pin a visible point on the selected branch or any descendant, or choose the source with the first click if nothing is selected. Show the pin and guidance. Orbit between clicks; empty space, a drag or an unrelated source hit does not advance placement. Cancel by leaving the tool. Sources: branch-placement.js / branchPlacement.start, cancel and pointer handlers, surface-pick.js / pickSurface. Comparison `B1.png` · Source pin `B1-pin.png`
- [x] B2. Move the entire branch to the second picked surface, preserving the source anchor, child transforms and mount; detach stale plate site when reparented. Reject moving onto itself or its descendants and allow another destination pick. Sources: graft.js / placeBranch, branch-placement.js / branchPlacement and scutes.js / fittedScute. Comparison `B2.png` · Painted mount `B2-mounted.png`
- [x] B3. Copy the entire branch by default, with unique IDs, attachments, layer settings, saved outfits and joint poses copied to the new IDs. Preserve the original, select the new root, reject over-capacity copies. Sources: graft.js / placeBranch, parts.js / copyBranch, app.js / placement accept. Comparison `B3.png`
- [x] B4. Scale placement from 10 to 400 percent about the picked pin, aligning it even under scaled parents. Source: graft.js / placeBranch. Comparison `B4.png`
- [x] B5. Twist up to ±360 degrees about either the receiving surface normal or the view axis, about the picked anchor. Sources: branch-placement.js / branchPlacement, graft.js / placeBranch. Comparison `B5.png` · View axis `B5-view.png`
- [x] B6. Seat the anchor 0–100 mm into the receiving surface (8 mm default); reject invalid settings while retaining the source pin. Source: branch-placement.js / branchPlacement. Comparison `B6.png`

## Phase 8a visual rechecks

- [x] V1. Face edit with a framed head and a visible change to its shape. Source: facial-sculpt.js / deformFace. Comparison `V1.png`
- [x] V2. Build edit with a visible change to body proportions. Source: body-sculpt.js / sculptBuild. Comparison `V2.png`
- [x] V3. Surface pull showing actual deformation independently of selection outlines. Source: surface-pull.js / pullSurface. Comparison `V3.png`
- [x] V4. Control cage drag with visible carrier deformation. Source: control-cage.js / cageGeometry and app.js / #cage-corner change handler. Comparison `V4.png`
- [x] V5. Repeated spine plates visibly project from the carrier. Source: scutes.js / repeatOnSpine and app.js / #repeat click handler. Comparison `V5.png`

## Reproducing the evidence

Build both workshops, then run `pnpm --filter @irudd/desktop qa:shape-parity` on a hardware GPU. [Run instructions](parity.md) · Contact sheet `contact-sheet.png`

The studio comparisons use the same camera before and after, with a detail enlargement below. The live comparisons show the pointer tools in each workshop. The capacity exercise starts at 63 existing pulls and 128 parts and checks the final accepted pull plus the rejected pull, drawing and copy. Each saved character is reopened in a fresh editor and compared with its edited document digest.
