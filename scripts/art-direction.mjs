import { codexJob, generatedPng } from "./codex-worker.mjs";

export async function paintVariation(brief, signal) {
  const one = brief.paintTarget;
  const prompt = [
    "Act as art director for an open source character workshop. Invoke the image generation tool exactly once. Only use that tool. Treat the attached editor views and the design brief as reference, and make an original nonsexualized game asset.",
    one
      ? "The first attachment shows the whole character. The second is a close-up of the selected geometry in isolation. Generate just one replacement for the selected part in isolation, with no body attached. Centre that single component in every panel. Preserve its function and orientation."
      : "Generate one complete original character. Show every foot, hand, horn and garment. Leave space between limbs in the front and side views where anatomically possible.",
    "Deliver one square 2x2 orthographic turnaround. Top left exact front (+Z), top right exact profile with nose pointing LEFT, bottom left exact rear, bottom right opposite profile pointing RIGHT. Equal square cells. Same pose, floor and character scale in all views. The outermost points should have 5% margin. Even diffuse game lighting. Uniform saturated #ff00ff background fills every gap. No floor, shadow, gradients, dividing lines, typography or alternate figures.",
    "Follow the steering first and use the random cues for unresolved details. Keep adult humanoids in practical work or base layers. Return JSON with only image (PNG filename), summary (short description), and height (standing height or isolated part height in metres, .15 to 6).",
    JSON.stringify({
      direction: brief.instructions,
      target: one ?? "whole character",
      originalHeight: brief.height,
      variation: brief.variation,
      selectedNudges: brief.nudge,
    }),
  ].join("\n");
  const { result, session } = await codexJob(
    prompt,
    (brief.views ?? []).map((v) => ({ data: v.jpeg })),
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
    png: bytes.toString("base64"),
  };
}

export async function fitArtwork(brief, signal) {
  const prompt = [
    "You are tracing corresponding visible volumes in orthographic character artwork for a 3D editor. Inspect the two attached views: FIRST is front; SECOND is the same subject in profile facing LEFT. Coordinate labels are on each view. The four corners of EACH visible square are [0,0] at top left and [1,1] at bottom right. These two images are already separated, so do not divide coordinates into quadrants. Use no tools or shell. Return a single JSON trace map.",
    "Format: {format:'irudd.trace-map.v1',height:number,regions:[{id:string,parent?:string,method:'loft'|'volume',front:[[x,y],...],side:[[x,y],...],outfitRole?:string,motionRole?:string}]}. Use numeric 0..1 values and double quoted JSON. Per polygon use 4–12 ordered outline vertices. Never encode a polygon as 4 scalar bounds. Both polygons for a given region must overlap in standing height on the actual subject. Cover the entire visible shape across the graph. Aim for 5–12 coherent regions. Combine minor markings, eyes, buckles and tiny details into their parent surface. Use a separate region only when its height spans at least 4% of the subject or separate motion is essential. A single isolated item may take fewer. Choose one primary root and attach other regions to meaningful parents. No cycles.",
    "Lofts produce smooth elliptical slices; use for body, face, limbs, garments. Volumes preserve disconnected contours or perforations; use for open loops, wings, wide branched fins or feet. Thin structures pointing sideways need a wider side box to give them thickness. Where limbs overlap in profile, infer anatomically plausible depth bounds. Don't interpret markings and textures as detachable geometry.",
    "Supported optional roles: torso, head, upper arm, forearm, hand, thigh, shin, foot, skirt, tail. Movement also supports wing or rigid. Assign thigh to a whole walking leg if there is no separate shin. Left and right are the character's own. +X is the character's left (image right in front view).",
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
    )
  ).result;
}
