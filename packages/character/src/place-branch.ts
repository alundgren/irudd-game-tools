import * as T from "three";
import {
  humanRegionCopy,
  descendants,
  figurePlateSite,
  figureScute,
  outfitLayers,
  outfitLooks,
  motionPoses,
  quatNormalize,
  type CharacterDocument,
  type Part,
  type PartId,
  type Vec3,
  type GarmentLayers,
  type Json,
} from "@irudd/document";
import { copyDetailBranch } from "./surface-edit.js";
import { drawAppendage, type BranchKind } from "./shape-tools.js";

function pose(matrix: T.Matrix4) {
  const position = new T.Vector3(),
    rotation = new T.Quaternion(),
    size = new T.Vector3();
  matrix.decompose(position, rotation, size);
  return {
    position: position.toArray(),
    rotation: quatNormalize(rotation.toArray()),
    size: size.toArray(),
  };
}

export function drawBranches(
  doc: CharacterDocument,
  parent: Part,
  points: readonly Vec3[],
  kind: BranchKind,
  radius: number,
  color: string,
  mirror: boolean,
  mount: (id: string) => T.Matrix4,
) {
  if (doc.parts.length + (mirror ? 2 : 1) > 128)
    throw new Error("The form supports up to 128 parts.");
  const opposite = parent.label.replace(/\bleft\b|\bright\b/i, (word) =>
    word.toLowerCase() === "left" ? "right" : "left",
  );
  const twin = doc.parts.find((p) => p.label.toLowerCase() === opposite.toLowerCase()) ?? parent;
  const used = new Set(doc.parts.map((p) => p.label.toLowerCase()));
  return (mirror ? [1, -1] : [1]).map((side) => {
    const host = side === 1 ? parent : twin;
    const path = points.map(([x, y, z]): Vec3 => [x * side, y, z]);
    const branch = drawAppendage(parent, path, kind, radius, color);
    const world = new T.Matrix4().makeTranslation(...branch.position);
    const transform = pose(mount(host.id).clone().invert().multiply(world));
    const name = (mirror ? (branch.position[0] >= 0 ? "Left " : "Right ") : "") + kind;
    let label = name,
      n = 2;
    while (used.has(label.toLowerCase())) label = name + " " + n++;
    used.add(label.toLowerCase());
    return { ...branch, ...transform, label, parent: host.id };
  });
}

export interface BranchPlacement {
  anchor: Vec3;
  point: Vec3;
  normal: Vec3;
  axis: Vec3;
  twist: number;
  depth: number;
  scale: number;
  copy: boolean;
}

export function placeBranch(
  doc: CharacterDocument,
  source: Part,
  target: Part,
  world: T.Matrix4,
  mount: T.Matrix4,
  options: BranchPlacement,
) {
  const { copy, scale, twist, depth } = options;
  if (
    !Number.isFinite(scale) ||
    scale < 0.1 ||
    scale > 4 ||
    !Number.isFinite(twist) ||
    Math.abs(twist) > 360 ||
    !Number.isFinite(depth) ||
    depth < 0 ||
    depth > 0.1
  )
    throw new Error("Check branch size, turn and seating depth.");
  if (
    ![options.anchor, options.point, options.normal, options.axis].every((v) =>
      v.every(Number.isFinite),
    ) ||
    !doc.parts.some((p) => p.id === source.id) ||
    !doc.parts.some((p) => p.id === target.id)
  )
    throw new Error("Choose a branch, a destination and two finite points on the model.");
  const branch = descendants(doc, source.id);
  if (!copy && branch.has(target.id)) throw new Error("Move the branch outside its own branch.");
  if (copy && doc.parts.length + branch.size > 128)
    throw new Error("This copy would exceed the 128-part limit.");
  const inverse = mount.clone().invert();
  const pin = new T.Vector3(...options.anchor).applyMatrix4(world.clone().invert());
  const turn = new T.Quaternion().setFromAxisAngle(
    new T.Vector3(...options.axis).normalize(),
    T.MathUtils.degToRad(twist),
  );
  const relative = inverse
    .clone()
    .multiply(new T.Matrix4().compose(new T.Vector3(), turn, new T.Vector3(scale, scale, scale)))
    .multiply(world);
  const transform = pose(relative);
  const dest = new T.Vector3(...options.point)
    .addScaledVector(new T.Vector3(...options.normal), -depth)
    .applyMatrix4(inverse);
  transform.position = dest
    .sub(
      pin
        .multiply(new T.Vector3(...transform.size))
        .applyQuaternion(new T.Quaternion(...transform.rotation)),
    )
    .toArray();
  const set = { ...transform, parent: target.id },
    ops: object[] = [];
  const seated = figureScute.read(source.features)?.mount
    ? figureScute.json({ mount: transform })
    : undefined;
  if (!copy) {
    if (seated)
      ops.push({ op: "feature.set", part: source.id, feature: figureScute.id, value: seated });
    ops.push({ op: "part.set", part: source.id, set });
    if (source.parent !== target.id && figurePlateSite.read(source.features))
      ops.push({ op: "feature.set", part: source.id, feature: figurePlateSite.id, value: null });
    return { id: source.id, ops };
  }
  const ids = new Map<PartId, PartId>();
  const copies = copyDetailBranch(doc, source, false, ids);
  const root = copies[0];
  if (!root) throw new Error("Choose a branch.");
  const slots = new Map(
    doc.parts.flatMap((p) => (p.slot && ids.has(p.id) ? [[ids.get(p.id), p.slot] as const] : [])),
  );
  const usedLabels = new Set(doc.parts.map((p) => p.label.toLowerCase()));
  ops.push(
    ...copies.map((p) => {
      let label = p.label,
        suffix = 2;
      while (usedLabels.has(label.toLowerCase())) label = p.label + " " + suffix++;
      usedLabels.add(label.toLowerCase());
      const slot = slots.get(p.id),
        copyPart = {
          ...p,
          label,
          ...(p === root ? set : {}),
          ...(p === root && seated
            ? { features: { ...p.features, [figureScute.id]: seated } }
            : {}),
        };
      return {
        op: "part.add",
        part:
          slot && doc.generation?.generator === "irudd.human-adult"
            ? {
                ...copyPart,
                features: {
                  ...copyPart.features,
                  [humanRegionCopy.id]: humanRegionCopy.json({ slot }),
                },
              }
            : copyPart,
      };
    }),
  );
  function layers(old: GarmentLayers) {
    const next = { ...old };
    for (const [id, other] of ids) if (old[id]) next[other] = { ...old[id] };
    return next;
  }
  const feature = (id: string, value: Json) => ops.push({ op: "feature.set", feature: id, value });
  const active = outfitLayers.read(doc.features),
    looks = outfitLooks.read(doc.features),
    poses = motionPoses.read(doc.features);
  if (active) feature(outfitLayers.id, outfitLayers.json({ layers: layers(active.layers) }));
  if (looks)
    feature(
      outfitLooks.id,
      outfitLooks.json({ looks: looks.looks.map((l) => ({ ...l, layers: layers(l.layers) })) }),
    );
  if (poses)
    feature(
      motionPoses.id,
      motionPoses.json({
        poses: poses.poses.map((p) => ({
          ...p,
          joints: [
            ...p.joints,
            ...p.joints.flatMap((j) => {
              const part = j.part && ids.get(j.part);
              return part ? [{ ...j, part }] : [];
            }),
          ],
        })),
      }),
    );
  for (const pose of doc.poses) {
    const copied = pose.joints.flatMap((joint) => {
      const part = ids.get(joint.part);
      return part ? [{ ...joint, part }] : [];
    });
    if (copied.length)
      ops.push({ op: "pose.set", pose: { ...pose, joints: [...pose.joints, ...copied] } });
  }
  return { id: root.id, ops };
}
