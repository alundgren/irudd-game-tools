import {
  figureAssembly,
  figureCage,
  figureFinish,
  figureHornSwatch,
  figureJoin,
  figurePaint,
  figurePlateField,
  figurePlateSite,
  figureSweep,
  jsonEqual,
  motionRole,
  type CharacterDocument,
  type Json,
  type Part,
  type PlateField,
  type PlateFieldRest,
  type Vec3,
} from "@irudd/document";
import { addDetail, removeDetailBranches } from "./surface-edit.js";
import { makePlate, surfaceChart } from "./surfaces/plate-growth.js";

import { legacyPlateLayout, migratePlate } from "./legacy-plates.js";
type Template = ReturnType<typeof makePlate>;
export const plateDefaults: PlateField = {
  seed: 1,
  tipSeed: 1,
  rows: 6,
  columns: 3,
  face: "Back",
  direction: "first",
  start: 0.14,
  end: 0.83,
  wrap: 150,
  overlap: 0.4,
  crest: 0.65,
  rise: 1,
  color: "#c2ab7c",
  mirrored: false,
};

function restOf(p: Part, settings: PlateField): PlateFieldRest {
  const sweep = figureSweep.read(p.features);
  if (!sweep) throw new Error("Choose a swept carrier for growing plates.");
  const trace = figurePaint.read(p.features);
  const assembly = figureAssembly.read(p.features);
  return {
    knots: sweep.knots.map(([x, y, z, w, d]) => [settings.mirrored ? -x : x, y, z, w, d]),
    horizontal: Boolean(trace && trace.frame !== "path"),
    frameSize: assembly ? (assembly.frameSize ?? [1, 1, 1]) : p.size,
  };
}
const change = (p: Part, feature: string, value: Json | null) => ({
  op: "feature.set",
  part: p.id,
  feature,
  value,
});
function plateFeatures(t: Template) {
  return {
    [figureAssembly.id]: figureAssembly.json({ order: 0, frameSize: [1, 1, 1] }),
    [figureCage.id]: figureCage.json(t.cage),
    [figureJoin.id]: figureJoin.json(t.surfaceJoin),
    [figureHornSwatch.id]: figureHornSwatch.json({ swatch: t.hornSwatch }),
    [figureFinish.id]: figureFinish.json({ surface: "horn" }),
    [figurePlateSite.id]: figurePlateSite.json(t.plateSite),
    [motionRole.id]: motionRole.json({ role: "rigid" }),
  };
}
function shift(v: Vec3, before: Vec3, after: Vec3): Vec3 {
  const axis = (i: 0 | 1 | 2) =>
    before[i] === v[i] ? after[i] : Math.round((v[i] + after[i] - before[i]) * 1e8) / 1e8;
  return [axis(0), axis(1), axis(2)];
}
function reshape(p: Part, before: Template, after: Template, single: boolean) {
  const cage = figureCage.read(p.features);
  const ops: object[] = [];
  if (
    cage &&
    cage.vertices.length === before.cage.vertices.length &&
    jsonEqual(cage.faces, before.cage.faces)
  ) {
    const next = figureCage.json({
      ...cage,
      faces: after.cage.faces,
      vertices: cage.vertices.map((v, i) => {
        const a = before.cage.vertices[i],
          b = after.cage.vertices[i];
        return a && b ? shift(v, a, b) : v;
      }),
    });
    if (!jsonEqual(next, figureCage.json(cage))) ops.push(change(p, figureCage.id, next));
  } else if (single) throw new Error("This plate has a custom topology. Sculpt its tip directly.");
  if (
    jsonEqual(p.features[figureJoin.id], before.surfaceJoin) &&
    !jsonEqual(before.surfaceJoin, after.surfaceJoin)
  )
    ops.push(change(p, figureJoin.id, after.surfaceJoin));
  if (!p.features[figureHornSwatch.id])
    ops.push(change(p, figureHornSwatch.id, { swatch: after.hornSwatch }));
  const position = shift(p.position, before.position, after.position);
  const color = p.color === before.color ? after.color : p.color;
  if (!jsonEqual(position, p.position) || p.color !== color)
    ops.push({ op: "part.set", part: p.id, set: { position, color } });
  return ops;
}
export function changePlateTip(doc: CharacterDocument, plate: Part, seed: number | null): object[] {
  const host = doc.parts.find((p) => p.id === plate.parent);
  const field = host && figurePlateField.read(host.features),
    site = figurePlateSite.read(plate.features);
  if (!host || !field || !site) throw new Error("Select a plate in a growth field.");
  const chart = surfaceChart(field.rest ?? restOf(host, field), field);
  const template = (tipSeed: number) =>
    makePlate(chart, { ...field, tipSeed }, site.row, site.column);
  if (!field.rest && !plate.features[figureHornSwatch.id]) {
    const before = template(site.tipSeed ?? field.tipSeed),
      next = migratePlate(
        plate,
        field,
        legacyPlateLayout(host, field),
        before,
        plateFeatures(before),
      );
    if (next !== plate)
      return [{ op: "part.replace", part: next }, ...changePlateTip(doc, next, seed)];
  }
  const ops = reshape(
    plate,
    template(site.tipSeed ?? field.tipSeed),
    template(seed ?? field.tipSeed),
    true,
  );
  return [
    ...ops,
    change(
      plate,
      figurePlateSite.id,
      figurePlateSite.json({
        row: site.row,
        column: site.column,
        ...(seed === null ? {} : { tipSeed: seed }),
      }),
    ),
  ];
}
export function growPlateField(
  doc: CharacterDocument,
  host: Part,
  patch: Partial<Omit<PlateField, "rest">>,
  previousHost: Part = host,
) {
  const previous = figurePlateField.read(host.features);
  const settings = { ...plateDefaults, ...previous, ...patch };
  const keys = Object.keys(patch);
  const baseline = previous && (previous.rest ?? restOf(previousHost, previous));
  const rest =
    baseline && keys.length && keys.every((k) => k === "tipSeed" || k === "color")
      ? baseline
      : restOf(host, settings);
  const nextChart = surfaceChart(rest, settings);
  const oldChart = previous && baseline && surfaceChart(baseline, previous);
  const ops: object[] = [
    change(host, figurePlateField.id, figurePlateField.json({ ...settings, rest })),
  ];
  const removed: Part[] = [];
  const legacy = previous && !previous.rest ? legacyPlateLayout(previousHost, previous) : undefined;
  const occupied = new Set<number>();
  let count = doc.parts.length;
  for (let p of doc.parts) {
    if (p.parent !== host.id) continue;
    const site = figurePlateSite.read(p.features);
    if (!site) continue;
    const { row, column } = site,
      key = row * 7 + column;
    if (occupied.has(key)) throw new Error("Detach duplicate plates before updating the field.");
    occupied.add(key);
    if (!oldChart || !previous) throw new Error("Plate has no growth field.");
    const before = makePlate(
      oldChart,
      { ...previous, tipSeed: site.tipSeed ?? previous.tipSeed },
      row,
      column,
    );
    if (legacy) {
      const next = migratePlate(p, previous, legacy, before, plateFeatures(before));
      if (p !== next) {
        ops.push({ op: "part.replace", part: next });
        p = next;
      }
    }
    if (row < settings.rows && column < settings.columns) {
      const after = makePlate(
        nextChart,
        { ...settings, tipSeed: site.tipSeed ?? settings.tipSeed },
        row,
        column,
      );
      ops.push(...reshape(p, before, after, false));
    } else {
      if (doc.parts.some((c) => c.parent === p.id))
        throw new Error("Move attachments off surplus plates before shrinking the field.");
      const unchanged =
        !p.component &&
        !p.paint &&
        !p.sculpt.length &&
        p.color === before.color &&
        jsonEqual(p.position, before.position) &&
        jsonEqual(p.size, [1, 1, 1]) &&
        jsonEqual(p.rotation, [0, 0, 0, 1]) &&
        jsonEqual(p.features, plateFeatures(before));
      if (unchanged) {
        removed.push(p);
        count--;
      } else ops.push(change(p, figurePlateSite.id, null));
    }
  }
  if (removed.length) ops.push(...removeDetailBranches(doc, removed));
  const labels = new Set(doc.parts.map((p) => p.label));
  for (let row = 0; row < settings.rows; row++)
    for (let column = 0; column < settings.columns; column++) {
      if (
        occupied.has(row * 7 + column) ||
        (previous && row < previous.rows && column < previous.columns)
      )
        continue;
      count++;
      const t = makePlate(nextChart, settings, row, column);
      const base = host.label.slice(0, 92) + " plate " + (row + 1) + "." + (column + 1);
      let label = base;
      for (let i = 2; labels.has(label); i++) label = base + " " + i;
      labels.add(label);
      ops.push({
        op: "part.add",
        part: {
          ...addDetail(host, "cage"),
          label,
          size: [1, 1, 1],
          position: t.position,
          color: t.color,
          features: plateFeatures(t),
        },
      });
    }
  if (count > 128) throw new Error("This plate field exceeds the 128 part limit.");
  return ops;
}
