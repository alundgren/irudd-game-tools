import { Schema } from "effect";
import {
  FeatureId,
  figureOccluders,
  figurePaint,
  occluderOrder,
  type AssetEntry,
  type CharacterDocument,
  type Digest,
  type Operation,
  type PaintSource,
  type PartId,
} from "@irudd/document";

const key = (atlas: Digest, region: string | undefined) => `${atlas}\u001f${region ?? ""}`;

function sources(doc: CharacterDocument): PaintSource[] {
  const regions = new Map<string, PaintSource>();
  const all: PaintSource[] = [
    ...(figureOccluders.read(doc.features)?.sources ?? []),
    ...doc.parts.flatMap((p) => {
      const trace = figurePaint.read(p.features);
      return p.paint && trace?.region !== undefined
        ? [{ ...trace, region: trace.region, atlas: p.paint.atlas }]
        : [];
    }),
  ];
  for (const s of all) regions.set(key(s.atlas, s.region), s);
  return [...regions.values()];
}

function retained(
  painted: ReadonlyArray<{ readonly atlas: Digest; readonly region: string }>,
  prior: ReadonlyArray<PaintSource>,
  candidates: ReadonlyArray<PaintSource>,
): PaintSource[] {
  const active = new Set(painted.map((p) => p.atlas));
  const visible = new Set(painted.map((p) => key(p.atlas, p.region)));
  const hidden = new Map<string, PaintSource>();
  for (const s of [...prior, ...candidates]) {
    const k = key(s.atlas, s.region);
    if (active.has(s.atlas) && !visible.has(k)) hidden.set(k, s);
  }
  return [...hidden.values()].sort(occluderOrder);
}

const occludersFeature = Schema.decodeUnknownSync(FeatureId)(figureOccluders.id);

export function retainRemovedPaint(doc: CharacterDocument, removed: readonly string[]): Operation {
  const painted = doc.parts.flatMap((p) => {
    if (removed.includes(p.id) || !p.paint) return [];
    const region = figurePaint.read(p.features)?.region;
    return region ? [{ atlas: p.paint.atlas, region }] : [];
  });
  const hidden = retained(painted, [], sources(doc));
  return {
    op: "feature.set",
    feature: occludersFeature,
    value: hidden.length ? figureOccluders.json({ sources: hidden }) : null,
  };
}

export function paintedBranch(
  doc: CharacterDocument,
  target: string,
  locked: ReadonlySet<string>,
): PartId[] {
  const atlas = doc.parts.find((p) => p.id === target)?.paint?.atlas;
  if (!atlas || locked.has(target)) return [];
  const branch = new Set([target]);
  let count = 0;
  while (count !== branch.size) {
    count = branch.size;
    for (const part of doc.parts)
      if (part.parent && branch.has(part.parent) && !locked.has(part.id)) branch.add(part.id);
  }
  return doc.parts.filter((p) => branch.has(p.id) && p.paint?.atlas === atlas).map((p) => p.id);
}

export class RepaintError extends Error {}

export function repaintOperations(
  doc: CharacterDocument,
  parts: ReadonlyArray<PartId>,
  sheet: AssetEntry,
): Operation[] {
  if (!parts.length || parts.length > 128)
    throw new RepaintError("Choose a turnaround and at least one painted region.");
  const selected = new Set(parts);
  const chosen = doc.parts.filter((p) => selected.has(p.id));
  const oldAtlas = chosen[0]?.paint?.atlas;
  if (
    chosen.length !== selected.size ||
    oldAtlas === undefined ||
    chosen.some((p) => p.paint?.atlas !== oldAtlas)
  )
    throw new RepaintError("Choose regions painted from the same source sheet.");
  const prior = sources(doc);
  const painted = doc.parts.flatMap((p) => {
    const region = figurePaint.read(p.features)?.region;
    if (!p.paint || region === undefined) return [];
    return [{ atlas: selected.has(p.id) ? sheet.digest : p.paint.atlas, region }];
  });
  const occluders = retained(painted, figureOccluders.read(doc.features)?.sources ?? [], [
    ...prior,
    ...prior.filter((s) => s.atlas === oldAtlas).map((s) => ({ ...s, atlas: sheet.digest })),
  ]);
  const ops: Operation[] = [];
  if (!doc.assets.some((a) => a.digest === sheet.digest))
    ops.push({ op: "asset.add", asset: sheet });
  for (const p of chosen)
    ops.push({ op: "part.set", part: p.id, set: { paint: { ...p.paint, atlas: sheet.digest } } });
  ops.push({
    op: "feature.set",
    feature: occludersFeature,
    value: occluders.length ? figureOccluders.json({ sources: occluders }) : null,
  });
  return ops;
}
