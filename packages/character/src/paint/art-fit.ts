// Fitting a paired agent's trace and depth replies onto an existing painted
// part, as typed operations. Ported from character-view at 2761eb1:
//
// - depth: newDepthCandidate in art-variation.js. The target is the selected
//   painted portrait (acceptsDepth in portrait-depth.js); the agent's front
//   depth pass is drawn into a 384 px square canvas and registered by
//   depthFromPixels, and the part's paint takes the field at mix 0.88,
//   keeping its depth pins.
// - trace: the trace editor's fits on the selected head (trace-editor.js).
//   A trace region's five faceLandmarks calibrate the face (registerFace in
//   portrait-frame.js); its depthPairs become depth pins on the traced front
//   (pairDepth and withDepthPairs in turnaround.js), appended to the part's
//   own up to 24. Coordinates are fractions of the sheet's front and
//   left-facing profile panels, as the coordinate views G0 sent show them.
//
// A fit only fits: other regions and outlines are reported, never built. A
// trace brief whose intent is build adds them as parts (trace-build.ts).

import { Schema } from "effect";
import {
  FeatureId,
  figureAnatomy,
  figurePaint,
  figurePortraitDepth,
  figureSweep,
  isJson,
  isJsonArray,
  motionRole,
  outfitWear,
  depthFieldSize,
  type CharacterDocument,
  type DepthField,
  type DepthPin,
  type FigurePaint,
  type Json,
  type Operation,
  type Part,
  type PortraitLandmarks,
} from "@irudd/document";

export { panelFromPixels, type Panel } from "./panel.js";

/** The measurements of a sheet panel that register its coordinates: see `Panel`. */
export interface PanelFrame {
  readonly size: number;
  readonly mid: number;
  readonly feet: number;
  readonly span: number;
}

/** The canvas G0 draws a depth pass into before registering it. */
export const depthCanvas = 384;
/** The square panel a sheet's views are prepared at. */
export const panelCanvas = 640;

export class ArtFitError extends Error {}

const feature = Schema.decodeUnknownSync(FeatureId);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x2000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  return btoa(text);
}

// ── Depth ───────────────────────────────────────────────────────────────────

/**
 * The fitted field of a front depth pass on black, from its RGBA pixels. The
 * image tool can recrop a portrait: its top and bottom register to the
 * source profile and its silhouette on each scan line to the loft's own
 * width. Ported from depthFromPixels in character-view/portrait-depth.js.
 */
export function depthFromPixels(rgba: ArrayLike<number>, w: number, h: number): DepthField {
  const [width, height] = depthFieldSize;
  const px = (i: number) => rgba[i] ?? 0;
  const spans: (readonly [number, number] | null)[] = [];
  for (let y = 0; y < h; y++) {
    let lo = w;
    let hi = -1;
    for (let x = 0; x < w; x++) {
      const at = 4 * (y * w + x);
      if (
        px(at + 3) > 128 &&
        px(at) > 16 &&
        Math.max(px(at), px(at + 1), px(at + 2)) - Math.min(px(at), px(at + 1), px(at + 2)) < 30
      ) {
        lo = Math.min(lo, x);
        hi = x;
      }
    }
    spans.push(hi - lo > 3 ? [lo, hi] : null);
  }
  const top = spans.findIndex(Boolean);
  const bottom = spans.findLastIndex(Boolean);
  if (top < 0 || bottom - top < h * 0.35)
    throw new ArtFitError("Use one front-facing grayscale depth pass on black.");
  const present = spans.filter((s): s is readonly [number, number] => s !== null);
  const values = new Uint8Array(width * height);
  const left = Math.min(...present.map((s) => s[0]));
  const right = Math.max(...present.map((s) => s[1]));
  for (let j = 0; j < height; j++) {
    const y = Math.round(lerp(bottom, top, j / (height - 1)));
    const span = spans[y];
    if (!span) continue;
    for (let i = 0; i < width; i++) {
      const x = clamp(lerp(left, right, i / (width - 1)), span[0], span[1]);
      const k = Math.floor(x);
      values[j * width + i] = Math.round(
        lerp(px((y * w + k) * 4), px((y * w + Math.min(k + 1, span[1])) * 4), x - k),
      );
    }
  }
  return { mix: 0.88, values: toBase64(values) };
}

const partNamed = (doc: CharacterDocument, id: string): Part => {
  const part = doc.parts.find((p) => p.id === id);
  if (!part) throw new ArtFitError(`This revision has no part ${id}.`);
  return part;
};

/** The one part a fit brief names. */
function onlyTarget(doc: CharacterDocument, parts: ReadonlyArray<string> | undefined): Part {
  if (!parts?.length) throw new ArtFitError("Select the painted part to fit.");
  if (parts.length > 1) throw new ArtFitError("Select one painted part to fit.");
  return partNamed(doc, parts[0] ?? "");
}

/**
 * Why a part cannot take a depth field, or undefined when it can: a traced
 * face with calibrated landmarks whose binding spans most of its height.
 * Ported from acceptsDepth in character-view/portrait-depth.js.
 */
export function depthRefusal(part: Part): string | undefined {
  const paint = figurePaint.read(part.features);
  if (
    figureAnatomy.read(part.features)?.region !== "face" ||
    !part.paint ||
    !figureSweep.read(part.features) ||
    !paint?.portrait
  )
    return `${part.id} is not a painted portrait: select a traced face with calibrated landmarks.`;
  const first = paint.rest[0];
  const last = paint.rest[paint.rest.length - 1];
  if (!first || !last || (last[1] - first[1]) / paint.height <= 0.72)
    return `${part.id} covers too little of its portrait to fit a depth pass.`;
  return undefined;
}

/** The depth target a brief names, or why it cannot take a depth pass. */
export function depthTarget(
  doc: CharacterDocument,
  parts: ReadonlyArray<string> | undefined,
): Part {
  const part = onlyTarget(doc, parts);
  const refusal = depthRefusal(part);
  if (refusal) throw new ArtFitError(refusal);
  return part;
}

/** The operation giving the target's traced front the depth field; its depth pins stay. */
export function depthOperations(
  doc: CharacterDocument,
  partId: string,
  field: DepthField,
): Operation[] {
  const part = depthTarget(doc, [partId]);
  const prior = figurePortraitDepth.read(part.features);
  return [
    {
      op: "feature.set",
      feature: feature(figurePortraitDepth.id),
      part: part.id,
      value: figurePortraitDepth.json({ ...(prior?.pins ? { pins: prior.pins } : {}), field }),
    },
  ];
}

// ── Trace fits ──────────────────────────────────────────────────────────────

/** The binding of a painted horizontal loft, or why the part has none. */
function loftBinding(part: Part): FigurePaint {
  const paint = figurePaint.read(part.features);
  if (!part.paint || !paint || !figureSweep.read(part.features) || paint.frame === "path")
    throw new ArtFitError(`${part.id} is not a painted horizontal loft: select a traced head.`);
  return paint;
}

/** The trace target a brief names: a painted horizontal loft. */
export function traceTarget(
  doc: CharacterDocument,
  parts: ReadonlyArray<string> | undefined,
): Part {
  const part = onlyTarget(doc, parts);
  loftBinding(part);
  return part;
}

/**
 * Depth pins of front and profile marks of the same features. Ported from
 * pairDepth in character-view/turnaround.js: each pair is [front x, front y,
 * profile x, profile y, radius], panel fractions and a radius in binding
 * heights, at matching standing heights in both views.
 */
export function pairDepth(
  binding: FigurePaint,
  front: PanelFrame,
  side: PanelFrame,
  pair: readonly [number, number, number, number, number],
): DepthPin {
  if (
    pair.length !== 5 ||
    !pair.every(Number.isFinite) ||
    pair.slice(0, 4).some((x) => x < 0 || x > 1) ||
    pair[4] < 0.035 ||
    pair[4] > 0.35
  )
    throw new ArtFitError("Use front and profile points and a radius from 0.035 to 0.35.");
  const [fx, fy, sx, sy, r] = pair;
  const y1 = (front.feet - fy * front.size) / front.span;
  const y2 = (side.feet - sy * side.size) / side.span;
  if (Math.abs(y1 - y2) > 0.065)
    throw new ArtFitError("Choose the same feature at matching height in both views.");
  return [
    ((fx * front.size - front.mid) / front.span) * binding.height - binding.offset[0],
    y1 * binding.height - binding.offset[1],
    ((side.mid - sx * side.size) / side.span) * binding.height - binding.offset[2],
    Math.max(0.001, r * binding.height),
  ];
}

/**
 * The face landmarks of five front marks: both pupils, nose tip, lip centre
 * and chin bottom. Ported from registerFace in character-view/portrait-frame.js.
 */
export function registerFace(
  binding: FigurePaint,
  marks: ReadonlyArray<readonly [number, number]>,
  panel: PanelFrame,
): PortraitLandmarks {
  if (
    marks.length !== 5 ||
    !marks.every((p) => p.length === 2 && p.every((n) => Number.isFinite(n) && n >= 0 && n <= 1))
  )
    throw new ArtFitError("Mark both pupils, nose, lips and chin in the front view.");
  const h = binding.height;
  const first = binding.rest[0];
  const last = binding.rest[binding.rest.length - 1];
  if (!first || !last) throw new ArtFitError("This head area is too small to calibrate.");
  const base = (first[1] + binding.offset[1]) / h;
  const top = (last[1] + binding.offset[1]) / h;
  const span = top - base;
  if (span < 0.018) throw new ArtFitError("This head area is too small to calibrate.");
  const [a, z, nose, mouth, chin] = marks;
  if (!a || !z || !nose || !mouth || !chin)
    throw new ArtFitError("Mark both pupils, nose, lips and chin in the front view.");
  const y = (p: readonly [number, number]) =>
    ((panel.feet - p[1] * panel.size) / panel.span - base) / span;
  const x = (p: readonly [number, number]) => (p[0] * panel.size - panel.mid) / panel.span;
  const eyes = (y(a) + y(z)) * 0.5;
  const width = Math.abs(x(a) - x(z)) / (0.85 * span);
  if (
    width < 0.08 ||
    width > 0.8 ||
    Math.abs(y(a) - y(z)) > 0.16 ||
    eyes >= 1 ||
    y(chin) < -0.025 ||
    !(eyes > y(nose) && y(nose) > y(mouth) && y(mouth) > y(chin))
  )
    throw new ArtFitError(
      "Check the five landmarks. Both pupils must sit above the nose, lips and chin, inside the head region.",
    );
  return {
    center: 0,
    width,
    eyes,
    nose: y(nose),
    mouth: y(mouth),
    chin: Math.max(0, y(chin)),
    frame: { base, span, centerX: (x(a) + x(z)) * 0.5 },
  };
}

/** The fields of an `irudd.trace-map.v1` region a fit reads. */
export interface TraceRegionInput {
  readonly id: string;
  readonly parent?: string;
  readonly method: string;
  readonly front?: ReadonlyArray<unknown>;
  readonly side?: ReadonlyArray<unknown>;
  readonly spine?: ReadonlyArray<unknown>;
  readonly faceLandmarks?: ReadonlyArray<readonly [number, number]>;
  readonly depthPairs?: ReadonlyArray<readonly [number, number, number, number, number]>;
}

export interface TraceFit {
  readonly operations: Operation[];
  /** The region fitted onto the part. */
  readonly region: string;
  readonly landmarks: boolean;
  readonly pins: number;
  /** What the reply carried that this fit did not apply, for the person and the agent. */
  readonly notes: ReadonlyArray<string>;
}

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[\s_.-]+/g, " ");

/**
 * The region of a trace map that describes the target: the one named like
 * the part (its ID, label or traced region), or else the only region carrying
 * a fit, as an isolated portrait's root does.
 */
export function targetRegion(
  part: Part,
  regions: ReadonlyArray<TraceRegionInput>,
): TraceRegionInput {
  const paint = figurePaint.read(part.features);
  const names = new Set(
    [part.id, part.id.replace(/^p-/, ""), part.label, paint?.region].flatMap((n) =>
      n ? [norm(n)] : [],
    ),
  );
  const named = regions.filter((r) => names.has(norm(r.id)));
  if (named.length === 1 && named[0]) return named[0];
  const fitted = regions.filter((r) => r.faceLandmarks || r.depthPairs?.length);
  if (named.length === 0 && fitted.length === 1 && fitted[0]) return fitted[0];
  throw new ArtFitError(
    `Name the trace region for ${part.id} by its ID or label, or give exactly one region faceLandmarks or depthPairs.`,
  );
}

/**
 * The operations that fit a trace map's region onto the target: its face
 * landmarks calibrate the face and its depth pairs add depth pins. `front`
 * and `side` are the target sheet's first two panels.
 */
export function traceFitOperations(
  doc: CharacterDocument,
  partId: string,
  regions: ReadonlyArray<TraceRegionInput>,
  front: PanelFrame,
  side: PanelFrame,
): TraceFit {
  const part = traceTarget(doc, [partId]);
  const binding = loftBinding(part);
  const region = targetRegion(part, regions);
  const notes: string[] = [];
  const others = regions.filter((r) => r !== region).map((r) => r.id);
  if (others.length)
    notes.push(
      `Not built: ${others.join(", ")} (this brief fits one part; a trace brief that builds adds regions as parts).`,
    );
  if (region.method !== "loft" || region.front?.length || region.side?.length || region.spine)
    notes.push(
      `${part.id} keeps its traced cross sections; the ${region.method} outlines are kept with the reply only.`,
    );
  const ops: Operation[] = [];
  let portrait: PortraitLandmarks | undefined;
  if (region.faceLandmarks) {
    portrait = registerFace(binding, region.faceLandmarks, front);
    if (figureAnatomy.read(part.features)?.region !== "face")
      ops.push({
        op: "feature.set",
        feature: feature(figureAnatomy.id),
        part: part.id,
        value: figureAnatomy.json({ region: "face" }),
      });
    if (!motionRole.read(part.features))
      ops.push({
        op: "feature.set",
        feature: feature(motionRole.id),
        part: part.id,
        value: motionRole.json({ role: "head" }),
      });
    const wear = outfitWear.read(part.features);
    if (wear?.role === undefined)
      ops.push({
        op: "feature.set",
        feature: feature(outfitWear.id),
        part: part.id,
        value: outfitWear.json({ ...wear, role: "head" }),
      });
    ops.push({
      op: "feature.set",
      feature: feature(figurePaint.id),
      part: part.id,
      value: figurePaint.json({ ...binding, portrait }),
    });
  }
  const pairs = region.depthPairs ?? [];
  const prior = figurePortraitDepth.read(part.features);
  const existing = prior?.pins ?? [];
  const pins: DepthPin[] = [];
  const missed: number[] = [];
  // Match independent sight lines: an uncertain point does not discard the others.
  for (const [i, pair] of pairs.entries()) {
    try {
      pins.push(pairDepth(binding, front, side, pair));
    } catch {
      missed.push(i + 1);
    }
  }
  const room = Math.max(0, 24 - existing.length);
  if (missed.length)
    notes.push(
      `Depth pairs ${missed.join(", ")} did not match at the same height in both views and were left out.`,
    );
  if (pins.length > room)
    notes.push(
      `${part.id} holds at most 24 depth pins; ${pins.length - room} of the new pins were left out.`,
    );
  const added = pins.slice(0, room);
  if (added.length)
    ops.push({
      op: "feature.set",
      feature: feature(figurePortraitDepth.id),
      part: part.id,
      value: figurePortraitDepth.json({ ...prior, pins: [...existing, ...added] }),
    });
  if (!ops.length)
    throw new ArtFitError(
      `Region ${region.id} fits nothing onto ${part.id}: give it faceLandmarks or depthPairs that match in both views.${notes.length ? ` ${notes.join(" ")}` : ""}`,
    );
  return {
    operations: ops,
    region: region.id,
    landmarks: portrait !== undefined,
    pins: added.length,
    notes,
  };
}

/** Plain JSON operations, as an art translator returns them. */
export function jsonOperations(ops: ReadonlyArray<Operation>): Json[] {
  const copy: unknown = JSON.parse(JSON.stringify(ops));
  if (!isJson(copy) || !isJsonArray(copy)) throw new ArtFitError("The fit produced no operations.");
  return [...copy];
}
