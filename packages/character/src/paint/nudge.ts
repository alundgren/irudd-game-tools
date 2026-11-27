import * as T from "three";
import {
  applyOperations,
  buildAxes,
  createRegistry,
  decodeOperations,
  derivePartId,
  familyFeatures,
  figureAnatomy,
  figureBuild,
  figureDrape,
  figureMantle,
  figurePiece,
  figureSculpt,
  figureSweep,
  type CharacterDocument,
  type Knot,
  type Part,
} from "@irudd/document";
import { faceAxes, reshapeSweep } from "../shape-tools.js";
import { jsonOperations } from "./art-fit.js";
const sizeAxes = ["width", "height", "depth"] as const;
const moveAxes = ["across", "lift", "forward"] as const;
const turnAxes = ["pitch", "yaw", "roll"] as const;
const spineAxes = ["bow", "side bend", "extend", "tip girth"];
const clothAxes = ["hem opening", "slit height", "fold depth", "fold count"];
const face = (p: Part) =>
  figurePiece.read(p.features)?.piece === "head" ||
  figureAnatomy.read(p.features)?.region === "face";
export function paintNudgeAxes(doc: CharacterDocument, p?: Part) {
  return [
    ...sizeAxes,
    ...moveAxes,
    ...turnAxes,
    ...(p ? [] : buildAxes),
    ...(p && figureSweep.read(p.features) ? [...spineAxes, ...clothAxes] : []),
    ...((p ? face(p) : doc.parts.some(face)) ? faceAxes : []),
  ];
}
const registry = createRegistry({ features: familyFeatures });
const clamp = T.MathUtils.clamp;
type Amounts = Readonly<Record<string, number>>;
function bent(knots: readonly Knot[], v: Amounts): Knot[] {
  const start = knots[0],
    end = knots.at(-1);
  if (!start || !end) return [...knots];
  const blend = (i: number, k: 0 | 1 | 2 | 3 | 4) => T.MathUtils.lerp(start[k], end[k], i / 4);
  const rows =
    knots.length === 2 && (v["bow"] || v["side bend"])
      ? Array.from({ length: 5 }, (_, i): Knot => [
          blend(i, 0),
          blend(i, 1),
          blend(i, 2),
          blend(i, 3),
          blend(i, 4),
        ])
      : knots;
  const point = (r: Knot) => new T.Vector3(r[0], r[1], r[2]);
  const span = new T.CatmullRomCurve3(rows.map(point)).getLength();
  const root = point(start),
    axis = point(end).sub(root).normalize();
  const up = Math.abs(axis.y) > 0.8 ? new T.Vector3(0, 0, 1) : new T.Vector3(0, 1, 0);
  up.addScaledVector(axis, -axis.dot(up)).normalize();
  const side = new T.Vector3().crossVectors(axis, up).normalize();
  return rows.map((row, i) => {
    const t = i / (rows.length - 1),
      girth = 1 + (t * (v["tip girth"] ?? 0)) / 100;
    const p = point(row)
      .sub(root)
      .multiplyScalar(1 + (v["extend"] ?? 0) / 100)
      .add(root)
      .addScaledVector(up, (span * Math.sin(t * Math.PI) * (v["bow"] ?? 0)) / 100)
      .addScaledVector(side, (span * t * t * (v["side bend"] ?? 0)) / 100);
    return [...p.toArray(), clamp(row[3] * girth, 0.0005, 4), clamp(row[4] * girth, 0.0005, 4)];
  });
}
export function paintNudge(doc: CharacterDocument, target: string | null, amounts: Amounts) {
  const operations: object[] = [];
  const add = (part: Part | undefined, feature: string, value: unknown) =>
    operations.push({ op: "feature.set", ...(part ? { part: part.id } : {}), feature, value });
  const selected = doc.parts.find((p) => p.id === target);
  if (target && !selected) throw new Error("The nudged part is missing.");
  const axes = paintNudgeAxes(doc, selected);
  for (const [a, v] of Object.entries(amounts))
    if (!axes.includes(a) || !Number.isFinite(v) || Math.abs(v) > 40)
      throw new Error("Invalid painted edit nudge: " + a);
  const amount = (a: string) => amounts[a] ?? 0;
  const active = (axes: readonly string[]) => axes.some((a) => amount(a) !== 0);
  if (!selected && active(buildAxes)) {
    const build = figureBuild.read(doc.features) ?? {
      frame: doc.parts.filter((p) => !figureMantle.read(p.features)).map((p) => p.id),
    };
    const next = { ...build };
    for (const a of buildAxes)
      if (amount(a)) next[a] = clamp((build[a] ?? 1) * (1 + amount(a) / 100), 0.4, 2.4);
    add(undefined, figureBuild.id, next);
  }
  for (const p of doc.parts) {
    if (selected && p.id !== selected.id) continue;
    const sweep = selected && figureSweep.read(p.features);
    if (sweep && active(spineAxes))
      operations.push(...reshapeSweep(doc, p, bent(sweep.knots, amounts)));
    if (sweep && active(clothAxes)) {
      const d = figureDrape.read(p.features) ?? {
        folds: 10,
        depth: 0,
        twist: 0,
        slit: 0,
        slitHeight: 0.6,
      };
      add(p, figureDrape.id, {
        ...d,
        slit: clamp(d.slit + amount("hem opening") / 100, 0, 0.35),
        slitHeight: clamp(d.slitHeight + amount("slit height") / 100, 0.05, 1),
        depth: clamp(d.depth + amount("fold depth") / 100, 0, 0.3),
        folds: clamp(Math.round(d.folds + amount("fold count")), 2, 32),
      });
    }
    if (face(p) && active(faceAxes)) {
      const original = {
        ...figurePiece.read(p.features)?.look?.sculpt,
        ...figureSculpt.read(p.features)?.sculpt,
      };
      const sculpt = { ...original };
      for (const a of faceAxes)
        if (amount(a)) sculpt[a] = clamp((original[a] ?? 1) * (1 + amount(a) / 100), 0.35, 2);
      add(p, figureSculpt.id, { sculpt });
    }
    if (!selected && p.parent) continue;
    if (active([...sizeAxes, ...moveAxes, ...turnAxes])) {
      const angles = new T.Euler().setFromQuaternion(new T.Quaternion(...p.rotation));
      const scale = sizeAxes.map((a) => 1 + amount(a) / 100);
      const turn = new T.Euler(
        angles.x + T.MathUtils.degToRad(amount("pitch")),
        angles.y + T.MathUtils.degToRad(amount("yaw")),
        angles.z + T.MathUtils.degToRad(amount("roll")),
      );
      operations.push({
        op: "part.set",
        part: p.id,
        set: {
          size: p.size.map((d, i) => d * (scale[i] ?? 1)),
          position: p.position.map(
            (d, i) => d * (selected ? 1 : (scale[i] ?? 1)) + amount(moveAxes[i] ?? "") / 100,
          ),
          rotation: new T.Quaternion().setFromEuler(turn).toArray(),
        },
      });
    }
  }
  if (!operations.length) return { document: doc, operations: [] };
  const decoded = decodeOperations(operations);
  if (!decoded.ok) throw new Error(decoded.diagnostics.map((d) => d.message).join(" "));
  const result = applyOperations(doc, decoded.value, {
    registry,
    retired: new Set(),
    idFor: (slot) => derivePartId(doc.id, "paint-nudge", slot),
  });
  if (!result.ok) throw new Error(result.diagnostics.map((d) => d.message).join(" "));
  return { document: result.value, operations: jsonOperations(decoded.value) };
}
