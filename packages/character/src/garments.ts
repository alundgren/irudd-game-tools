import * as T from "three";
import {
  figureFinish,
  figureMantle,
  motionRole,
  outfitFit,
  outfitWear,
  PartId,
  decodeWith,
  SkirtOutline,
  type MantleCut,
  type Part,
  type SkirtCut,
} from "@irudd/document";
import type { BuiltCharacter, BuiltPart } from "./build.js";
import { isMesh } from "./mesh.js";

export function partBounds(object: T.Object3D): T.Box3 {
  object.updateWorldMatrix(true, true);
  const box = new T.Box3();
  const visit = (node: T.Object3D): void => {
    if (node !== object && (!node.visible || node.userData["partId"])) return;
    if (isMesh(node)) {
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      if (node.geometry.boundingBox)
        box.union(node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld));
    }
    node.children.forEach(visit);
  };
  visit(object);
  if (box.isEmpty())
    box.setFromCenterAndSize(
      object.getWorldPosition(new T.Vector3()),
      object.getWorldScale(new T.Vector3()),
    );
  return box;
}

export function cutGarment(
  built: BuiltCharacter,
  hostId: string,
  kind: MantleCut["kind"],
  color: string,
): Part {
  const host = built.parts.get(hostId);
  if (!host || host.part.fitted) throw new Error("Select a body region for the garment.");
  function bodyBounds({ part, object }: BuiltPart) {
    const bone = built.human?.bones.get(part.id);
    const box = bone && built.human?.regionBounds.get(bone);
    if (!box) return partBounds(object);
    object.updateWorldMatrix(true, false);
    return new T.Box3(new T.Vector3(...box[0]), new T.Vector3(...box[1])).applyMatrix4(
      object.matrixWorld,
    );
  }
  const bounds = bodyBounds(host);
  const size = bounds.getSize(new T.Vector3()),
    pivot = bounds.getCenter(new T.Vector3());
  const clamp = T.MathUtils.clamp;
  pivot.y = kind === "Skirt" ? bounds.min.y + size.y * 0.42 : bounds.max.y - size.y * 0.016;
  let cut: MantleCut;
  if (kind === "Skirt") {
    let floor = bounds.min.y;
    for (const entry of built.parts.values()) {
      const { part, object } = entry;
      if (!part.fitted && object.visible && !part.wear.visibleIn && part.wear.role !== "accessory")
        floor = Math.min(floor, bodyBounds(entry).min.y);
    }
    cut = {
      kind,
      width: clamp(size.x * 0.86, 0.025, 8),
      depth: clamp(size.z * 0.91, 0.025, 8),
      drop: clamp((pivot.y - floor) * 0.965, 0.025, 8),
      flare: 1,
      folds: 7,
      bias: 0.65,
      gather: 0.12,
      tiers: 2,
      train: 0,
      outline: [
        [0, 1],
        [0.2, 1.22],
        [0.6, 1.04],
        [1, 1.5],
      ],
    };
  } else {
    cut = {
      kind,
      width: clamp(size.x * 1.06, 0.035, 6),
      depth: clamp(size.z * 1.05, 0.035, 6),
      drop: clamp(size.y * (kind === "Cape" ? 1.42 : kind === "Tabard" ? 1.28 : 1.02), 0.07, 7),
      flare: kind === "Poncho" ? 1.35 : 1,
      opening: kind === "Cape" ? 65 : kind === "Tabard" ? 15 : 4,
      folds: kind === "Tabard" ? 5 : 12,
    };
  }
  host.mount.updateWorldMatrix(true, false);
  const placement = host.mount.matrixWorld
    .clone()
    .invert()
    .multiply(new T.Matrix4().makeTranslation(pivot));
  const position = new T.Vector3(),
    rotation = new T.Quaternion(),
    scale = new T.Vector3();
  placement.decompose(position, rotation, scale);
  rotation.normalize();
  const sign = rotation.w < 0 ? -1 : 1;
  const id = decodeWith(PartId, "p-" + crypto.randomUUID());
  const parent = decodeWith(PartId, hostId);
  if (!id.ok || !parent.ok) throw new Error("Invalid garment attachment.");
  const labels = new Set(built.view.parts.map((p) => p.label));
  let label: string = kind;
  for (let n = 2; labels.has(label); n++) label = kind + " " + n;
  return {
    id: id.value,
    parent: parent.value,
    label,
    shape: "ellipsoid",
    color,
    position: position.toArray(),
    rotation: [rotation.x * sign, rotation.y * sign, rotation.z * sign, rotation.w * sign],
    size: scale.toArray(),
    sculpt: [],
    features: {
      [figureMantle.id]: figureMantle.json({ cut }),
      [figureFinish.id]: figureFinish.json({ surface: kind === "Skirt" ? "satin" : "canvas" }),
      [motionRole.id]: motionRole.json({ role: "skirt" }),
      [outfitFit.id]: outfitFit.json({}),
      [outfitWear.id]: outfitWear.json({ visibleIn: [built.view.outfit] }),
    },
  };
}

export function traceSkirt(points: readonly (readonly [number, number])[]): SkirtCut["outline"] {
  const [centre, edge, ...rest] = points;
  const hem = rest.at(-1);
  if (!centre || !edge || !hem || rest.length < 2)
    throw new Error("Mark the waist centre, waist edge and at least two points down to the hem.");
  const width = edge[0] - centre[0],
    drop = hem[1] - edge[1];
  if (Math.abs(width) < 2 || drop <= 0 || Math.abs(edge[1] - centre[1]) > Math.abs(width) * 0.3)
    throw new Error("Mark a level waist and follow one side down to the hem.");
  const read = decodeWith(SkirtOutline, [
    [0, 1],
    ...rest.map(([x, y]) => [(y - edge[1]) / drop, (x - centre[0]) / width]),
  ]);
  if (!read.ok)
    throw new Error("Follow one side downwards, between 32% and 400% of the waist radius.");
  return read.value;
}
