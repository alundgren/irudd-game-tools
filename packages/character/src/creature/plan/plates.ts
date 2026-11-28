import type { Knot, PlateField, PlateFieldRest } from "@irudd/document";
import { makePlate, surfaceChart } from "../../surfaces/plate-shape.js";
import type { Form, FormPart } from "./types.js";

type Field = PlateField;

function restOf(carrier: FormPart, settings: Field): PlateFieldRest {
  const knots = (carrier.knots ?? []).map(([x = 0, y = 0, z = 0, w = 0, d = 0]): Knot => [
    settings.mirrored ? -x : x,
    y,
    z,
    w,
    d,
  ]);
  const [a = 1, b = 1, c = 1] = carrier.frameSize ?? [1, 1, 1];
  return { knots, horizontal: false, frameSize: [a, b, c] };
}

function plateName(used: Set<string>, carrier: string, row: number, column: number) {
  const suffix = " plate " + (row + 1) + "." + (column + 1);
  const base = carrier.slice(0, 64 - suffix.length) + suffix;
  let id = base;
  for (let n = 2; used.has(id); n++) {
    const extra = " " + n;
    id = base.slice(0, 64 - extra.length) + extra;
  }
  used.add(id);
  return id;
}

export function growPlates(form: Form, carrier: FormPart, settings: Field): Form {
  const rest = restOf(carrier, settings);
  const chart = surfaceChart(rest, settings);
  const used = new Set(form.parts.map((p) => p.id));
  const parts = form.parts.map((p) =>
    p === carrier ? { ...p, plateGrowth: settings, plateGrowthRest: rest } : p,
  );
  for (let row = 0; row < settings.rows; row++)
    for (let column = 0; column < settings.columns; column++) {
      const plate = makePlate(chart, settings, row, column);
      parts.push({
        id: plateName(used, carrier.id, row, column),
        parent: carrier.id,
        shape: "cage",
        position: [...plate.position],
        rotation: [0, 0, 0],
        size: [1, 1, 1],
        frameSize: [1, 1, 1],
        color: plate.color,
        surface: "horn",
        hornSwatch: plate.hornSwatch,
        motionRole: "rigid",
        cage: {
          vertices: plate.cage.vertices.map((v) => [...v]),
          faces: plate.cage.faces.map((f) => [...f]),
          creases: plate.cage.creases.map((c) => [...c]),
          levels: 1,
        },
        surfaceJoin: { faces: [...plate.surfaceJoin.faces], depth: plate.surfaceJoin.depth },
        plateSite: { ...plate.plateSite },
      });
    }
  if (parts.length > 128) throw new Error("This plate field exceeds the 128 part limit.");
  return { ...form, parts };
}
