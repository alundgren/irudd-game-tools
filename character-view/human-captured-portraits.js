import { unzlibSync } from "three/addons/libs/fflate.module.js";
import captures from "./human-captured-portraits-data.json" with { type: "json" };

export const capturedAxes = Object.keys(captures);
export const capturedTitles = {};
export const capturedSkinNames = [];
const axisForSkin = new Map();
for (const axis of capturedAxes) {
  const number = Number(axis.slice(4));
  const name = "Captured skin " + number;
  capturedTitles[axis] = "Captured face " + number;
  capturedSkinNames.push(name);
  axisForSkin.set(name, axis);
}

export const captureCredit = {
  title: "HSRD-100: 100 High-Quality 3D Human Scans Dataset",
  author: "Digital Reality Lab",
  year: 2025,
  source: "https://huggingface.co/datasets/digitalrealitylab/HSRD-100/tree/9cc5e9c138dd310dc88c95c80e5db0a3ecb7971a",
  license: "https://creativecommons.org/licenses/by/4.0/",
  changes: "Registered face and iris photographs and fitted facial measurements to the editable adult mesh."
};
export function capturedSkin(name) {
  return captures[axisForSkin.get(name)];
}

export function creditedCaptures(form) {
  return capturedAxes.filter(axis => form?.human?.[axis] > 0 || axis === axisForSkin.get(form?.complexion))
    .map(axis => captures[axis].source);
}

const subjects = [
  ["scan0023", .72, .78], ["scan0028", -.76, .12], ["scan0102", -.64, .18],
  ["scan0040", .63, .58], ["scan0042", .82, .14], ["scan0112", -.66, .76], ["scan0015", -.58, .22],
  ["scan0027", -.55, .47], ["scan0081", .22, .17]
];

export function drawCapturedPortrait(person, random) {
  if (random() >= .54) return null;
  const weights = subjects.map(([, frame, age]) => Math.exp(-2.8 * (person.frame-frame)**2 - 6 * (person.age-age)**2));
  let draw = random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    draw -= weights[i];
    if (draw <= 0) {
      const axis = subjects[i][0];
      return { axis, amount: .70 + .28 * random(), complexion: capturedSkinNames[capturedAxes.indexOf(axis)] };
    }
  }
  return null;
}

function decode(encoded, Type) {
  const bytes = unzlibSync(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)));
  return new Type(bytes.buffer, bytes.byteOffset, bytes.byteLength / Type.BYTES_PER_ELEMENT);
}
const shapes = new Map();
export function applyCapturedShape(vertices, person) {
  const sum = capturedAxes.reduce((total, axis) => total + (person[axis] ?? 0), 0);
  if (!sum) return;
  for (const axis of capturedAxes) {
    if (!(person[axis] > 0)) continue;
    if (!shapes.has(axis)) {
      const { ids, delta } = captures[axis];
      shapes.set(axis, { ids: decode(ids, Uint16Array), delta: decode(delta, Int16Array) });
    }
    const { ids, delta } = shapes.get(axis);
    const weight = .000002 * person[axis] / Math.max(1, sum);
    for (let i = 0; i < ids.length; i++) {
      const offset = 3 * ids[i];
      for (let d = 0; d < 3; d++) vertices[offset + d] += weight * delta[3 * i + d];
    }
  }
}

const irisValues = new Map();
export function capturedIris(name) {
  const capture = capturedSkin(name);
  if (!capture) return null;
  if (!irisValues.has(name)) {
    irisValues.set(name, { size: capture.iris.size, values: decode(capture.iris.value, Uint8Array) });
  }
  return irisValues.get(name);
}
