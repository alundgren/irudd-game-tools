import * as T from "three";
import {
  coreShapes,
  descendants,
  figureBuild,
  outfitLayers,
  outfitLooks,
  motionOffer,
  motionPoses,
  type GarmentLayers,
  type Json,
  creatureBlend,
  creatureLimbChain,
  creatureOrgan,
  figureAssembly,
  figureCage,
  figureFaceAnchor,
  figureHand,
  figureHull,
  figurePiece,
  figurePlateField,
  figurePulls,
  figurePlateSite,
  figureScute,
  figureSweep,
  outfitWear,
  motionRole,
  PartId,
  decodeWith,
  type Part,
  type Shape,
  type Vec3,
  type FigureMarkings,
  type CharacterDocument,
  type Finish,
  type OutfitRoleName,
  type MotionRoleName,
  figureFinish,
  figureMarkings,
} from "@irudd/document";
import { headFrame } from "./surfaces/front-fit.js";
import type { BuiltCharacter } from "./build.js";
import type { BuildPart } from "./view.js";

export const detailShapes = [...coreShapes, "sweep", "cage", "scute", "hand", "head"] as const;
export type DetailShape = (typeof detailShapes)[number];

function newId() {
  const id = decodeWith(PartId, "p-" + crypto.randomUUID());
  if (!id.ok) throw new Error("Invalid part ID.");
  return id.value;
}

export function addDetail(parent: Part | undefined, shape: DetailShape): Part {
  const size: Vec3 = shape === "sweep" || shape === "head" ? [1, 1, 1] : [0.14, 0.24, 0.14];
  const features: Record<string, Part["features"][string]> = {
    [figureAssembly.id]: figureAssembly.json({ order: 0, frameSize: size }),
  };
  let primitive: Shape = "ellipsoid";
  switch (shape) {
    case "sweep":
      features[figureSweep.id] = figureSweep.json({
        knots: [
          [0, 0, 0, 0.05, 0.045],
          [0, 0.13, 0.025, 0.039, 0.035],
          [0.04, 0.22, 0, 0.012, 0.011],
        ],
      });
      break;
    case "cage":
      features[figureCage.id] = figureCage.json({
        vertices: [
          [-0.5, -0.5, -0.5],
          [0.5, -0.5, -0.5],
          [0.5, 0.5, -0.5],
          [-0.5, 0.5, -0.5],
          [-0.5, -0.5, 0.5],
          [0.5, -0.5, 0.5],
          [0.5, 0.5, 0.5],
          [-0.5, 0.5, 0.5],
        ],
        faces: [
          [3, 2, 1, 0],
          [4, 5, 6, 7],
          [0, 1, 5, 4],
          [1, 2, 6, 5],
          [2, 3, 7, 6],
          [3, 0, 4, 7],
        ],
      });
      break;
    case "hand":
      features[figureHand.id] = figureHand.json({ fingers: 4, spread: 0.2, curl: 0.15, side: 1 });
      break;
    case "head":
      features[figurePiece.id] = figurePiece.json({
        piece: "head",
        look: { palette: "Clay", skin: "#b08566", hair: "Bald", hairColor: "#45352e" },
      });
      break;
    case "scute":
      features[figureScute.id] = figureScute.json({});
      break;
    default:
      primitive = shape;
  }
  return {
    id: newId(),
    label: shape[0]?.toUpperCase() + shape.slice(1),
    parent: parent?.id ?? null,
    shape: primitive,
    size,
    position: parent ? [0, 0.14, 0.06] : [0, 0.9, 0.25],
    rotation: [0, 0, 0, 1],
    color: "#c99563",
    features,
    sculpt: [],
  };
}

const reflect = ([x, y, z]: Vec3): Vec3 => [-x, y, z];
function mirrorPart(part: Part): Part {
  const features = { ...part.features };
  const sweep = figureSweep.read(features),
    cage = figureCage.read(features),
    hand = figureHand.read(features),
    hull = figureHull.read(features),
    field = figurePlateField.read(features),
    anchor = figureFaceAnchor.read(features),
    piece = figurePiece.read(features);
  const pulls = figurePulls.read(features);
  if (pulls)
    features[figurePulls.id] = figurePulls.json({
      pulls: pulls.pulls.map((q) => ({
        ...q,
        at: reflect(q.at),
        offset: reflect(q.offset),
        ...(q.mirrorX === undefined ? {} : { mirrorX: -q.mirrorX }),
      })),
    });
  if (sweep)
    features[figureSweep.id] = figureSweep.json({
      knots: sweep.knots.map(([x, y, z, a, b]) => [-x, y, z, a, b]),
    });
  if (cage)
    features[figureCage.id] = figureCage.json({
      ...cage,
      vertices: cage.vertices.map(reflect),
      faces: cage.faces.map((f) => [...f].reverse()),
    });
  if (hand) features[figureHand.id] = figureHand.json({ ...hand, side: hand.side === -1 ? 1 : -1 });
  if (hull) features[figureHull.id] = figureHull.json({ ...hull, mirrored: !hull.mirrored });
  if (field)
    features[figurePlateField.id] = figurePlateField.json({
      ...field,
      mirrored: !field.mirrored,
      face: field.face === "Left" ? "Right" : field.face === "Right" ? "Left" : field.face,
    });
  if (anchor)
    features[figureFaceAnchor.id] = figureFaceAnchor.json({
      ...anchor,
      anchor: reflect(anchor.anchor),
    });
  if (piece) {
    const swapped = {
      "left arm": "right arm",
      "right arm": "left arm",
      "left leg": "right leg",
      "right leg": "left leg",
      head: "head",
      torso: "torso",
    } as const;
    features[figurePiece.id] = figurePiece.json({ ...piece, piece: swapped[piece.piece] });
  }
  const [x, y, z, w] = part.rotation;
  return {
    ...part,
    position: reflect(part.position),
    rotation: [x, -y, -z, w],
    features,
    sculpt: part.sculpt.map((s) => ({ ...s, at: reflect(s.at), offset: reflect(s.offset) })),
  };
}

export function copyDetailBranch(
  doc: CharacterDocument,
  root: Part,
  mirror: boolean,
  ids = new Map<PartId, PartId>(),
): Part[] {
  const result: Part[] = [];
  const visit = (p: Part, parent: Part["parent"]) => {
    const { slot: _slot, ...source } = p;
    const copy = mirror ? mirrorPart(source) : source;
    const features = { ...copy.features };
    if (p.id === root.id) delete features[figurePlateSite.id];
    const next: Part = {
      ...copy,
      id: ids.get(p.id) ?? newId(),
      parent,
      features,
      label: copy.label.slice(0, 110) + (mirror ? " mirrored" : " copy"),
      position:
        !mirror && p.id === root.id
          ? [p.position[0] + 0.08, p.position[1], p.position[2]]
          : copy.position,
    };
    ids.set(p.id, next.id);
    result.push(next);
    for (const child of doc.parts) if (child.parent === p.id) visit(child, next.id);
  };
  visit(root, root.parent);
  return result.map((part) => {
    const chain = creatureLimbChain.read(part.features),
      organ = creatureOrgan.read(part.features);
    if (!chain && organ?.rank !== "spine") return part;
    const features = { ...part.features };
    if (chain)
      features[creatureLimbChain.id] = creatureLimbChain.json({
        ...chain,
        side: mirror ? (chain.side === "left" ? "right" : "left") : chain.side,
        chain: chain.chain.map((id) => ids.get(id) ?? id),
        tinted: chain.tinted.map((id) => ids.get(id) ?? id),
      });
    if (organ?.rank === "spine") {
      const { rank: _rank, ...rest } = organ;
      features[creatureOrgan.id] = creatureOrgan.json(rest);
    }
    return { ...part, features };
  });
}

export function removeDetailBranch(doc: CharacterDocument, root: Part) {
  return removeDetailBranches(doc, [root]);
}
export function removeDetailBranches(doc: CharacterDocument, roots: readonly Part[]) {
  const gone = new Set(roots.flatMap((p) => Array.from(descendants(doc, p.id))));
  if (gone.size === doc.parts.length)
    throw new Error("Add another part before removing the whole character.");
  const ops: object[] = [];
  const change = (feature: string, value: Json | null) =>
    ops.push({ op: "feature.set", feature, value });
  const trim = (layers: GarmentLayers) =>
    Object.fromEntries(Object.entries(layers).filter(([id]) => !gone.has(id)));
  const affected = (layers: GarmentLayers) => Object.keys(layers).some((id) => gone.has(id));
  const layers = outfitLayers.read(doc.features),
    looks = outfitLooks.read(doc.features),
    build = figureBuild.read(doc.features),
    poses = motionPoses.read(doc.features),
    offer = motionOffer.read(doc.features);
  if (layers && affected(layers.layers))
    change(outfitLayers.id, outfitLayers.json({ layers: trim(layers.layers) }));
  if (looks?.looks.some((l) => affected(l.layers)))
    change(
      outfitLooks.id,
      outfitLooks.json({ looks: looks.looks.map((l) => ({ ...l, layers: trim(l.layers) })) }),
    );
  if (build?.frame.some((id) => gone.has(id))) {
    const frame = build.frame.filter((id) => !gone.has(id));
    change(figureBuild.id, frame.length ? figureBuild.json({ ...build, frame }) : null);
  }
  const clips = poses?.poses.map((p) => ({
    ...p,
    joints: p.joints.filter((j) => !j.part || !gone.has(j.part)),
  }));
  if (poses && clips?.some((p, i) => p.joints.length !== poses.poses[i]?.joints.length))
    change(motionPoses.id, motionPoses.json({ poses: clips }));
  if (offer && (gone.has(offer.held) || !clips?.find((p) => p.name === offer.pose)?.joints.length))
    change(motionOffer.id, null);
  for (const p of doc.parts) {
    if (gone.has(p.id)) continue;
    const chain = creatureLimbChain.read(p.features);
    if (!chain) continue;
    if (chain.chain.some((id) => gone.has(id))) ops.push(setDetail(p, creatureLimbChain.id, null));
    else if (chain.tinted.some((id) => gone.has(id)))
      ops.push(
        setDetail(
          p,
          creatureLimbChain.id,
          creatureLimbChain.json({ ...chain, tinted: chain.tinted.filter((id) => !gone.has(id)) }),
        ),
      );
  }
  return [...ops, ...roots.map((p) => ({ op: "part.remove", part: p.id, cascade: true }))];
}

export function fitAccessory(built: BuiltCharacter, faceId: string, pivotId: string): Vec3 {
  const root = built.parts.get(faceId)?.object,
    pivot = built.parts.get(pivotId);
  const face = [...built.faces.keys()].find((m) => m === root || m.parent === root);
  if (!face || !pivot || pivot.part.parent !== faceId)
    throw new Error("Select a face and one of its attached pieces.");
  const frame = headFrame(face);
  return face
    .worldToLocal(pivot.object.getWorldPosition(new T.Vector3()))
    .sub(frame.center)
    .multiply(frame.factor)
    .toArray();
}

export function acceptsGuide(b: BuildPart) {
  return (
    !!b.sweep &&
    !b.paint &&
    !b.volume &&
    !b.hairCap &&
    !b.blend &&
    !b.fitted &&
    !b.mantle &&
    !b.hand &&
    !b.piece &&
    b.anatomy !== "face"
  );
}

export function blendable(p: BuildPart) {
  return (
    (Boolean(p.sweep) || p.shape === "ellipsoid") &&
    !p.paint &&
    !p.fibres &&
    !p.fitted &&
    !p.mantle &&
    !p.piece &&
    !p.hand &&
    !p.cage &&
    !p.scute &&
    !p.wing &&
    !p.volume
  );
}

export function bodyCoatPart(p: BuildPart) {
  return (
    blendable(p) &&
    p.wear.role !== "skirt" &&
    p.wear.role !== "accessory" &&
    !["canvas", "satin", "leather", "metal"].includes(p.finish) &&
    !/eye|pupil|iris|tooth|teeth|claw|beak|plate|buckle|strap|boot|lens|saddle|sleeve|shirt|coat|robe|skirt|gown|tunic|dress|belt|pouch|vest|pack|collar|cuff|hat/i.test(
      p.label,
    )
  );
}

export const setDetail = (part: Part, feature: string, value: Part["features"][string] | null) => ({
  op: "feature.set",
  part: part.id,
  feature,
  value,
});

export function finishPart(
  part: Part,
  color: string,
  surface: Finish,
  region: OutfitRoleName | "",
  movement: MotionRoleName | "",
) {
  const { role: _role, ...wear } = outfitWear.read(part.features) ?? {};
  return [
    { op: "part.set", part: part.id, set: { color } },
    setDetail(part, figureFinish.id, figureFinish.json({ surface })),
    setDetail(
      part,
      outfitWear.id,
      region ? { ...wear, role: region } : Object.keys(wear).length ? wear : null,
    ),
    setDetail(part, motionRole.id, movement ? { role: movement } : null),
  ];
}

export const paintParts = (parts: readonly Part[], mark: FigureMarkings | null) =>
  parts.map((p) => setDetail(p, figureMarkings.id, mark && figureMarkings.json(mark)));
export function blendParts(parts: readonly Part[], join: boolean, existing: readonly Part[] = []) {
  if (join && new Set([...existing, ...parts].map((p) => p.id)).size > 48)
    throw new Error("Join at most 48 skin regions at once.");
  return parts.map((p) => setDetail(p, creatureBlend.id, join ? { blend: true } : null));
}
