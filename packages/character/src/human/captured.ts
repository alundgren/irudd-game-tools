// Faces registered from HSRD-100 scans (Digital Reality Lab, CC BY 4.0), as
// in character-view/human-captured-portraits.js.

import { capturedAxes, type CapturedAxis } from "./catalogue.js";
import type { HumanBody } from "./body.js";

export const capturedSkinNames: ReadonlyArray<string> = capturedAxes.map(
  (axis) => "Captured skin " + Number(axis.slice(4)),
);

// Match a draw's age and frame loosely.
const subjects: ReadonlyArray<readonly [CapturedAxis, number, number]> = [
  ["scan0023", 0.72, 0.78],
  ["scan0028", -0.76, 0.12],
  ["scan0102", -0.64, 0.18],
  ["scan0040", 0.63, 0.58],
  ["scan0042", 0.82, 0.14],
  ["scan0112", -0.66, 0.76],
  ["scan0015", -0.58, 0.22],
  ["scan0027", -0.55, 0.47],
  ["scan0081", 0.22, 0.17],
];

export interface CapturedDraw {
  readonly axis: CapturedAxis;
  readonly amount: number;
  readonly complexion: string;
}

export function drawCapturedPortrait(
  person: { readonly frame?: number; readonly age?: number },
  random: () => number,
): CapturedDraw | null {
  if (random() >= 0.54) return null;
  const frame = person.frame ?? Number.NaN,
    age = person.age ?? Number.NaN;
  const weights = subjects.map(([, f, a]) =>
    Math.exp(-2.8 * (frame - f) ** 2 - 6 * (age - a) ** 2),
  );
  let draw = random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    draw -= weights[i] ?? 0;
    const subject = subjects[i];
    if (draw <= 0 && subject) {
      const axis = subject[0];
      return {
        axis,
        amount: 0.7 + 0.28 * random(),
        complexion: capturedSkinNames[capturedAxes.indexOf(axis)] ?? "",
      };
    }
  }
  return null;
}

export function applyCapturedShape(
  body: HumanBody,
  vertices: Float32Array,
  person: Partial<Record<CapturedAxis, number>>,
): void {
  const sum = capturedAxes.reduce((total, axis) => total + (person[axis] ?? 0), 0);
  if (!sum) return;
  for (const axis of capturedAxes) {
    const amount = person[axis] ?? 0;
    if (!(amount > 0)) continue;
    const { ids, delta } = body.captured(axis);
    const weight = (0.000002 * amount) / Math.max(1, sum);
    for (let i = 0; i < ids.length; i++) {
      const offset = 3 * (ids[i] ?? 0);
      for (let d = 0; d < 3; d++)
        vertices[offset + d] = (vertices[offset + d] ?? 0) + weight * (delta[3 * i + d] ?? 0);
    }
  }
}
