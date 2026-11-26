import {
  decodeWith,
  figureScapulaMount,
  type CharacterDocument,
  type FigureWing,
} from "@irudd/document";
import { type HumanBody } from "../human/body.js";
import {
  humanAdultId,
  HumanAdultParams,
  humanMeasurements,
  humanSlot,
} from "../human/generator.js";
import { scapulaSocket } from "../human/sockets.js";
import { evaluateHuman } from "../human/surface.js";
import { wingSurface } from "./body.js";

export function mountWings(
  doc: CharacterDocument,
  body: HumanBody,
  structure: FigureWing["structure"],
  length: number,
  color: string,
  seed: number,
) {
  const g = doc.generation;
  const params = g?.generator === humanAdultId && decodeWith(HumanAdultParams, g.params);
  const chest = doc.parts.find((p) => p.slot === humanSlot("spine_03"));
  if (!params || !params.ok || !chest) throw new Error("Choose an editable adult with a chest.");
  const surface = evaluateHuman(body, humanMeasurements(params.value));
  return ([1, -1] as const).flatMap((side): object[] => {
    const skin = { base: color, accent: color, pale: "#decba7" };
    const wing = wingSurface(
      structure,
      side,
      [side * length * 0.84, length * 0.36, -length * 0.45],
      [0, -length * 0.14, -length * 0.39],
      skin,
      seed,
    );
    const existing = doc.parts.find(
      (p) =>
        p.parent === chest.id &&
        figureScapulaMount.read(p.features)?.side === side &&
        p.features["figure.wing"],
    );
    if (existing)
      return [
        { op: "feature.set", feature: "figure.wing", part: existing.id, value: wing },
        { op: "part.set", part: existing.id, set: { color } },
      ];
    return [
      {
        op: "part.add",
        part: {
          id: "p-" + crypto.randomUUID(),
          label: (side === 1 ? "Left" : "Right") + " wing",
          parent: chest.id,
          shape: "ellipsoid",
          position: scapulaSocket(surface, side),
          rotation: [0, 0, 0, 1],
          size: [1, 1, 1],
          color,
          sculpt: [],
          features: { "figure.wing": wing, "figure.scapula-mount": { side } },
        },
      },
    ];
  });
}
