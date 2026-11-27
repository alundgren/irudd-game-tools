import * as T from "three";
import {
  figureAssembly,
  figureSweep,
  figureCage,
  figureFinish,
  figureHornSwatch,
  figurePlateSite,
  jsonEqual,
  quatNormalize,
  type Part,
  type PlateField,
  type Vec3,
} from "@irudd/document";
import { legacyPlateCage, makePlate } from "./surfaces/plate-growth.js";
const vector = (p: readonly number[]) => new T.Vector3(p[0], p[1], p[2]);
export function legacyPlateLayout(p: Part, shape: PlateField) {
  const { rows, columns, face } = shape;
  const sites = new Map<
    string,
    { row: number; col: number; position: Vec3; rotation: Part["rotation"]; size: Vec3 }
  >();
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
  if (shape.end - shape.start < 0.04)
    throw new Error("The end of the plate run must follow its start by at least 4%.");
  const span = (path.getLength() * (shape.end - shape.start)) / (rows - 1);
  const assembly = figureAssembly.read(p.features);
  const mountBasis = vector(assembly ? (assembly.frameSize ?? [1, 1, 1]) : p.size);

  for (let row = 0; row < rows; row++) {
    const t = shape.start + ((shape.end - shape.start) * row) / (rows - 1),
      centre = path.getPoint(t),
      along = path.getTangent(t);
    const axis = vector(directions[face]);
    if (Math.abs(axis.dot(along)) > 0.98) axis.set(0, 0, 1);
    if (Math.abs(axis.dot(along)) > 0.98) axis.set(1, 0, 0);
    axis.addScaledVector(along, -axis.dot(along)).normalize();
    const f = t * (sweep.knots.length - 1),
      i = Math.min(sweep.knots.length - 2, Math.floor(f)),
      a = sweep.knots[i],
      b = sweep.knots[i + 1];
    if (!a || !b) continue;
    const w = T.MathUtils.lerp(a[3], b[3], f - i),
      d = T.MathUtils.lerp(a[4], b[4], f - i);
    for (let col = 0; col < columns; col++) {
      const angle =
        columns === 1 ? 0 : (col / (columns - 1) - 0.5) * T.MathUtils.degToRad(shape.wrap);
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
          .setFromRotationMatrix(new T.Matrix4().makeBasis(across, along, outward))
          .toArray(),
      );
      const size: Vec3 = [
        Math.max(0.008, Math.min(w * 1.35, span) * 1.15),
        Math.max(0.008, span * (1 + shape.overlap)),
        Math.max(0.006, span * (0.15 + shape.crest * (1 - Math.abs(angle) / Math.PI) * 0.4)),
      ];
      sites.set(row + "/" + col, { row, col, position, rotation, size });
    }
  }
  return sites;
}

export function migratePlate(
  p: Part,
  field: PlateField,
  layout: ReturnType<typeof legacyPlateLayout>,
  template: ReturnType<typeof makePlate>,
  features: Part["features"],
): Part {
  const site = figurePlateSite.read(p.features);
  if (!site || p.features[figureHornSwatch.id] || field.rest) return p;
  const base = legacyPlateCage(site.row, site.column),
    cage = figureCage.read(p.features),
    pose = layout.get(site.row + "/" + site.column);
  if (!pose || !cage || !jsonEqual(base.faces, cage.faces)) return p;
  const turn = new T.Quaternion(...pose.rotation),
    size = vector(pose.size);
  const vertices = template.cage.vertices.map((v, i) => {
    const original = base.vertices[i],
      edited = cage.vertices[i];
    if (!original || !edited) return v;
    return vector(edited)
      .sub(vector(original))
      .multiply(size)
      .applyQuaternion(turn)
      .add(vector(v))
      .toArray();
  });
  const result = {
    ...p,
    position: vector(p.position)
      .sub(vector(pose.position))
      .add(vector(template.position))
      .toArray(),
    rotation: jsonEqual(p.rotation, pose.rotation)
      ? quatNormalize([0, 0, 0, 1])
      : quatNormalize(new T.Quaternion(...p.rotation).multiply(turn.invert()).toArray()),
    size: vector(p.size).divide(size).toArray(),
    color: p.color === field.color ? template.color : p.color,
    features: {
      ...features,
      ...p.features,
      [figureAssembly.id]: features[figureAssembly.id] ?? {},
      [figureCage.id]: figureCage.json({
        ...cage,
        faces: template.cage.faces,
        vertices,
        ...(jsonEqual(cage.creases, base.creases) ? { creases: template.cage.creases } : {}),
      }),
      [figureFinish.id]: p.features[figureFinish.id] ?? { surface: "horn" },
    },
  };
  return result;
}
