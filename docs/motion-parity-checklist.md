# Phase 9-7 · Limb IK, expressions and smooth creatures

Each comparison shows the same character and action in the browser workshop on the left and the desktop app on the right. Joint guiding uses real pointer drags on both canvases. A saved pose records one History entry and survives saving and reopening. Source files are in `character-view/` unless another directory is named. Screenshot filenames refer to the local `.reference-cache/phase9-7/` directory. Open `contact-sheet.png` there to see every comparison.

Build both workshops before running `pnpm --filter @irudd/desktop qa:motion-parity`. Append `wrist`, `courier`, `tip`, `save`, `face` or `smooth` for a focused run.

## Wrist and limb-tip IK

- [x] 01. Guide wrist: dragging the target handle reaches it, keeps the hand's orientation and reports "Wrist reached the target. The hand kept its orientation." Source: `pose-editor.js choose, guideWrist`; `wrist-reach.js wristReach`. Screenshot: `01-guide-wrist-drag.png`.
- [x] 02. Undo pose edit returns the arm to rest, one step per drag. Source: `pose-editor.js remember, pose-undo onclick`. Screenshot: `02-undo-pose-edit.png`.
- [x] 03. A target out of reach stretches the arm and reports "At full reach, N cm from the target." Source: `pose-editor.js guideWrist`. Screenshot: `03-full-reach.png`.
- [x] 04. The step buttons move the wrist target in metres (0.25 m up and forward). Source: `pose-editor.js pose-minus/pose-plus onclick`. Screenshot: `04-nudge-target.png`.
- [x] 05. Point elbow toward the floor. Source: `wrist-reach.js wristReach (solve direction)`. Screenshot: `05-elbow-down.png`.
- [x] 06. Point elbow to the character's left. Source: `wrist-reach.js wristReach`. Screenshot: `06-elbow-left.png`.
- [x] 07. Point elbow to the character's right. Source: `wrist-reach.js wristReach`. Screenshot: `07-elbow-right.png`.
- [x] 08. Point elbow toward the back. Source: `wrist-reach.js wristReach`. Screenshot: `08-elbow-back.png`.
- [x] 09. Elbow turn in degrees rolls the elbow around the shoulder–wrist line and keeps the wrist on target. Source: `wrist-reach.js wristReach (roll)`. Screenshot: `09-elbow-turn.png`.
- [x] 10. Choose a point on the model places the wrist target on the clicked surface and turns the picker off. Source: `pose-editor.js pickSurface, pose-reach-surface onclick`. Screenshot: `10-surface-point.png`.
- [x] 11. Point elbow along the existing bend on a four-hand courier. Source: `wrist-reach.js wristReach`. Screenshot: `11-elbow-original-courier.png`.
- [x] 12. Give other arms room swings the elbow clear of the other arms and torso; the elbow lands at the same world point in both apps. Source: `wrist-reach.js clearanceGuide`. Screenshot: `12-elbow-clear.png`.
- [x] 13. Guide limb tip on a creature leg (this joint only); the twin stays still. Source: `pose-editor.js guideTip`; `limb-pose.js tipReach`. Screenshot: `13-tip-one.png`.
- [x] 14. Pose together: left and right leg tips move together ("2 limb tips moved together."). Source: `pose-editor.js chooseLimbs`; `limb-pose.js followers, carry`. Screenshot: `14-tip-pair.png`.
- [x] 15. Pose together: all 6 legs move together ("6 limb tips moved together."). Source: `limb-pose.js followers, carry`. Screenshot: `15-tip-kind.png`.
- [x] 16. Rotate with left and right together mirrors the turn onto the twin only. Source: `pose-editor.js follow`; `limb-pose.js spread`. Screenshot: `16-rotate-pair.png`.
- [x] 17. Rotate with all legs together turns every leg. Source: `limb-pose.js spread`. Screenshot: `17-rotate-kind.png`.
- [x] 18. Move a joint by a step in metres. Source: `pose-editor.js pose-minus/pose-plus onclick`. Screenshot: `18-move-joint.png`.
- [x] 19. Relax joint returns it to its rest pose. Source: `pose-editor.js pose-reset onclick`. Screenshot: `19-relax-joint.png`.
- [x] 20. Keep the other feet planted: lowering the body leaves every foot in place (and without it the feet move). Source: `limb-pose.js plantFeet`. Screenshot: `20-plant-feet.png`.
- [x] 21. Front view returns the pose camera to the front after orbiting. Source: `pose-editor.js pose-front onclick`. Screenshot: `21-front-view.png`.
- [x] 22. Save pose stores the IK result as one undoable History entry (undo and redo restore the digests), and it survives save and reopen. Source: `pose-editor.js pose-save onclick`. Screenshot: `22-save-ik-pose.png`.
- [x] 38. A creature plan has posable leg and arm chains; planting is on by default and a guided leg tip leaves the other feet planted. Source: `pose-editor.js open (pose-plant default)`; `creature-plan.js organic (motionRole)`. Screenshot: `38-plan-tip-planted.png`.

## Smile and expressions

- [x] 23. Smile visibly changes the face at full strength. Source: `expressions.js poseExpression`; `motion-preview.js motionPreview`. Screenshot: `23-smile.png`.
- [x] 24. Blink closes the eyelids. Source: `expressions.js poseExpression`. Screenshot: `24-blink.png`.
- [x] 25. Raise brows lifts the brows (desktop label now "Raise brows"). Source: `expressions.js poseExpression`. Screenshot: `25-raise-brows.png`.
- [x] 26. Expression amount scales the morph (Smile at 40%). Source: `motion-preview.js face-pose-amount`. Screenshot: `26-expression-amount.png`.
- [x] 27. Look across turns the eyes sideways. Source: `ocular.js setGaze`. Screenshot: `27-gaze-across.png`.
- [x] 28. Look up raises the gaze. Source: `ocular.js setGaze`. Screenshot: `28-gaze-up.png`.
- [x] 29. Centre gaze returns the eyes to rest. Source: `motion-preview.js look-center onclick`. Screenshot: `29-gaze-centre.png`.
- [x] 30. The adult's authored smile changes its face. Source: `expressions.js prepareExpressions`. Screenshot: `30-adult-smile.png`.
- [x] 31. The expression holds while a clip (Idle) plays. Source: `motion-preview.js motionPreview`. Screenshot: `31-expression-during-clip.png`.

## Smooth creature bodies

- [x] 32. Grazer plan body is smooth and is the same creature in both workshops. The desktop generator is a port of `creature-plan.js randomCreaturePlan, buildCreature`, so the plan, proportions, relief, ridges and rings, joint blending and warps, hands, feet and claws, coat, hide and plumage match the browser for every seed (exact form JSON on 400 seeds). Sweeps keep the browser form's own knots. The blended skin joins every blended part in one field, as the browser does, so a part away from the trunk (such as the tank's muzzle) no longer changes the body's tessellation. Unit tests: `verification/families/test/creature-families.test.ts` (one test per family: same form digest, mesh count, vertex count and bounds) and `packages/character/test/creature-smooth.test.ts`. Source: `creature-plan.js`; `surface.js sweepGeometry`. Screenshot: `32-smooth-grazer.png`.
- [x] 33. Stalker plan body is smooth. Source: `surface.js sweepGeometry`. Screenshot: `33-smooth-stalker.png`.
- [x] 34. Glider plan body is smooth. Source: `surface.js sweepGeometry`. Screenshot: `34-smooth-glider.png`.
- [x] 35. Brute plan body is smooth. Source: `surface.js sweepGeometry`. Screenshot: `35-smooth-brute.png`.
- [x] 36. Wader plan body is smooth. Source: `surface.js sweepGeometry`. Screenshot: `36-smooth-wader.png`.
- [x] 37. Swimmer plan body is smooth. A plan with `skin.blend` joins its organic parts into one shared skin (unit test `packages/character/test/creature-smooth.test.ts`). Source: `surface.js sweepGeometry`; `blended-skin.js`. Screenshot: `37-smooth-swimmer.png`.

## Whole creatures, same seed and camera

Each family is created at seed 33 on the desktop, its plan is built by the browser workshop, and both are rendered in Clay from the same orthographic camera, browser left and desktop right. Body vertex counts and whole-creature bounds must match. Shell whorls, nostril cartilage and contour feathers are carried by the `creature.cage-finish` feature (`creature-whorl.js finishWhorl, finishCartilage`; `creature-plumage.js finishContourFeather`), and dress livery by `creature-livery.js`. The default three-quarter camera uses the browser's direction and bounds fit (`app.js chooseAngle`).

- [x] 39. Whole envoy matches. Screenshot: `39-whole-envoy.png`.
- [x] 40. Whole hopper matches. Screenshot: `40-whole-hopper.png`.
- [x] 41. Whole grazer matches. Screenshot: `41-whole-grazer.png`.
- [x] 42. Whole stalker matches. Screenshot: `42-whole-stalker.png`.
- [x] 43. Whole glider matches. Screenshot: `43-whole-glider.png`.
- [x] 44. Whole brute matches. Screenshot: `44-whole-brute.png`.
- [x] 45. Whole tank matches. Screenshot: `45-whole-tank.png`.
- [x] 46. Whole wader matches. Screenshot: `46-whole-wader.png`.
- [x] 47. Whole skitter matches. Screenshot: `47-whole-skitter.png`.
- [x] 48. Whole mantis matches. Screenshot: `48-whole-mantis.png`.
- [x] 49. Whole strider matches. Screenshot: `49-whole-strider.png`.
- [x] 50. Whole drifter matches. Screenshot: `50-whole-drifter.png`.
- [x] 51. Whole swimmer matches. Screenshot: `51-whole-swimmer.png`.
- [x] 52. Whole wild matches. Screenshot: `52-whole-wild.png`.

