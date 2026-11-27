import * as T from "three";
import { Schema } from "effect";
import {
  createRegistry,
  familyFeatures,
  figureAnatomy,
  figureAssembly,
  figureHairCap,
  figureHeadLayer,
  figurePaint,
  figureSweep,
  motionRole,
  outfitWear,
  outfitRoles,
  PartId,
  requireDeclaredFeatures,
  sub,
  type AssetEntry,
  type CharacterDocument,
  type Json,
  type Part,
} from "@irudd/document";
import { buildCharacter, clayMaterials } from "../build.js";
import { graftComponent } from "../graft.js";
import type { HumanBody } from "../human/body.js";
import { headSpace } from "../surfaces/face.js";
import { fittedEditRefusal, type PaintedEdit } from "./art-fit.js";
import { fitHairCap } from "./fit-hair.js";
import { bipedTracks } from "./biped-tracks.js";
import { traceRegion } from "./trace.js";
import {
  silhouetteRuns,
  regionGeometry,
  type SheetPanels,
  type TraceBuildRegion,
} from "./trace-build.js";

const registry = createRegistry({ features: familyFeatures });
const id = () => Schema.decodeUnknownSync(PartId)("p-" + crypto.randomUUID());

function eyes(part: Part) {
  const paint = figurePaint.read(part.features);
  if (!paint?.portrait)
    throw new Error("The scalp fit needs an isolated face with five landmarks.");
  const frame = headSpace(paint),
    face = paint.portrait;
  const y = face.eyes * frame.height - frame.offset[1];
  const rows = figureSweep.read(part.features)?.knots ?? paint.rest;
  const at = rows.findIndex((row, i) => i > 0 && row[1] >= y);
  const upper = at < 0 ? rows.length - 1 : at;
  const a = rows[upper - 1],
    b = rows[upper];
  if (!a || !b) throw new Error("Missing face cross sections.");
  const depth = T.MathUtils.lerp(
    a[2] + a[4] * 0.89,
    b[2] + b[4] * 0.89,
    T.MathUtils.clamp((y - a[1]) / (b[1] - a[1] || 1), 0, 1),
  );
  return {
    point: new T.Vector3(face.center * frame.height - frame.offset[0], y, depth),
    size: frame.height * Math.sqrt(face.width * (face.eyes - face.chin)),
  };
}

function scalpPlacement(old: Part, face: Part, world: T.Matrix4) {
  const a = eyes(old),
    b = eyes(face);
  const ratio = T.MathUtils.clamp(a.size / b.size, 0.35, 3);
  return world
    .clone()
    .multiply(new T.Matrix4().makeTranslation(...a.point.toArray()))
    .multiply(new T.Matrix4().makeScale(ratio, ratio, ratio))
    .multiply(new T.Matrix4().makeTranslation(...b.point.negate().toArray()));
}

function hairChild(original: Part, scalp: T.Matrix4, world: T.Matrix4): Part {
  const cap = figureHairCap.read(original.features);
  if (!cap) throw new Error("The source hairstyle is missing.");
  const features: Record<string, Json> = {
    [figureHairCap.id]: figureHairCap.json({ ...cap, sourceOnly: true }),
    [figureHeadLayer.id]: figureHeadLayer.json({ layer: "hair" }),
    [motionRole.id]: motionRole.json({ role: "rigid" }),
    [figureAssembly.id]: figureAssembly.json({ order: 0 }),
  };
  for (const key of [figureSweep.id, figurePaint.id]) {
    const value = original.features[key];
    if (value !== undefined) features[key] = value;
  }
  const position = new T.Vector3(),
    rotation = new T.Quaternion(),
    size = new T.Vector3();
  scalp.clone().invert().multiply(world).decompose(position, rotation, size);
  return {
    id: id(),
    parent: original.id,
    label: original.label.slice(0, 112) + " hair",
    color: original.color,
    shape: original.shape,
    sculpt: [],
    position: position.toArray(),
    rotation: rotation.toArray(),
    size: size.toArray(),
    ...(original.paint ? { paint: original.paint } : {}),
    features,
  };
}

export function fittedPaintOperations(
  doc: CharacterDocument,
  action: PaintedEdit,
  target: Part | undefined,
  asset: AssetEntry,
  panels: SheetPanels,
  height: number,
  map: readonly TraceBuildRegion[],
  coverage: "open" | "closed",
  protectedIds: readonly string[],
  human?: HumanBody,
) {
  const refusal = fittedEditRefusal(action, target, protectedIds);
  if (refusal) throw new Error(refusal);
  const portrait =
    (action === "revise" ||
      action === "scalp" ||
      (action === "replace" && target && figureAnatomy.read(target.features)?.region === "face")) &&
    map.find((r) => !r.parent && r.faceLandmarks);
  let regions = portrait ? [{ ...portrait, method: "loft", front: [], side: [] }] : [...map];
  if (action === "scalp" && !portrait)
    throw new Error("Return the five landmarks of the clean scalp portrait.");
  let shellId: string | undefined;
  if (action === "wear" && coverage === "closed") {
    let name = "garment shell";
    while (regions.some((r) => r.id === name)) name += " outer";
    shellId = name;
    regions = [
      { id: name, method: "loft", front: [], side: [] },
      ...regions.map((r) => (r.parent ? r : { ...r, parent: name })),
    ];
  }
  const notes: string[] = [];
  function trace(r: TraceBuildRegion) {
    const shape = regionGeometry(r, panels, asset.digest, height);
    const features = { ...shape.features };
    const binding = figurePaint.read(features);
    if (binding?.portrait && action !== "scalp" && portrait && portrait.id === r.id) {
      const shapes =
        portrait.hairRegions ??
        map.flatMap((region) =>
          region.front?.length &&
          region.side?.length &&
          /hair|coiffure|fringe|bun|braid|locks/i.test(region.id)
            ? [{ id: region.id, front: region.front, side: region.side }]
            : [],
        );
      const cap = fitHairCap(binding, panels, shapes);
      if (cap) features[figureHairCap.id] = figureHairCap.json(cap);
    }
    if (binding && r.id === shellId) {
      const { region: _region, ...shell } = binding;
      features[figurePaint.id] = figurePaint.json(shell);
    }
    const part: Part = {
      id: id(),
      label: r.id,
      parent: null,
      shape: shape.shape,
      position: shape.position,
      rotation: [0, 0, 0, 1],
      size: [1, 1, 1],
      color: "#ffffff",
      sculpt: [],
      paint: { atlas: asset.digest },
      features: { ...features, [figureAssembly.id]: figureAssembly.json({ order: 0 }) },
    };
    notes.push(...shape.notes);
    return { region: r, part };
  }
  const traced = regions.flatMap((r) => {
    try {
      return [trace(r)];
    } catch (error) {
      notes.push(r.id + ": " + (error instanceof Error ? error.message : String(error)));
      return [];
    }
  });
  const mapped = traced.filter((t) => t.region.id !== shellId).length;
  const automatic = !traced.length || mapped < (regions.length - (shellId ? 1 : 0)) * 0.7;
  const uncalibrated = notes.filter((note) => note.includes("faceLandmarks were left out")).length;
  const fit = {
    needsRepair: !map.length || automatic || traced.length !== regions.length || uncalibrated > 0,
    score: automatic ? -1 : mapped * 100 - uncalibrated,
  };
  if (automatic) {
    if (protectedIds.length && action === "whole")
      throw new Error("The map could not match the protected regions.");
    try {
      const tracks = bipedTracks((view, h) => silhouetteRuns(panels[view], h));
      const generated = tracks.map(({ id: label, role, parent, track, options }) => {
        const { atlas: _atlas, ...binding } = traceRegion(
          panels,
          asset.digest,
          label,
          height,
          track,
          options.samples,
          options.pivot,
          options.profile,
        );
        const region: TraceBuildRegion = {
          id: label,
          method: "loft",
          ...(parent ? { parent } : {}),
          outfitRole: role,
        };
        const wear = outfitRoles.find((r) => r === role);
        const part: Part = {
          id: id(),
          label,
          parent: null,
          shape: "capsule",
          rotation: [0, 0, 0, 1],
          size: [1, 1, 1],
          position: binding.offset,
          color: "#ffffff",
          sculpt: [],
          paint: { atlas: asset.digest },
          features: {
            [figurePaint.id]: figurePaint.json(binding),
            [figureSweep.id]: figureSweep.json({ knots: binding.rest }),
            [figureAssembly.id]: figureAssembly.json({ order: 0 }),
            ...(wear ? { [outfitWear.id]: outfitWear.json({ role: wear }) } : {}),
            ...(role === "head"
              ? { [figureAnatomy.id]: figureAnatomy.json({ region: "face" }) }
              : {}),
          },
        };
        return { region, part };
      });
      traced.splice(0, traced.length, ...generated);
      if (shellId) {
        const shell = trace({ id: shellId, method: "loft", front: [], side: [] });
        for (const piece of traced)
          if (!piece.region.parent) piece.region = { ...piece.region, parent: shellId };
        traced.unshift(shell);
      }
      notes.push("Used the automatic biped fit.");
    } catch {
      traced.splice(
        0,
        traced.length,
        trace({
          id: shellId ?? "painted volume",
          method: shellId ? "loft" : "volume",
          front: [],
          side: [],
        }),
      );
      notes.push("Used one silhouette volume.");
    }
  }
  const root = traced.find((t) => !t.region.parent) ?? traced[0];
  if (!root) throw new Error("The returned sheet has no fitted regions.");
  const parts = traced.map(({ part, region }) => {
    let ancestor = region.parent;
    const visited = new Set<string>();
    while (ancestor && !visited.has(ancestor) && !traced.some((t) => t.region.id === ancestor)) {
      visited.add(ancestor);
      ancestor = regions.find((r) => r.id === ancestor)?.parent;
    }
    const parent =
      traced.find((t) => t.region.id === ancestor) ??
      (part !== root.part && action !== "whole" ? root : undefined);
    return parent
      ? { ...part, parent: parent.part.id, position: sub(part.position, parent.part.position) }
      : part;
  });
  const source = requireDeclaredFeatures(
    {
      format: "irudd.character",
      version: 1,
      id: doc.id,
      label: doc.label,
      requires: [],
      catalog: [],
      assets: [asset],
      parts,
      poses: [],
      features: {},
      extensions: {},
    },
    registry,
  );
  if (action === "whole") {
    const pinned = new Map<string, Part>();
    for (const key of protectedIds) {
      const old = doc.parts.find((p) => p.id === key);
      const next = old && parts.find((p) => p.label === old.label || p.label === key);
      if (!old || !next) throw new Error("The map has no region for protected " + key + ".");
      pinned.set(next.id, old);
    }
    const operations: object[] = [];
    if (!doc.assets.some((a) => a.digest === asset.digest))
      operations.push({ op: "asset.add", asset });
    for (const p of parts) {
      const old = pinned.get(p.id);
      const parent = (p.parent && pinned.get(p.parent)?.id) ?? p.parent;
      if (old)
        operations.push({
          op: "part.set",
          part: old.id,
          set: { position: p.position, rotation: p.rotation, parent },
        });
      else operations.push({ op: "part.add", part: { ...p, parent } });
    }
    const saved = new Set([...pinned.values()].map((p) => p.id));
    for (const p of doc.parts)
      if (!saved.has(p.id) && (!p.parent || saved.has(p.parent)))
        operations.push({ op: "part.remove", part: p.id, cascade: true });
    return { operations, notes, fit };
  }
  if (!target) throw new Error("Select the receiving part.");
  const donor = buildCharacter(source, { materials: clayMaterials() });
  try {
    const dest = buildCharacter(doc, { materials: clayMaterials(), human });
    try {
      dest.group.updateMatrixWorld(true);
      const world = dest.parts.get(target.id)?.object.matrixWorld;
      const scalp =
        action === "scalp" && world ? scalpPlacement(target, root.part, world) : undefined;
      const graft = graftComponent(
        source,
        root.part,
        donor,
        doc,
        target,
        dest,
        action === "wear" ? "Wear in current outfit" : "Replace part, keep children",
        true,
        human,
        true,
        scalp,
      );
      if (scalp && world) graft.ops.push({ op: "part.add", part: hairChild(target, scalp, world) });
      return { operations: graft.ops, notes, fit };
    } finally {
      dest.dispose();
    }
  } finally {
    donor.dispose();
  }
}
