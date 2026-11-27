# Phase 9-6 · Tracing, turnaround reuse and reference studies

Each comparison shows the same character and action in the browser workshop on the left and the desktop app on the right. Character edits undo as one History entry and survive saving and reopening. Source files are in `character-view/` unless another directory is named. Screenshot filenames refer to the local `.reference-cache/phase9-6/` directory. Open `contact-sheet.png` there to see every comparison.

Build both workshops before running `pnpm --filter @irudd/desktop qa:trace-parity`. Append `trace`, `details`, `agent`, `reuse`, `catalogue`, `scans`, `compare` or `launch` for a focused run. Tracing uses real pointer clicks on both canvases. Chrome and Electron use the same registered turnarounds, part map, feline worker and festival conductor, and the paired agent client returns the same local part map.

The local studies need the files listed by `pnpm references`. To check a checkout without them, build both workshops with `WORKSHOP_REFERENCES=none` and append `optional`.

## Row 61 · Trace artwork to build a character

- [x] 01. Open tracing on a registered turnaround. Show its front and profile views, defaulting to the selected region's sheet. Source: `trace-editor.js trace-open, refresh / turnaround.js registeredArtwork, paintGuide`. Screenshot: `01-registered-turnaround.png`.
- [x] 02. Click paired front and profile outlines. A dashed guide follows the pointer's registered height across both views. Source: `trace-editor.js canvas.onclick, onpointermove, draw / turnaround.js guideHeight, guidePosition`. Screenshot: `02-paired-outlines.png`.
- [x] 03. Undo the last point in the last view used, or clear both outlines. Source: `trace-editor.js trace-undo, trace-clear`. Screenshot: `03-correct-outline.png`.
- [x] 04. Refuse an outline with one or two points. Source: `trace-editor.js trace-add`. Screenshot: `27-open-outline-refused.png`.
- [x] 05. Refuse a subject height outside 0.15 to 6 metres. Source: `trace-editor.js trace-add, trace-biped`. Screenshot: `28-height-refused.png`.
- [x] 06. Build editable cross sections from the two outlines. Source: `trace-editor.js trace-add / turnaround.js traceOutline`. Screenshot: `04-rounded-loft.png`.
- [x] 07. Build a solid hull that preserves openings and separate contours. Source: `trace-editor.js trace-add / turnaround.js traceHull`. Screenshot: `05-solid-hull.png`.
- [x] 08. Build a thin membrane whose edges run the same way. Source: `trace-editor.js trace-add / turnaround.js traceHull`. Screenshot: `06-same-direction.png`.
- [x] 09. Build a thin membrane whose edges run opposite ways. Source: `trace-editor.js trace-add / turnaround.js traceHull`. Screenshot: `07-opposite-direction.png`.
- [x] 10. Build a curved centreline from paired points, root to tip, with the root radius tapering to a tenth at the tip. Source: `trace-editor.js trace-add, method.onchange / turnaround.js tracePath`. Screenshot: `08-centreline.png`.
- [x] 11. Refuse a centreline whose views have different numbers of points. Source: `trace-editor.js trace-add`. Screenshot: `09-unmatched-points.png`.
- [x] 12. Use the full silhouette when both outlines are empty. Source: `trace-editor.js trace-add / turnaround.js traceOutline`. Screenshot: `30-full-silhouette.png`.
- [x] 13. Import a four-view artwork file. Refuse files over 12 MB, scale to 1800 pixels, store it as WebP under 2.4 MB, list it as imported art and keep it with the traced character. Source: `trace-editor.js trace-import, upload.onchange / turnaround.js importArtwork, storeArtworkBlob`. Screenshot: `29-imported-artwork.png`.
- [x] 14. Add a traced region to the current character, attached to the selected region in world space, with a unique name. Source: `trace-editor.js trace-add`. Screenshot: `10-attached-region.png`.
- [x] 15. Add a traced centreline to the current character, attached to the selected region from another sheet. Source: `trace-editor.js trace-add / turnaround.js tracePath`. Screenshot: `31-attached-centreline.png`.
- [x] 16. Mark both pupils, nose, lips and chin on the selected painted head and fit the face. Source: `trace-editor.js trace-face, trace-face-apply, showMarks / turnaround.js calibrateFace`. Screenshot: `11-five-landmarks.png`.
- [x] 17. Match one feature in front and profile and fit a depth point with its influence radius, up to 24 points. Source: `trace-editor.js trace-depth, trace-depth-apply / turnaround.js pairDepth`. Screenshot: `12-paired-depth.png`.
- [x] 18. Fit a whole articulated biped to the sheet at the subject height. Source: `trace-editor.js trace-biped / trace-biped.js traceBiped`. Screenshot: `13-articulated-biped.png`.
- [x] 19. Build articulated regions from a part map under 500 KB. Source: `trace-editor.js trace-map-import / trace-map.js buildTraceMap`. Screenshot: `14-imported-map.png`.
- [x] 20. Ask the paired agent to fit separate parts with fit instructions and build the returned map as a new character. Source: `trace-editor.js trace-agent-fit / art-variation.js fitMapWithAgent`. Screenshot: `15-agent-fitted-map.png`.
- [x] 21. Discard an agent reply that arrives after the dialog closes. Source: `trace-editor.js trace-agent-fit`. Screenshot: `33-closed-agent-fit.png`.

## Row 62 · Reuse a turnaround on other regions

- [x] 22. Choose the sheet to reuse and the regions to repaint, grouped by their current sheet and excluding the chosen sheet. Apply stays disabled until a region is chosen. Source: `reuse-paint-editor.js reusePaintEditor, showRegions`. Screenshot: `16-reuse-selection.png`.
- [x] 23. Repaint the selected regions in one edit, keeping their shape, texture coordinates and occluding paint sources. Source: `reuse-paint-editor.js apply.onclick / paint-sources.js repaintRegions`. Screenshot: `17-repainted-regions.png`.
- [x] 24. Refuse regions painted from different sheets. Source: `paint-sources.js repaintRegions`. Screenshot: `32-mixed-sheets-refused.png`.

## Row 66 · Open reference studies

- [x] 25. List every study in the browser's order as title and category, and open each as an editable character with its display mode and camera angle. Source: `app.js setup, openStudy / study-catalogue.js studies`. Screenshot: `18-study-catalogue.png`.
- [x] 26. Open the six locally prepared body scan studies with their measured section profiles and a link to the original scan. Source: `app.js openStudy, updateStudySource / examples/reference-studies.js referenceStudies / examples/local-references.js scanFits`. Screenshots: `20-scan-f01.png` to `25-scan-m09.png`.
- [x] 27. Open the locally prepared editable MHR fits and head scan study with their surface corrections and linked 3D references. Source: `examples/human-studies.js humanStudies / examples/local-references.js workshopFits, headFits`. Screenshots: `35-editable-mhr-fit.png` and `36-head-scan-study.png`.
- [x] 28. Compare the measured torso with the rigged 3D reference, then return to the torso study. Source: `entry.js / examples/rig-study.js startRigStudy / examples/mhr-study.js mhrStudies`. Screenshot: `19-rig-comparison.png`.
- [x] 29. Open a study from the launch request, opening its linked reference in the 3D fitting room when comparison is requested. Source: `app.js openExample`. Screenshot: `34-launch-study-comparison.png`.
- [x] 30. Without local reference material, omit the scan and torso studies and the comparison link and open the shipped studies. Source: `examples/local-references.js / entry.js / scripts/build.mjs`. Screenshot: `26-without-private-studies.png`.
