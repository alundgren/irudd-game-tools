import * as T from "three";
import {
  familyFeatures,
  humanReferenceRigs,
  assetCredits,
  mergeAssetCredits,
  assetCreditsNamespace,
  quatNormalize,
  figureAssembly,
  figurePlateField,
  figurePlateSite,
  figureBuild,
  figureCage,
  figureDrape,
  type FigureDrape,
  figureMantle,
  figurePiece,
  figurePulls,
  figureSculpt,
  figureScute,
  figurePaint,
  figureSweep,
  figureJoin,
  outfitWear,
  outfitWardrobe,
  figureFinish,
  figureLocations,
  motionRole,
  creatureBlend,
  type SurfacePull,
  type FaceSculpt,
  type Json,
  type Knot,
  type Part,
  type CharacterDocument,
  type Vec3,
  type PlateField,
  type FigureCage,
} from "@irudd/document";
import { growPlateField } from "./plate-field.js";
import { addDetail, copyDetailBranch } from "./surface-edit.js";

const feature = (part: Part, id: string, value: Json) => ({
  op: "feature.set",
  part: part.id,
  feature: id,
  value,
});
const vector = (p: readonly number[]) => new T.Vector3(p[0], p[1], p[2]);
export const faceAxes = [
  "jaw",
  "nose",
  "brow",
  "cheek",
  "eyes",
  "eye size",
  "mouth",
  "lips",
  "chin",
  "smile",
] as const;
export function shapeFace(p: Part, axis: keyof FaceSculpt, value: number) {
  return feature(
    p,
    figureSculpt.id,
    figureSculpt.json({
      sculpt: {
        ...figurePiece.read(p.features)?.look?.sculpt,
        ...figureSculpt.read(p.features)?.sculpt,
        [axis]: value,
      },
    }),
  );
}
export function shapeBuild(doc: CharacterDocument, axis: string, value: number) {
  const current = figureBuild.read(doc.features) ?? {
    frame: doc.parts.filter((p) => !figureMantle.read(p.features)).map((p) => p.id),
  };
  return {
    op: "feature.set",
    feature: figureBuild.id,
    value: figureBuild.json({ ...current, [axis]: value }),
  };
}
export function drapeSweep(p: Part, settings: FigureDrape) {
  return feature(p, figureDrape.id, figureDrape.json(settings));
}
export function foldCloth(p: Part, folds: number, flare: number) {
  const mantle = figureMantle.read(p.features);
  if (!mantle) throw new Error("Choose a cut garment.");
  return feature(p, figureMantle.id, figureMantle.json({ cut: { ...mantle.cut, folds, flare } }));
}
export function moveControl(p: Part, kind: "Spine" | "Cage", index: number, to: Vec3) {
  if (kind === "Cage") {
    const cage = figureCage.read(p.features);
    if (!cage?.vertices[index]) throw new Error("Select a cage vertex.");
    return feature(
      p,
      figureCage.id,
      figureCage.json({ ...cage, vertices: cage.vertices.map((v, i) => (i === index ? to : v)) }),
    );
  }
  const sweep = figureSweep.read(p.features);
  if (!sweep?.knots[index]) throw new Error("Select a spine point.");
  return feature(
    p,
    figureSweep.id,
    figureSweep.json({ knots: sweep.knots.map((k, i) => (i === index ? [...to, k[3], k[4]] : k)) }),
  );
}
export function moveSpine(doc: CharacterDocument, p: Part, index: number, to: Vec3) {
  const op = moveControl(p, "Spine", index, to),
    old = figureSweep.read(p.features);
  if (!old) throw new Error("Choose a swept part.");
  const next = old.knots.map((k, i) => (i === index ? vector(to) : vector(k)));
  const before = new T.CatmullRomCurve3(old.knots.map(vector)),
    after = new T.CatmullRomCurve3(next);
  const assembly = figureAssembly.read(p.features);
  const basis = vector(assembly ? (assembly.frameSize ?? [1, 1, 1]) : p.size);
  const samples = before.getPoints(Math.max(48, old.knots.length * 8));
  const paint = figurePaint.read(p.features);
  const horizontal = paint && paint.frame !== "path";
  const field = figurePlateField.read(p.features);
  const ops: object[] = [op];
  function follow(pose: Pick<Part, "position" | "rotation">) {
    const position = vector(pose.position).divide(basis);
    let best = Infinity,
      station = 0;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1],
        b = samples[i];
      if (!a || !b) continue;
      const line = new T.Line3(a, b),
        t = line.closestPointToPointParameter(position, true),
        dist = line.at(t, new T.Vector3()).distanceToSquared(position);
      if (dist < best) {
        best = dist;
        station = (i - 1 + t) / (samples.length - 1);
      }
    }
    const delta = new T.Quaternion();
    if (!horizontal)
      delta.setFromUnitVectors(before.getTangent(station), after.getTangent(station));
    const moved = position
      .sub(before.getPoint(station))
      .applyQuaternion(delta)
      .add(after.getPoint(station))
      .multiply(basis);
    const rotation = quatNormalize(delta.multiply(new T.Quaternion(...pose.rotation)).toArray());
    return { position: moved.toArray(), rotation };
  }
  for (const child of doc.parts.filter((q) => q.parent === p.id)) {
    if (field && figurePlateSite.read(child.features)) continue;
    ops.push({ op: "part.set", part: child.id, set: follow(child) });
    const mount = figureScute.read(child.features)?.mount;
    if (mount)
      ops.push(
        feature(child, figureScute.id, figureScute.json({ mount: { ...mount, ...follow(mount) } })),
      );
  }
  if (field) {
    const changed = { ...p, features: { ...p.features, [figureSweep.id]: op.value } };
    ops.push(...growPlateField(doc, changed, {}, p));
  }
  return ops;
}

export function cageFace(
  p: Part,
  index: number,
  kind: "Inset" | "Extrude" | "Crease" | "Tunnel",
  amount: number,
  other = 0,
) {
  const cage = figureCage.read(p.features),
    face = cage?.faces[index];
  if (!cage || !face) throw new Error("Select a cage face.");
  let next: FigureCage;
  if (kind === "Crease") {
    const key = (a: number, b: number) => [Math.min(a, b), Math.max(a, b)].join("/");
    const creases = new Map((cage.creases ?? []).map((e) => [key(...e), e]));
    const edges = face.map((a, i) => [a, face[(i + 1) % face.length] ?? a] as const);
    const remove = edges.every((e) => creases.has(key(...e)));
    for (const e of edges)
      if (remove) creases.delete(key(...e));
      else creases.set(key(...e), e);
    next = { ...cage, creases: [...creases.values()] };
  } else {
    const vertices = [...cage.vertices],
      faces = cage.faces.map((f) => [...f]);
    function collar(fi: number, polygon: readonly number[], inset: number, travel: number) {
      const points = polygon.map((i) => vector(vertices[i] ?? []));
      const centre = points.reduce((a, v) => a.add(v), new T.Vector3()).divideScalar(points.length);
      const normal = new T.Vector3();
      for (const [i, pt] of points.entries())
        normal.add(
          pt
            .clone()
            .sub(centre)
            .cross((points[(i + 1) % points.length] ?? pt).clone().sub(centre)),
        );
      normal.normalize();
      const ring = points.map(
        (v) => vertices.push(v.lerp(centre, inset).addScaledVector(normal, travel).toArray()) - 1,
      );
      for (const [i, v] of polygon.entries()) {
        const j = (i + 1) % polygon.length;
        faces.push([v, polygon[j] ?? v, ring[j] ?? 0, ring[i] ?? 0]);
      }
      faces[fi] = ring;
      return ring;
    }
    const a = collar(index, face, kind === "Extrude" ? 0 : amount, kind === "Extrude" ? amount : 0);
    if (kind === "Tunnel") {
      const target = cage.faces[other];
      if (!target || target.length !== face.length || target.some((v) => face.includes(v)))
        throw new Error("Choose two separated faces with the same number of corners.");
      const b = collar(other, target, amount, 0).reverse();
      const costs = b.map((_, shift) =>
        a.reduce(
          (sum, id, i) =>
            sum +
            vector(vertices[id] ?? []).distanceToSquared(
              vector(vertices[b[(i + shift) % b.length] ?? 0] ?? []),
            ),
          0,
        ),
      );
      const shift = costs.indexOf(Math.min(...costs));
      const walls = a.map((v, i) => [
        v,
        a[(i + 1) % a.length] ?? v,
        b[(i + 1 + shift) % b.length] ?? 0,
        b[(i + shift) % b.length] ?? 0,
      ]);
      faces[index] = walls[0] ?? [];
      faces[other] = walls[1] ?? [];
      faces.push(...walls.slice(2));
    }
    next = { ...cage, vertices, faces };
  }
  return feature(p, figureCage.id, figureCage.json(next));
}
export function pullPart(p: Part, at: Vec3, offset: Vec3, reach: Vec3, mirrorX?: number) {
  const pulls = figurePulls.read(p.features)?.pulls ?? [];
  if (pulls.length >= 64) throw new Error("This part already has 64 surface pulls.");
  const field: SurfacePull = { at, offset, reach, ...(mirrorX === undefined ? {} : { mirrorX }) };
  return feature(p, figurePulls.id, figurePulls.json({ pulls: [...pulls, field] }));
}
export function markLocation(p: Part, name: string, at: Vec3) {
  if (!name.trim() || name.trim().length > 48)
    throw new Error("Give the location a name of up to 48 characters.");
  const marks = figureLocations.read(p.features)?.marks ?? [];
  return feature(
    p,
    figureLocations.id,
    figureLocations.json({
      marks: [...marks.filter((m) => m.name !== name.trim()), { name: name.trim(), at }],
    }),
  );
}
export const branchKinds = ["Horn", "Tail", "Fin", "Walking limb"] as const;
export type BranchKind = (typeof branchKinds)[number];
export function branchStroke(origin: Vec3, normal: Vec3, radius: number) {
  const start = vector(origin),
    outward = vector(normal);
  let points: Vec3[] = [
    start
      .clone()
      .addScaledVector(outward, -radius * 0.35)
      .toArray(),
  ];
  return {
    get points(): readonly Vec3[] {
      return points;
    },
    sample(plane: Vec3) {
      const next = vector(plane),
        distance = next.distanceTo(start),
        last = points.at(-1);
      next.addScaledVector(outward, Math.min(radius * 0.45, distance * 0.4));
      if (!last || distance <= 0.0001 || next.distanceTo(vector(last)) < 0.008) return false;
      if (points.length >= 255) points = points.filter((_, i) => i % 2 === 0);
      points.push(next.toArray());
      return true;
    },
  };
}
export function drawAppendage(
  p: Part,
  stroke: readonly Vec3[],
  kind: BranchKind,
  radius: number,
  color: string,
) {
  const start = stroke[0];
  if (
    !start ||
    stroke.length < 2 ||
    stroke.length > 256 ||
    !stroke.every((pt) => pt.every(Number.isFinite)) ||
    !Number.isFinite(radius) ||
    radius < 0.005 ||
    radius > 0.6
  )
    throw new Error("Draw a visible stroke with a valid radius.");
  const path = new T.CurvePath<T.Vector3>();
  let prev = vector(start);
  for (const pt of stroke.slice(1)) {
    const next = vector(pt);
    if (prev.distanceToSquared(next) > 0.000001) {
      path.add(new T.LineCurve3(prev, next));
      prev = next;
    }
  }
  if (!path.curves.length || path.getLength() < 0.025)
    throw new Error("Drag farther to draw an appendage.");
  const roles = { Horn: "rigid", Tail: "tail", Fin: "wing", "Walking limb": "thigh" } as const;
  const tips = { Horn: 0.025, Tail: 0.12, Fin: 0.08, "Walking limb": 0.42 };
  const depths = { Horn: 0.86, Tail: 0.96, Fin: 0.22, "Walking limb": 0.9 };
  const count = T.MathUtils.clamp(
    Math.ceil(path.getLength() / Math.max(0.03, radius * 0.8)),
    3,
    20,
  );
  const knots: Knot[] = Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1),
      v = path.getPoint(t).sub(vector(start)),
      r = radius * T.MathUtils.lerp(1, tips[kind], t ** 1.05);
    return [v.x, v.y, v.z, r, r * depths[kind]];
  });
  const part = addDetail(p, "sweep");
  return {
    ...part,
    label: kind,
    color,
    position: start,
    features: {
      ...part.features,
      ...(creatureBlend.read(p.features)
        ? { [creatureBlend.id]: p.features[creatureBlend.id] ?? {} }
        : {}),
      [figureSweep.id]: figureSweep.json({ knots }),
      [motionRole.id]: motionRole.json({ role: roles[kind] }),
    },
  };
}
export function repeatedPlates(
  doc: CharacterDocument,
  p: Part,
  rows: number,
  columns: number,
  face: PlateField["face"],
  width: number,
  equipped = false,
  color = "#d4c6a7",
  start = equipped ? 0.15 : 0.18,
  end = equipped ? 0.9 : 0.88,
) {
  if (
    !Number.isInteger(rows) ||
    rows < 1 ||
    rows > 16 ||
    !Number.isInteger(columns) ||
    columns < 1 ||
    columns > 7 ||
    doc.parts.length + rows * columns > 128
  )
    throw new Error("This arrangement exceeds the part limit.");
  if (!(width >= 0.01 && width <= 1)) throw new Error("Use a width from 1 to 100 cm.");
  const paintedRows = Boolean(figurePaint.read(p.features));
  const fitted = paintedRows && !equipped;
  const outfit = outfitWardrobe.read(doc.features)?.outfit ?? "Anatomy";
  const parts: Part[] = [];
  const labels = new Set(doc.parts.map((part) => part.label));
  const sweep = figureSweep.read(p.features);
  if (!sweep) throw new Error("Select a swept part for the plate path.");
  const path = new T.CatmullRomCurve3(sweep.knots.map(vector));
  const directions = {
    Front: [0, 0, 1],
    Back: [0, 0, -1],
    Left: [1, 0, 0],
    Right: [-1, 0, 0],
    Top: [0, 1, 0],
  };
  const assembly = figureAssembly.read(p.features);
  const mountBasis = vector(assembly ? (assembly.frameSize ?? [1, 1, 1]) : p.size);

  for (let row = 0; row < rows; row++) {
    const u = rows === 1 ? 0.5 : row / (rows - 1);
    const t = start + (end - start) * u,
      centre = path.getPoint(t),
      along = paintedRows ? new T.Vector3(0, 1, 0) : path.getTangent(t);
    const axis = vector(directions[face]);
    if (axis.clone().cross(along).lengthSq() < 0.001)
      axis.set(Math.abs(along.z) < 0.8 ? 0 : 1, 0, Math.abs(along.z) < 0.8 ? 1 : 0);
    axis.addScaledVector(along, -axis.dot(along)).normalize();
    const f = t * (sweep.knots.length - 1),
      i = Math.min(sweep.knots.length - 2, Math.floor(f)),
      a = sweep.knots[i],
      b = sweep.knots[i + 1];
    if (!a || !b) continue;
    const w = T.MathUtils.lerp(a[3], b[3], f - i),
      d = T.MathUtils.lerp(a[4], b[4], f - i);
    for (let col = 0; col < columns; col++) {
      const angle = columns === 1 ? 0 : (col / (columns - 1) - 0.5) * 1.65;
      const outward = axis.clone().applyAxisAngle(along, angle),
        across = along.clone().cross(outward);
      const radius = 1 / Math.hypot(outward.x / w, Math.hypot(outward.y, outward.z) / d);
      const position = centre
        .clone()
        .addScaledVector(outward, radius)
        .multiply(mountBasis)
        .toArray();
      const rotation = quatNormalize(
        new T.Quaternion()
          .setFromRotationMatrix(
            new T.Matrix4()
              .makeBasis(across, along, outward)
              .multiply(new T.Matrix4().makeRotationX(-0.15)),
          )
          .toArray(),
      );
      const plateWidth = width * (0.8 + 0.2 * u),
        size: Vec3 = [plateWidth, plateWidth * 1.18, plateWidth * 0.34];
      const plate = addDetail(p, "scute");
      const base =
        (equipped ? "armour scale " : "plate ") + (row + 1) + (columns > 1 ? "/" + (col + 1) : "");
      let label = base;
      for (let i = 2; labels.has(label); i++) label = base + " " + i;
      labels.add(label);
      parts.push({
        ...plate,
        label,
        position,
        rotation,
        size,
        color: fitted ? "#f9f5e9" : equipped ? color : "#ab9877",
        features: {
          ...plate.features,
          [figureAssembly.id]: figureAssembly.json({ order: 0 }),
          [figureFinish.id]: figureFinish.json({ surface: equipped ? "plain" : "scales" }),
          ...(fitted
            ? { [figureScute.id]: figureScute.json({ mount: { position, rotation, size } }) }
            : {}),
          ...(equipped
            ? {
                [motionRole.id]: motionRole.json({ role: "rigid" }),
                [outfitWear.id]: outfitWear.json({ visibleIn: [outfit] }),
                [figureJoin.id]: figureJoin.json({
                  end: "base",
                  depth: T.MathUtils.clamp(width * 0.34 * 0.14, 0.001, 0.008),
                }),
              }
            : {}),
        },
      });
    }
  }
  return parts;
}
export function arrangePlates(
  doc: CharacterDocument,
  carrierId: string,
  rows: number,
  columns: 1 | 3 | 5 | 7,
  face: PlateField["face"],
  color: string,
  field: boolean,
  shape?: Pick<PlateField, "start" | "end" | "wrap" | "overlap" | "crest">,
  repeatWidth = 0.12,
) {
  const host = doc.parts.find((p) => p.id === carrierId);
  if (!host) throw new Error("Select a plate carrier.");
  if (field) return growPlateField(doc, host, { rows, columns, face, color, ...shape });
  return repeatedPlates(
    doc,
    host,
    rows,
    columns,
    face,
    repeatWidth,
    false,
    color,
    shape?.start,
    shape?.end,
  ).map((part) => ({ op: "part.add", part }));
}
export function resizeCharacter(doc: CharacterDocument, height: number, target: number) {
  const factor = target / height;
  if (!Number.isFinite(factor) || factor <= 0) throw new Error("Enter a positive height.");
  const ops: object[] = [];
  for (const p of doc.parts.filter((q) => !q.parent)) {
    if (!figureAssembly.read(p.features) && doc.generation?.generator !== "irudd.human-adult")
      ops.push(feature(p, figureAssembly.id, figureAssembly.json({ order: 0, frameSize: p.size })));
    ops.push({
      op: "part.set",
      part: p.id,
      set: { position: p.position.map((v) => v * factor), size: p.size.map((v) => v * factor) },
    });
  }
  return ops;
}
export function graftBranch(
  source: CharacterDocument,
  root: Part,
  destination: CharacterDocument,
  target: Part,
  position: Vec3,
) {
  const copies = copyDetailBranch(source, root, false);
  return [
    ...graftDependencies(source, destination, copies),
    ...copies.map((p, i) => ({
      op: "part.add",
      part: i === 0 ? { ...p, parent: target.id, position, label: root.label } : p,
    })),
  ];
}

export function graftDependencies(
  source: CharacterDocument,
  destination: CharacterDocument,
  copies: readonly Part[],
) {
  const catalogs = new Set(copies.map((p) => p.component?.catalog));
  const assets = new Set<string>();
  for (const p of copies) {
    if (p.paint) {
      assets.add(p.paint.atlas);
      if (p.paint.occluder) assets.add(p.paint.occluder);
    }
    for (const f of familyFeatures) {
      const data = p.features[f.id];
      if (data === undefined) continue;
      for (const ref of f.references(data)) if (ref.kind === "asset") assets.add(ref.id);
    }
  }
  const ops: object[] = [];
  for (const dep of source.catalog.filter((d) => catalogs.has(d.id))) {
    const existing = destination.catalog.find((d) => d.id === dep.id);
    if (existing && existing.digest !== dep.digest)
      throw new Error("The destination uses a different revision of " + dep.id + ".");
    if (!existing) ops.push({ op: "catalog.set", dependency: dep });
  }
  for (const asset of source.assets)
    if (assets.has(asset.digest) && !destination.assets.some((a) => a.digest === asset.digest))
      ops.push({ op: "asset.add", asset });
  const sourceRigs = humanReferenceRigs.read(source.features);
  if (sourceRigs) {
    const rigs = Array.from(
      new Set([...(humanReferenceRigs.read(destination.features)?.rigs ?? []), ...sourceRigs.rigs]),
    );
    ops.push({
      op: "feature.set",
      feature: humanReferenceRigs.id,
      value: humanReferenceRigs.json({ rigs }),
    });
  }
  const credits = Array.from(assetCredits(source).values()).filter((c) => assets.has(c.digest));
  if (credits.length) {
    const declared = new Set([...destination.assets.map((a) => a.digest), ...assets]);
    const merged = mergeAssetCredits(destination, declared, credits);
    if (!merged.ok) throw new Error(merged.diagnostics.map((d) => d.message).join(" "));
    if (merged.value)
      ops.push({ op: "extension.set", namespace: assetCreditsNamespace, value: merged.value });
  }
  return ops;
}
