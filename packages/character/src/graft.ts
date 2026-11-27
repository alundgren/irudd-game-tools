import * as T from "three";
import {
  characterAppearance,
  descendants,
  figureAssembly,
  figurePaint,
  figureFinish,
  figureMantle,
  figurePiece,
  figurePlateSite,
  figurePlateField,
  figureScapulaMount,
  figureScute,
  figureOccluders,
  humanCorrections,
  humanFineHead,
  humanRegionCopy,
  motionRole,
  outfitFit,
  outfitLayers,
  outfitWear,
  quatNormalize,
  occluderOrder,
  type CharacterDocument,
  type Part,
  type PartId,
  type PaintSource,
} from "@irudd/document";
import { copyDetailBranch, removeDetailBranches } from "./surface-edit.js";
import { cutGarment, partBounds } from "./garments.js";
import type { BuiltCharacter, BuiltPart } from "./build.js";
import { graftDependencies } from "./shape-tools.js";
import { humanSlotBone, humanMeasurements } from "./human/generator.js";
import { scapulaSocket } from "./human/sockets.js";
import { evaluateHuman } from "./human/surface.js";
import type { HumanBody } from "./human/body.js";
import { volumeBounds } from "./surfaces/volume.js";
import { isMesh } from "./mesh.js";
import { paintSources } from "./view.js";

const pieceBounds = {
  head: [
    [-0.12, -0.05, -0.12],
    [0.12, 0.37, 0.14],
  ],
  torso: [
    [-0.21, -0.1, -0.16],
    [0.21, 0.59, 0.16],
  ],
  "left arm": [
    [-0.073, -0.55, -0.09],
    [0.15, 0.08, 0.13],
  ],
  "right arm": [
    [-0.15, -0.55, -0.09],
    [0.073, 0.08, 0.13],
  ],
  "left leg": [
    [-0.1, -0.85, -0.12],
    [0.106, 0.027, 0.18],
  ],
  "right leg": [
    [-0.106, -0.85, -0.12],
    [0.1, 0.027, 0.18],
  ],
} as const;
export const graftModes = [
  "Replace part, keep children",
  "Wear in current outfit",
  "Recut garment pattern",
  "Replace whole branch",
  "Attach above selection",
] as const;
type Mode = (typeof graftModes)[number];
function pose(m: T.Matrix4) {
  const v = new T.Vector3(),
    q = new T.Quaternion(),
    s = new T.Vector3();
  m.decompose(v, q, s);
  return { position: v.toArray(), rotation: quatNormalize(q.toArray()), size: s.toArray() };
}
function bounds(built: BuiltCharacter, ids: ReadonlySet<string>, measured: boolean) {
  const box = new T.Box3();
  for (const id of ids) {
    const entry = built.parts.get(id);
    if (!entry) continue;
    const { object, part } = entry;
    if (measured) {
      let visible = true;
      object.traverseAncestors((a) => {
        if (!a.visible) visible = false;
      });
      if (!visible) continue;
      const visit = (node: T.Object3D) => {
        if (!node.visible || (node !== object && node.userData["partId"])) return;
        if (isMesh(node)) {
          const points = node.geometry.getAttribute("position"),
            point = new T.Vector3();
          for (let i = 0; i < points.count; i++)
            box.expandByPoint(point.fromBufferAttribute(points, i).applyMatrix4(node.matrixWorld));
        }
        node.children.forEach(visit);
      };
      visit(object);
      continue;
    }
    const rig = built.regionSources?.get(id) ?? built.human;
    const bone = rig?.bones.get(id),
      region = bone && rig?.regionBounds.get(bone);
    if (region)
      box.union(
        new T.Box3(new T.Vector3(...region[0]), new T.Vector3(...region[1])).applyMatrix4(
          object.matrixWorld,
        ),
      );
    else if (part.cage)
      for (const v of part.cage.vertices)
        box.expandByPoint(new T.Vector3(...v).applyMatrix4(object.matrixWorld));
    else if (part.sweep)
      for (const [x, y, z, w, d] of part.sweep.knots)
        for (const sign of [-1, 1])
          for (const side of [-1, 1])
            box.expandByPoint(
              new T.Vector3(x + sign * w, y, z + side * d).applyMatrix4(object.matrixWorld),
            );
    else if (part.mantle) box.union(partBounds(object));
    else {
      const [a, b] = part.volume
        ? volumeBounds(part.volume.hull)
        : part.piece
          ? pieceBounds[part.piece.piece]
          : part.hand
            ? ([
                [-0.62, -1, -0.6],
                [0.55, 0, 0.8],
              ] as const)
            : ([
                [-0.5, -0.5, -0.5],
                [0.5, 0.5, 0.5],
              ] as const);
      box.union(
        new T.Box3(new T.Vector3(...a), new T.Vector3(...b)).applyMatrix4(object.matrixWorld),
      );
    }
  }
  if (box.isEmpty()) throw new Error("The selected branch has no visible geometry.");
  return box;
}
function regionSource(source: CharacterDocument, part: Part) {
  const copy = humanRegionCopy.read(part.features);
  if (copy?.source) return copy;
  const slot = copy?.slot ?? part.slot,
    g = source.generation;
  if (!slot || !humanSlotBone(slot) || g?.generator !== "irudd.human-adult") return undefined;
  const corrections = humanCorrections.read(source.features);
  const fineHead = humanFineHead.read(source.features);
  return {
    slot,
    source: {
      version: g.version,
      params: g.params,
      ...(corrections ? { corrections } : {}),
      ...(fineHead ? { fineHead } : {}),
    },
  };
}
function makePattern(
  donor: BuiltCharacter,
  dest: BuiltCharacter,
  root: Part,
  target: Part,
  entry: BuiltPart,
) {
  const cut = figureMantle.read(root.features)?.cut;
  if (!cut || !root.parent) throw new Error("Choose a cut garment from a saved form.");
  const original = cutGarment(donor, root.parent, cut.kind, root.color);
  const receiving = cutGarment(dest, target.id, cut.kind, root.color);
  const a = figureMantle.read(original.features)?.cut,
    b = figureMantle.read(receiving.features)?.cut;
  if (!a || !b) throw new Error("Cannot measure this garment pattern.");
  const s = entry.object.getWorldScale(new T.Vector3());
  const fit = (axis: "width" | "depth" | "drop", scale: number) =>
    T.MathUtils.clamp((b[axis] * cut[axis] * Math.abs(scale)) / a[axis], 0.025, 8);
  return {
    ...receiving,
    features: {
      ...receiving.features,
      [figureMantle.id]: figureMantle.json({
        cut: { ...cut, width: fit("width", s.x), depth: fit("depth", s.z), drop: fit("drop", s.y) },
      }),
      ...(root.features[figureFinish.id]
        ? { [figureFinish.id]: root.features[figureFinish.id] }
        : {}),
    },
  };
}
export function graftComponent(
  source: CharacterDocument,
  root: Part,
  donor: BuiltCharacter,
  destination: CharacterDocument,
  target: Part,
  dest: BuiltCharacter,
  mode: Mode,
  fit: boolean,
  body?: HumanBody,
  shelfChildren?: boolean,
) {
  donor.group.updateMatrixWorld(true);
  dest.group.updateMatrixWorld(true);
  const entry = donor.parts.get(root.id),
    host = dest.parts.get(target.id);
  if (!host || !entry) throw new Error("Choose a donor branch and a destination.");
  if (mode === "Recut garment pattern") {
    const part = makePattern(donor, dest, root, target, entry),
      dye = donor.view.layers.get(root.id)?.dye;
    if (destination.parts.length >= 128) throw new Error("The assembled form exceeds 128 parts.");
    const ops: object[] = [{ op: "part.add", part }];
    if (dye)
      ops.push({
        op: "feature.set",
        feature: outfitLayers.id,
        value: outfitLayers.json({
          layers: { ...outfitLayers.read(destination.features)?.layers, [part.id]: { dye } },
        }),
      });
    return { id: part.id, ops };
  }
  const attach = mode === "Attach above selection",
    wear = mode === "Wear in current outfit",
    replace = !attach && !wear;
  const branch = mode === "Replace whole branch";
  const lost = replace
    ? branch
      ? descendants(destination, target.id)
      : new Set([target.id])
    : new Set<PartId>();
  const ids = new Map<PartId, PartId>();
  if (replace) ids.set(root.id, target.id);
  const extracted =
    shelfChildren !== false
      ? source
      : { ...source, parts: source.parts.filter((p) => p.parent !== root.id) };
  const copies = copyDetailBranch(extracted, root, false, ids);
  if (destination.parts.length - lost.size + copies.length > 128)
    throw new Error("The assembled form exceeds 128 parts.");
  const measured = branch && fit && shelfChildren === undefined,
    src = bounds(donor, new Set(ids.keys()), measured),
    dst = bounds(dest, measured ? lost : new Set([target.id]), measured);
  const extent = src.getSize(new T.Vector3()),
    to = dst.getSize(new T.Vector3()),
    blade = figureScapulaMount.read(root.features);
  const socket =
    attach && blade && body && dest.human && humanSlotBone(target.slot ?? "") === "spine_03"
      ? scapulaSocket(evaluateHuman(body, humanMeasurements(dest.human.params)), blade.side)
      : undefined;
  const ratio = (a: number, b: number, ease = 1) =>
    fit && !socket ? T.MathUtils.clamp((ease * a) / Math.max(0.005, b), 0.075, 10) : 1;
  const scale = wear
    ? new T.Vector3(
        ratio(to.x, extent.x, 1.12),
        ratio(to.y, extent.y, 1.015),
        ratio(to.z, extent.z, 1.12),
      )
    : new T.Vector3().setScalar(ratio(to.y, extent.y));
  const centre = dst.getCenter(new T.Vector3());
  if (attach && !socket) centre.y += 0.47 * (to.y + extent.y * scale.y);
  const world = new T.Matrix4()
    .makeScale(...scale.toArray())
    .setPosition(centre.sub(src.getCenter(new T.Vector3()).multiply(scale)))
    .multiply(entry.object.matrixWorld);
  const parent = replace ? target.parent : target.id;
  const mount = parent ? dest.parts.get(parent)?.mount.matrixWorld : undefined;
  const placement = pose((mount?.clone() ?? new T.Matrix4()).invert().multiply(world));
  if (socket) placement.position = socket;
  const labels = new Set(destination.parts.filter((p) => !lost.has(p.id)).map((p) => p.label));
  const originals = new Map(
    Array.from(ids, ([old, id]) => [id, source.parts.find((p) => p.id === old)]),
  );
  const incoming = copies.map((copy, i): Part => {
    const original = originals.get(copy.id);
    if (!original) throw new Error("Missing donor part.");
    const features = { ...copy.features },
      region = regionSource(source, original);
    if (region) features[humanRegionCopy.id] = humanRegionCopy.json(region);
    const piece = figurePiece.read(features),
      look = piece?.look ?? characterAppearance.read(source.features);
    if (piece && look) features[figurePiece.id] = figurePiece.json({ ...piece, look });
    if (i === 0) {
      if (shelfChildren === false) delete features[figurePlateField.id];
      delete features[outfitFit.id];
      delete features[figurePlateSite.id];
      if (figureScute.read(features)?.mount) features[figureScute.id] = figureScute.json({});
    }
    if (wear) {
      features[outfitWear.id] = outfitWear.json({ visibleIn: [dest.view.outfit] });
      features[motionRole.id] = motionRole.json({ role: "rigid" });
      if (i === 0) features[outfitFit.id] = outfitFit.json({});
    }
    const base = (!i && replace ? target.label : original.label).slice(0, 56);
    let label = base;
    for (let n = 2; labels.has(label); n++) label = base.slice(0, 110) + " " + n;
    labels.add(label);
    return { ...copy, ...(i === 0 ? { ...placement, parent } : {}), features, label };
  });
  const first = incoming[0];
  if (!first) throw new Error("Choose a component.");
  const ops = graftDependencies(source, destination, incoming);
  if (branch)
    ops.push(
      ...removeDetailBranches(
        destination,
        destination.parts.filter((p) => p.parent === target.id),
      ),
    );
  ops.push(
    ...incoming.map((part, i) => ({ op: replace && i === 0 ? "part.replace" : "part.add", part })),
  );
  const retained = destination.parts.map((p) => {
    if (mode !== "Replace part, keep children" || p.parent !== target.id) return p;
    const child = dest.parts.get(p.id);
    if (!child) throw new Error("Missing attached child.");
    const basis = figureAssembly.read(first.features);
    const frame = basis ? basis.frameSize : regionSource(source, root) ? undefined : first.size;
    const childWorld = world.clone();
    if (frame) childWorld.scale(new T.Vector3(1 / frame[0], 1 / frame[1], 1 / frame[2]));
    const set = {
      ...pose(childWorld.invert().multiply(child.object.matrixWorld)),
      parent: first.id,
    };
    ops.push({ op: "part.set", part: p.id, set });
    if (figurePlateSite.read(p.features))
      ops.push({ op: "feature.set", part: p.id, feature: figurePlateSite.id, value: null });
    return { ...p, ...set };
  });
  const kept = [...retained.filter((p) => !lost.has(p.id)), ...incoming];
  const visible = new Set(
    kept.flatMap((p) => {
      const region = figurePaint.read(p.features)?.region;
      return p.paint && region ? [p.paint.atlas + "|" + region] : [];
    }),
  );
  const active = new Set(kept.flatMap((p) => (p.paint ? [p.paint.atlas] : []))),
    hidden = new Map<string, PaintSource>();
  for (const s of [...paintSources(dest.view), ...paintSources(donor.view)]) {
    const key = s.atlas + "|" + s.region;
    if (s.region && active.has(s.atlas) && !visible.has(key))
      hidden.set(key, { ...s, region: s.region });
  }
  if (hidden.size || destination.features[figureOccluders.id])
    ops.push({
      op: "feature.set",
      feature: figureOccluders.id,
      value: hidden.size
        ? figureOccluders.json({ sources: [...hidden.values()].sort(occluderOrder) })
        : null,
    });
  return { id: first.id, ops };
}
