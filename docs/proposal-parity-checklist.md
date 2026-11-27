# Phase 9-5 workshop parity

Each item requires a browser-left and desktop-right comparison of the same character and action. Character edits must undo in one entry and survive saving and reopening. Source files are under `character-view/`.

Build both workshops, then run `pnpm --filter @irudd/desktop qa:proposal-parity`. For a focused run append `paint`, `review`, `coverage` or `files`. Chrome and Electron use the same feline worker, fitted portrait or adult seeded with 491. The paired client returns local artwork and operations. Screenshot paths below are relative to the repo. Open `.reference-cache/phase9-5/contact-sheet.png` for the gallery.

The full hardware run took 8 minutes 41 seconds on an RTX 5070 Ti while other desktop checks were running. The jacket check samples the teal pixels in both viewports. The alternate check compares the saved parts with the preview and the original document with its previous digest.

## Painted edits

- [x] 01. Send a whole-character or isolated-target brief with measured views, nudge, direction, references and protected parts. Cancel in flight, reject stale replies or exchange files offline. Source: `app.js generate, referenceViews, exportBrief`. Screenshot: `.reference-cache/phase9-5/01-measured-artwork-request.png`.
- [x] 02. Fit a whole painted turnaround, retain protected shapes and their articulation, or report missing protected regions. Source: `art-variation.js paintWithAgent, fitMapWithAgent`. Screenshot: `.reference-cache/phase9-5/02-whole-painted-character.png`.
- [x] 03. Redesign one selected part with its root fitted to the original and the rest of the character retained. Source: `art-variation.js paintWithAgent / graft.js placeComponent`. Screenshot: `.reference-cache/phase9-5/03-fitted-torso-replacement.png`.
- [x] 04. Fit isolated closed wearable artwork as a continuous outer shell plus attachments. Permit wearing over a locked part. Source: `art-variation.js paintWithAgent / graft.js placeComponent`. Screenshot: `.reference-cache/phase9-5/04-closed-teal-waistcoat.png`.
- [x] 05. Fit open wearable artwork without filling openings. Attach its mapped pieces to the selected part. Source: `art-variation.js paintWithAgent / graft.js placeComponent`. Screenshot: `.reference-cache/phase9-5/05-open-teal-waistcoat.png`.
- [x] 06. Repaint a selected loft or hull on its registered source sheet, retaining geometry, occluders and unrelated paint. Source: `paint-sources.js repaintRegions / art-variation.js paintWithAgent`. Screenshot: `.reference-cache/phase9-5/06-registered-jacket-repaint.png`.
- [x] 07. Repaint eligible descendants sharing the sheet. Stop at locked branches and omit unrelated sheets. Source: `art-variation.js paintWithAgent`. Screenshot: `.reference-cache/phase9-5/07-repainted-attached-sleeves.png`.
- [x] 08. Revise a calibrated portrait using its source artwork. Retain an editable fitted face, landmarks, optional depth pairs and source hairstyle regions. Source: `art-variation.js paintWithAgent, fitMapWithAgent`. Screenshot: `.reference-cache/phase9-5/08-revised-fitted-portrait.png`.
- [x] 09. Fit a clean scalp using the source portrait. Align eyes and chin, preserve the source hair as a separate child and retain child placement. Source: `graft.js keepSourceHairstyle / art-variation.js paintWithAgent`. Screenshot: `.reference-cache/phase9-5/09-clean-scalp-under-source-hair.png`.
- [x] 10. Fit a grayscale depth pass to an eligible portrait with source views. Compare relief in clay and adjust influence. Source: `art-variation.js newDepthCandidate / app.js update`. Screenshot: `.reference-cache/phase9-5/10-portrait-depth-in-clay.png`.
- [x] 11. Repair missed outlines, report omitted regions and uncalibrated faces, and fall back to an automatic biped or silhouette where allowed. Source: `art-variation.js fitMapWithAgent, paintWithAgent`. Screenshot: `.reference-cache/phase9-5/11-automatic-biped-after-outline-repair.png`.
- [x] 12. Preview, accept or discard the painted reply. Download its turnaround and trace map when supplied. Source: `app.js generate, bindControls, candidateForm`. Screenshot: `.reference-cache/phase9-5/12-download-artwork-and-trace-map.png`.

## Proposal refinement and alternates

- [x] 13. Toggle the current character and proposal with the summary, protected-shape warning and any new parts hidden in the outfit. Source: `app.js update, candidateForm`. Screenshot: `.reference-cache/phase9-5/13-current-character-comparison.png`.
- [x] 14. Send or export a refinement of the visible candidate with notes, prior direction, summary, round, applicable locks, references, spatial and surface guides. Source: `app.js refineProposal, exportBrief`. Screenshot: `.reference-cache/phase9-5/14-refinement-direction.png`.
- [x] 15. Receive a matching revision, retain artwork across rounds, cancel or reject stale replies and restore a preceding proposal from the eight-round history. Source: `app.js receiveRefinement, bindControls, refineProposal`. Screenshot: `.reference-cache/phase9-5/15-previous-proposal.png`.
- [x] 16. Keep a preview as an independent alternate with thumbnail and title, including while showing current. Resume editing the original. Source: `app.js bindAlternates / alternates.js saveAlternate`. Screenshot: `.reference-cache/phase9-5/16-kept-alternate-and-original.png`.
- [x] 17. Keep a named current variation, list newest first, reopen to compare or accept, remove a saved variation and reopen after reload. Source: `app.js bindAlternates / alternates.js listAlternates, loadAlternate, removeAlternate`. Screenshot: `.reference-cache/phase9-5/17-saved-workwear-variations.png`.

## Game export inspection

- [x] 18. Inspect the actual game GLB for the proposed character: export, reimport, show triangles, height, four labeled colour/clay views at rest and in a sampled clip. Source: `export-review.js inspectGameExport / app.js inspectProposal`. Screenshot: `.reference-cache/phase9-5/18-reloaded-game-export.png`.
- [x] 19. Use the prior camera when both poses fit. Otherwise reframe and flag the mismatch. Toggle earlier and current inspection with their own images and metrics. Source: `export-review.js inspectGameExport / app.js update`. Screenshots: `.reference-cache/phase9-5/19-earlier-game-export.png` and `.reference-cache/phase9-5/files-reframed-survey-staff-export.png` (the 3.10 m staff exceeds the preceding camera frame).
- [x] 20. Compare full-detail and game garments in each view, showing worst exposure and reporting layer swaps and enclosed skin patches. Source: `coverage-review.js garmentCoverage, exposedSkinPixels, enclosedSkin / export-review.js inspectGameExport`. Screenshot: `.reference-cache/phase9-5/20-full-and-game-suit-coverage.png`.
- [x] 21. Compare matched proposal masks for newly bare pixels by garment, body and view. Skip motion when clip/time differ and skip unmatched frames. Source: `coverage-review.js compareCoverage / export-review.js inspectGameExport`. Screenshot: `.reference-cache/phase9-5/21-newly-exposed-skin-by-garment.png`.
- [x] 22. Refine using the current export, including when viewing the earlier export. Supply default defect-review instructions or user notes and two bounded, labeled earlier/current image pairs with both reports. Source: `app.js refineProposal / export-review.js compareExportViews`. Screenshot: `.reference-cache/phase9-5/22-refine-from-compared-exports.png`.
