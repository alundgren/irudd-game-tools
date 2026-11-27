import {
  requireDeclaredFeatures,
  type AssetEntry,
  type DocumentId,
  affineFromTrs,
  composeAffine,
  createRegistry,
  decomposeAffine,
  familyFeatures,
  figureAnatomy,
  figureAssembly,
  figureHull,
  figurePaint,
  figurePortraitDepth,
  figureSweep,
  identityAffine,
  invertAffine,
  motionRole,
  motionRoles,
  outfitRoles,
  outfitWear,
  partPlacements,
  PartId,
  sub,
  affineScaled,
  type Affine,
  type CharacterDocument,
  type DepthPin,
  type Digest,
  type FigureHull,
  type FigurePaint,
  type Json,
  type Operation,
  type Part,
  type Vec3,
} from "@irudd/document";
import { Schema } from "effect";
import { ArtFitError, pairDepth, registerFace, type TraceRegionInput } from "./art-fit.js";
import type { Panel } from "./panel.js";
import { traceRegion, type TrackRow } from "./trace.js";

export type SheetPanels = readonly [Panel, Panel, Panel, Panel];

export interface HairOutline {
  readonly id: string;
  readonly front: readonly (readonly [number, number])[];
  readonly side: readonly (readonly [number, number])[];
}

export interface TraceBuildRegion extends TraceRegionInput {
  readonly hairRegions?: readonly HairOutline[];
  readonly front?: ReadonlyArray<readonly [number, number]>;
  readonly side?: ReadonlyArray<readonly [number, number]>;
  readonly spine?: ReadonlyArray<readonly [number, number, number, number, number, number]>;
  readonly correspondence?: "same" | "opposite";
  readonly thickness?: number;
  readonly outfitRole?: string;
  readonly motionRole?: string;
}

const partId = Schema.decodeUnknownSync(PartId);
const registry = createRegistry({ features: familyFeatures });

const guideHeight = (p: Panel, y: number) => (p.feet - y * p.size) / p.span;
const guidePosition = (p: Panel, h: number) => (p.feet - h * p.span) / p.size;

type Point = readonly [number, number];

function polygonInterval(
  points: ReadonlyArray<Point>,
  y: number,
): readonly [number, number] | null {
  const hits: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (!a || !b) continue;
    if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y))
      hits.push(a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]));
  }
  return hits.length >= 2 ? [Math.min(...hits), Math.max(...hits)] : null;
}

function outlineHeights(
  panels: SheetPanels,
  outlines: readonly [ReadonlyArray<Point>, ReadonlyArray<Point>],
): readonly [number, number] {
  let low = 0.001;
  let high = 0.999;
  for (const [view, points] of outlines.entries()) {
    if (!points.length) continue;
    const ys = points.map((p) => guideHeight(panels[view] ?? panels[0], p[1]));
    low = Math.max(low, Math.min(...ys));
    high = Math.min(high, Math.max(...ys));
  }
  if (high <= low) throw new ArtFitError("The front and profile outlines must overlap in height.");
  return [low, high];
}

export function silhouetteRuns(p: Panel, height: number, bridge = 0.011): Array<[number, number]> {
  const y = Math.max(0, Math.min(p.size - 1, Math.round(p.feet - height * p.span)));
  const runs: Array<[number, number]> = [];
  for (let x = 0; x < p.size; x++) {
    if (!p.mask[y * p.size + x]) continue;
    const u = (x - p.mid) / p.span;
    const last = runs[runs.length - 1];
    if (last && u - last[1] <= bridge) last[1] = u;
    else runs.push([u, u]);
  }
  return runs.filter(([a, b]) => b - a >= 0.003);
}

export function traceOutline(
  panels: SheetPanels,
  atlas: Digest,
  id: string,
  height: number,
  outlines: readonly [ReadonlyArray<Point>, ReadonlyArray<Point>],
) {
  const tracks: TrackRow[] = [];
  const [low, high] = outlineHeights(panels, outlines);
  for (let i = 0; i < 42; i++) {
    const h = low + ((high - low) * (i + 0.01)) / 41.02;
    const edges: number[] = [];
    for (let v = 0; v < 2; v++) {
      const p = panels[v] ?? panels[0];
      const y = guidePosition(p, h);
      const outline = outlines[v] ?? [];
      const interval = outline.length ? polygonInterval(outline, y) : ([0, 1] as const);
      if (!interval) break;
      const l = (interval[0] * p.size - p.mid) / p.span;
      const r = (interval[1] * p.size - p.mid) / p.span;
      edges.push(...(v === 0 ? [l, r] : [-r, -l]));
    }
    const [a = 0, b = 0, c = 0, d = 0] = edges;
    if (edges.length === 4) tracks.push([h, a, b, c, d]);
  }
  if (tracks.length < 2)
    throw new ArtFitError(
      "The front and profile outlines must overlap in height. Widen the selected region.",
    );
  try {
    return traceRegion(
      panels,
      atlas,
      id,
      height,
      tracks,
      Math.min(42, Math.max(12, tracks.length)),
    );
  } catch (error) {
    throw new ArtFitError(error instanceof Error ? error.message : String(error));
  }
}

type HullRow = readonly [number, Array<[number, number]>, Array<[number, number]>];

export function traceHull(
  panels: SheetPanels,
  height: number,
  outlines: readonly [ReadonlyArray<Point>, ReadonlyArray<Point>],
): { readonly hull: FigureHull; readonly position: Vec3 } {
  const rows: HullRow[] = [];
  const [low, high] = outlineHeights(panels, outlines);
  for (let j = 0; j < 89; j++) {
    const h = low + ((high - low) * (j + 0.01)) / 88.02;
    const spans: Array<Array<[number, number]>> = [];
    for (let v = 0; v < 2; v++) {
      const p = panels[v] ?? panels[0];
      const outline = outlines[v] ?? [];
      const span = outline.length
        ? polygonInterval(outline, guidePosition(p, h))
        : ([0, 1] as const);
      if (!span) break;
      const a = (span[0] * p.size - p.mid) / p.span;
      const b = (span[1] * p.size - p.mid) / p.span;
      const runs = silhouetteRuns(p, h, 0.005)
        .map(([l, r]): [number, number] => [Math.max(a, l), Math.min(b, r)])
        .filter(([l, r]) => r - l > 0.005);
      spans.push(v === 0 ? runs : runs.reverse().map(([l, r]): [number, number] => [-r, -l]));
    }
    const [front, side] = spans;
    rows.push(spans.length === 2 && front?.length && side?.length ? [h, front, side] : [h, [], []]);
  }
  while (rows.length && !rows[0]?.[1].length) rows.shift();
  while (rows.length && !rows[rows.length - 1]?.[1].length) rows.pop();
  if (rows.filter((r) => r[1].length).length < 3)
    throw new ArtFitError("Select a larger overlapping region.");
  if (rows.some((r) => !r[1].length))
    throw new ArtFitError(
      "Its outlines leave a gap with no silhouette inside the volume; outline each piece as its own region.",
    );
  const middle = (intervals: ReadonlyArray<readonly [number, number]>) =>
    (Math.min(...intervals.map((x) => x[0])) + Math.max(...intervals.map((x) => x[1]))) / 2;
  const first = rows[0];
  if (!first) throw new ArtFitError("Select a larger overlapping region.");
  const pivot: Vec3 = [
    middle(rows.flatMap((r) => r[1])),
    first[0],
    middle(rows.flatMap((r) => r[2])),
  ];
  const frame = (p: Panel) => [p.mid / p.size, p.feet / p.size, p.span / p.size] as const;
  return {
    hull: {
      height,
      rows,
      pivot,
      frames: [frame(panels[0]), frame(panels[1]), frame(panels[2]), frame(panels[3])],
      resolution: 64,
    },
    position: [pivot[0] * height, pivot[1] * height, pivot[2] * height],
  };
}

export function tracePath(
  panels: SheetPanels,
  height: number,
  spine: ReadonlyArray<ReadonlyArray<number>>,
): { readonly paint: FigurePaint; readonly position: Vec3 } {
  if (spine.length < 2 || spine.length > 48)
    throw new ArtFitError("Mark 2 to 48 matching centreline points.");
  const [f, s] = panels;
  const knots = spine.map((row) => {
    if (
      row.length !== 6 ||
      !row.every(Number.isFinite) ||
      row.slice(0, 4).some((v) => v < 0 || v > 1) ||
      row.slice(4).some((v) => v <= 0 || v > 0.6)
    )
      throw new ArtFitError(
        "Each path point needs matching front/profile coordinates and two positive radii.",
      );
    const [fx = 0, fy = 0, sx = 0, sy = 0, rw = 0, rd = 0] = row;
    const yf = guideHeight(f, fy);
    const ys = guideHeight(s, sy);
    if (Math.abs(yf - ys) > 0.15)
      throw new ArtFitError("A paired path landmark lies at different heights in the two views.");
    return [
      ((fx * f.size - f.mid) / f.span) * height,
      (yf + ys) * 0.5 * height,
      ((s.mid - sx * s.size) / s.span) * height,
      Math.max(0.0006, rw * height),
      Math.max(0.0006, rd * height),
    ] as const;
  });
  const [first] = knots;
  if (!first) throw new ArtFitError("Mark 2 to 48 matching centreline points.");
  const pivot: Vec3 = [first[0], first[1], first[2]];
  const rest = knots.map(
    (k) => [k[0] - pivot[0], k[1] - pivot[1], k[2] - pivot[2], k[3], k[4]] as const,
  );
  return { paint: { height, offset: pivot, rest, frame: "path" }, position: pivot };
}

const isMotion = (r: string): r is (typeof motionRoles)[number] => motionRoles.some((m) => m === r);
const isOutfit = (r: string): r is (typeof outfitRoles)[number] => outfitRoles.some((m) => m === r);

function inferRole(id: string, outfit: string | undefined, face: boolean): string {
  const name = id.toLowerCase();
  if (/wing/.test(name) && (!/(rib|spar|plate|fin)/.test(name) || /leading.spar/.test(name)))
    return "wing";
  if (outfit) return outfit;
  if (face || /(?:^|[- ])head(?:$|[- ])/.test(name)) return "head";
  if (name === "spine" || name === "torso") return "torso";
  if (
    /^(left|right)[- ](foreleg|hindleg|leg)$/.test(name) ||
    /walking leg|load bearing leg/.test(name)
  )
    return "thigh";
  if (/bent arm|power arm/.test(name)) return "upper arm";
  if (/tail/.test(name)) return "tail";
  if (/foot|feet/.test(name)) return "foot";
  return "rigid";
}

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[\s_.-]+/g, " ");

function sheetPoint(part: Part): Vec3 | undefined {
  const binding = figurePaint.read(part.features);
  if (binding) return binding.offset;
  const hull = figureHull.read(part.features);
  if (hull)
    return [hull.pivot[0] * hull.height, hull.pivot[1] * hull.height, hull.pivot[2] * hull.height];
  return undefined;
}

function sheetHeight(part: Part): number | undefined {
  return figurePaint.read(part.features)?.height ?? figureHull.read(part.features)?.height;
}

export function buildAnchorRefusal(part: Part): string | undefined {
  if (!part.paint || sheetPoint(part) === undefined)
    return `${part.id} is not painted from a turnaround sheet: select a traced part of the sheet to build on.`;
  return undefined;
}

export function buildAnchor(
  doc: CharacterDocument,
  parts: ReadonlyArray<string> | undefined,
): Part {
  if (!parts?.length) throw new ArtFitError("Select a painted part of the sheet to build on.");
  if (parts.length > 1) throw new ArtFitError("Select one painted part of the sheet to build on.");
  const part = doc.parts.find((p) => p.id === parts[0]);
  if (!part) throw new ArtFitError(`This revision has no part ${parts[0] ?? ""}.`);
  const refusal = buildAnchorRefusal(part);
  if (refusal) throw new ArtFitError(refusal);
  return part;
}

export interface BuiltPart {
  readonly region: string;
  readonly method: string;
  readonly part: Part;
}

export interface TraceBuild {
  readonly operations: Operation[];
  readonly built: ReadonlyArray<BuiltPart>;
  readonly kept: ReadonlyArray<{ readonly region: string; readonly part: string }>;
  readonly missed: ReadonlyArray<{ readonly region: string; readonly reason: string }>;
  readonly notes: ReadonlyArray<string>;
}

function newId(name: string, taken: Set<string>): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 52) || "region";
  let id = `p-${slug}`;
  for (let n = 2; taken.has(id); n++) id = `p-${slug}-${n}`;
  taken.add(id);
  return id;
}

interface Geometry {
  readonly shape: "capsule" | "box";
  readonly position: Vec3;
  readonly features: Record<string, Json>;
  readonly notes: string[];
}

export function regionGeometry(
  r: TraceBuildRegion,
  panels: SheetPanels,
  atlas: Digest,
  height: number,
): Geometry {
  const notes: string[] = [];
  const features: Record<string, Json> = {};
  let position: Vec3;
  let shape: "capsule" | "box";
  let loft: FigurePaint | undefined;
  if (r.method === "path") {
    const traced = tracePath(panels, height, r.spine ?? []);
    position = traced.position;
    shape = "capsule";
    loft = traced.paint;
    features[figureSweep.id] = figureSweep.json({ knots: traced.paint.rest });
    features[figurePaint.id] = figurePaint.json(traced.paint);
  } else {
    const outlines = [r.front ?? [], r.side ?? []] as const;
    if (r.method === "loft") {
      const { atlas: _atlas, ...binding } = traceOutline(panels, atlas, r.id, height, outlines);
      position = binding.offset;
      shape = "capsule";
      loft = binding;
      features[figureSweep.id] = figureSweep.json({ knots: binding.rest });
      features[figurePaint.id] = figurePaint.json(binding);
    } else {
      const traced = traceHull(panels, height, outlines);
      let hull = traced.hull;
      if (r.method === "membrane") {
        if (r.correspondence !== "same" && r.correspondence !== "opposite")
          throw new ArtFitError("Choose same or opposite edge correspondence in the two pictures.");
        hull = {
          ...hull,
          membrane: {
            slope: r.correspondence === "same" ? -1 : 1,
            thickness: r.thickness ?? 0.016,
          },
        };
      }
      position = traced.position;
      shape = "box";
      features[figureHull.id] = figureHull.json(hull);
    }
  }
  let face = false;
  if (r.faceLandmarks) {
    if (!loft || loft.frame === "path")
      notes.push(`${r.id}'s faceLandmarks were left out: only a loft region can be a face.`);
    else
      try {
        const portrait = registerFace(loft, r.faceLandmarks, panels[0]);
        loft = { ...loft, portrait };
        features[figurePaint.id] = figurePaint.json(loft);
        features[figureAnatomy.id] = figureAnatomy.json({ region: "face" });
        face = true;
      } catch (error) {
        if (!(error instanceof ArtFitError)) throw error;
        notes.push(`${r.id}'s faceLandmarks were left out: ${error.message}`);
      }
  }
  const pairs = r.depthPairs ?? [];
  if (pairs.length) {
    if (!loft || loft.frame === "path")
      notes.push(`${r.id}'s depthPairs were left out: only a loft region takes depth pins.`);
    else {
      const pins: DepthPin[] = [];
      for (const pair of pairs.slice(0, 24))
        try {
          pins.push(pairDepth(loft, panels[0], panels[1], pair));
        } catch {}
      if (pins.length < pairs.length)
        notes.push(
          `${pairs.length - pins.length} of ${r.id}'s depthPairs did not match at the same height in both views and were left out.`,
        );
      if (pins.length) features[figurePortraitDepth.id] = figurePortraitDepth.json({ pins });
    }
  }
  let outfit: string | undefined;
  if (r.outfitRole !== undefined) {
    if (isOutfit(r.outfitRole)) outfit = r.outfitRole;
    else notes.push(`${r.id}'s outfitRole ${r.outfitRole} is not an outfit role and was left out.`);
  }
  if (face) outfit ??= "head";
  let motion: string | undefined;
  if (r.motionRole !== undefined) {
    if (isMotion(r.motionRole)) motion = r.motionRole;
    else
      notes.push(`${r.id}'s motionRole ${r.motionRole} is not a movement role and was left out.`);
  }
  if (face) motion ??= "head";
  const role = motion ?? inferRole(r.id, outfit, face);
  if (isMotion(role)) features[motionRole.id] = motionRole.json({ role });
  if (outfit !== undefined && isOutfit(outfit))
    features[outfitWear.id] = outfitWear.json({ role: outfit });
  return { shape, position, features, notes };
}

export function traceRoot(
  id: DocumentId,
  label: string,
  asset: AssetEntry,
  panels: SheetPanels,
  outlines: readonly [readonly Point[], readonly Point[]],
): CharacterDocument {
  const g = regionGeometry(
    { id: label, method: "loft", front: outlines[0], side: outlines[1] },
    panels,
    asset.digest,
    1.72,
  );
  return requireDeclaredFeatures(
    {
      format: "irudd.character",
      version: 1,
      id,
      label,
      requires: [],
      catalog: [],
      assets: [asset],
      parts: [
        {
          id: partId("p-traced-body"),
          label,
          parent: null,
          shape: g.shape,
          position: g.position,
          size: [1, 1, 1],
          rotation: [0, 0, 0, 1],
          color: "#ffffff",
          sculpt: [],
          paint: { atlas: asset.digest },
          features: g.features,
        },
      ],
      poses: [],
      features: {},
      extensions: {},
    },
    registry,
  );
}

export function traceBuildOperations(
  doc: CharacterDocument,
  anchorId: string,
  regions: ReadonlyArray<TraceBuildRegion>,
  panels: SheetPanels,
  mapHeight?: number,
): TraceBuild {
  const anchor = buildAnchor(doc, [anchorId]);
  const atlas = anchor.paint?.atlas;
  const origin = sheetPoint(anchor);
  const height = sheetHeight(anchor);
  if (!atlas || !origin || height === undefined)
    throw new ArtFitError(`${anchor.id} is not painted from a turnaround sheet.`);
  const notes: string[] = [];
  if (mapHeight !== undefined && Math.abs(mapHeight - height) > height * 0.01)
    notes.push(
      `The map's height ${mapHeight} m was replaced by the sheet's ${Math.round(height * 1000) / 1000} m, so the new parts register with ${anchor.id}.`,
    );
  const placements = partPlacements(doc, registry);
  const anchorFrame = placements.get(anchor.id)?.frame;
  if (!anchorFrame) throw new ArtFitError(`${anchor.id} cannot be placed.`);
  const existing = new Map<string, Part>();
  for (const r of regions) {
    const match = doc.parts.filter((p) => {
      const region = figurePaint.read(p.features)?.region;
      const sameSheet = p.paint?.atlas === atlas;
      return (
        norm(p.id) === norm(r.id) ||
        norm(p.id.replace(/^p-/, "")) === norm(r.id) ||
        norm(p.label) === norm(r.id) ||
        (sameSheet && region !== undefined && norm(region) === norm(r.id))
      );
    });
    const [only] = match;
    if (match.length === 1 && only) existing.set(r.id, only);
  }
  const byId = new Map(regions.map((r) => [r.id, r]));
  const ordered: TraceBuildRegion[] = [];
  const visiting = new Set<string>();
  const visit = (r: TraceBuildRegion) => {
    if (ordered.includes(r) || visiting.has(r.id)) return;
    visiting.add(r.id);
    const parent = r.parent === undefined ? undefined : byId.get(r.parent);
    if (parent) visit(parent);
    ordered.push(r);
  };
  for (const r of regions) visit(r);

  const taken = new Set<string>(doc.parts.map((p) => p.id));
  const kept: Array<{ region: string; part: string }> = [];
  const missed: Array<{ region: string; reason: string }> = [];
  const built: BuiltPart[] = [];
  const placed = new Map<string, { readonly id: string; readonly children: Affine }>();
  let order =
    Math.max(-1, ...doc.parts.map((p) => figureAssembly.read(p.features)?.order ?? -1)) + 1;
  for (const r of ordered) {
    const own = existing.get(r.id);
    if (own) {
      kept.push({ region: r.id, part: own.id });
      const children = placements.get(own.id)?.children;
      if (children) placed.set(r.id, { id: own.id, children });
      continue;
    }
    let parentRegion = r.parent;
    const seen = new Set<string>();
    while (parentRegion !== undefined && !placed.has(parentRegion) && !seen.has(parentRegion)) {
      seen.add(parentRegion);
      parentRegion = byId.get(parentRegion)?.parent;
    }
    const parent = parentRegion === undefined ? undefined : placed.get(parentRegion);
    let geometry: Geometry;
    try {
      geometry = regionGeometry(r, panels, atlas, height);
    } catch (error) {
      if (!(error instanceof ArtFitError)) throw error;
      missed.push({ region: r.id, reason: error.message });
      continue;
    }
    const world = composeAffine(
      anchorFrame,
      affineFromTrs(sub(geometry.position, origin), [0, 0, 0, 1]),
    );
    const basis = parent?.children ?? identityAffine;
    const inverse = invertAffine(basis);
    const local = inverse && decomposeAffine(composeAffine(inverse, world), 1e-6);
    if (!local) {
      missed.push({
        region: r.id,
        reason: `it cannot be placed under ${parent?.id ?? "the document"} without shearing.`,
      });
      continue;
    }
    const id = newId(r.id, taken);
    const part: Part = {
      id: partId(id),
      label: r.id.slice(0, 120),
      parent: parent ? partId(parent.id) : null,
      shape: geometry.shape,
      position: local.position,
      rotation: local.rotation,
      size: local.size,
      color: "#ffffff",
      sculpt: [],
      paint: { atlas },
      features: {
        [figureAssembly.id]: figureAssembly.json({ order: order }),
        ...geometry.features,
      },
    };
    try {
      for (const f of [
        figureAssembly,
        figureSweep,
        figurePaint,
        figureHull,
        figureAnatomy,
        figurePortraitDepth,
        motionRole,
        outfitWear,
      ])
        f.read(part.features);
    } catch (error) {
      missed.push({
        region: r.id,
        reason: `the document cannot hold its geometry (${error instanceof Error ? error.message : String(error)}).`,
      });
      taken.delete(id);
      continue;
    }
    order++;
    notes.push(...geometry.notes);
    built.push({ region: r.id, method: r.method, part });
    placed.set(r.id, {
      id,
      children: affineScaled(
        composeAffine(basis, affineFromTrs(local.position, local.rotation)),
        local.size,
      ),
    });
  }
  if (!built.length)
    throw new ArtFitError(
      `No region of the map could be built on ${anchor.id}'s sheet.${missed.length ? " " + missed.map((m) => `${m.region}: ${m.reason}`).join(" ") : ""}${kept.length ? ` ${kept.map((k) => k.region).join(", ")} name existing parts, which stay as they are.` : ""}`,
    );
  if (kept.length)
    notes.push(
      `Kept as they are: ${kept.map((k) => (norm(k.region) === norm(k.part) ? k.part : `${k.region} (${k.part})`)).join(", ")}.`,
    );
  if (missed.length)
    notes.push(
      `Not built: ${missed.map((m) => `${m.region} (${m.reason.replace(/\.$/, "")})`).join("; ")}.`,
    );
  const operations: Operation[] = built.map(({ part }) => ({ op: "part.add", part }));
  return { operations, built, kept, missed, notes };
}
