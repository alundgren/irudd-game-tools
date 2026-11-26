import { referenceInstructions } from "../character-view/visual-references.js";
import { designDirection } from "../character-view/variations.js";
import { codexJob, generatedPng } from "./codex-worker.mjs";

export async function paintVariation(brief, signal) {
  const one = brief.paintTarget;
  const prompt = [
    "Act as art director for an open source character workshop. Invoke the image generation tool exactly once. Only use that tool. Treat the attached editor views and the design brief as reference, and make an original nonsexualized game asset.",
    brief.wearable
      ? "The first attachment shows the whole wearer. The second is the exact body area to dress. Generate just a wearable shell covering that area, on an invisible mannequin. The four views show the garment alone with its original colors, straps and attachments. No head, skin, hands, legs or mannequin. Keep the same front direction as the wearer."
      : one
        ? "The first attachment shows the whole character. The second is a close-up of the selected geometry in isolation. Generate just one replacement for the selected part in isolation, with no body attached. Centre that single component in every panel. Preserve its function and orientation."
        : "Generate one complete original character. Show every foot, hand, horn and garment. Leave space between limbs in the front and side views where anatomically possible.",
    referenceInstructions(brief.references),
    brief.resurface
      ? "The third image is the accepted four-view texture source. Edit this exact atlas. Duplicate all four panels, front/back/side order, clothing cut, pose, expression, landmarks, silhouette, framing, camera and magenta negative spaces. Only revise the requested pigments, textile print, weathering or skin surface. If the source has a full body, preserve the full body in all four panels. The software reuses the existing geometry and projects these colors onto one selected region, so registration is critical. The next attachments are optional artist references."
      : "",
    brief.sourceRevision
      ? "The third image contains the current original art in all four views. Revise the SAME isolated portrait. The user's requested changes and supplied artist references take priority over features that drifted in that art. Match the reference expression, gaze, parting and asymmetries. Remove baked lighting. Keep front, back, right and left views mutually consistent with the result."
      : "",
    brief.scalp
      ? "The third attachment supplies the exact identity in four views. Reconstruct the SAME adult with the scalp completely shaved, with anatomically complete ears and the matching natural skin of the bare scalp, including around the temples and behind both ears. Keep the original facial structure, eye spacing, age and facial hair. Show no head hair, tuft, wig, collar or clothing. The editor will fit the original hairstyle separately. Preserve the camera and neck orientation and the face proportions."
      : "",
    "Deliver one square 2x2 orthographic turnaround. Top left exact front (+Z), top right exact profile with nose pointing LEFT, bottom left exact rear, bottom right opposite profile pointing RIGHT. Equal square cells. Same pose, floor and character scale in all views. The outermost points should have 5% margin. Even diffuse game lighting. Uniform saturated #ff00ff background fills every gap. No floor, shadow, gradients, dividing lines, typography or alternate figures.",
    "Follow the steering first and use the random cues for unresolved details. Keep adult humanoids in practical work or base layers. Return JSON with only image (PNG filename), summary (short description), and height (standing height or isolated part height in metres, .15 to 6).",
    brief.wearable
      ? "Also return coverage as open for open-front, perforated or strappy garments with exposed skin, or closed for a full covered front and back. The editor uses this to construct the backing."
      : "",
    JSON.stringify({
      direction: brief.instructions,
      target: one ?? "whole character",
      originalHeight: brief.height,
      variation: designDirection(brief.variation),
      selectedNudges: brief.nudge,
    }),
  ].join("\n");
  const { result, session } = await codexJob(
    prompt,
    [
      ...(brief.views ?? []),
      ...(brief.sourceView ? [brief.sourceView] : []),
      ...(brief.references ?? []),
    ].map((v) => ({
      data: v.jpeg,
    })),
    signal,
  );
  const bytes = await generatedPng(session, result.image);
  return {
    requestId: brief.requestId,
    revision: brief.revision,
    summary: String(result.summary ?? "Painted variation").slice(0, 400),
    height: Math.min(
      6,
      Math.max(0.15, Number(result.height) || brief.height || 1.75),
    ),
    ...(brief.wearable
      ? { coverage: result.coverage === "open" ? "open" : "closed" }
      : {}),
    png: bytes.toString("base64"),
  };
}

export async function fitArtwork(brief, signal) {
  const prompt = [
    "You are tracing corresponding visible volumes in orthographic character artwork for a 3D editor. Inspect the two attached views: FIRST is front; SECOND is the same subject in profile facing LEFT. Coordinate labels are on each view. The four corners of EACH visible square are [0,0] at top left and [1,1] at bottom right. These two images are already separated, so do not divide coordinates into quadrants. Use no tools or shell. Return a single JSON trace map.",
    "Format: {format:'irudd.trace-map.v1',height:number,regions:[{id:string,parent?:string,method:'loft'|'volume',front:[[x,y],...],side:[[x,y],...],outfitRole?:string,motionRole?:string}]}. Use numeric 0..1 values and double quoted JSON. Per polygon use 4–12 ordered outline vertices. Never encode a polygon as 4 scalar bounds. Both polygons for a given region must overlap in standing height on the actual subject. Cover the entire visible shape across the graph. Aim for 5–12 coherent regions. Combine minor markings, eyes, buckles and tiny details into their parent surface. Use a separate region only when its height spans at least 4% of the subject or separate motion is essential. A single isolated item may take fewer. Choose one primary root and attach other regions to meaningful parents. No cycles.",
    "Lofts produce smooth elliptical slices; use for body, face, limbs, garments. Volumes preserve disconnected contours or perforations; use for open loops, wings, wide branched fins or feet. Thin structures pointing sideways need a wider side box to give them thickness. Where limbs overlap in profile, infer anatomically plausible depth bounds. Don't interpret markings and textures as detachable geometry.",
    "For an axis that hooks or doubles back, especially a long horizontal tail, choose method 'path' and return spine:[[frontX,frontY,sideX,sideY,radiusWidth,radiusDepth],...] in order from the attachment socket embedded in its parent to the tip. Radii are fractions of full standing height. Use 4-12 corresponding points, wide at the root and fine at the tip. A path region needs no polygons. For a flat fin, ear or wing seen well in both pictures use method 'membrane' with front and side polygons. Add correspondence:'same' if moving from root to tip goes in the same horizontal image direction in front and profile, otherwise 'opposite'. Specify thickness as a fraction of standing height (.006-.04). Include the actual joint within the parent so the membrane meets the shoulder.",
    "For a clearly humanoid face, fit a single loft including the face and cranium. Provide faceLandmarks:[[firstPupilX,firstPupilY],[secondPupilX,secondPupilY],[noseTipX,noseTipY],[lipCenterX,lipCenterY],[chinBottomX,chinBottomY]]. These five precise marks are in the full FRONT picture at normalized coordinates. This unlocks facial sculpting, eyelids and expressions on the actual new portrait. Eyes, lips and nose stay in that loft. On a request for only a person's head, keep this head as the root with any separate accessories attached. For an isolated portrait with readable front and left-facing profile, supply optional depthPairs:[[frontX,frontY,profileX,profileY,influenceRadius], ...]. Match up to eight independently visible surface points (e.g. lateral cheek prominence, brow, lip corner, outer jaw) at the same relative anatomical height in both views. Coordinates are normalized to each full panel. Radius is 0.06 to 0.25 of portrait height. Omit an occluded landmark. Nonhuman snouts and beaks can use a normal loft.",
    "Supported optional roles: torso, head, upper arm, forearm, hand, thigh, shin, foot, skirt, tail. Movement also supports wing, fin, axial spine or rigid. Use axial spine for a flexible trunk extending from head to tail, and fin for underwater paddles. Assign thigh to a whole walking leg if there is no separate shin. Left and right are the character's own. +X is the character's left (image right in front view).",
    "For protected parts include the exact id in the new map at the matching location. The application can graft the protected 3D surface back. Keep physical proportions and the supplied height.",
    JSON.stringify({
      height: brief.height,
      direction: brief.instructions,
      protected: brief.preserve ?? [],
      previousFailure: brief.repair ?? null,
    }),
  ].join("\n");
  return (
    await codexJob(
      prompt,
      brief.views.map((v) => ({ data: v.jpeg })),
      signal,
      { effort: "medium" },
    )
  ).result;
}

export async function paintDepth(brief, signal) {
  const prompt = [
    "Call the image generation tool exactly once. Return JSON with the key image containing the generated PNG filename.",
    "Reconstruct the geometry of the head in the FIRST reference and render its front-facing orthographic linear Z depth buffer. The SECOND reference is its side profile for depth only. Deliver a single front view on black with the identical flat camera, crop and orientation as the FIRST image. Remove no features. Keep both eye centres, nostrils, lips, jaw and neck at their original image positions.",
    "Render physical distance from camera as a smooth grayscale scalar field, like a high quality 3D scan z-pass. Closest is light (nose tip about 245/255); the plane through the front of the ears should be medium gray around 85/255. Far silhouette edges darken. All background is pure black. Pure grayscale foreground. No illumination, shadows, highlights, ambient occlusion, colored pixels, skin color, painted eyebrows, dark pupil dots, specular eyeballs, lettering or extra panels. A moustache is only its subtle raised physical shape. Each pixel is surface depth. Asymmetric surface features of this particular sitter matter.",
    "User's direction: " + brief.instructions,
  ].join("\n");
  const { result, session } = await codexJob(
    prompt,
    brief.views.map((v) => ({ data: v.jpeg })),
    signal,
  );
  const bytes = await generatedPng(session, result.image);
  return {
    requestId: brief.requestId,
    revision: brief.revision,
    png: bytes.toString("base64"),
  };
}
